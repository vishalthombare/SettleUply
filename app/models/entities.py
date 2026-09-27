from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import String, Text, Boolean, Date, DateTime, Numeric, ForeignKey, CheckConstraint, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base, IdentityMixin, AuditMixin, ID_TYPE, utcnow
from app.models.enums import *


def enum_type(cls):
    return SAEnum(cls, native_enum=False, create_constraint=True, name=cls.__name__.lower())


class User(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'users'
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(enum_type(Role), default=Role.USER)
    status: Mapped[UserStatus] = mapped_column(enum_type(UserStatus), default=UserStatus.PENDING_VERIFICATION, index=True)
    email_verified: Mapped[bool] = mapped_column(default=False)
    approved_by: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('users.id'))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    approver: Mapped[Optional['User']] = relationship(remote_side='User.id', foreign_keys=[approved_by], lazy='raise')
    settings: Mapped['UserSettings'] = relationship(back_populates='user', foreign_keys='UserSettings.user_id', lazy='raise', uselist=False)
    sessions: Mapped[list['UserSession']] = relationship(back_populates='user', foreign_keys='UserSession.user_id', lazy='raise')


class UserSettings(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'user_settings'
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), unique=True)
    default_currency: Mapped[str] = mapped_column(String(3), default='MYR')
    timezone: Mapped[str] = mapped_column(String(64), default='Asia/Kuala_Lumpur')
    email_transaction_notifications: Mapped[bool] = mapped_column(default=False)
    sms_transaction_notifications: Mapped[bool] = mapped_column(default=False)
    email_due_reminders: Mapped[bool] = mapped_column(default=False)
    sms_due_reminders: Mapped[bool] = mapped_column(default=False)
    email_settlement_notifications: Mapped[bool] = mapped_column(default=False)
    sms_settlement_notifications: Mapped[bool] = mapped_column(default=False)
    email_group_notifications: Mapped[bool] = mapped_column(default=False)
    sms_group_notifications: Mapped[bool] = mapped_column(default=False)
    default_reminder_days_before: Mapped[int] = mapped_column(default=3)
    user: Mapped[User] = relationship(back_populates='settings', foreign_keys=[user_id], lazy='raise')


class UserSession(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'user_sessions'
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    user_agent: Mapped[Optional[str]] = mapped_column(String(512))
    user: Mapped[User] = relationship(back_populates='sessions', foreign_keys=[user_id], lazy='raise')


class OTPVerification(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'otp_verifications'
    user_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    purpose: Mapped[OTPPurpose] = mapped_column(enum_type(OTPPurpose))
    otp_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(default=0)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    user: Mapped[Optional[User]] = relationship(foreign_keys=[user_id], lazy='raise')


class Contact(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'contacts'
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[Optional[str]] = mapped_column(String(254))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    country_code: Mapped[Optional[str]] = mapped_column(String(5))
    preferred_currency: Mapped[Optional[str]] = mapped_column(String(3))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    linked_user_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('users.id'))
    is_active: Mapped[bool] = mapped_column(default=True)
    owner: Mapped[User] = relationship(foreign_keys=[user_id], lazy='raise')
    linked_user: Mapped[Optional[User]] = relationship(foreign_keys=[linked_user_id], lazy='raise')
    transactions: Mapped[list['Transaction']] = relationship(back_populates='contact', lazy='raise')


class CatalogMixin(IdentityMixin, AuditMixin):
    user_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    name: Mapped[str] = mapped_column(String(80))
    icon: Mapped[Optional[str]] = mapped_column(String(40))
    is_system: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)


class Category(CatalogMixin, Base):
    __tablename__ = 'categories'
    __table_args__ = (CheckConstraint('(is_system AND user_id IS NULL) OR (NOT is_system AND user_id IS NOT NULL)', name='ownership'),)
    user: Mapped[Optional[User]] = relationship(foreign_keys='Category.user_id', lazy='raise')


class PaymentMethod(CatalogMixin, Base):
    __tablename__ = 'payment_methods'
    __table_args__ = (CheckConstraint('(is_system AND user_id IS NULL) OR (NOT is_system AND user_id IS NOT NULL)', name='ownership'),)
    user: Mapped[Optional[User]] = relationship(foreign_keys='PaymentMethod.user_id', lazy='raise')


class Transaction(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'transactions'
    __table_args__ = (
        CheckConstraint('amount > 0', name='positive_amount'),
        CheckConstraint("(transaction_type = 'PERSONAL_EXPENSE' AND contact_id IS NULL) OR (transaction_type != 'PERSONAL_EXPENSE' AND contact_id IS NOT NULL)", name='contact_type'),
    )
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    contact_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('contacts.id'), index=True)
    transaction_type: Mapped[TransactionType] = mapped_column(enum_type(TransactionType), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3), index=True)
    category_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('categories.id'))
    payment_method_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('payment_methods.id'))
    purpose: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text)
    reference_number: Mapped[Optional[str]] = mapped_column(String(120))
    transaction_date: Mapped[date] = mapped_column(Date, index=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, index=True)
    status: Mapped[TransactionStatus] = mapped_column(enum_type(TransactionStatus), default=TransactionStatus.OPEN, index=True)
    notify_email: Mapped[bool] = mapped_column(default=False)
    notify_sms: Mapped[bool] = mapped_column(default=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    owner: Mapped[User] = relationship(foreign_keys=[user_id], lazy='raise')
    contact: Mapped[Optional[Contact]] = relationship(back_populates='transactions', lazy='raise')
    category: Mapped[Optional[Category]] = relationship(lazy='raise')
    payment_method: Mapped[Optional[PaymentMethod]] = relationship(lazy='raise')
    settlements: Mapped[list['TransactionSettlement']] = relationship(back_populates='transaction', lazy='raise')


class TransactionSettlement(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'transaction_settlements'
    __table_args__ = (CheckConstraint('amount > 0', name='positive_amount'),)
    transaction_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('transactions.id'), index=True)
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3))
    payment_method_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('payment_methods.id'))
    settlement_date: Mapped[date] = mapped_column(Date)
    reference_number: Mapped[Optional[str]] = mapped_column(String(120))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    transaction: Mapped[Transaction] = relationship(back_populates='settlements', lazy='raise')
    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy='raise')
    payment_method: Mapped[Optional[PaymentMethod]] = relationship(lazy='raise')


