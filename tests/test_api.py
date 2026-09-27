from datetime import timedelta
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import get_db
from app.models import UserSession
from app.db.base import Base, utcnow
from app.core.security import access_token, token_hash


async def test_envelopes_pagination_filters_and_idor(db):
    session = UserSession(user_id=1, refresh_token_hash=token_hash('test'), expires_at=utcnow() + timedelta(days=1))
    db.add(session)
    await db.commit()
    async def override():
        yield db
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            headers = {'Authorization': 'Bearer ' + access_token(1, session.id)}
            for path in ['/contacts?search=Alice&balance_filter=settled', '/transactions?currency=INR', '/groups?search=Trip', '/activity?kind=SETTLEMENT', '/notifications', '/dashboard']:
                response = await client.get('/api/v1' + path, headers=headers)
                assert response.status_code == 200, response.text
                assert response.json()['success'] is True
            assert (await client.get('/api/v1/contacts/2', headers=headers)).status_code == 404
            assert (await client.get('/api/v1/admin/users', headers=headers)).status_code == 403
            assert (await client.get('/api/v1/contacts?page_size=1000', headers=headers)).status_code == 422
            assert (await client.get('/api/v1/contacts')).status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_exact_table_count_and_openapi():
    assert len(Base.metadata.tables) == 15
    assert '/api/v1/groups/{group_id}/expenses/preview' in app.openapi()['paths']
