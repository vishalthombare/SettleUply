"""Populate shared category and payment method choices.

Revision ID: b19a730d2f41
Revises: 84d5c68a2e10
"""
from alembic import op
import sqlalchemy as sa

revision = 'b19a730d2f41'
down_revision = '84d5c68a2e10'
branch_labels = None
depends_on = None

DEFAULTS = {
    'categories': ['Food', 'Transport', 'Shopping', 'Bills', 'Rent', 'Health', 'Education', 'Travel', 'Other'],
    'payment_methods': ['Cash', 'Bank transfer', 'UPI', 'Debit card', 'Credit card', 'Wallet', 'Other'],
}


def upgrade():
    for table, names in DEFAULTS.items():
        for name in names:
            # Do not duplicate existing defaults or overwrite user-created catalog entries.
            statement = sa.text(f"""INSERT INTO {table}
                (name, is_system, is_active, created_application_type, updated_application_type)
                SELECT :name, true, true, 'SYSTEM', 'SYSTEM'
                WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE is_system = true AND lower(name) = lower(:name))""")
            op.execute(statement.bindparams(name=name))


def downgrade():
    # Catalog IDs may be referenced by financial history. Retain these data rows.
    pass
