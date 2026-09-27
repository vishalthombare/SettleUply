from datetime import timedelta, datetime, time
from zoneinfo import ZoneInfo
from decimal import Decimal
from sqlalchemy import select, func
from app.models import Transaction, TransactionSettlement, Contact, PaymentMethod, Reminder
from app.models.enums import TransactionType as TT, TransactionStatus as TS, ReminderStatus, ReminderType
from app.repositories.base import Repository
from app.services.balances import BalanceCalculationService
from app.services.users import UserService
from app.schemas.inputs import CURRENCY_DIGITS
from app.exceptions import AppError
from app.db.base import utcnow


def validate_precision(amount, currency):
    quantum = Decimal(1).scaleb(-CURRENCY_DIGITS[currency])
    if amount != amount.quantize(quantum):
        raise AppError(422, f'{currency} supports {CURRENCY_DIGITS[currency]} decimal places')


class TransactionService(Repository):
    async def save(self, user_id, data, resource_id=None):
        validate_precision(data.amount, data.currency)
        await self.financial_references(data, user_id)
        if data.transaction_type == TT.PERSONAL_EXPENSE:
            if data.contact_id is not None:
                raise AppError(422, 'Personal expenses cannot have a contact')
        else:
            if data.contact_id is None:
                raise AppError(422, 'Choose a contact')
            contact = await self.owned(Contact, data.contact_id, user_id)
            if not contact.is_active:
                raise AppError(409, 'Contact is archived')
        if data.due_date and data.due_date < data.transaction_date:
            raise AppError(422, 'Due date cannot precede transaction date')
        obj = await self.owned(Transaction, resource_id, user_id, lock=True) if resource_id else Transaction(user_id=user_id)
        balance = BalanceCalculationService(self.db)
        paid = await balance.settled(obj.id) if resource_id else Decimal('0')
        if paid > 0:
            immutable = ['amount', 'currency', 'transaction_type', 'contact_id', 'transaction_date']
            if any(getattr(obj, k) != getattr(data, k) for k in immutable) or data.status == 'CANCELLED':
                raise AppError(409, 'Settled financial history cannot be changed or cancelled')
        settings = await UserService(self.db).settings(user_id)
        values = data.model_dump(exclude={'status'})
        values['notify_email'] = data.notify_email if data.notify_email is not None else settings.email_transaction_notifications
        values['notify_sms'] = data.notify_sms if data.notify_sms is not None else settings.sms_transaction_notifications
        for key, value in values.items():
            setattr(obj, key, value)
        obj.status = TS.CANCELLED if data.status == 'CANCELLED' else TS.OPEN
        obj.status = balance.status(obj, paid, await balance.today(user_id))
        self.db.add(obj)
        await self.db.flush()
        if resource_id is None and obj.due_date and obj.transaction_type != TT.PERSONAL_EXPENSE and obj.status != TS.CANCELLED and (settings.email_due_reminders or settings.sms_due_reminders):
            reminder_date = obj.due_date - timedelta(days=settings.default_reminder_days_before)
            scheduled = datetime.combine(reminder_date, time(9), tzinfo=ZoneInfo(settings.timezone))
            scheduled = max(scheduled, utcnow())
            self.db.add(Reminder(user_id=user_id, transaction_id=obj.id, reminder_type=ReminderType.DUE_SOON,
                                 scheduled_at=scheduled, next_run_at=scheduled,
                                 email_enabled=settings.email_due_reminders, sms_enabled=settings.sms_due_reminders))
        await self.db.commit()
        return await balance.describe(obj)

    async def list(self, user_id, page=1, page_size=20, **filters):
        query = select(Transaction).where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        for field in ['transaction_type', 'contact_id', 'category_id', 'currency']:
            if filters.get(field) is not None:
                query = query.where(getattr(Transaction, field) == filters[field])
        if filters.get('search'):
            query = query.where(Transaction.purpose.ilike(f"%{filters['search']}%"))
        if filters.get('from_date'):
            query = query.where(Transaction.transaction_date >= filters['from_date'])
        if filters.get('to_date'):
            query = query.where(Transaction.transaction_date <= filters['to_date'])
        today = await BalanceCalculationService(self.db).today(user_id)
        overdue_condition = (Transaction.due_date < today) & Transaction.status.in_([TS.OPEN, TS.PARTIALLY_SETTLED, TS.OVERDUE]) & (Transaction.transaction_type != TT.PERSONAL_EXPENSE)
        status = filters.get('status')
        if filters.get('overdue') or status == TS.OVERDUE:
            query = query.where(overdue_condition)
        elif status:
            query = query.where(Transaction.status == status)
            if status in [TS.OPEN, TS.PARTIALLY_SETTLED]:
                query = query.where((Transaction.due_date.is_(None)) | (Transaction.due_date >= today))
        sort = filters.get('sort', 'date_desc')
        order = {'date_desc': Transaction.transaction_date.desc(), 'date_asc': Transaction.transaction_date.asc(), 'amount_desc': Transaction.amount.desc(), 'amount_asc': Transaction.amount.asc()}[sort]
        result = await self.page(query.order_by(order, Transaction.id.desc()), page, page_size)
        result['items'] = [await BalanceCalculationService(self.db).describe(t, today) for t in result['items']]
        return result

    async def details(self, user_id, resource_id):
        return await BalanceCalculationService(self.db).describe(await self.owned(Transaction, resource_id, user_id))

    async def delete(self, user_id, resource_id):
        obj = await self.owned(Transaction, resource_id, user_id, lock=True)
        if await BalanceCalculationService(self.db).settled(resource_id) > 0:
            raise AppError(409, 'Transactions with settlements cannot be deleted')
        obj.deleted_at = utcnow()
        for reminder in (await self.db.scalars(select(Reminder).where(Reminder.user_id == user_id, Reminder.transaction_id == resource_id))).all():
            reminder.status = ReminderStatus.CANCELLED
        await self.db.commit()


class SettlementService(Repository):
    async def create(self, user_id, transaction_id, data):
        transaction = await self.owned(Transaction, transaction_id, user_id, lock=True)
        if transaction.transaction_type == TT.PERSONAL_EXPENSE or transaction.status == TS.CANCELLED:
            raise AppError(409, 'This transaction cannot accept settlements')
        validate_precision(data.amount, data.currency)
        if data.currency != transaction.currency:
            raise AppError(422, 'Settlement currency must match the transaction')
        if data.settlement_date < transaction.transaction_date:
            raise AppError(422, 'Settlement date cannot precede transaction date')
        await self.catalog(PaymentMethod, data.payment_method_id, user_id)
        balance = BalanceCalculationService(self.db)
        paid = await balance.settled(transaction_id)
        if data.amount > transaction.amount - paid:
            raise AppError(409, 'Settlement exceeds outstanding balance')
        settlement = TransactionSettlement(transaction_id=transaction_id, user_id=user_id, **data.model_dump())
        self.db.add(settlement)
        transaction.status = balance.status(transaction, paid + data.amount, await balance.today(user_id))
        await self.db.commit()
        return settlement

    async def list(self, user_id, transaction_id, page, page_size):
        await self.owned(Transaction, transaction_id, user_id)
        return await self.page(select(TransactionSettlement).where(TransactionSettlement.transaction_id == transaction_id, TransactionSettlement.user_id == user_id).order_by(TransactionSettlement.settlement_date.desc(), TransactionSettlement.id.desc()), page, page_size)
