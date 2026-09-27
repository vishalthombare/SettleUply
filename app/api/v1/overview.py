from typing import Annotated
from fastapi import APIRouter, Query, Depends
from sqlalchemy import select
from app.api.dependencies import DB, CurrentUser
from app.schemas.inputs import ReminderInput, PageParams, CURRENCY_DIGITS
from app.services.reminders import ReminderService
from app.services.dashboard import DashboardService
from app.repositories.base import Repository
from app.models import NotificationLog
from app.utils.serialization import ok

router = APIRouter()


@router.get('/dashboard', tags=['dashboard'])
async def dashboard(db: DB, user: CurrentUser):
    return ok(await DashboardService(db).load(user.id))


@router.get('/currencies', tags=['settings'])
async def currencies():
    return ok(CURRENCY_DIGITS)


@router.get('/reminders', tags=['reminders'])
async def reminders(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await ReminderService(db).list(user.id, pagination.page, pagination.page_size))


@router.post('/reminders', status_code=201, tags=['reminders'])
async def create(data: ReminderInput, db: DB, user: CurrentUser):
    return ok(await ReminderService(db).save(user.id, data))


@router.patch('/reminders/{resource_id}', tags=['reminders'])
async def edit(resource_id: int, data: ReminderInput, db: DB, user: CurrentUser):
    return ok(await ReminderService(db).save(user.id, data, resource_id))


@router.delete('/reminders/{resource_id}', tags=['reminders'])
async def cancel(resource_id: int, db: DB, user: CurrentUser):
    await ReminderService(db).cancel(user.id, resource_id)
    return ok(message='Reminder cancelled')


@router.get('/notifications', tags=['notifications'])
async def notifications(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await Repository(db).page(select(NotificationLog).where(NotificationLog.user_id == user.id).order_by(NotificationLog.id.desc()), pagination.page, pagination.page_size))
