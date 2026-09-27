import json
import re
from datetime import timedelta
from html import escape
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import func, select

from app.core.config import Settings, get_settings
from app.core.security import otp_hash, verify_password
from app.db.base import utcnow
from app.db.session import get_db
from app.exceptions import AppError
from app.main import app
from app.models import NotificationLog, OTPVerification, User, UserSession, UserSettings
from app.models.enums import OTPPurpose, UserStatus
from app.notifications.providers import Delivery, NoopProvider, ResendEmailProvider, get_email_service
from app.services.auth import AuthService
from app.services.notifications import NotificationService


def resend_provider(handler):
    return ResendEmailProvider(
        're_test_key', 'SettleUply <otp@example.com>', transport=httpx.MockTransport(handler),
    )


@pytest.mark.parametrize('html', [None, '<p>Your code is <strong>123456</strong></p>'])
async def test_resend_request_and_acceptance(html):
    def handler(request):
        assert request.url == 'https://api.resend.com/emails'
        assert request.method == 'POST'
        assert request.headers['Authorization'] == 'Bearer re_test_key'
        expected = {
            'from': 'SettleUply <otp@example.com>', 'to': ['member@example.com'],
            'subject': 'Verification', 'text': 'Your code is 123456',
        }
        if html is not None:
            expected['html'] = html
        assert json.loads(request.content) == expected
        return httpx.Response(200, json={'id': 'resend-message-id'})

    delivery = await resend_provider(handler).send('member@example.com', 'Verification', 'Your code is 123456', html=html)
    assert delivery.status == 'SENT'
    assert delivery.provider_message_id == 'resend-message-id'
    assert delivery.error is None


@pytest.mark.parametrize('status', [400, 401, 403, 422, 429, 500])
async def test_resend_rejections_are_sanitized(status):
    provider = resend_provider(lambda request: httpx.Response(status, json={
        'message': 'Echoed sensitive contents: code 123456, key re_test_key',
    }))
    delivery = await provider.send('member@example.com', 'Verification', '123456')
    assert delivery.status == 'FAILED'
    assert delivery.provider_message_id is None
    assert f'HTTP {status}' in delivery.error
    assert '123456' not in delivery.error
    assert 're_test_key' not in delivery.error


@pytest.mark.parametrize('payload', [{}, {'id': None}, [], {'id': ''}])
async def test_resend_requires_provider_confirmation(payload):
    provider = resend_provider(lambda request: httpx.Response(200, json=payload))
    assert (await provider.send('member@example.com', 'Verification', '123456')).status == 'FAILED'


async def test_resend_network_and_non_json_failures():
    def timeout(request):
        raise httpx.ReadTimeout('Request with secret 123456 timed out', request=request)

    delivery = await resend_provider(timeout).send('member@example.com', 'Verification', '123456')
    assert delivery.status == 'FAILED'
    assert '123456' not in delivery.error
    invalid = resend_provider(lambda request: httpx.Response(200, text='invalid response'))
    assert (await invalid.send('member@example.com', 'Verification', '123456')).status == 'FAILED'


async def test_email_factory_and_missing_recipient():
    config = Settings(_env_file=None, email_provider='resend', email_api_key='re_test', email_from='otp@example.com')
    assert isinstance(get_email_service(config), ResendEmailProvider)
    config.email_provider = 'noop'
    assert isinstance(get_email_service(config), NoopProvider)
    assert (await get_email_service(config).send('member@example.com', 'Test', 'Text')).status == 'SKIPPED'

    def unexpected(request):
        pytest.fail('Missing recipient must not reach Resend')

    assert (await resend_provider(unexpected).send('', 'Test', 'Text')).status == 'FAILED'


