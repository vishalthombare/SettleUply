from datetime import date
from decimal import Decimal

from app.models import Contact
from app.schemas.inputs import TransactionInput, SettlementInput
from app.services.transactions import TransactionService, SettlementService
from app.services.dashboard import DashboardService
from app.services.catalogs import ContactService
from app.services.ledger import LedgerService


async def loan(db, contact, kind, amount, currency='INR'):
    return await TransactionService(db).save(1, TransactionInput(
        contact_id=contact, transaction_type=kind, amount=amount, currency=currency,
        purpose='Person balance regression', transaction_date=date.today(),
    ))


async def payment(db, transaction, amount):
    return await SettlementService(db).create(1, transaction['id'], SettlementInput(
        amount=amount, currency=transaction['currency'], settlement_date=date.today(),
    ))


async def test_reported_case_nets_existing_entries_without_rewriting_history(db):
    await loan(db, 1, 'MONEY_LENT', '9000')
    await loan(db, 1, 'MONEY_LENT', '1000')
    for amount in ['5000', '2000', '1000']:
        await loan(db, 1, 'MONEY_BORROWED', amount)
    ledger = await LedgerService(db).contact(1, 1, 1, 20)
    assert ledger['receivables'] == {'INR': Decimal('2000')}
    assert ledger['payables'] == {'INR': Decimal('0')}
    assert len(ledger['history']['items']) == 5
    contacts = await ContactService(db).list(1, 1, 20, balance_filter='owes_me')
    assert contacts['items'][0]['balances'] == [
        {'currency': 'INR', 'direction': 'receivable', 'amount': Decimal('2000')},
    ]
    assert not (await ContactService(db).list(1, 1, 20, balance_filter='i_owe'))['items']
    dashboard = await DashboardService(db).load(1)
    assert dashboard['receivables']['INR'] == Decimal('2000')
    assert dashboard['payables']['INR'] == 0
    assert len(dashboard['people_balances']) == 1
    assert dashboard['people_balances'][0]['amount'] == Decimal('2000')


async def test_three_people_aggregate_after_netting_and_repayments_count_once(db):
    rahul = Contact(user_id=1, name='Rahul')
    priya = Contact(user_id=1, name='Priya')
    db.add_all([rahul, priya])
    await db.commit()
    lent = await loan(db, 1, 'MONEY_LENT', '9000')
    await loan(db, 1, 'MONEY_LENT', '1000')
    for amount in ['5000', '2000', '1000']:
        await payment(db, lent, amount)
    borrowed = await loan(db, rahul.id, 'MONEY_BORROWED', '6000')
    await payment(db, borrowed, '1000')
    await loan(db, priya.id, 'MONEY_LENT', '4000')
    dashboard = await DashboardService(db).load(1)
    assert dashboard['receivables'] == {'INR': Decimal('6000')}
    assert dashboard['payables'] == {'INR': Decimal('5000')}
    assert dashboard['net_balances'] == {'INR': Decimal('1000')}
    assert (await TransactionService(db).details(1, lent['id']))['outstanding_amount'] == Decimal('1000')
    assert {p['id'] for p in (await ContactService(db).list(1, 1, 20, balance_filter='owes_me'))['items']} == {1, priya.id}
    assert {p['id'] for p in (await ContactService(db).list(1, 1, 20, balance_filter='i_owe'))['items']} == {rahul.id}


async def test_balanced_filter_uses_each_currency_and_does_not_settle_loans(db):
    lent = await loan(db, 1, 'MONEY_LENT', '100')
    await loan(db, 1, 'MONEY_BORROWED', '100')
    assert len((await ContactService(db).list(1, 1, 20, balance_filter='settled'))['items']) == 1
    assert (await TransactionService(db).details(1, lent['id']))['status'] == 'OPEN'
    await loan(db, 1, 'MONEY_BORROWED', '100', 'MYR')
    assert not (await ContactService(db).list(1, 1, 20, balance_filter='settled'))['items']
