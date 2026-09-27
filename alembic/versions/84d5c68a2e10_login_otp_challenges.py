"""Require email OTP for new sign-ins.

Revision ID: 84d5c68a2e10
Revises: 357357d2f437
"""
from alembic import op
import sqlalchemy as sa

revision = '84d5c68a2e10'
down_revision = '357357d2f437'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('otp_verifications', sa.Column('challenge_hash', sa.String(64), nullable=True))
    op.create_unique_constraint(op.f('uq_otp_verifications_challenge_hash'), 'otp_verifications', ['challenge_hash'])
    op.drop_constraint(op.f('ck_otp_verifications_otppurpose'), 'otp_verifications', type_='check')
    op.create_check_constraint(
        op.f('ck_otp_verifications_otppurpose'), 'otp_verifications',
        "purpose IN ('REGISTRATION', 'PASSWORD_RESET', 'EMAIL_CHANGE', 'LOGIN')",
    )


def downgrade():
    # Refuse to erase login verification history implicitly. The old constraint
    # must validate before removing the new column; archive LOGIN rows explicitly first.
    op.drop_constraint(op.f('ck_otp_verifications_otppurpose'), 'otp_verifications', type_='check')
    op.create_check_constraint(
        op.f('ck_otp_verifications_otppurpose'), 'otp_verifications',
        "purpose IN ('REGISTRATION', 'PASSWORD_RESET', 'EMAIL_CHANGE')",
    )
    op.drop_constraint(op.f('uq_otp_verifications_challenge_hash'), 'otp_verifications', type_='unique')
    op.drop_column('otp_verifications', 'challenge_hash')
