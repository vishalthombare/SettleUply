from datetime import date, timedelta, timezone
from decimal import Decimal
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import BigInteger, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable, PrimaryKeyConstraint, UniqueConstraint

from app.core.audit import ApplicationType
from app.core.security import access_token, token_hash, otp_hash, hash_password, aware
from app.db.audit import set_request_audit, set_audit_actor
from app.db.base import Base, utcnow
from app.db.session import get_db
from app.exceptions import AppError
from app.main import app
from app.models import Contact, User, UserSession, OTPVerification, GroupMember, ExpenseSplit
from app.models.enums import Role, UserStatus, OTPPurpose
from app.notifications.providers import Delivery
from app.schemas.inputs import ContactInput, GroupInput, MemberInput, GroupExpenseInput, SplitInput, VerifyOTP, Login
from app.services.auth import AuthService
from app.services.catalogs import ContactService
from app.services.groups import GroupService
from app.services.users import UserService

AUDIT_FIELDS = {
    'created_by', 'updated_by', 'created_at', 'updated_at',
    'created_application_type', 'updated_application_type',
}


def test_postgresql_constraint_and_index_names_do_not_collide():
    # SQLite accepts duplicate constraint names; PostgreSQL rejects them.
    index_names = set()
    for table in Base.metadata.tables.values():
        constraint_names = [str(item.name) for item in table.constraints if item.name]
        assert len(constraint_names) == len(set(constraint_names)), table.name
        # Primary/unique constraints also create indexes in the schema namespace.
        indexes = list(table.indexes) + [
            item for item in table.constraints
            if isinstance(item, (PrimaryKeyConstraint, UniqueConstraint))
        ]
        for item in indexes:
            assert item.name is not None, table.name
            assert str(item.name) not in index_names, item.name
            index_names.add(str(item.name))


def test_every_table_has_audit_fields_and_bigint_user_references():
    assert len(Base.metadata.tables) == 15
    for table in Base.metadata.tables.values():
        assert AUDIT_FIELDS.issubset(table.c.keys()), table.name
        for field in ['created_by', 'updated_by']:
            column = table.c[field]
            assert isinstance(column.type, BigInteger)
            assert next(iter(column.foreign_keys)).target_fullname == 'users.id'
        for field in ['created_at', 'updated_at']:
            assert table.c[field].type.timezone is True
            assert table.c[field].nullable is False
        ddl = str(CreateTable(table).compile(dialect=postgresql.dialect()))
        assert 'BIGINT GENERATED ALWAYS AS IDENTITY' in ddl
        assert 'created_application_type' in ddl


async def test_create_update_and_archive_keep_creation_audit(db):
    set_request_audit(db, 'WEB')
    set_audit_actor(db, 1)
    service = ContactService(db)
    contact = await service.save(1, ContactInput(name='Audit contact'))
    creation = (contact.created_by, contact.created_at, contact.created_application_type)
    assert contact.created_at.tzinfo == timezone.utc
    assert contact.created_by == contact.updated_by == 1
    assert contact.created_application_type == contact.updated_application_type == 'WEB'
    assert contact.created_at == contact.updated_at

    set_request_audit(db, 'MOBILE')
    set_audit_actor(db, 1)
    await service.save(1, ContactInput(name='Edited on mobile'), contact.id)
    assert (contact.created_by, contact.created_at, contact.created_application_type) == creation
    assert contact.updated_application_type == 'MOBILE'
    assert contact.updated_by == 1
    assert contact.updated_at > contact.created_at
    updated_at = contact.updated_at
    # Reads and no-op commits must not rewrite audit metadata.
    await db.commit()
    assert contact.updated_at == updated_at
    await service.archive(1, contact.id)
    assert not contact.is_active and contact.updated_at > updated_at
    assert (contact.created_by, contact.created_at, contact.created_application_type) == creation


async def test_admin_action_records_actor_not_target_user(db):
    admin = await db.get(User, 2)
    admin.role = Role.ADMIN
    await db.commit()
    target = await db.get(User, 1)
    created_at = target.created_at
    set_request_audit(db, 'MOBILE')
    set_audit_actor(db, admin.id)
    await UserService(db).transition(admin, target.id, 'suspend')
    assert target.status == UserStatus.SUSPENDED
    assert target.updated_by == admin.id
    assert target.updated_application_type == 'MOBILE'
    assert target.created_by is None and target.created_at == created_at


async def test_bulk_revocation_stamps_updates_without_changing_creation(db):
    set_request_audit(db, 'WEB')
    set_audit_actor(db, 1)
    session = UserSession(user_id=1, refresh_token_hash=token_hash('audit-token'), expires_at=utcnow() + timedelta(days=1))
    db.add(session)
    await db.commit()
    created_at = session.created_at
    set_request_audit(db, 'MOBILE')
    set_audit_actor(db, 1)
    await AuthService(db).revoke_all(1)
    await db.commit()
    await db.refresh(session)
    assert session.revoked_at is not None
    assert session.updated_application_type == 'MOBILE'
    assert session.updated_by == 1
    assert session.created_application_type == 'WEB'
    assert aware(session.created_at) == created_at
    assert aware(session.updated_at) > created_at


