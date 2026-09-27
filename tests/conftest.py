import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.db.base import Base
from app.models import User, UserSettings, Contact
from app.models.enums import UserStatus
from app.core.config import get_settings


@pytest.fixture(autouse=True)
def isolated_email_configuration(monkeypatch):
    # Local .env credentials must never send real email during the test suite.
    config = get_settings()
    monkeypatch.setattr(config, 'email_provider', 'noop')
    monkeypatch.setattr(config, 'dev_show_otp', False)
    # Keep local secrets out of assertion introspection and test tracebacks.
    monkeypatch.setattr(config, 'database_url', 'sqlite+aiosqlite:///:memory:')
    monkeypatch.setattr(config, 'email_api_key', 're_test_key')
    monkeypatch.setattr(config, 'email_from', 'otp@example.com')
    monkeypatch.setattr(config, 'sms_api_key', '')
    monkeypatch.setattr(config, 'jwt_secret', 'test-access-secret-' * 3)
    monkeypatch.setattr(config, 'jwt_refresh_secret', 'test-refresh-secret-' * 3)


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    async with engine.begin() as connection:
        await connection.execute(text('PRAGMA foreign_keys=ON'))
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        for name in ['Alice', 'Bob']:
            user = User(name=name, email=f'{name.lower()}@example.com', password_hash='unused', status=UserStatus.ACTIVE, email_verified=True)
            session.add(user)
            await session.flush()
            session.add(UserSettings(user_id=user.id))
            session.add(Contact(user_id=user.id, name=f'{name} contact'))
        await session.commit()
        yield session
    await engine.dispose()
