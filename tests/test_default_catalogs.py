import importlib.util
from pathlib import Path
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select
from app.models import Category, PaymentMethod


async def test_catalog_migration_is_repeatable_and_defaults_are_shared(db):
    path = Path(__file__).parents[1] / 'alembic/versions/b19a730d2f41_default_catalogs.py'
    spec = importlib.util.spec_from_file_location('default_catalog_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    def migrate(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
    await (await db.connection()).run_sync(migrate)
    for model, count in [(Category, 9), (PaymentMethod, 7)]:
        rows = (await db.scalars(select(model))).all()
        assert len(rows) == count
        assert all(row.is_active and row.is_system and row.user_id is None for row in rows)
