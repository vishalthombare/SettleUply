from typing import Annotated
from fastapi import Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.security import decode_access, aware
from app.db.base import utcnow
from app.db.audit import set_audit_actor
from app.models import User, UserSession
from app.models.enums import Role, UserStatus
from app.exceptions import AppError
from app.core.config import get_settings

DB = Annotated[AsyncSession, Depends(get_db)]
bearer = HTTPBearer(auto_error=False)


async def current_user(db: DB, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if credentials is None:
        raise AppError(401, 'Please sign in')
    claims = decode_access(credentials.credentials)
    user = await db.get(User, int(claims['sub']))
    session = await db.scalar(select(UserSession).where(UserSession.id == claims['sid'], UserSession.user_id == int(claims['sub']), UserSession.revoked_at.is_(None)))
    if user is None or session is None or aware(session.expires_at) <= utcnow():
        raise AppError(401, 'Please sign in again')
    if user.status != UserStatus.ACTIVE:
        raise AppError(403, 'Your account is not active')
    set_audit_actor(db, user.id)
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def admin_user(user: CurrentUser):
    if user.role != Role.ADMIN:
        raise AppError(403, 'Administrator access required')
    return user


AdminUser = Annotated[User, Depends(admin_user)]


def trusted_origin(request: Request):
    # Refresh/logout use cookies: require a same-site client Origin as CSRF protection.
    if request.headers.get('origin') != get_settings().frontend_url.rstrip('/'):
        raise AppError(403, 'Untrusted request origin')
