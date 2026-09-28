import re
from html.parser import HTMLParser

import pytest

from app.models.enums import OTPPurpose
from app.notifications.templates import notification_email, otp_email


class ParsedEmail(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.parts = []
        self.feed(markup)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, tuple(attrs)))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        self.parts.append(data)

    @property
    def text(self):
        return ' '.join(self.parts)


@pytest.mark.parametrize(('purpose', 'topic'), [
    (OTPPurpose.REGISTRATION, r'verif'),
    (OTPPurpose.PASSWORD_RESET, r'reset'),
    (OTPPurpose.EMAIL_CHANGE, r'(?:new|change|update).*email|email.*(?:new|change|update)'),
    (OTPPurpose.LOGIN, r'(?:sign[\s-]?in|log[\s-]?in)'),
])
def test_otp_emails_include_the_correct_purpose_code_and_expiry(purpose, topic):
    content = otp_email(name='Alice', code='012345', purpose=purpose, expires_minutes=17)
    rendered = ParsedEmail(content.html)

    assert '012345' not in content.subject
    assert 'SettleUply' in content.subject
    for body in (content.text, rendered.text):
        assert 'Alice' in body
        assert re.search(r'(?<!\d)012345(?!\d)', body)
        assert re.search(r'\b17\s+minutes?\b', body, re.IGNORECASE)
        assert re.search(topic, body, re.IGNORECASE | re.DOTALL)


def test_otp_purposes_have_distinct_subjects_and_instructions():
    messages = [
        otp_email(name='Alice', code='012345', purpose=purpose, expires_minutes=17)
        for purpose in OTPPurpose
    ]
    assert len({message.subject for message in messages}) == len(OTPPurpose)
    assert len({message.text for message in messages}) == len(OTPPurpose)
    assert len({ParsedEmail(message.html).text for message in messages}) == len(OTPPurpose)


@pytest.mark.parametrize('purpose', list(OTPPurpose))
def test_otp_names_are_literal_text_and_cannot_inject_markup(purpose):
    name = ('Maya <script>alert(1)</script> <img src=x onerror=alert(2)> '
            '<a href="https://evil.example">sign in</a> & Co.')
    content = otp_email(name=name, code='012345', purpose=purpose, expires_minutes=17)
    baseline = otp_email(name='Alice', code='012345', purpose=purpose, expires_minutes=17)
    rendered = ParsedEmail(content.html)

    assert name in content.text
    assert name in rendered.text
    assert rendered.elements == ParsedEmail(baseline.html).elements
    assert '<script>' not in content.html
    assert '<img src=x' not in content.html
    assert 'evil.example' not in content.subject


@pytest.mark.parametrize('kind', ['TRANSACTION', 'SETTLEMENT', 'GROUP', 'REMINDER'])
def test_notification_messages_keep_their_content_and_escape_html(kind):
    message = ('Alex & Sam updated "Dinner".\n'
               '<script>alert(1)</script><a href="https://evil.example">Pay here</a>')
    content = notification_email(kind=kind, message=message)
    baseline = notification_email(kind=kind, message='A record was updated.\nSee the details.')
    rendered = ParsedEmail(content.html)

    assert message in content.text
    assert 'Alex & Sam updated "Dinner".' in rendered.text
    assert '<script>alert(1)</script><a href="https://evil.example">Pay here</a>' in rendered.text
    assert rendered.elements == ParsedEmail(baseline.html).elements
    assert '<script>' not in content.html
    assert 'evil.example' not in content.subject
    assert 'SettleUply' in content.subject


def test_notification_kinds_use_distinct_subjects_with_a_safe_unknown_fallback():
    known = [
        notification_email(kind=kind, message='A record was updated.')
        for kind in ('TRANSACTION', 'SETTLEMENT', 'GROUP', 'REMINDER')
    ]
    assert len({message.subject for message in known}) == 4

    unknown = notification_email(kind='UNKNOWN', message='A record was updated.')
    hostile = notification_email(
        kind='ALERT\r\nBcc: outsider@evil.example<script>alert(1)</script>',
        message='A record was updated.',
    )
    assert hostile == unknown
    assert 'A record was updated.' in hostile.text
    assert 'A record was updated.' in ParsedEmail(hostile.html).text
    assert '\r' not in hostile.subject
    assert '\n' not in hostile.subject
