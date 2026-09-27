from typing import Protocol
from dataclasses import dataclass


@dataclass
class Delivery:
    status: str = 'SKIPPED'
    provider_message_id: str | None = None
    error: str | None = 'No delivery provider configured'


class EmailService(Protocol):
    async def send(self, recipient: str, subject: str, message: str) -> Delivery: ...


class SMSService(Protocol):
    async def send(self, recipient: str, subject: str, message: str) -> Delivery: ...


class NoopProvider:
    async def send(self, recipient: str, subject: str, message: str) -> Delivery:
        return Delivery()
