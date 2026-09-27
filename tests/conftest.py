import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.db.base import Base
from app.models import User, UserSettings, Contact
from app.models.enums import UserStatus


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
