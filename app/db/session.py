from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from fastapi import Request
from app.core.config import get_settings
from app.exceptions import AppError
from app.db.audit import set_request_audit

settings = get_settings()
url = settings.database_url
if url.startswith('postgresql://'):
    url = url.replace('postgresql://', 'postgresql+asyncpg://', 1)
engine = create_async_engine(url, pool_pre_ping=True) if url else None
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request):
    if engine is None:
        raise AppError(503, 'Database is not configured')
    async with SessionLocal() as session:
        set_request_audit(session, request.headers.get('X-Application-Type'))
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
