"""What the mails write to the log: what was sent, and never to whom.

An account's verification link, password reset link and sign-in code, and the email telling an
account's owner that someone signed up with its address, each go to the address an organizer typed,
and a vendor's sign-in code to the address a vendor typed. All five go through one ``send_mail``.
The log needs to know what was sent and whether it went, not where, so it names the email's kind,
an exception's type alone and the provider's status code, and never the address, an exception's
text or the provider's response body, which can each carry the address back.
"""

from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import resend
from resend.exceptions import ResendError

import utils.email as email_mod
from api.applicant_auth import _send_code_email

ADDRESS = "organizer-logged@example.com"

SENDS = [
    (email_mod.send_verification_email, "verification"),
    (email_mod.send_password_reset_email, "password reset"),
    (email_mod.send_otp_email, "sign-in code"),
    (lambda email, _secret: email_mod.send_account_exists_email(email), "existing account"),
    (
        lambda email, code: _send_code_email(
            email, code, "Harbour Night Market", "harbour-night-market", 1,
        ),
        "applicant sign-in code",
    ),
]


def _refused_naming_to(payload):
    """A provider's refusal whose message and response body carry the address it was sent to."""
    error = ResendError(
        code=422, error_type="validation_error",
        message=f"provider refused {payload['to'][0]}", suggested_action="",
    )
    error.response = {"to": payload["to"], "message": "provider body"}
    raise error


OUTCOMES = {
    "email-disabled": None,
    "sent": lambda payload: SimpleNamespace(id="m1"),
    "no-message-id": lambda payload: {"to": payload["to"]},
    "send-raises": _refused_naming_to,
}


@pytest.mark.parametrize("outcome", OUTCOMES)
@pytest.mark.parametrize("send, kind", SENDS, ids=[kind for _send, kind in SENDS])
def test_an_account_email_logs_what_was_sent_and_never_the_address(
    monkeypatch, caplog, send, kind, outcome,
):
    monkeypatch.setattr(email_mod, "_email_disabled", lambda: outcome == "email-disabled")
    monkeypatch.setattr(email_mod, "ready_mailer", lambda: True)
    if OUTCOMES[outcome]:
        monkeypatch.setattr(resend.Emails, "send", OUTCOMES[outcome])

    with caplog.at_level("DEBUG"):
        send(ADDRESS, "583920")

    assert caplog.records
    assert kind in caplog.text
    assert ADDRESS not in caplog.text
    assert "provider refused" not in caplog.text
    assert "provider body" not in caplog.text
    assert not any(record.exc_info for record in caplog.records)


def test_a_refused_send_logs_the_exceptions_type_and_the_providers_status(monkeypatch, caplog):
    monkeypatch.setattr(email_mod, "_email_disabled", lambda: False)
    monkeypatch.setattr(email_mod, "ready_mailer", lambda: True)
    monkeypatch.setattr(resend.Emails, "send", _refused_naming_to)

    with caplog.at_level("DEBUG"):
        assert email_mod.send_otp_email(ADDRESS, "583920") is False

    assert "ResendError" in caplog.text
    assert "422" in caplog.text
