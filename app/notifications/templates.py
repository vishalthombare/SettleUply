"""Self-contained transactional emails with HTML and plain-text alternatives."""

from dataclasses import dataclass
from html import escape
import re

from app.models.enums import OTPPurpose


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def _paragraph(value: str, *, muted: bool = False) -> str:
    color = '#68786f' if muted else '#344d42'
    content = escape(value).replace('\n', '<br>')
    return f'<p style="margin:0 0 18px;color:{color};font-size:15px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;">{content}</p>'


def _layout(*, title: str, preheader: str, eyebrow: str, content: str) -> str:
    # `content` is assembled only from escaped text and markup in this module.
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>{escape(title)} | SettleUply</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f6f7f2;color:#1c3029;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f6f7f2;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{escape(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f6f7f2;">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
        <tr><td style="padding:24px;background-color:#183f33;border-radius:18px 18px 0 0;">
          <p style="margin:0;color:#ffffff;font-size:25px;font-weight:700;letter-spacing:-0.8px;line-height:1.2;">Settle<span style="color:#d7edae;">Uply</span></p>
          <p style="margin:9px 0 0;color:#d7edae;font-size:12px;line-height:1.5;">Shared expenses. Sorted.</p>
        </td></tr>
        <tr><td style="padding:30px 24px 12px;background-color:#ffffff;border-left:1px solid #e1e7dd;border-right:1px solid #e1e7dd;">
          <p style="margin:0 0 12px;color:#547549;font-size:11px;font-weight:700;letter-spacing:1.6px;line-height:1.5;text-transform:uppercase;">{escape(eyebrow)}</p>
          <h1 style="margin:0 0 22px;color:#1c3029;font-size:28px;font-weight:700;letter-spacing:-0.7px;line-height:1.25;">{escape(title)}</h1>
          {content}
        </td></tr>
        <tr><td style="padding:18px 24px 22px;background-color:#ffffff;border:1px solid #e1e7dd;border-top:0;border-radius:0 0 18px 18px;">
          <p style="margin:0;padding-top:20px;border-top:1px solid #e9ede5;color:#68786f;font-size:13px;line-height:1.6;">Take care,<br><strong style="color:#183f33;">The SettleUply team</strong></p>
        </td></tr>
        <tr><td align="center" style="padding:20px 16px 0;">
          <p style="margin:0;color:#78867d;font-size:11px;line-height:1.6;">Sent by SettleUply</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>'''


_OTP_COPY = {
    OTPPurpose.REGISTRATION: (
        'Verify your email',
        'Verify your SettleUply email',
        'Welcome to SettleUply! Enter this code on the verification screen to confirm your email address.',
        'After you verify your email, an administrator will review your registration before you can sign in.',
    ),
    OTPPurpose.LOGIN: (
        'Complete your sign-in',
        'Your SettleUply sign-in code',
        'Enter this code on the sign-in screen to securely access your SettleUply account.',
        '',
    ),
    OTPPurpose.PASSWORD_RESET: (
        'Reset your password',
        'Reset your SettleUply password',
        'Enter this code on the password reset screen to choose a new password for your SettleUply account.',
        'Your password will stay the same until you finish resetting it.',
    ),
    OTPPurpose.EMAIL_CHANGE: (
        'Confirm your new email',
        'Confirm your new SettleUply email',
        'Enter this code on the email verification screen to confirm your new email address for SettleUply.',
        '',
    ),
}


def otp_email(*, name: str, code: str, purpose: OTPPurpose, expires_minutes: int) -> EmailContent:
    title, subject, instruction, next_step = _OTP_COPY[purpose]
    greeting = f'Hi {name.strip()},' if name.strip() else 'Hello,'
    minutes = f'{expires_minutes} minute' + ('' if expires_minutes == 1 else 's')
    expiry = f'This code expires in {minutes}.'
    security = 'This code can be used once. Never share it with anyone.'
    unexpected = "If you didn't request this email, you can safely ignore it."
    content = _paragraph(greeting) + _paragraph(instruction)
    content += f'''
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:24px 0;background-color:#f6f7f2;border:1px solid #dce6d4;border-radius:12px;">
        <tr><td align="center" style="padding:22px 12px;">
          <p style="margin:0 0 10px;color:#547549;font-size:11px;font-weight:700;letter-spacing:1.4px;line-height:1.5;">YOUR ONE-TIME CODE</p>
          <p style="margin:0;color:#183f33;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:5px;line-height:1.3;white-space:nowrap;">{escape(code)}</p>
          <p style="margin:12px 0 0;color:#68786f;font-size:12px;line-height:1.6;">{escape(expiry)}</p>
        </td></tr>
      </table>'''
    if next_step:
        content += _paragraph(next_step)
    content += _paragraph(security) + _paragraph(unexpected, muted=True)
    text = '\n\n'.join(part for part in (
        'SettleUply', title, greeting, instruction, f'Your one-time code: {code}',
        expiry, next_step, security, unexpected, 'Take care,\nThe SettleUply team',
    ) if part)
    return EmailContent(
        subject=subject,
        text=text,
        html=_layout(title=title, preheader=f'{title} with your one-time code. {expiry}', eyebrow='Account security', content=content),
    )


_NOTIFICATION_TITLES = {
    'TRANSACTION': ('Your transaction update', 'SettleUply transaction update'),
    'SETTLEMENT': ('Your settlement update', 'SettleUply settlement update'),
    'GROUP': ('Your group update', 'SettleUply group update'),
    'REMINDER': ('A friendly reminder', 'Your SettleUply reminder'),
}


def notification_email(*, kind: str, message: str) -> EmailContent:
    title, subject = _NOTIFICATION_TITLES.get(kind.strip().upper(), ('Your account update', 'SettleUply update'))
    message = message.replace('\r\n', '\n').replace('\r', '\n').strip() or 'You have a new update in SettleUply.'
    paragraphs = re.split(r'\n\s*\n', message)
    content = _paragraph('Hello,') + ''.join(_paragraph(paragraph) for paragraph in paragraphs)
    return EmailContent(
        subject=subject,
        text=f'SettleUply\n\n{title}\n\nHello,\n\n{message}\n\nTake care,\nThe SettleUply team',
        html=_layout(title=title, preheader='The latest from your SettleUply account.', eyebrow='Keeping you updated', content=content),
    )
