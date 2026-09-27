from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Optional, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, ConfigDict, Field, EmailStr, BeforeValidator, AfterValidator, AwareDatetime
from app.models.enums import *

# Supported ISO currencies and their minor units are shared by all financial operations.
CURRENCY_DIGITS = {'MYR': 2, 'INR': 2, 'USD': 2, 'EUR': 2, 'GBP': 2, 'SGD': 2, 'AUD': 2, 'CAD': 2, 'JPY': 0, 'KRW': 0, 'CNY': 2, 'HKD': 2, 'THB': 2, 'IDR': 2, 'PHP': 2, 'AED': 2, 'SAR': 2, 'CHF': 2, 'NZD': 2, 'BHD': 3, 'KWD': 3, 'OMR': 3}


def currency(value: str) -> str:
    value = value.upper().strip()
    if value not in CURRENCY_DIGITS:
        raise ValueError('Unsupported currency')
    return value


def no_float(value):
    if isinstance(value, (float, bool)):
        raise ValueError('Send money as a decimal string')
    return value


def password(value: str) -> str:
    if len(value) < 10 or not any(c.islower() for c in value) or not any(c.isupper() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError('Use at least 10 characters with uppercase, lowercase and a number')
    return value


def timezone_name(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError:
        raise ValueError('Unknown timezone')
    return value


Money = Annotated[Decimal, BeforeValidator(no_float), Field(gt=0, max_digits=19, decimal_places=4)]
Share = Annotated[Decimal, BeforeValidator(no_float), Field(ge=0, max_digits=19, decimal_places=4)]
Currency = Annotated[str, AfterValidator(currency)]
Password = Annotated[str, Field(max_length=128), AfterValidator(password)]
Name = Annotated[str, Field(min_length=1, max_length=120)]
ID = Annotated[int, Field(gt=0)]


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Register(Input):
    name: Name
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=30)
    password: Password


class Login(Input):
    email: EmailStr
    password: str = Field(max_length=128)


class EmailInput(Input):
    email: EmailStr


class VerifyOTP(EmailInput):
    otp: str = Field(pattern=r'^\d{6}$')


class ResetPassword(VerifyOTP):
    password: Password


class ChangePassword(Input):
    current_password: str = Field(max_length=128)
    new_password: Password


class ProfileUpdate(Input):
    name: Name
    phone: Optional[str] = Field(None, max_length=30)


class SettingsUpdate(Input):
    default_currency: Optional[Currency] = None
    timezone: Optional[Annotated[str, AfterValidator(timezone_name)]] = None
    email_transaction_notifications: Optional[bool] = None
    sms_transaction_notifications: Optional[bool] = None
    email_due_reminders: Optional[bool] = None
    sms_due_reminders: Optional[bool] = None
    email_settlement_notifications: Optional[bool] = None
    sms_settlement_notifications: Optional[bool] = None
    email_group_notifications: Optional[bool] = None
    sms_group_notifications: Optional[bool] = None
    default_reminder_days_before: Optional[int] = Field(None, ge=0, le=365)


class ContactInput(Input):
    name: Name
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=30)
    country_code: Optional[str] = Field(None, max_length=5)
    preferred_currency: Optional[Currency] = None
    notes: Optional[str] = Field(None, max_length=5000)
    is_active: bool = True


class CatalogInput(Input):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    icon: Optional[str] = Field(None, max_length=40)
    is_active: bool = True


class TransactionInput(Input):
    transaction_type: TransactionType
    contact_id: Optional[ID] = None
    amount: Money
    currency: Currency
    category_id: Optional[ID] = None
    payment_method_id: Optional[ID] = None
    purpose: Annotated[str, Field(min_length=1, max_length=200)]
    description: Optional[str] = Field(None, max_length=5000)
    reference_number: Optional[str] = Field(None, max_length=120)
    transaction_date: date
    due_date: Optional[date] = None
    notify_email: Optional[bool] = None
    notify_sms: Optional[bool] = None
    status: Optional[Literal['OPEN', 'CANCELLED']] = None


class SettlementInput(Input):
    amount: Money
    currency: Currency
    payment_method_id: Optional[ID] = None
    settlement_date: date
    reference_number: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=5000)


class GroupInput(Input):
    name: Name
    description: Optional[str] = Field(None, max_length=5000)
    default_currency: Optional[Currency] = None
    is_active: bool = True


class MemberInput(Input):
    display_name: Name
    # Registered members join by their known email; no user-directory enumeration.
    registered_email: Optional[EmailStr] = None
    contact_id: Optional[ID] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=30)
    is_active: bool = True


class SplitInput(Input):
    group_member_id: ID
    share_amount: Optional[Share] = None


class GroupExpenseInput(Input):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    amount: Money
    currency: Currency
    paid_by_member_id: ID
    expense_date: date
    category_id: Optional[ID] = None
    payment_method_id: Optional[ID] = None
    description: Optional[str] = Field(None, max_length=5000)
    split_type: SplitType
    splits: list[SplitInput] = Field(min_length=1, max_length=200)


class ReminderInput(Input):
    transaction_id: ID
    reminder_type: ReminderType = ReminderType.CUSTOM
    scheduled_at: AwareDatetime
    repeat_interval_days: Optional[int] = Field(None, ge=1, le=365)
    email_enabled: bool = True
    sms_enabled: bool = False
    status: ReminderStatus = ReminderStatus.PENDING


class PageParams(Input):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
