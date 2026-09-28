from sqlalchemy import select, or_, func
from app.models import Contact, Transaction
from app.models.enums import TransactionType as TT, TransactionStatus as TS
from app.services.balances import BalanceCalculationService
from app.utils.serialization import serialize
from app.exceptions import AppError
from app.repositories.base import Repository


class ContactService(Repository):
    async def list(self, user_id, page, page_size, search=None, active=True, balance_filter=None):
        balance = BalanceCalculationService(self.db)
        rows = balance.outstanding_query(user_id).subquery()
        owed = select(rows.c.contact_id).where(rows.c.outstanding > 0)
        net = balance.person_balances_query(user_id).subquery()
        people = select(net.c.contact_id)
        query = select(Contact).where(Contact.user_id == user_id)
        if active is not None:
            query = query.where(Contact.is_active == active)
        if search:
            query = query.where(Contact.name.ilike(f'%{search}%'))
        if balance_filter == 'owes_me':
            query = query.where(Contact.id.in_(people.where(net.c.net > 0)))
        elif balance_filter == 'i_owe':
            query = query.where(Contact.id.in_(people.where(net.c.net < 0)))
        elif balance_filter == 'settled':
            query = query.where(~Contact.id.in_(people.where(net.c.net != 0)))
        elif balance_filter == 'overdue':
            query = query.where(Contact.id.in_(owed.where(rows.c.due_date < await balance.today(user_id))))
        elif balance_filter:
            raise AppError(422, 'Unknown balance filter')
        result = await self.page(query.order_by(Contact.name, Contact.id), page, page_size)
        items = []
        for contact in result['items']:
            totals = await balance.totals(user_id, contact.id)
            item = serialize(contact)
            item['balances'] = [{'currency': currency, 'direction': direction, 'amount': amount}
                                for key, direction in [('receivables', 'receivable'), ('payables', 'payable')]
                                for currency, amount in totals[key].items() if amount > 0]
            items.append(item)
        result['items'] = items
        return result

    async def save(self, user_id, data, resource_id=None):
        obj = await self.owned(Contact, resource_id, user_id) if resource_id else Contact(user_id=user_id)
        for key, value in data.model_dump().items():
            setattr(obj, key, value)
        self.db.add(obj)
        await self.db.commit()
        return obj

    async def archive(self, user_id, resource_id):
        obj = await self.owned(Contact, resource_id, user_id)
        obj.is_active = False
        await self.db.commit()


class CatalogService(Repository):
    async def list(self, model, user_id, page, page_size):
        return await self.page(select(model).where(or_(model.user_id == user_id, model.is_system.is_(True)), model.is_active.is_(True)).order_by(model.name), page, page_size)

    async def save(self, model, user_id, data, resource_id=None):
        obj = await self.owned(model, resource_id, user_id) if resource_id else model(user_id=user_id, is_system=False)
        for key, value in data.model_dump().items():
            setattr(obj, key, value)
        self.db.add(obj)
        await self.db.commit()
        return obj

    async def archive(self, model, user_id, resource_id):
        obj = await self.owned(model, resource_id, user_id)
        obj.is_active = False
        await self.db.commit()
