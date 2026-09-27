import asyncio
from sqlalchemy import select, text
from app.db.session import SessionLocal
from app.models import Category, PaymentMethod

CATEGORIES = ['Food', 'Travel', 'Shopping', 'Rent', 'Bills', 'Loan', 'Entertainment', 'Medical', 'Other']
PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Credit Card', 'Debit Card', 'DuitNow', "Touch 'n Go", 'Other']


async def main():
    async with SessionLocal() as db:
        if db.bind.dialect.name == 'postgresql':
            await db.execute(text('SELECT pg_advisory_xact_lock(723451)'))
        for model, names in [(Category, CATEGORIES), (PaymentMethod, PAYMENT_METHODS)]:
            existing = set((await db.scalars(select(model.name).where(model.is_system.is_(True)))).all())
            for name in names:
                if name not in existing:
                    db.add(model(name=name, is_system=True, user_id=None))
        await db.commit()
    print('Default categories and payment methods ready')


if __name__ == '__main__':
    asyncio.run(main())
