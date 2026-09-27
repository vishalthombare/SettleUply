from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from sqlalchemy import inspect

SENSITIVE = {'password_hash', 'refresh_token_hash', 'otp_hash'}


def serialize(value):
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, datetime):
        # SQLite tests omit offsets on reload; all application timestamps represent UTC.
        timestamp = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return timestamp.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    if hasattr(value, '__table__'):
        return {c.key: serialize(getattr(value, c.key)) for c in inspect(value).mapper.column_attrs if c.key not in SENSITIVE}
    return value


def ok(data=None, message='Success'):
    return {'success': True, 'message': message, 'data': serialize(data)}
