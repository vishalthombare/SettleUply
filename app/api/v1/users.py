from typing import Annotated
from fastapi import APIRouter, Query, Depends
from app.api.dependencies import DB, CurrentUser, AdminUser
from app.schemas.inputs import ProfileUpdate, SettingsUpdate, PageParams
from app.models.enums import UserStatus
from app.services.users import UserService
from app.utils.serialization import ok

router = APIRouter(tags=['users'])


@router.get('/users/me')
async def me(user: CurrentUser):
    return ok(user)


@router.patch('/users/me')
async def profile(data: ProfileUpdate, db: DB, user: CurrentUser):
    return ok(await UserService(db).profile(user, data))


@router.get('/settings', tags=['settings'])
async def settings(db: DB, user: CurrentUser):
    return ok(await UserService(db).settings(user.id))


@router.patch('/settings', tags=['settings'])
async def update_settings(data: SettingsUpdate, db: DB, user: CurrentUser):
    return ok(await UserService(db).update_settings(user.id, data))


@router.get('/admin', tags=['admin'])
async def stats(db: DB, user: AdminUser):
    return ok(await UserService(db).stats())


@router.get('/admin/users', tags=['admin'])
async def users(db: DB, user: AdminUser, pagination: Annotated[PageParams, Depends()], search: str | None = None, status: UserStatus | None = None):
    return ok(await UserService(db).list_users(pagination.page, pagination.page_size, search, status))


@router.get('/admin/users/pending', tags=['admin'])
async def pending(db: DB, user: AdminUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await UserService(db).list_users(pagination.page, pagination.page_size, status=UserStatus.PENDING_APPROVAL))


@router.get('/admin/users/{user_id}', tags=['admin'])
async def detail(user_id: int, db: DB, user: AdminUser):
    return ok(await UserService(db).details(user_id))


def action_route(action):
    async def endpoint(user_id: int, db: DB, user: AdminUser):
        return ok(await UserService(db).transition(user, user_id, action))
    router.add_api_route(f'/admin/users/{{user_id}}/{action}', endpoint, methods=['POST'], tags=['admin'], name=f'{action}_user')


for action in ['approve', 'reject', 'suspend', 'reactivate']:
    action_route(action)
