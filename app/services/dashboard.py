from datetime import timedelta
from decimal import Decimal
from sqlalchemy import select, func
from app.models import Transaction, TransactionSettlement, Contact
from app.models.enums import TransactionType, TransactionStatus
from app.repositories.base import Repository
from app.services.balances import BalanceCalculationService
from app.services.transactions import TransactionService
from app.services.ledger import LedgerService
from app.services.groups import GroupService


class DashboardService(Repository):
    async def load(self, user_id):
        balance = BalanceCalculationService(self.db)
        totals = await balance.totals(user_id)
        # Personal lending and borrowing only; never combine different currencies.
        net_balances = {
            currency: totals['receivables'].get(currency, Decimal('0')) - totals['payables'].get(currency, Decimal('0'))
            for currency in sorted(totals['receivables'].keys() | totals['payables'].keys())
        }
        today = await balance.today(user_id)
        monthly = (await self.db.execute(select(Transaction.currency, func.sum(Transaction.amount)).where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None), Transaction.status != TransactionStatus.CANCELLED, Transaction.transaction_type == TransactionType.PERSONAL_EXPENSE, Transaction.transaction_date >= today.replace(day=1), Transaction.transaction_date <= today).group_by(Transaction.currency))).all()
        due = await self.db.scalars(select(Transaction).where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None), Transaction.transaction_type != TransactionType.PERSONAL_EXPENSE, Transaction.status.in_([TransactionStatus.OPEN, TransactionStatus.PARTIALLY_SETTLED, TransactionStatus.OVERDUE]), Transaction.due_date >= today, Transaction.due_date <= today + timedelta(days=7)).order_by(Transaction.due_date).limit(10))
        people_rows = balance.person_balances_query(user_id).subquery()
        people = (await self.db.execute(select(people_rows.c.contact_id, Contact.name,
            people_rows.c.currency, people_rows.c.net).join(Contact, Contact.id == people_rows.c.contact_id)
            .where(people_rows.c.net != 0).order_by(Contact.name, Contact.id, people_rows.c.currency).limit(100))).mappings().all()
        people = [dict(contact_id=p['contact_id'], name=p['name'], currency=p['currency'],
                       transaction_type=TransactionType.MONEY_LENT if p['net'] > 0 else TransactionType.MONEY_BORROWED,
                       amount=abs(p['net'])) for p in people]
        return {**totals, 'net_balances': net_balances, 'personal_expenses_this_month': dict(monthly), 'due_soon': [await balance.describe(t, today) for t in due], 'overdue': (await TransactionService(self.db).list(user_id, 1, 10, overdue=True))['items'], 'recent_activity': (await LedgerService(self.db).activity(user_id, 1, 10))['items'], 'recent_settlements': (await LedgerService(self.db).activity(user_id, 1, 5, kind='SETTLEMENT'))['items'], 'people_balances': [dict(p) for p in people], 'group_activity': (await LedgerService(self.db).activity(user_id, 1, 5, kind='GROUP_EXPENSE'))['items']}
