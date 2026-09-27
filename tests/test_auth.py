from datetime import timedelta
from types import SimpleNamespace
import pytest
from sqlalchemy import select
from app.models import User, OTPVerification, UserSession
from app.models.enums import OTPPurpose, UserStatus
from app.core.security import otp_hash, hash_password, token_hash
from app.db.base import utcnow
from app.schemas.inputs import VerifyOTP
from app.services.auth import AuthService
from app.exceptions import AppError


async def test_otp_attempt_limit_and_approval(db):
    user = await db.get(User, 1)
    user.status = UserStatus.PENDING_VERIFICATION
    db.add(OTPVerification(user_id=1, email=user.email, purpose=OTPPurpose.REGISTRATION, otp_hash=otp_hash(user.email, 'REGISTRATION', '123456'), expires_at=utcnow() + timedelta(minutes=10)))
    await db.commit()
    service = AuthService(db)
    for _ in range(5):
        with pytest.raises(AppError):
            await service.verify_registration(VerifyOTP(email=user.email, otp='000000'))
    with pytest.raises(AppError):
        await service.verify_registration(VerifyOTP(email=user.email, otp='123456'))
    assert user.status == UserStatus.PENDING_VERIFICATION


async def test_refresh_rotation_and_replay(db):
    service = AuthService(db)
    request = SimpleNamespace(client=None, headers={})
    user = await db.get(User, 1)
    _, raw = await service.new_session(user, request)
    await db.commit()
    result, next_raw = await service.refresh(raw, request)
    assert result['access_token'] and next_raw != raw
    old = await db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash(raw)))
    assert old.revoked_at is not None
    with pytest.raises(AppError):
        await service.refresh(raw, request)
    new = await db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash(next_raw)))
    assert new.revoked_at is not None
