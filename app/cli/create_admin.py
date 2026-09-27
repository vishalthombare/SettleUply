import asyncio
import getpass
from pydantic import ValidationError
from sqlalchemy import select
from app.models import User, UserSettings
from app.models.enums import Role, UserStatus
from app.schemas.inputs import Register
from app.core.security import hash_password
from app.db.base import utcnow
from app.db.session import SessionLocal
from app.services.auth import AuthService


async def main():
    email = input('Admin email: ').strip().lower()
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email).with_for_update())
        if user is None:
            name = input('Name: ').strip()
            secret = getpass.getpass('Password (10+ chars, upper/lower/number): ')
            if secret != getpass.getpass('Confirm password: '):
                raise SystemExit('Passwords do not match')
            try:
                data = Register(name=name, email=email, password=secret)
            except ValidationError as exc:
                # Pydantic's default traceback includes input values, including passwords.
                errors = exc.errors(include_input=False, include_context=False, include_url=False)
                details = '\n'.join(f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in errors)
                raise SystemExit(f'Invalid admin details:\n{details}\nRun the command again with corrected details.') from None
            user = User(name=data.name, email=str(data.email).lower(), password_hash=hash_password(data.password))
            db.add(user)
            await db.flush()
            db.add(UserSettings(user_id=user.id))
        elif input(f'Promote {user.email} to ACTIVE ADMIN? Type PROMOTE: ') != 'PROMOTE':
            raise SystemExit('Cancelled')
        user.role, user.status, user.email_verified = Role.ADMIN, UserStatus.ACTIVE, True
        user.approved_at = utcnow()
        await AuthService(db).revoke_all(user.id)
        await db.commit()
    print('Admin account ready')


if __name__ == '__main__':
    asyncio.run(main())
