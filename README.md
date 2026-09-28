# SettleUply backend

See the [root setup guide](../README.md), [API overview](../docs/api-overview.md), and [database design](../docs/database-design.md).

From this directory:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Configure .env using the root setup guide; this workspace already has it.
alembic upgrade head
alembic current
alembic check
uvicorn app.main:app --reload
```

The initial migration `357357d2f437` creates the 15 application tables and their audit fields. Configure `DATABASE_URL` in `.env` before running migrations. No schema is automatically created on application startup. `/docs` and `/health` work without a database; business endpoints return 503 until configured.

```sh
python -m pytest -q
python -m app.cli.seed
python -m app.cli.create_admin
python -m app.cli.run_reminders
```

The final three commands require a configured, migrated database. Tests use SQLite in memory and require no external services. Never enable DEV_SHOW_OTP outside local development.

Email layout and copy live in [app/notifications/templates.py](app/notifications/templates.py). Registration, sign-in, and password-reset codes use a shared branded HTML layout with a plain-text alternative, personalized greeting, and the configured OTP expiry. Transaction, settlement, group, and reminder emails use the same layout with their own headings. Resend receives both `html` and `text` through its [send-email API](https://resend.com/docs/api-reference/emails/send-email). Template changes require no database migration or additional environment settings.

Run `python -m pytest -q` to check template escaping and delivery payloads using mocked email transport; the tests do not send real email.

The dashboard response includes `net_balances`, a currency-to-decimal-string map of outstanding personal receivables minus payables. Partial repayments reduce the corresponding outstanding total; deleted/cancelled loans, personal expenses, and group balances are excluded. Zero net balances are retained and do not imply that every loan is settled. This calculated field needs no database migration.
