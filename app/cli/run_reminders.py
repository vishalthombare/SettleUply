import asyncio
from app.db.session import SessionLocal
from app.services.reminders import ReminderService


async def main():
    async with SessionLocal() as db:
        print(f'Dispatched {await ReminderService(db).run_due()} reminders')


if __name__ == '__main__':
    asyncio.run(main())
