import hmac
import logging
import secrets
from datetime import timedelta
from sqlalchemy import select, update
from app.core.config import get_settings
from app.core.security import hash_password, verify_password, token_hash, otp_hash, access_token, aware
from app.db.base import utcnow
from app.db.audit import set_audit_actor
from app.models import User, UserSettings, UserSession, OTPVerification
from app.models.enums import UserStatus, OTPPurpose
from app.exceptions import AppError
from app.notifications.providers import Delivery, EmailService, get_email_service
from app.notifications.templates import otp_email

logger = logging.getLogger(__name__)
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


class AuthService:
    def __init__(self, db, email: EmailService | None = None):
        self.db = db
        self.config = get_settings()
        self.email = email if email is not None else get_email_service(self.config)

    async def find_user(self, email, lock=False):
        query = select(User).where(User.email == str(email).lower())
        return await self.db.scalar(query.with_for_update() if lock else query)

    async def issue_otp(self, user, purpose):
        # Lock user to serialize resend requests and invalidate previous codes.
        await self.db.scalar(select(User).where(User.id == user.id).with_for_update())
        latest = await self.db.scalar(select(OTPVerification).where(OTPVerification.user_id == user.id, OTPVerification.purpose == purpose).order_by(OTPVerification.id.desc()).limit(1))
        if latest and aware(latest.created_at) > utcnow() - timedelta(seconds=60):
            raise AppError(429, 'Please wait one minute before requesting another code')
        await self.db.execute(update(OTPVerification).where(OTPVerification.user_id == user.id, OTPVerification.purpose == purpose, OTPVerification.verified_at.is_(None)).values(verified_at=utcnow()))
        code = f'{secrets.randbelow(1000000):06d}'
        challenge = secrets.token_urlsafe(32) if purpose == OTPPurpose.LOGIN else None
        expires_at = utcnow() + timedelta(minutes=self.config.otp_expire_minutes)
        self.db.add(OTPVerification(
            user_id=user.id, email=user.email, purpose=purpose,
            otp_hash=otp_hash(user.email, purpose.value, code),
            challenge_hash=token_hash(challenge) if challenge else None,
            expires_at=expires_at,
        ))
        await self.db.commit()
        # OTP is never persisted in logs or returned by the API. Explicit local debug only.
        local_debug = self.config.app_env == 'development' and self.config.dev_show_otp
        if local_debug:
            logger.warning('LOCAL DEVELOPMENT OTP for %s (%s): %s', user.email, purpose.value, code)
        email = otp_email(
            name=user.name, code=code, purpose=purpose,
            expires_minutes=self.config.otp_expire_minutes,
        )
        try:
            delivery = await self.email.send(user.email, email.subject, email.text, html=email.html)
        except Exception:
            # Provider exceptions may contain request bodies, so do not log them verbatim.
            delivery = Delivery(status='FAILED', error='Email provider raised an unexpected error')
        if delivery.status != 'SENT' and not (delivery.status == 'SKIPPED' and local_debug):
            logger.error('OTP email delivery failed: %s', delivery.error)
            if purpose == OTPPurpose.LOGIN:
                raise AppError(503, 'We could not send the sign-in code. Wait one minute, then sign in again.')
            raise AppError(503, "We couldn't send the email code. Wait one minute, then request a new code.")
        if challenge:
            return {
                'challenge_token': challenge,
                'expires_in': max(0, int((expires_at - utcnow()).total_seconds())),
                'resend_after': 60,
            }

    async def register(self, data):
        existing = await self.find_user(data.email)
        if existing:
            return
        user = User(name=data.name, email=str(data.email).lower(), phone=data.phone, password_hash=hash_password(data.password))
        self.db.add(user)
        await self.db.flush()
        self.db.add(UserSettings(user_id=user.id))
        await self.issue_otp(user, OTPPurpose.REGISTRATION)

    async def verify_code(self, email, purpose, code):
        user = await self.find_user(email, lock=True)
        row = await self.db.scalar(select(OTPVerification).where(OTPVerification.email == str(email).lower(), OTPVerification.purpose == purpose, OTPVerification.verified_at.is_(None)).order_by(OTPVerification.id.desc()).limit(1).with_for_update())
        if user is None or row is None or aware(row.expires_at) <= utcnow() or row.attempt_count >= 5:
            raise AppError(400, 'Invalid or expired verification code')
        row.attempt_count += 1
        if not hmac.compare_digest(row.otp_hash, otp_hash(user.email, purpose.value, code)):
            await self.db.commit()  # Failed attempts must survive request rollback.
            raise AppError(400, 'Invalid or expired verification code')
        set_audit_actor(self.db, user.id)
        row.verified_at = utcnow()
        return user

    async def verify_registration(self, data):
        user = await self.verify_code(data.email, OTPPurpose.REGISTRATION, data.otp)
        if user.status == UserStatus.PENDING_VERIFICATION:
            user.email_verified = True
            user.status = UserStatus.PENDING_APPROVAL
        await self.db.commit()

    async def resend(self, email, purpose):
        if purpose == OTPPurpose.LOGIN:
            raise AppError(400, 'Start sign-in with your email and password')
        user = await self.find_user(email)
        if user and (purpose != OTPPurpose.REGISTRATION or user.status == UserStatus.PENDING_VERIFICATION):
            await self.issue_otp(user, purpose)

    async def new_session(self, user, request):
        raw = secrets.token_urlsafe(64)
        session = UserSession(user_id=user.id, refresh_token_hash=token_hash(raw), expires_at=utcnow() + timedelta(days=self.config.refresh_token_expire_days), ip_address=request.client.host if request.client else None, user_agent=request.headers.get('user-agent', '')[:512])
        self.db.add(session)
        await self.db.flush()
        return {'access_token': access_token(user.id, session.id), 'token_type': 'bearer', 'user': user}, raw

    @staticmethod
    def require_active_login(user):
        if user.status != UserStatus.ACTIVE:
            messages = {UserStatus.PENDING_APPROVAL: 'Your account is awaiting administrator approval.', UserStatus.SUSPENDED: 'Your account has been suspended.', UserStatus.PENDING_VERIFICATION: 'Please verify your email before signing in.'}
            raise AppError(403, messages.get(user.status, 'Your account is not active.'))
        if not user.email_verified:
            raise AppError(403, 'Please verify your email before signing in.')

    async def login(self, data, request=None):
        user = await self.find_user(data.email, lock=True)
        valid = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
        if not user or not valid:
            raise AppError(401, 'Invalid email or password')
        self.require_active_login(user)
        set_audit_actor(self.db, user.id)
        return await self.issue_otp(user, OTPPurpose.LOGIN)

    async def login_challenge(self, challenge_token):
        candidate = await self.db.scalar(select(OTPVerification).where(
            OTPVerification.challenge_hash == token_hash(challenge_token),
            OTPVerification.purpose == OTPPurpose.LOGIN,
        ))
        if candidate is None:
            raise AppError(400, 'Invalid or expired sign-in attempt. Sign in again.')
        # Always lock the user before the OTP, matching password/admin/session operations.
        user = await self.db.scalar(select(User).where(User.id == candidate.user_id)
                                    .with_for_update().execution_options(populate_existing=True))
        row = await self.db.scalar(select(OTPVerification).where(OTPVerification.id == candidate.id)
                                   .with_for_update().execution_options(populate_existing=True))
        if (user is None or row is None or row.verified_at is not None
                or aware(row.expires_at) <= utcnow() or row.attempt_count >= 5):
            raise AppError(400, 'Invalid or expired sign-in attempt. Sign in again.')
        self.require_active_login(user)
        return user, row

    async def verify_login(self, data, request):
        user, row = await self.login_challenge(data.challenge_token)
        row.attempt_count += 1
        if not hmac.compare_digest(row.otp_hash, otp_hash(row.email, OTPPurpose.LOGIN.value, data.otp)):
            await self.db.commit()
            raise AppError(400, 'Invalid or expired sign-in code')
        set_audit_actor(self.db, user.id)
        row.verified_at = utcnow()
        user.last_login_at = utcnow()
        result = await self.new_session(user, request)
        await self.db.commit()
        return result

    async def resend_login(self, challenge_token):
        user, _ = await self.login_challenge(challenge_token)
        set_audit_actor(self.db, user.id)
        return await self.issue_otp(user, OTPPurpose.LOGIN)

    async def refresh(self, raw, request):
        if not raw:
            raise AppError(401, 'Please sign in again')
        # User-before-session lock ordering matches login/password/admin operations.
        candidate = await self.db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash(raw)))
        if candidate is None:
            raise AppError(401, 'Please sign in again')
        user = await self.db.scalar(select(User).where(User.id == candidate.user_id).with_for_update())
        session = await self.db.scalar(select(UserSession).where(UserSession.id == candidate.id).with_for_update().execution_options(populate_existing=True))
        if session.revoked_at is not None:
            await self.revoke_all(user.id)
            await self.db.commit()
            raise AppError(401, 'Session reuse detected; please sign in again')
        if aware(session.expires_at) <= utcnow() or user.status != UserStatus.ACTIVE:
            raise AppError(401, 'Please sign in again')
        set_audit_actor(self.db, user.id)
        session.revoked_at = utcnow()
        result = await self.new_session(user, request)
        await self.db.commit()
        return result

    async def revoke_all(self, user_id):
        await self.db.execute(update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
        await self.db.execute(update(OTPVerification).where(
            OTPVerification.user_id == user_id,
            OTPVerification.purpose == OTPPurpose.LOGIN,
            OTPVerification.verified_at.is_(None),
        ).values(verified_at=utcnow()))

    async def logout(self, raw):
        if raw:
            session = await self.db.scalar(select(UserSession).where(UserSession.refresh_token_hash == token_hash(raw)))
            if session is None:
                return
            # Match the user-before-session lock order used during refresh.
            await self.db.scalar(select(User).where(User.id == session.user_id).with_for_update())
            if session.revoked_at is None and aware(session.expires_at) > utcnow():
                set_audit_actor(self.db, session.user_id)
            await self.db.execute(update(UserSession).where(UserSession.refresh_token_hash == token_hash(raw)).values(revoked_at=utcnow()))
            await self.db.commit()

    async def reset_password(self, data):
        user = await self.verify_code(data.email, OTPPurpose.PASSWORD_RESET, data.otp)
        user.password_hash = hash_password(data.password)
        await self.revoke_all(user.id)
        await self.db.commit()

    async def change_password(self, user, data):
        user = await self.db.scalar(select(User).where(User.id == user.id).with_for_update())
        if not verify_password(data.current_password, user.password_hash):
            raise AppError(400, 'Current password is incorrect')
        set_audit_actor(self.db, user.id)
        user.password_hash = hash_password(data.new_password)
        await self.revoke_all(user.id)
        await self.db.commit()
