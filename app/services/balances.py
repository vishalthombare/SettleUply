from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy import select, func, case
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

    def person_balances_query(self, user_id):
        rows = self.outstanding_query(user_id).subquery()
        signed = case((rows.c.transaction_type == TT.MONEY_LENT, rows.c.outstanding),
                      else_=-rows.c.outstanding)
        return select(rows.c.contact_id, rows.c.currency, func.sum(signed).label('net')).where(
            rows.c.contact_id.is_not(None), rows.c.transaction_type != TT.PERSONAL_EXPENSE,
        ).group_by(rows.c.contact_id, rows.c.currency)

    async def totals(self, user_id, contact_id=None):
        rows = self.person_balances_query(user_id).subquery()
        query = select(rows)
        if contact_id is not None:
            query = query.where(rows.c.contact_id == contact_id)
        result = {'receivables': {}, 'payables': {}}
        for _, currency, net in (await self.db.execute(query)).all():
            # Offset only within one person and currency, then aggregate each side.
            for key, amount in [('receivables', max(net, ZERO)), ('payables', max(-net, ZERO))]:
                result[key][currency] = result[key].get(currency, ZERO) + amount
        return result
