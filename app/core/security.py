import hashlib
import hmac
from datetime import timedelta, timezone
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from app.core.config import get_settings
from app.db.base import utcnow
from app.exceptions import AppError

hasher = PasswordHasher()


def hash_password(value: str) -> str:
    return hasher.hash(value)


def verify_password(value: str, hashed: str) -> bool:
    try:
        return hasher.verify(hashed, value)
    except (VerificationError, InvalidHashError):
        return False


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def otp_hash(email: str, purpose: str, otp: str) -> str:
    return hmac.new(get_settings().jwt_refresh_secret.encode(), f'{email}:{purpose}:{otp}'.encode(), hashlib.sha256).hexdigest()


def access_token(user_id: int, session_id: int) -> str:
    now = utcnow()
    return jwt.encode({'sub': str(user_id), 'sid': session_id, 'type': 'access', 'iat': now, 'exp': now + timedelta(minutes=get_settings().access_token_expire_minutes)}, get_settings().jwt_secret, algorithm='HS256')


def decode_access(token: str):
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=['HS256'], options={'require': ['sub', 'sid', 'exp', 'type']})
        if data['type'] != 'access' or int(data['sub']) <= 0:
            raise ValueError()
        return data
    except (jwt.PyJWTError, ValueError, TypeError):
        raise AppError(401, 'Please sign in again')


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
