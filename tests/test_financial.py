from datetime import date
from decimal import Decimal
import pytest
from sqlalchemy import select
from app.schemas.inputs import TransactionInput, SettlementInput, SplitInput, GroupInput, MemberInput, GroupExpenseInput
from app.services.transactions import TransactionService, SettlementService
from app.services.balances import BalanceCalculationService
from app.services.groups import GroupSplitService, GroupService
from app.services.dashboard import DashboardService
from app.services.ledger import LedgerService
from app.services.catalogs import ContactService
from app.models import User, GroupMember
from app.exceptions import AppError


def transaction(kind='MONEY_LENT', amount='10000', currency='INR', contact=1):
    return TransactionInput(transaction_type=kind, amount=amount, currency=currency, contact_id=contact, purpose='Test', transaction_date=date(2026, 9, 1))


def repayment(amount, currency='INR'):
    return SettlementInput(amount=amount, currency=currency, settlement_date=date(2026, 9, 2))


async def test_ledger_scenarios_and_ownership(db):
    tx = await TransactionService(db).save(1, transaction())
    await SettlementService(db).create(1, tx['id'], repayment('3000'))
    details = await TransactionService(db).details(1, tx['id'])
    assert Decimal(details['amount']) == Decimal('10000')
    assert details['settled_amount'] == Decimal('3000')
    assert details['outstanding_amount'] == Decimal('7000')
    assert details['status'] == 'PARTIALLY_SETTLED'
    borrowed = await TransactionService(db).save(1, transaction('MONEY_BORROWED', '500', 'MYR'))
    await SettlementService(db).create(1, borrowed['id'], repayment('200', 'MYR'))
    await TransactionService(db).save(1, transaction('PERSONAL_EXPENSE', '50', 'MYR', None))
    totals = await BalanceCalculationService(db).totals(1, 1)
    assert totals == {'receivables': {'INR': Decimal('7000')}, 'payables': {'MYR': Decimal('300')}}
    with pytest.raises(AppError) as error:
        await TransactionService(db).details(2, tx['id'])
    assert error.value.status == 404
    with pytest.raises(AppError):
        await SettlementService(db).create(2, tx['id'], repayment('1'))
    with pytest.raises(AppError):
        await TransactionService(db).save(1, transaction(contact=2))
    assert (await ContactService(db).list(1, 1, 20, balance_filter='owes_me'))['total'] == 1
    assert (await LedgerService(db).contact(1, 1, 1, 20))['history']['total'] == 4
    dashboard = await DashboardService(db).load(1)
    assert dashboard['receivables']['INR'] == Decimal('7000')


async def test_settlement_invariants(db):
    tx = await TransactionService(db).save(1, transaction(amount='100'))
    for data in [repayment('101'), repayment('1', 'MYR')]:
        with pytest.raises(AppError):
            await SettlementService(db).create(1, tx['id'], data)
    await SettlementService(db).create(1, tx['id'], repayment('100'))
    assert (await TransactionService(db).details(1, tx['id']))['status'] == 'SETTLED'
    with pytest.raises(AppError):
        await SettlementService(db).create(1, tx['id'], repayment('1'))
    with pytest.raises(AppError):
        await TransactionService(db).delete(1, tx['id'])
    personal = await TransactionService(db).save(1, transaction('PERSONAL_EXPENSE', '10', 'INR', None))
    with pytest.raises(AppError):
        await SettlementService(db).create(1, personal['id'], repayment('1'))
    await TransactionService(db).delete(1, personal['id'])
    with pytest.raises(AppError):
        await TransactionService(db).details(1, personal['id'])


def test_deterministic_equal_and_exact_splits():
    splits = [SplitInput(group_member_id=i) for i in [3, 1, 2]]
    shares = GroupSplitService.calculate(Decimal('100'), 'MYR', 'EQUAL', splits)
    assert shares == {1: Decimal('33.34'), 2: Decimal('33.33'), 3: Decimal('33.33')}
    assert sum(shares.values()) == Decimal('100')
    assert sum(GroupSplitService.calculate(Decimal('1'), 'JPY', 'EQUAL', splits).values()) == Decimal('1')
    with pytest.raises(AppError):
        GroupSplitService.calculate(Decimal('100'), 'MYR', 'EXACT', [SplitInput(group_member_id=1, share_amount='99')])
    with pytest.raises(AppError):
        GroupSplitService.calculate(Decimal('1.001'), 'MYR', 'EQUAL', splits)


async def test_group_atomic_creation_access_and_balance(db):
    service = GroupService(db)
    group = await service.save(await db.get(User, 1), GroupInput(name='Trip', default_currency='MYR'))
    other = await service.save_member(1, group.id, MemberInput(display_name='Bob', registered_email='bob@example.com'))
    owner = await db.scalar(select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == 1))
    data = GroupExpenseInput(title='Dinner', amount='100', currency='MYR', paid_by_member_id=owner.id, expense_date=date.today(), split_type='EQUAL', splits=[SplitInput(group_member_id=owner.id), SplitInput(group_member_id=other.id)])
    expense = await service.save_expense(1, group.id, data)
    assert sum(s.share_amount for s in expense['splits']) == Decimal('100')
    assert await service.balances(2, group.id) == {'MYR': {owner.id: Decimal('50'), other.id: Decimal('-50')}}
    with pytest.raises(AppError):
        await service.save_expense(2, group.id, data)
    await service.remove_member(1, group.id, other.id)
    with pytest.raises(AppError):
        await service.access(2, group.id)
    assert (await service.balances(1, group.id))['MYR'][other.id] == Decimal('-50')
    await service.delete_expense(1, group.id, expense['id'])
    assert await service.balances(1, group.id) == {}
