from sqlalchemy import select, literal, union_all, func, cast, String, case
from app.db.base import ID_TYPE
from app.models.enums import TransactionStatus as TS
from app.models import Contact, Transaction, TransactionSettlement, GroupExpense, Group, GroupMember
from app.repositories.base import Repository
from app.services.balances import BalanceCalculationService


class LedgerService(Repository):
    def activity_query(self, user_id, contact_id=None, include_groups=True, today=None):
        tx = select(Transaction.id.label('id'), Transaction.id.label('transaction_id'), cast(literal(None), ID_TYPE).label('group_id'), cast(Transaction.transaction_type, String).label('kind'), Transaction.purpose.label('title'), Transaction.amount.label('amount'), Transaction.currency.label('currency'), Transaction.transaction_date.label('date'), case((Transaction.status.in_([TS.OPEN, TS.PARTIALLY_SETTLED, TS.OVERDUE]) & (Transaction.due_date < today), 'OVERDUE'), else_=cast(Transaction.status, String)).label('status')).where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        settlements = select(TransactionSettlement.id, Transaction.id, cast(literal(None), ID_TYPE), literal('SETTLEMENT'), Transaction.purpose, TransactionSettlement.amount, TransactionSettlement.currency, TransactionSettlement.settlement_date, literal('SETTLED')).join(Transaction, Transaction.id == TransactionSettlement.transaction_id).where(TransactionSettlement.user_id == user_id, Transaction.deleted_at.is_(None))
        if contact_id is not None:
            tx = tx.where(Transaction.contact_id == contact_id)
            settlements = settlements.where(Transaction.contact_id == contact_id)
        queries = [tx, settlements]
        if include_groups and contact_id is None:
            membership = select(GroupMember.group_id).where(GroupMember.user_id == user_id, GroupMember.is_active.is_(True))
            groups = select(GroupExpense.id, cast(literal(None), ID_TYPE), GroupExpense.group_id, literal('GROUP_EXPENSE'), GroupExpense.title, GroupExpense.amount, GroupExpense.currency, GroupExpense.expense_date, literal('OPEN')).join(Group, Group.id == GroupExpense.group_id).where((Group.owner_user_id == user_id) | Group.id.in_(membership), GroupExpense.deleted_at.is_(None), Group.is_active.is_(True))
            queries.append(groups)
        return union_all(*queries).subquery()

    async def activity(self, user_id, page=1, page_size=20, contact_id=None, **filters):
        rows = self.activity_query(user_id, contact_id, today=await BalanceCalculationService(self.db).today(user_id))
        query = select(rows)
        for field in ['currency', 'status', 'kind']:
            if filters.get(field):
                query = query.where(rows.c[field] == filters[field])
        if filters.get('search'):
            query = query.where(rows.c.title.ilike(f"%{filters['search']}%"))
        if filters.get('from_date'):
            query = query.where(rows.c.date >= filters['from_date'])
        if filters.get('to_date'):
            query = query.where(rows.c.date <= filters['to_date'])
        total = await self.db.scalar(select(func.count()).select_from(query.subquery()))
        items = (await self.db.execute(query.order_by(rows.c.date.desc(), rows.c.id.desc()).offset((page - 1) * page_size).limit(page_size))).mappings().all()
        return {'items': [dict(i) for i in items], 'page': page, 'page_size': page_size, 'total': total, 'total_pages': (total + page_size - 1) // page_size}

    async def contact(self, user_id, contact_id, page, page_size):
        contact = await self.owned(Contact, contact_id, user_id)
        return {'contact': contact, **await BalanceCalculationService(self.db).totals(user_id, contact_id), 'history': await self.activity(user_id, page, page_size, contact_id)}
