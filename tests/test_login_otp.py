import json
import re
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import hash_password, otp_hash, token_hash
from app.db.base import utcnow
from app.db.session import get_db
from app.main import app
from app.models import OTPVerification, User, UserSession
from app.models.enums import OTPPurpose, Role, UserStatus
from app.notifications.providers import ResendEmailProvider
from app.schemas.inputs import ChangePassword
from app.services.auth import AuthService
from app.services.users import UserService


@pytest.fixture
def login_mail(monkeypatch):
    state = SimpleNamespace(messages=[], status=200)

    def send(request):
        state.messages.append(json.loads(request.content))
        return httpx.Response(state.status, json={'id': f'mail-{len(state.messages)}'})

    provider = ResendEmailProvider(
        're_test_key', 'SettleUply <otp@example.com>', transport=httpx.MockTransport(send),
    )
    monkeypatch.setattr('app.services.auth.get_email_service', lambda config: provider)
    return state


@pytest_asyncio.fixture
async def login_client(db, login_mail):
    user = await db.get(User, 1)
    user.password_hash = hash_password('Password123')
    await db.commit()

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def mailed_code(login_mail):
    return re.search(r'\b\d{6}\b', login_mail.messages[-1]['text']).group()


async def start_login(client):
    response = await client.post('/api/v1/auth/login', json={
        'email': 'alice@example.com', 'password': 'Password123',
    })
    assert response.status_code == 200, response.text
    return response.json()['data']


async def verify_login(client, challenge, code):
    return await client.post('/api/v1/auth/verify-login-otp', json={
        'challenge_token': challenge['challenge_token'], 'otp': code,
    })


@pytest.mark.parametrize('role', [Role.USER, Role.ADMIN])
async def test_login_needs_email_otp_before_session_for_every_role(db, login_client, login_mail, role, caplog):
    user = await db.get(User, 1)
    user.role = role
    await db.commit()

    challenge = await start_login(login_client)
    assert set(challenge) == {'challenge_token', 'expires_in', 'resend_after'}
    assert len(challenge['challenge_token']) >= 32
    lifetime_seconds = get_settings().otp_expire_minutes * 60
    assert 0 < challenge['expires_in'] <= lifetime_seconds
    assert challenge['resend_after'] == 60
    assert not login_client.cookies
    assert user.last_login_at is None
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0
    assert len(login_mail.messages) == 1
    assert login_mail.messages[0]['to'] == [user.email]
    assert 'sign' in login_mail.messages[0]['text'].lower() or 'login' in login_mail.messages[0]['text'].lower()

    code = mailed_code(login_mail)
    row = await db.scalar(select(OTPVerification).where(OTPVerification.user_id == user.id))
    assert row.purpose == OTPPurpose.LOGIN
    assert row.otp_hash == otp_hash(user.email, 'LOGIN', code)
    assert row.challenge_hash == token_hash(challenge['challenge_token'])
    assert row.verified_at is None
    assert code not in json.dumps(challenge) + caplog.text

    # The login challenge cannot be used as an access token.
    protected = await login_client.get('/api/v1/dashboard', headers={
        'Authorization': 'Bearer ' + challenge['challenge_token'],
    })
    assert protected.status_code == 401
    response = await verify_login(login_client, challenge, code)
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['access_token']
    assert data['user']['role'] == role.value
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert login_client.cookies.get('settleuply_refresh')
    assert user.last_login_at is not None
    assert row.verified_at is not None
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 1

    replay = await verify_login(login_client, challenge, code)
    assert replay.status_code == 400
    assert 'set-cookie' not in replay.headers
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 1