async def test_registration_resend_and_password_reset_use_email_without_exposing_otp(db, monkeypatch, capsys, caplog):
    messages = []

    def handler(request):
        messages.append(json.loads(request.content))
        return httpx.Response(200, json={'id': f'email-{len(messages)}'})

    provider = resend_provider(handler)
    monkeypatch.setattr('app.services.auth.get_email_service', lambda config: provider)

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/auth/register', json={
                'name': 'Email user', 'email': 'email-user@example.com', 'password': 'Password123',
            })
            assert response.status_code == 201
            assert len(messages) == 1
            user = await db.scalar(select(User).where(User.email == 'email-user@example.com'))
            assert user.status == UserStatus.PENDING_VERIFICATION
            assert await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id)) is not None
            first = await db.scalar(select(OTPVerification).where(OTPVerification.user_id == user.id))
            code = re.search(r'\b\d{6}\b', messages[0]['text']).group()
            assert first.otp_hash == otp_hash(user.email, 'REGISTRATION', code)
            assert code not in response.text
            assert 'Verify your SettleUply email' == messages[0]['subject']
            assert messages[0]['to'] == [user.email]

            limited = await client.post('/api/v1/auth/resend-otp', json={'email': user.email})
            assert limited.status_code == 429
            assert len(messages) == 1

            # Simulate the resend cooldown elapsing without changing immutable audit fields.
            monkeypatch.setattr('app.services.auth.utcnow', lambda: utcnow() + timedelta(seconds=61))
            resend = await client.post('/api/v1/auth/resend-otp', json={'email': user.email})
            assert resend.status_code == 200
            assert len(messages) == 2
            assert first.verified_at is not None
            code = re.search(r'\b\d{6}\b', messages[1]['text']).group()
            verified = await client.post('/api/v1/auth/verify-otp', json={'email': user.email, 'otp': code})
            assert verified.status_code == 200
            assert user.status == UserStatus.PENDING_APPROVAL

            reset = await client.post('/api/v1/auth/forgot-password', json={'email': user.email})
            assert reset.status_code == 200
            assert len(messages) == 3
            assert messages[2]['subject'] == 'Reset your SettleUply password'
            code = re.search(r'\b\d{6}\b', messages[2]['text']).group()
            assert code not in reset.text
            changed = await client.post('/api/v1/auth/reset-password', json={
                'email': user.email, 'otp': code, 'password': 'ChangedPassword123',
            })
            assert changed.status_code == 200
            assert verify_password('ChangedPassword123', user.password_hash)

            user.status = UserStatus.ACTIVE
            await db.commit()
            login = await client.post('/api/v1/auth/login', json={
                'email': user.email, 'password': 'ChangedPassword123',
            })
            assert login.status_code == 200
            challenge = login.json()['data']
            assert 'access_token' not in challenge
            assert len(messages) == 4
            assert challenge['challenge_token'] not in messages[3]['html']
            assert await db.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)) == 0
            code = re.search(r'\b\d{6}\b', messages[3]['text']).group()
            verified_login = await client.post('/api/v1/auth/verify-login-otp', json={
                'challenge_token': challenge['challenge_token'], 'otp': code,
            })
            assert verified_login.status_code == 200
            assert verified_login.json()['data']['access_token']
            assert await db.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)) == 1
            assert await db.scalar(select(func.count()).select_from(NotificationLog)) == 0
            output = capsys.readouterr()
            for message in messages:
                secret = re.search(r'\b\d{6}\b', message['text']).group()
                assert secret in message['html']
                assert secret not in message['subject']
                assert 'Email user' in message['html']
                assert f'{get_settings().otp_expire_minutes} minutes' in message['html']
                assert secret not in output.out + output.err + caplog.text
    finally:
        app.dependency_overrides.clear()


async def test_failed_otp_delivery_returns_service_error_without_losing_registration(db, monkeypatch, caplog):
    provider = resend_provider(lambda request: httpx.Response(403, json={'message': 'sensitive provider response'}))
    monkeypatch.setattr('app.services.auth.get_email_service', lambda config: provider)

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/auth/register', json={
                'name': 'Retry user', 'email': 'retry@example.com', 'password': 'Password123',
            })
        assert response.status_code == 503
        assert response.json()['success'] is False
        assert "couldn't send" in response.json()['message']
        assert 'sensitive provider response' not in response.text + caplog.text
        assert 'HTTP 403' in caplog.text
        user = await db.scalar(select(User).where(User.email == 'retry@example.com'))
        assert user.status == UserStatus.PENDING_VERIFICATION
        assert await db.scalar(select(OTPVerification).where(OTPVerification.user_id == user.id)) is not None
    finally:
        app.dependency_overrides.clear()


async def test_noop_otp_delivery_requires_explicit_local_debug(db, monkeypatch, caplog):
    user = await db.get(User, 1)
    with pytest.raises(AppError) as exc:
        await AuthService(db).issue_otp(user, OTPPurpose.REGISTRATION)
    assert exc.value.status == 503
    assert 'LOCAL DEVELOPMENT OTP' not in caplog.text

    monkeypatch.setattr(get_settings(), 'app_env', 'development')
    monkeypatch.setattr(get_settings(), 'dev_show_otp', True)
    await AuthService(db).issue_otp(user, OTPPurpose.PASSWORD_RESET)
    assert 'LOCAL DEVELOPMENT OTP' in caplog.text


@pytest.mark.parametrize('kind', ['TRANSACTION', 'SETTLEMENT', 'GROUP', 'REMINDER'])
async def test_notifications_use_configured_email_provider_and_keep_receipt(db, monkeypatch, kind):
    messages = []

    def handler(request):
        messages.append(json.loads(request.content))
        return httpx.Response(200, json={'id': 'notification-email'})

    provider = resend_provider(handler)
    monkeypatch.setattr('app.services.notifications.get_email_service', lambda: provider)
    message = 'A record from <strong>Alice & Bob</strong> was updated.'
    await NotificationService(db).deliver(1, 'EMAIL', 'alice@example.com', kind, message)
    assert len(messages) == 1
    assert message in messages[0]['text']
    assert escape(message) in messages[0]['html']
    assert '<strong>Alice & Bob</strong>' not in messages[0]['html']
    log = await db.scalar(select(NotificationLog))
    assert log.message == message
    assert log.subject == messages[0]['subject']
    assert log.status.value == 'SENT'
    assert log.provider_message_id == 'notification-email'
    assert log.sent_at is not None
    assert log.error_message is None


async def test_sms_delivery_keeps_plain_text_without_html(db):
    messages = []

    async def send(recipient, subject, message):
        messages.append((recipient, subject, message))
        return Delivery(status='SENT', provider_message_id='sms-message', error=None)

    message = 'A financial record has been updated.'
    await NotificationService(db, sms=SimpleNamespace(send=send)).deliver(
        1, 'SMS', '+15550123456', 'TRANSACTION', message,
    )
    assert messages == [('+15550123456', 'SettleUply update', message)]
    log = await db.scalar(select(NotificationLog))
    assert log.message == message
    assert log.status.value == 'SENT'
