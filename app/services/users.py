from sqlalchemy import select, func
from app.models import User, UserSettings
from app.models.enums import UserStatus, Role
from app.repositories.base import Repository
from app.services.auth import AuthService
from app.db.base import utcnow
from app.exceptions import AppError


class UserService(Repository):
    async def settings(self, user_id):
        return await self.db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))

    async def update_settings(self, user_id, data):
        obj = await self.settings(user_id)
        for key, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
            setattr(obj, key, value)
        await self.db.commit()
        return obj

    async def profile(self, user, data):
        user.name, user.phone = data.name, data.phone
        await self.db.commit()
        return user

    async def list_users(self, page, page_size, search=None, status=None):
        query = select(User)
        if search:
            query = query.where(User.name.ilike(f'%{search}%') | User.email.ilike(f'%{search}%'))
        if status:
            query = query.where(User.status == status)
        return await self.page(query.order_by(User.id.desc()), page, page_size)

    async def details(self, user_id):
        user = await self.db.get(User, user_id)
        if user is None:
            raise AppError(404, 'User not found')
        return user

    async def stats(self):
        counts = dict((await self.db.execute(select(User.status, func.count()).group_by(User.status))).all())
        return {'total': sum(counts.values()), **{status.value: counts.get(status, 0) for status in UserStatus}}

    async def transition(self, admin, user_id, action):
        user = await self.db.scalar(select(User).where(User.id == user_id).with_for_update())
        if not user:
            raise AppError(404, 'User not found')
        if user.id == admin.id or user.role == Role.ADMIN:
            raise AppError(409, 'Administrator accounts must be managed through the CLI')
        transitions = {'approve': ({UserStatus.PENDING_APPROVAL}, UserStatus.ACTIVE), 'reject': ({UserStatus.PENDING_APPROVAL}, UserStatus.REJECTED), 'suspend': ({UserStatus.ACTIVE}, UserStatus.SUSPENDED), 'reactivate': ({UserStatus.SUSPENDED, UserStatus.REJECTED}, UserStatus.ACTIVE)}
        allowed, target = transitions[action]
        if user.status not in allowed or not user.email_verified:
            raise AppError(409, 'This status transition is not available')
        user.status = target
        if target == UserStatus.ACTIVE:
            user.approved_by, user.approved_at = admin.id, utcnow()
        else:
            await AuthService(self.db).revoke_all(user.id)
        await self.db.commit()
        return user