async def test_group_members_and_splits_inherit_request_actor(db):
    set_request_audit(db, 'MOBILE')
    set_audit_actor(db, 1)
    service = GroupService(db)
    group = await service.save(await db.get(User, 1), GroupInput(name='Audited group'))
    member = await service.save_member(1, group.id, MemberInput(display_name='Bob', registered_email='bob@example.com'))
    owner = await db.scalar(select(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == 1))
    assert member.user_id == 2 and member.created_by == 1
    expense = await service.save_expense(1, group.id, GroupExpenseInput(
        title='Dinner', amount=Decimal('100'), currency='MYR', paid_by_member_id=owner.id,
        expense_date=date.today(), split_type='EQUAL',
        splits=[SplitInput(group_member_id=owner.id), SplitInput(group_member_id=member.id)],
    ))
    assert expense['created_by'] == 1
    assert expense['created_application_type'] == 'MOBILE'
    for split in expense['splits']:
        assert split.created_by == split.updated_by == 1
        assert split.created_application_type == 'MOBILE'


async def test_unknown_and_system_actions_are_not_mislabelled_as_web(db):
    system_contact = await ContactService(db).save(1, ContactInput(name='System record'))
    assert system_contact.created_by is None
    assert system_contact.created_application_type == 'SYSTEM'
    set_request_audit(db, None)
    anonymous = await ContactService(db).save(1, ContactInput(name='Missing source'))
    assert anonymous.created_by is None
    assert anonymous.created_application_type == 'UNKNOWN'
    for spoofed_source in ['SYSTEM', 'DESKTOP']:
        with pytest.raises(AppError):
            set_request_audit(db, spoofed_source)


async def test_password_and_otp_identity_are_recorded_only_after_verification(db):
    user = await db.get(User, 1)
    user.password_hash = hash_password('Password123')
    db.add(OTPVerification(user_id=user.id, email=user.email, purpose=OTPPurpose.REGISTRATION,
                           otp_hash=otp_hash(user.email, 'REGISTRATION', '123456'),
                           expires_at=utcnow() + timedelta(minutes=10)))
    await db.commit()
    set_request_audit(db, 'MOBILE')
    service = AuthService(db, email=SimpleNamespace(send=AsyncMock(return_value=Delivery(status='SENT'))))
    with pytest.raises(AppError):
        await service.verify_registration(VerifyOTP(email=user.email, otp='999999'))
    otp = await db.scalar(select(OTPVerification).where(OTPVerification.user_id == user.id))
    assert otp.updated_by is None and otp.updated_application_type == 'MOBILE'
    await service.verify_registration(VerifyOTP(email=user.email, otp='123456'))
    assert otp.updated_by == user.id
    set_request_audit(db, 'WEB')
    challenge = await service.login(Login(email=user.email, password='Password123'))
    assert await db.scalar(select(UserSession).where(UserSession.user_id == user.id)) is None
    code = re.search(r'\b\d{6}\b', service.email.send.call_args.args[2]).group()
    await service.verify_login(
        SimpleNamespace(challenge_token=challenge['challenge_token'], otp=code),
        SimpleNamespace(client=None, headers={}),
    )
    session = await db.scalar(select(UserSession).where(UserSession.user_id == user.id))
    assert session.created_by == user.id and session.created_application_type == 'WEB'
    assert user.updated_by == user.id


async def test_creation_metadata_cannot_be_rewritten(db):
    contact = await db.get(Contact, 1)
    contact.created_by = 2
    with pytest.raises(ValueError, match='Creation audit fields'):
        await db.flush()
    await db.rollback()
    with pytest.raises(ValueError, match='Creation audit fields'):
        await db.execute(update(Contact).where(Contact.id == 1).values(created_application_type='MOBILE'))


async def test_api_source_header_and_actor_are_applied_and_cannot_be_spoofed(db):
    session = UserSession(user_id=1, refresh_token_hash=token_hash('api-audit-token'), expires_at=utcnow() + timedelta(days=1))
    db.add(session)
    await db.commit()

    async def override(request: Request):
        set_request_audit(db, request.headers.get('X-Application-Type'))
        yield db

    app.dependency_overrides[get_db] = override
    headers = {'Authorization': 'Bearer ' + access_token(1, session.id), 'X-Application-Type': 'MOBILE', 'X-User-Id': '2'}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            spoofed = await client.post('/api/v1/contacts', headers=headers, json={'name': 'Contact', 'created_by': 2})
            assert spoofed.status_code == 422
            response = await client.post('/api/v1/contacts', headers=headers, json={'name': 'Contact'})
            assert response.status_code == 201, response.text
            data = response.json()['data']
            assert data['created_by'] == data['updated_by'] == 1
            assert data['created_application_type'] == 'MOBILE'
            headers['X-Application-Type'] = 'WEB'
            updated = await client.patch(f"/api/v1/contacts/{data['id']}", headers=headers, json={'name': 'Edited'})
            assert updated.status_code == 200, updated.text
            result = updated.json()['data']
            assert result['created_application_type'] == 'MOBILE'
            assert result['created_at'] == data['created_at']
            assert result['updated_application_type'] == 'WEB'
            headers['X-Application-Type'] = 'SYSTEM'
            assert (await client.post('/api/v1/contacts', headers=headers, json={'name': 'Spoofed'})).status_code == 422
            preflight = await client.options('/api/v1/contacts', headers={
                'Origin': 'http://localhost:4200', 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,content-type,x-application-type',
            })
            assert preflight.status_code == 200
    finally:
        app.dependency_overrides.clear()
