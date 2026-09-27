from datetime import timedelta
from sqlalchemy import select
from app.models import Reminder, Transaction, User
from app.models.enums import ReminderStatus, TransactionStatus, TransactionType, UserStatus
from app.repositories.base import Repository
from app.services.notifications import NotificationService
from app.services.balances import BalanceCalculationService
from app.exceptions import AppError
from app.db.base import utcnow


class ReminderService(Repository):
    async def list(self, user_id, page, page_size):
        return await self.page(select(Reminder).where(Reminder.user_id == user_id).order_by(Reminder.scheduled_at.desc()), page, page_size)

    async def save(self, user_id, data, reminder_id=None):
        transaction = await self.owned(Transaction, data.transaction_id, user_id)
        if transaction.transaction_type == TransactionType.PERSONAL_EXPENSE or transaction.status in [TransactionStatus.SETTLED, TransactionStatus.CANCELLED]:
            raise AppError(409, 'Reminders require an outstanding loan')
        obj = await self.owned(Reminder, reminder_id, user_id) if reminder_id else Reminder(user_id=user_id)
        for key, value in data.model_dump().items():
            setattr(obj, key, value)
        obj.next_run_at = data.scheduled_at
        self.db.add(obj)
        await self.db.commit()
        return obj

    async def cancel(self, user_id, reminder_id):
        obj = await self.owned(Reminder, reminder_id, user_id)
        obj.status = ReminderStatus.CANCELLED
        await self.db.commit()

    async def run_due(self, limit=100):
        # Claim and commit schedule advancement before delivery: at-most-once dispatch.
        rows = list((await self.db.scalars(select(Reminder).where(Reminder.status == ReminderStatus.PENDING, Reminder.next_run_at <= utcnow()).order_by(Reminder.next_run_at).limit(limit).with_for_update(skip_locked=True))).all())
        jobs = []
        for reminder in rows:
            owner = await self.db.get(User, reminder.user_id)
            if owner is None or owner.status != UserStatus.ACTIVE:
                reminder.status = ReminderStatus.CANCELLED
                continue
            transaction = await self.db.get(Transaction, reminder.transaction_id)
            if not transaction or transaction.deleted_at or transaction.status in [TransactionStatus.CANCELLED, TransactionStatus.SETTLED]:
                reminder.status = ReminderStatus.CANCELLED
                continue
            reminder.last_sent_at = utcnow()
            if reminder.repeat_interval_days:
                reminder.next_run_at = utcnow() + timedelta(days=reminder.repeat_interval_days)
            else:
                reminder.status = ReminderStatus.SENT
                reminder.next_run_at = None
            jobs.append(dict(user_id=reminder.user_id, kind='REMINDER', contact_id=transaction.contact_id, transaction_id=transaction.id, email_override=reminder.email_enabled, sms_override=reminder.sms_enabled))
        await self.db.commit()
        for job in jobs:
            await NotificationService(self.db).financial(**job)
        return len(jobs)
