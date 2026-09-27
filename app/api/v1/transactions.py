from datetime import date
from typing import Annotated, Literal
from fastapi import APIRouter, Query, Depends, BackgroundTasks
from app.api.dependencies import DB, CurrentUser
from app.schemas.inputs import TransactionInput, SettlementInput, PageParams
from app.models.enums import TransactionType, TransactionStatus
from app.services.transactions import TransactionService, SettlementService
from app.services.ledger import LedgerService
from app.services.notifications import financial_notification
from app.utils.serialization import ok

router = APIRouter(tags=['transactions'])


@router.get('/transactions')
async def listing(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()], search: str | None = None, transaction_type: TransactionType | None = None, contact_id: int | None = None, category_id: int | None = None, currency: str | None = None, status: TransactionStatus | None = None, from_date: date | None = None, to_date: date | None = None, overdue: bool = False, sort: Literal['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] = 'date_desc'):
    return ok(await TransactionService(db).list(user.id, pagination.page, pagination.page_size, search=search, transaction_type=transaction_type, contact_id=contact_id, category_id=category_id, currency=currency, status=status, from_date=from_date, to_date=to_date, overdue=overdue, sort=sort))


@router.post('/transactions', status_code=201)
async def create(data: TransactionInput, db: DB, user: CurrentUser, tasks: BackgroundTasks):
    result = await TransactionService(db).save(user.id, data)
    tasks.add_task(financial_notification, user_id=user.id, kind='TRANSACTION', contact_id=data.contact_id, transaction_id=result['id'], email_override=result['notify_email'], sms_override=result['notify_sms'])
    return ok(result, 'Transaction created successfully')


@router.get('/transactions/{resource_id}')
async def detail(resource_id: int, db: DB, user: CurrentUser):
    return ok(await TransactionService(db).details(user.id, resource_id))


@router.patch('/transactions/{resource_id}')
async def edit(resource_id: int, data: TransactionInput, db: DB, user: CurrentUser):
    return ok(await TransactionService(db).save(user.id, data, resource_id))


@router.delete('/transactions/{resource_id}')
async def remove(resource_id: int, db: DB, user: CurrentUser):
    await TransactionService(db).delete(user.id, resource_id)
    return ok(message='Transaction deleted')


@router.post('/transactions/{resource_id}/settlements', status_code=201, tags=['settlements'])
async def settle(resource_id: int, data: SettlementInput, db: DB, user: CurrentUser, tasks: BackgroundTasks):
    result = await SettlementService(db).create(user.id, resource_id, data)
    transaction = await TransactionService(db).details(user.id, resource_id)
    tasks.add_task(financial_notification, user_id=user.id, kind='SETTLEMENT', contact_id=transaction['contact_id'], transaction_id=resource_id)
    return ok(result, 'Settlement recorded')


@router.get('/transactions/{resource_id}/settlements', tags=['settlements'])
async def settlements(resource_id: int, db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await SettlementService(db).list(user.id, resource_id, pagination.page, pagination.page_size))


@router.get('/activity', tags=['activity'])
async def activity(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()], search: str | None = None, kind: str | None = None, currency: str | None = None, status: str | None = None, from_date: date | None = None, to_date: date | None = None):
    return ok(await LedgerService(db).activity(user.id, pagination.page, pagination.page_size, search=search, kind=kind, currency=currency, status=status, from_date=from_date, to_date=to_date))
