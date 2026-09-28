from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.security import access_token, token_hash
from app.db.base import utcnow
from app.db.session import get_db
from app.main import app
from app.models import GroupMember, User, UserSession
from app.schemas.inputs import (
    GroupExpenseInput, GroupInput, MemberInput, SettlementInput, SplitInput,
    TransactionInput,
)
from app.services.balances import BalanceCalculationService
from app.services.dashboard import DashboardService
from app.services.groups import GroupService
from app.services.transactions import SettlementService, TransactionService


async def add_transaction(db, kind, amount, currency='INR', user_id=1, **values):
    return await TransactionService(db).save(user_id, TransactionInput(
        transaction_type=kind,
        amount=amount,
        currency=currency,
        contact_id=None if kind == 'PERSONAL_EXPENSE' else user_id,
        purpose='Dashboard balance test',
        transaction_date=date.today(),
        **values,
    ))


async def repay(db, transaction, amount):
    return await SettlementService(db).create(1, transaction['id'], SettlementInput(
        amount=amount,
        currency=transaction['currency'],
        settlement_date=date.today(),
    ))


@pytest.mark.parametrize(('receivable', 'payable', 'expected'), [
    ('30000', '20000', '10000'),
    ('10000', '20000', '-10000'),
    ('20000', '20000', '0'),
])
async def test_net_balance_keeps_positive_negative_and_zero_currencies(db, receivable, payable, expected):
    await add_transaction(db, 'MONEY_LENT', receivable)
    await add_transaction(db, 'MONEY_BORROWED', payable)

    dashboard = await DashboardService(db).load(1)

    assert dashboard['net_balances'] == {'INR': Decimal(expected)}
    assert dashboard['receivables'] == {'INR': Decimal(receivable)}
    assert dashboard['payables'] == {'INR': Decimal(payable)}
    # Other consumers of the common totals service retain the existing contract.
    assert await BalanceCalculationService(db).totals(1) == {
        'receivables': dashboard['receivables'],
        'payables': dashboard['payables'],
    }


async def test_dashboard_without_personal_lending_has_no_net_currencies(db):
    dashboard = await DashboardService(db).load(1)

    assert dashboard['net_balances'] == {}
    assert dashboard['receivables'] == {}
    assert dashboard['payables'] == {}


async def test_repayments_update_net_using_only_remaining_balances(db):
    lent = await add_transaction(db, 'MONEY_LENT', '30000')
    borrowed = await add_transaction(db, 'MONEY_BORROWED', '20000')
    await repay(db, lent, '15000')
    await repay(db, borrowed, '2000')

    dashboard = await DashboardService(db).load(1)

    assert dashboard['receivables'] == {'INR': Decimal('15000')}
    assert dashboard['payables'] == {'INR': Decimal('18000')}
    assert dashboard['net_balances'] == {'INR': Decimal('-3000')}

    await repay(db, lent, '15000')
    await repay(db, borrowed, '18000')

    settled = await DashboardService(db).load(1)
    assert settled['receivables'] == {'INR': Decimal('0')}
    assert settled['payables'] == {'INR': Decimal('0')}
    assert settled['net_balances'] == {'INR': Decimal('0')}


async def test_net_balance_separates_currencies_and_preserves_decimal_precision(db):
    await add_transaction(db, 'MONEY_LENT', '40000', 'INR')
    await add_transaction(db, 'MONEY_BORROWED', '1000', 'MYR')
    await add_transaction(db, 'MONEY_LENT', '0.30', 'USD')
    await add_transaction(db, 'MONEY_BORROWED', '0.20', 'USD')

    dashboard = await DashboardService(db).load(1)

    assert dashboard['net_balances'] == {
        'INR': Decimal('40000'),
        'MYR': Decimal('-1000'),
        'USD': Decimal('0.10'),
    }
    assert all(isinstance(amount, Decimal) for amount in dashboard['net_balances'].values())


async def test_net_excludes_expenses_cancelled_deleted_and_other_users(db):
    await add_transaction(db, 'MONEY_LENT', '30000')
    await add_transaction(db, 'MONEY_BORROWED', '20000')
    await add_transaction(db, 'PERSONAL_EXPENSE', '9999', 'USD')
    await add_transaction(db, 'MONEY_LENT', '5000', status='CANCELLED')
    await add_transaction(db, 'MONEY_BORROWED', '9000', 'MYR', status='CANCELLED')
    deleted = await add_transaction(db, 'MONEY_BORROWED', '6000', 'USD')
    await TransactionService(db).delete(1, deleted['id'])
    await add_transaction(db, 'MONEY_LENT', '8000', user_id=2)
    await add_transaction(db, 'MONEY_BORROWED', '7000', 'MYR', user_id=2)

    dashboard = await DashboardService(db).load(1)

    assert dashboard['net_balances'] == {'INR': Decimal('10000')}
    assert dashboard['receivables'] == {'INR': Decimal('30000')}
    assert dashboard['payables'] == {'INR': Decimal('20000')}


async def test_group_balances_do_not_enter_personal_dashboard_net(db):
    await add_transaction(db, 'MONEY_LENT', '30000')
    await add_transaction(db, 'MONEY_BORROWED', '20000')
    groups = GroupService(db)
    group = await groups.save(await db.get(User, 1), GroupInput(name='Trip', default_currency='INR'))
    other = await groups.save_member(1, group.id, MemberInput(display_name='Bob', registered_email='bob@example.com'))
    owner = await db.scalar(select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == 1))
    await groups.save_expense(1, group.id, GroupExpenseInput(
        title='Dinner', amount='5000', currency='INR', paid_by_member_id=owner.id,
        expense_date=date.today(), split_type='EQUAL',
        splits=[SplitInput(group_member_id=owner.id), SplitInput(group_member_id=other.id)],
    ))

    assert (await groups.balances(1, group.id))['INR'][owner.id] == Decimal('2500')
    assert (await DashboardService(db).load(1))['net_balances'] == {'INR': Decimal('10000')}


async def test_dashboard_api_serializes_net_amounts_as_exact_decimal_strings(db):
    await add_transaction(db, 'MONEY_LENT', '0.30', 'INR')
    await add_transaction(db, 'MONEY_BORROWED', '0.20', 'INR')
    await add_transaction(db, 'MONEY_BORROWED', '0.11', 'MYR')
    await add_transaction(db, 'MONEY_LENT', '10', 'JPY')
    await add_transaction(db, 'MONEY_BORROWED', '10', 'JPY')
    session = UserSession(user_id=1, refresh_token_hash=token_hash('dashboard-test'), expires_at=utcnow() + timedelta(days=1))
    db.add(session)
    await db.commit()

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.get('/api/v1/dashboard', headers={
                'Authorization': 'Bearer ' + access_token(1, session.id),
            })
        assert response.status_code == 200
        assert response.json()['data']['net_balances'] == {
            'INR': '0.1000', 'JPY': '0.0000', 'MYR': '-0.1100',
        }
    finally:
        app.dependency_overrides.pop(get_db, None)
