from collections import defaultdict
from datetime import date
from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy import select, func
from app.models import Transaction, TransactionSettlement, UserSettings
from app.models.enums import TransactionType as TT, TransactionStatus as TS
from app.db.base import utcnow
from app.repositories.base import Repository
from app.utils.serialization import serialize

ZERO = Decimal('0')


class BalanceCalculationService(Repository):
    async def today(self, user_id):
        settings = await self.db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
        return utcnow().astimezone(ZoneInfo(settings.timezone if settings else 'UTC')).date()

    async def settled(self, transaction_id):
        return await self.db.scalar(select(func.coalesce(func.sum(TransactionSettlement.amount), 0)).where(TransactionSettlement.transaction_id == transaction_id)) or ZERO

    @staticmethod
    def status(transaction, settled, today):
        if transaction.status == TS.CANCELLED:
            return TS.CANCELLED
        if transaction.transaction_type == TT.PERSONAL_EXPENSE or settled == transaction.amount:
            return TS.SETTLED
        if transaction.due_date and transaction.due_date < today:
            return TS.OVERDUE
        return TS.PARTIALLY_SETTLED if settled > ZERO else TS.OPEN

    async def describe(self, transaction, today=None):
        paid = await self.settled(transaction.id)
        result = serialize(transaction)
        result.update(settled_amount=paid, outstanding_amount=ZERO if transaction.transaction_type == TT.PERSONAL_EXPENSE or transaction.status == TS.CANCELLED else transaction.amount - paid, status=self.status(transaction, paid, today or await self.today(transaction.user_id)))
        return result

    def outstanding_query(self, user_id):
        settled = select(TransactionSettlement.transaction_id, func.sum(TransactionSettlement.amount).label('paid')).where(TransactionSettlement.user_id == user_id).group_by(TransactionSettlement.transaction_id).subquery()
        return select(Transaction, (Transaction.amount - func.coalesce(settled.c.paid, 0)).label('outstanding')).outerjoin(settled, settled.c.transaction_id == Transaction.id).where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None), Transaction.status != TS.CANCELLED)

    async def totals(self, user_id, contact_id=None):
        query = self.outstanding_query(user_id)
        if contact_id is not None:
            query = query.where(Transaction.contact_id == contact_id)
        query = query.subquery()
        rows = (await self.db.execute(select(query.c.transaction_type, query.c.currency, func.sum(query.c.outstanding)).where(query.c.transaction_type != TT.PERSONAL_EXPENSE).group_by(query.c.transaction_type, query.c.currency))).all()
        result = {'receivables': {}, 'payables': {}}
        for kind, currency, amount in rows:
            result['receivables' if kind == TT.MONEY_LENT else 'payables'][currency] = amount
        return result
