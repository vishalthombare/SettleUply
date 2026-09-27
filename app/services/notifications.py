import logging
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.base import utcnow
from app.models import NotificationLog, UserSettings, Contact, User, GroupMember, Group
from app.models.enums import Channel, NotificationStatus, UserStatus
from app.notifications.providers import NoopProvider, get_email_service
from app.notifications.templates import notification_email

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, db, email=None, sms=None):
        self.db = db
        self.email = email if email is not None else get_email_service()
        self.sms = sms or NoopProvider()

    async def deliver(self, user_id, channel, recipient, kind, message, **references):
        channel = Channel(channel)
        email = notification_email(kind=kind, message=message) if channel == Channel.EMAIL else None
        subject = email.subject if email else 'SettleUply update'
        log = NotificationLog(user_id=user_id, channel=channel, recipient=recipient or '', notification_type=kind, subject=subject, message=message, **references)
        self.db.add(log)
        await self.db.commit()
        try:
            if email:
                result = await self.email.send(recipient or '', email.subject, email.text, html=email.html)
            else:
                result = await self.sms.send(recipient or '', subject, message)
            log.status = NotificationStatus(result.status)
            log.provider_message_id = result.provider_message_id
            log.error_message = result.error
            if log.status == NotificationStatus.SENT:
                log.sent_at = utcnow()
        except Exception:
            log.status = NotificationStatus.FAILED
            log.error_message = 'Provider delivery failed'
            logger.exception('Notification delivery failed')
        await self.db.commit()

    async def financial(self, user_id, kind, contact_id=None, transaction_id=None, group_id=None, email_override=None, sms_override=None):
        if kind == 'GROUP' and group_id:
            group = await self.db.get(Group, group_id)
            if group is None or group.owner_user_id != user_id:
                return
            recipients = (await self.db.scalars(select(User).join(GroupMember, GroupMember.user_id == User.id).where(GroupMember.group_id == group_id, GroupMember.is_active.is_(True), User.status == UserStatus.ACTIVE))).all()
            for member in recipients:
                preferences = await self.db.scalar(select(UserSettings).where(UserSettings.user_id == member.id))
                for channel in ['EMAIL', 'SMS']:
                    if getattr(preferences, f'{channel.lower()}_group_notifications', False):
                        await self.deliver(member.id, channel, member.email if channel == 'EMAIL' else member.phone, kind, 'A shared expense has been recorded in your SettleUply group.', group_id=group_id)
            return
        settings = await self.db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
        recipient = await self.db.get(Contact, contact_id) if contact_id else await self.db.get(User, user_id)
        if recipient is None or (contact_id and recipient.user_id != user_id):
            return
        preference = {'TRANSACTION': 'transaction_notifications', 'SETTLEMENT': 'settlement_notifications', 'GROUP': 'group_notifications', 'REMINDER': 'due_reminders'}[kind]
        for channel, override in [('EMAIL', email_override), ('SMS', sms_override)]:
            enabled = override if override is not None else getattr(settings, f'{channel.lower()}_{preference}', False)
            if enabled:
                await self.deliver(user_id, channel, recipient.email if channel == 'EMAIL' else recipient.phone, kind, 'A financial record has been updated in SettleUply. Sign in to view details.', contact_id=contact_id, transaction_id=transaction_id, group_id=group_id)


async def financial_notification(**kwargs):
    # Called only after the financial service has committed, in a separate session.
    try:
        async with SessionLocal() as db:
            await NotificationService(db).financial(**kwargs)
    except Exception:
        logger.exception('Background notification failed; financial record remains saved')
