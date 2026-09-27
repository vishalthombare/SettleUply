import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.cli import create_admin
from app.core.security import verify_password
from app.models import User, UserSettings
from app.models.enums import Role, UserStatus


def mock_admin_prompts(monkeypatch, db, password):
    answers = iter(['admin@example.com', 'Local admin'])
    monkeypatch.setattr('builtins.input', lambda prompt: next(answers))
    monkeypatch.setattr(create_admin.getpass, 'getpass', lambda prompt: password)
    monkeypatch.setattr(create_admin, 'SessionLocal', async_sessionmaker(db.bind, expire_on_commit=False))


@pytest.mark.parametrize('password', ['lowercaseonly', 'UPPERCASE1234', 'CaseNoDigit', 'Short1'])
async def test_invalid_admin_password_exits_without_leaking_input(db, monkeypatch, capsys, password):
    mock_admin_prompts(monkeypatch, db, password)
    with pytest.raises(SystemExit) as exc:
        await create_admin.main()

    message = str(exc.value)
    assert 'Use at least 10 characters with uppercase, lowercase and a number' in message
    assert 'Run the command again' in message
    assert exc.value.__suppress_context__ is True
    output = capsys.readouterr()
    visible = message + output.out + output.err
    assert password not in visible
    assert 'input_value' not in visible
    assert 'Traceback' not in visible
    assert await db.scalar(select(User).where(User.email == 'admin@example.com')) is None


async def test_valid_admin_creation_is_ready_for_login(db, monkeypatch, capsys):
    mock_admin_prompts(monkeypatch, db, '  LocalAdmin123  ')
    await create_admin.main()

    user = await db.scalar(select(User).where(User.email == 'admin@example.com'))
    assert user.role == Role.ADMIN
    assert user.status == UserStatus.ACTIVE
    assert user.email_verified is True
    assert user.approved_at is not None
    assert verify_password('LocalAdmin123', user.password_hash)
    assert await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id)) is not None
    assert 'Admin account ready' in capsys.readouterr().out