@pytest.mark.parametrize('email,password', [
    ('alice@example.com', 'WrongPassword123'), ('absent@example.com', 'Password123'),
])
async def test_bad_password_or_unknown_email_does_not_send_login_otp(db, login_client, login_mail, email, password):
    response = await login_client.post('/api/v1/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 401
    assert response.json()['message'] == 'Invalid email or password'
    assert not login_mail.messages
    assert not login_client.cookies
    assert await db.scalar(select(func.count()).select_from(OTPVerification)) == 0


@pytest.mark.parametrize('status,verified', [
    (UserStatus.PENDING_VERIFICATION, False), (UserStatus.PENDING_APPROVAL, True),
    (UserStatus.REJECTED, True), (UserStatus.SUSPENDED, True), (UserStatus.ACTIVE, False),
])
async def test_ineligible_accounts_cannot_start_login(db, login_client, login_mail, status, verified):
    user = await db.get(User, 1)
    user.status, user.email_verified = status, verified
    await db.commit()
    response = await login_client.post('/api/v1/auth/login', json={
        'email': user.email, 'password': 'Password123',
    })
    assert response.status_code == 403
    assert not login_mail.messages
    assert not login_client.cookies
    assert await db.scalar(select(func.count()).select_from(OTPVerification)) == 0


async def test_login_otp_attempt_limit_survives_failures(db, login_client, login_mail):
    challenge = await start_login(login_client)
    code = mailed_code(login_mail)
    wrong = '000000' if code != '000000' else '999999'
    for _ in range(5):
        response = await verify_login(login_client, challenge, wrong)
        assert response.status_code == 400
    row = await db.scalar(select(OTPVerification).where(OTPVerification.purpose == OTPPurpose.LOGIN))
    await db.refresh(row)
    assert row.attempt_count == 5
    response = await verify_login(login_client, challenge, code)
    assert response.status_code == 400
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0
    assert not login_client.cookies


async def test_expired_login_challenge_cannot_verify_or_resend(db, login_client, login_mail, monkeypatch):
    challenge = await start_login(login_client)
    code = mailed_code(login_mail)
    monkeypatch.setattr('app.services.auth.utcnow', lambda: utcnow() + timedelta(minutes=get_settings().otp_expire_minutes + 1))
    assert (await verify_login(login_client, challenge, code)).status_code == 400
    response = await login_client.post('/api/v1/auth/resend-login-otp', json={
        'challenge_token': challenge['challenge_token'],
    })
    assert response.status_code == 400
    assert len(login_mail.messages) == 1
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0


async def test_resend_cooldown_rotates_and_invalidates_previous_login_challenge(db, login_client, login_mail, monkeypatch):
    challenge = await start_login(login_client)
    old_code = mailed_code(login_mail)
    limited = await login_client.post('/api/v1/auth/resend-login-otp', json={
        'challenge_token': challenge['challenge_token'],
    })
    assert limited.status_code == 429
    assert len(login_mail.messages) == 1
    monkeypatch.setattr('app.services.auth.utcnow', lambda: utcnow() + timedelta(seconds=61))
    response = await login_client.post('/api/v1/auth/resend-login-otp', json={
        'challenge_token': challenge['challenge_token'],
    })
    assert response.status_code == 200, response.text
    replacement = response.json()['data']
    assert replacement['challenge_token'] != challenge['challenge_token']
    assert len(login_mail.messages) == 2
    assert not login_client.cookies
    assert (await verify_login(login_client, challenge, old_code)).status_code == 400
    replay_resend = await login_client.post('/api/v1/auth/resend-login-otp', json={
        'challenge_token': challenge['challenge_token'],
    })
    assert replay_resend.status_code == 400
    assert (await verify_login(login_client, replacement, mailed_code(login_mail))).status_code == 200
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 1


async def test_new_password_login_also_invalidates_old_challenge(db, login_client, login_mail, monkeypatch):
    old = await start_login(login_client)
    old_code = mailed_code(login_mail)
    monkeypatch.setattr('app.services.auth.utcnow', lambda: utcnow() + timedelta(seconds=61))
    new = await start_login(login_client)
    assert new['challenge_token'] != old['challenge_token']
    assert (await verify_login(login_client, old, old_code)).status_code == 400
    assert (await verify_login(login_client, new, mailed_code(login_mail))).status_code == 200


async def test_login_codes_are_isolated_from_registration_and_reset(db, login_client, login_mail):
    challenge = await start_login(login_client)
    code = mailed_code(login_mail)
    for path, extra in [('verify-otp', {}), ('reset-password', {'password': 'ChangedPassword123'})]:
        response = await login_client.post('/api/v1/auth/' + path, json={
            'email': 'alice@example.com', 'otp': code, **extra,
        })
        assert response.status_code == 400
    missing_challenge = await login_client.post('/api/v1/auth/verify-login-otp', json={
        'email': 'alice@example.com', 'otp': code,
    })
    assert missing_challenge.status_code == 422
    # A purpose-mismatched record cannot be accepted even if its token and code match.
    row = await db.scalar(select(OTPVerification).where(OTPVerification.purpose == OTPPurpose.LOGIN))
    row.purpose = OTPPurpose.PASSWORD_RESET
    await db.commit()
    assert (await verify_login(login_client, challenge, code)).status_code == 400
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0


@pytest.mark.parametrize('action', ['password', 'suspend', 'revoke'])
async def test_security_changes_invalidate_pending_login_challenges(db, login_client, login_mail, action):
    challenge = await start_login(login_client)
    code = mailed_code(login_mail)
    user = await db.get(User, 1)
    if action == 'password':
        await AuthService(db).change_password(user, ChangePassword(
            current_password='Password123', new_password='ChangedPassword123',
        ))
    elif action == 'suspend':
        admin = await db.get(User, 2)
        admin.role = Role.ADMIN
        await db.commit()
        await UserService(db).transition(admin, user.id, 'suspend')
        # Reactivation must not restore the earlier challenge.
        await UserService(db).transition(admin, user.id, 'reactivate')
    else:
        await AuthService(db).revoke_all(user.id)
        await db.commit()
    assert (await verify_login(login_client, challenge, code)).status_code == 400
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0


async def test_status_is_rechecked_before_completing_login(db, login_client, login_mail):
    challenge = await start_login(login_client)
    user = await db.get(User, 1)
    user.email_verified = False
    await db.commit()
    response = await verify_login(login_client, challenge, mailed_code(login_mail))
    assert response.status_code in (400, 403)
    assert user.last_login_at is None
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0


async def test_failed_login_email_does_not_create_authenticated_session(db, login_client, login_mail):
    login_mail.status = 503
    response = await login_client.post('/api/v1/auth/login', json={
        'email': 'alice@example.com', 'password': 'Password123',
    })
    assert response.status_code == 503
    assert not login_client.cookies
    assert 'challenge_token' not in response.text
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0
    assert (await db.get(User, 1)).last_login_at is None


async def test_unknown_challenge_never_sends_email_or_creates_session(db, login_client, login_mail):
    unknown = {'challenge_token': 'x' * 64}
    assert (await verify_login(login_client, unknown, '123456')).status_code == 400
    response = await login_client.post('/api/v1/auth/resend-login-otp', json=unknown)
    assert response.status_code == 400
    assert not login_mail.messages
    assert await db.scalar(select(func.count()).select_from(UserSession)) == 0
