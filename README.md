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
