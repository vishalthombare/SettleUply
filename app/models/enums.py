from enum import Enum

class Role(str, Enum):
    ADMIN = 'ADMIN'
    USER = 'USER'

class UserStatus(str, Enum):
    PENDING_VERIFICATION = 'PENDING_VERIFICATION'
    PENDING_APPROVAL = 'PENDING_APPROVAL'
    ACTIVE = 'ACTIVE'
    REJECTED = 'REJECTED'
    SUSPENDED = 'SUSPENDED'

class TransactionType(str, Enum):
    PERSONAL_EXPENSE = 'PERSONAL_EXPENSE'
    MONEY_LENT = 'MONEY_LENT'
    MONEY_BORROWED = 'MONEY_BORROWED'

class TransactionStatus(str, Enum):
    OPEN = 'OPEN'
    PARTIALLY_SETTLED = 'PARTIALLY_SETTLED'
    SETTLED = 'SETTLED'
    OVERDUE = 'OVERDUE'
    CANCELLED = 'CANCELLED'

class SplitType(str, Enum):
    EQUAL = 'EQUAL'
    EXACT = 'EXACT'

class OTPPurpose(str, Enum):
    REGISTRATION = 'REGISTRATION'
    PASSWORD_RESET = 'PASSWORD_RESET'
    EMAIL_CHANGE = 'EMAIL_CHANGE'

class ReminderType(str, Enum):
    DUE_SOON = 'DUE_SOON'
    DUE_TODAY = 'DUE_TODAY'
    OVERDUE = 'OVERDUE'
    CUSTOM = 'CUSTOM'

class ReminderStatus(str, Enum):
    PENDING = 'PENDING'
    SENT = 'SENT'
    CANCELLED = 'CANCELLED'

class Channel(str, Enum):
    EMAIL = 'EMAIL'
    SMS = 'SMS'

class NotificationStatus(str, Enum):
    PENDING = 'PENDING'
    SENT = 'SENT'
    FAILED = 'FAILED'
    SKIPPED = 'SKIPPED'
