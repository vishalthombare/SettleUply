from typing import Annotated
from fastapi import APIRouter, Query, Depends, BackgroundTasks
from app.api.dependencies import DB, CurrentUser
from app.schemas.inputs import GroupInput, MemberInput, GroupExpenseInput, PageParams
from app.services.groups import GroupService
from app.services.notifications import financial_notification
from app.utils.serialization import ok

router = APIRouter(prefix='/groups', tags=['groups'])


@router.get('')
async def listing(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()], search: str | None = None):
    return ok(await GroupService(db).list(user.id, pagination.page, pagination.page_size, search))


@router.post('', status_code=201)
async def create(data: GroupInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save(user, data))


@router.get('/{group_id}')
async def detail(group_id: int, db: DB, user: CurrentUser):
    return ok(await GroupService(db).access(user.id, group_id))


@router.patch('/{group_id}')
async def edit(group_id: int, data: GroupInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save(user, data, group_id))


@router.delete('/{group_id}')
async def remove(group_id: int, db: DB, user: CurrentUser):
    await GroupService(db).archive(user.id, group_id)
    return ok(message='Group archived')


@router.get('/{group_id}/balances')
async def balances(group_id: int, db: DB, user: CurrentUser):
    return ok(await GroupService(db).balances(user.id, group_id))


@router.get('/{group_id}/members', tags=['group-members'])
async def members(group_id: int, db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await GroupService(db).members(user.id, group_id, pagination.page, pagination.page_size))


@router.post('/{group_id}/members', status_code=201, tags=['group-members'])
async def add_member(group_id: int, data: MemberInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save_member(user.id, group_id, data))


@router.patch('/{group_id}/members/{member_id}', tags=['group-members'])
async def edit_member(group_id: int, member_id: int, data: MemberInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save_member(user.id, group_id, data, member_id))


@router.delete('/{group_id}/members/{member_id}', tags=['group-members'])
async def remove_member(group_id: int, member_id: int, db: DB, user: CurrentUser):
    await GroupService(db).remove_member(user.id, group_id, member_id)
    return ok(message='Member archived; history retained')


@router.get('/{group_id}/expenses', tags=['group-expenses'])
async def expenses(group_id: int, db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await GroupService(db).expenses(user.id, group_id, pagination.page, pagination.page_size))


@router.post('/{group_id}/expenses/preview', tags=['group-expenses'])
async def preview(group_id: int, data: GroupExpenseInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save_expense(user.id, group_id, data, preview=True))


@router.post('/{group_id}/expenses', status_code=201, tags=['group-expenses'])
async def add_expense(group_id: int, data: GroupExpenseInput, db: DB, user: CurrentUser, tasks: BackgroundTasks):
    result = await GroupService(db).save_expense(user.id, group_id, data)
    tasks.add_task(financial_notification, user_id=user.id, kind='GROUP', group_id=group_id)
    return ok(result)


@router.get('/{group_id}/expenses/{expense_id}', tags=['group-expenses'])
async def expense(group_id: int, expense_id: int, db: DB, user: CurrentUser):
    return ok(await GroupService(db).expense_detail(user.id, group_id, expense_id))


@router.patch('/{group_id}/expenses/{expense_id}', tags=['group-expenses'])
async def edit_expense(group_id: int, expense_id: int, data: GroupExpenseInput, db: DB, user: CurrentUser):
    return ok(await GroupService(db).save_expense(user.id, group_id, data, expense_id))


@router.delete('/{group_id}/expenses/{expense_id}', tags=['group-expenses'])
async def remove_expense(group_id: int, expense_id: int, db: DB, user: CurrentUser):
    await GroupService(db).delete_expense(user.id, group_id, expense_id)
    return ok(message='Expense deleted')