class Group(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'groups'
    owner_user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[Optional[str]] = mapped_column(Text)
    default_currency: Mapped[Optional[str]] = mapped_column(String(3))
    is_active: Mapped[bool] = mapped_column(default=True)
    owner: Mapped[User] = relationship(foreign_keys=[owner_user_id], lazy='raise')
    members: Mapped[list['GroupMember']] = relationship(back_populates='group', lazy='raise')
    expenses: Mapped[list['GroupExpense']] = relationship(back_populates='group', lazy='raise')


class GroupMember(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'group_members'
    __table_args__ = (
        UniqueConstraint('group_id', 'user_id', name='uq_group_members_group_id_user_id'),
        UniqueConstraint('group_id', 'contact_id', name='uq_group_members_group_id_contact_id'),
    )
    group_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('groups.id'), index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('users.id'))
    contact_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('contacts.id'))
    display_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[Optional[str]] = mapped_column(String(254))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(default=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    group: Mapped[Group] = relationship(back_populates='members', lazy='raise')
    user: Mapped[Optional[User]] = relationship(foreign_keys=[user_id], lazy='raise')
    contact: Mapped[Optional[Contact]] = relationship(lazy='raise')


class GroupExpense(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'group_expenses'
    __table_args__ = (CheckConstraint('amount > 0', name='positive_amount'),)
    group_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('groups.id'), index=True)
    created_by_user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'))
    paid_by_member_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('group_members.id'))
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3))
    category_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('categories.id'))
    payment_method_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('payment_methods.id'))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text)
    expense_date: Mapped[date] = mapped_column(Date)
    split_type: Mapped[SplitType] = mapped_column(enum_type(SplitType))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    group: Mapped[Group] = relationship(back_populates='expenses', lazy='raise')
    creator: Mapped[User] = relationship(foreign_keys=[created_by_user_id], lazy='raise')
    payer: Mapped[GroupMember] = relationship(lazy='raise')
    category: Mapped[Optional[Category]] = relationship(lazy='raise')
    payment_method: Mapped[Optional[PaymentMethod]] = relationship(lazy='raise')
    splits: Mapped[list['ExpenseSplit']] = relationship(back_populates='expense', lazy='raise')


class ExpenseSplit(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'expense_splits'
    __table_args__ = (UniqueConstraint('group_expense_id', 'group_member_id'), CheckConstraint('share_amount >= 0 AND settled_amount >= 0 AND settled_amount <= share_amount', name='valid_share'))
    group_expense_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('group_expenses.id'), index=True)
    group_member_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('group_members.id'))
    share_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    settled_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=Decimal('0'))
    expense: Mapped[GroupExpense] = relationship(back_populates='splits', lazy='raise')
    member: Mapped[GroupMember] = relationship(lazy='raise')


class Reminder(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'reminders'
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    transaction_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('transactions.id'), index=True)
    reminder_type: Mapped[ReminderType] = mapped_column(enum_type(ReminderType))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    repeat_interval_days: Mapped[Optional[int]] = mapped_column()
    email_enabled: Mapped[bool] = mapped_column(default=True)
    sms_enabled: Mapped[bool] = mapped_column(default=False)
    status: Mapped[ReminderStatus] = mapped_column(enum_type(ReminderStatus), default=ReminderStatus.PENDING)
    last_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy='raise')
    transaction: Mapped[Transaction] = relationship(lazy='raise')


class NotificationLog(IdentityMixin, AuditMixin, Base):
    __tablename__ = 'notification_logs'
    user_id: Mapped[int] = mapped_column(ID_TYPE, ForeignKey('users.id'), index=True)
    contact_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('contacts.id'))
    transaction_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('transactions.id'))
    group_id: Mapped[Optional[int]] = mapped_column(ID_TYPE, ForeignKey('groups.id'))
    channel: Mapped[Channel] = mapped_column(enum_type(Channel))
    notification_type: Mapped[str] = mapped_column(String(60))
    recipient: Mapped[str] = mapped_column(String(254))
    subject: Mapped[Optional[str]] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[NotificationStatus] = mapped_column(enum_type(NotificationStatus), default=NotificationStatus.PENDING)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(200))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy='raise')
    contact: Mapped[Optional[Contact]] = relationship(lazy='raise')
    transaction: Mapped[Optional[Transaction]] = relationship(lazy='raise')
    group: Mapped[Optional[Group]] = relationship(lazy='raise')
