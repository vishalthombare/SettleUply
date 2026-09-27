from typing import Protocol
from dataclasses import dataclass
import httpx
from app.core.config import Settings, get_settings


@dataclass
class Delivery:
    status: str = 'SKIPPED'
    provider_message_id: str | None = None
    error: str | None = 'No delivery provider configured'


class EmailService(Protocol):
    async def send(self, recipient: str, subject: str, message: str, *, html: str | None = None) -> Delivery: ...


class SMSService(Protocol):
    async def send(self, recipient: str, subject: str, message: str) -> Delivery: ...


class NoopProvider:
    async def send(self, recipient: str, subject: str, message: str, *, html: str | None = None) -> Delivery:
        return Delivery()


class ResendEmailProvider:
    def __init__(self, api_key: str, sender: str, *, transport=None):
        self.api_key = api_key.strip()
        self.sender = sender.strip()
        self.transport = transport

    async def send(self, recipient: str, subject: str, message: str, *, html: str | None = None) -> Delivery:
        if not recipient.strip():
            return Delivery(status='FAILED', error='Email recipient is missing')
        payload = {
            'from': self.sender,
            'to': [recipient],
            'subject': subject,
            'text': message,
        }
        if html is not None:
            payload['html'] = html
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(15, connect=5), transport=self.transport,
            ) as client:
                response = await client.post(
                    'https://api.resend.com/emails',
                    headers={'Authorization': f'Bearer {self.api_key}'},
                    json=payload,
                )
        except httpx.RequestError:
            return Delivery(status='FAILED', error='Unable to connect to Resend; check network access and retry')

        if not response.is_success:
            # Never persist raw provider responses: they can echo recipients or email contents.
            guidance = {
                400: 'check the sender and recipient email addresses',
                401: 'check EMAIL_API_KEY',
                403: 'check API key permissions and verify the EMAIL_FROM domain in Resend',
                422: 'check the sender and recipient email addresses',
                429: 'check Resend sending limits and retry later',
            }.get(response.status_code, 'retry later or check Resend service status')
            return Delivery(status='FAILED', error=f'Resend rejected the email (HTTP {response.status_code}); {guidance}')

        try:
            payload = response.json()
        except ValueError:
            payload = None
        message_id = payload.get('id') if isinstance(payload, dict) else None
        if not isinstance(message_id, str) or not message_id.strip():
            return Delivery(status='FAILED', error='Resend returned no email ID')
        # SENT means accepted by the provider, not confirmed inbox delivery.
        return Delivery(status='SENT', provider_message_id=message_id, error=None)


def get_email_service(config: Settings | None = None) -> EmailService:
    config = config or get_settings()
    if config.email_provider == 'resend':
        return ResendEmailProvider(config.email_api_key, config.email_from)
    return NoopProvider()
