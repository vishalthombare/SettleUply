from datetime import datetime, timezone
from sqlalchemy import BigInteger, Integer, DateTime, Identity, MetaData, ForeignKey, Enum, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, declared_attr, relationship
from app.core.audit import ApplicationType


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        'ix': 'ix_%(column_0_label)s', 'uq': 'uq_%(table_name)s_%(column_0_name)s',
        'ck': 'ck_%(table_name)s_%(constraint_name)s',
        'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s',
        'pk': 'pk_%(table_name)s',
    })


# Integer variant only supports isolated SQLite tests; PostgreSQL uses BIGINT IDENTITY.
ID_TYPE = BigInteger().with_variant(Integer, 'sqlite')


class IdentityMixin:
    id: Mapped[int] = mapped_column(ID_TYPE, Identity(always=True), primary_key=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), onupdate=utcnow)


class AuditMixin(TimestampMixin):
    # Anonymous registration and system jobs have no authenticated user actor.
    created_by: Mapped[int | None] = mapped_column(ID_TYPE, ForeignKey('users.id'), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ID_TYPE, ForeignKey('users.id'), nullable=True)
    created_application_type: Mapped[ApplicationType] = mapped_column(
        Enum(ApplicationType, native_enum=False, create_constraint=True, name='created_application_type'),
        default=ApplicationType.UNKNOWN, server_default='UNKNOWN',
    )
    updated_application_type: Mapped[ApplicationType] = mapped_column(
        Enum(ApplicationType, native_enum=False, create_constraint=True, name='updated_application_type'),
        default=ApplicationType.UNKNOWN, server_default='UNKNOWN',
    )

    @declared_attr
    def created_by_user(cls):
        return relationship('User', foreign_keys=[cls.created_by], remote_side='User.id', lazy='raise')

    @declared_attr
    def updated_by_user(cls):
        return relationship('User', foreign_keys=[cls.updated_by], remote_side='User.id', lazy='raise')
