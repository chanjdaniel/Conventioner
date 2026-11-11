"""The vendor's sign-in code mail carries the market's name as words, never as markup or a header.

Anyone can register, name a market, and ask for a code to any address on that market's page. The
name went into the code mail's HTML unescaped and into its subject as typed, so a name holding a
link sent that link, in a stranger's words, from Conventioner's own sending domain: a phishing mail
with the product's sender on it. The HTML now holds the name escaped wherever it appears, and the
subject and text hold it on one line.

Every mail goes through one ``send_mail``, whose Resend client gives up after 10 seconds, so a slow
provider fails a request quickly instead of holding it for the library's default 30.
"""

from types import SimpleNamespace

import pytest
import requests
from requests.adapters import HTTPAdapter

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import resend

import utils.email as email_mod
from market_documents import market_name_slug
from test_applicant_auth import FakeDatabase, _published_market_doc
from test_email import A_REAL_KEY
from utils.email import MAIL_TIMEOUT_SECONDS, one_line

VENDOR = "vendor-words@example.com"
PHISHING_NAME = 'Spring <a href="https://phish.example">Fair</a>\nBcc: x@example.com'


@pytest.fixture
def mail_on(monkeypatch):
    """Mail on with a key, so a send reaches Resend's own code and is seen there."""
    monkeypatch.setattr(email_mod, "_email_disabled", lambda: False)
    monkeypatch.setenv(email_mod.RESEND_API_KEY_VAR, A_REAL_KEY)
    monkeypatch.setenv(email_mod.FRONTEND_URL_VAR, "https://app.test")


@pytest.fixture
def sent(mail_on, monkeypatch):
    """What Resend's send is given."""
    payloads = []
    monkeypatch.setattr(
        resend.Emails, "send", lambda payload: payloads.append(payload) or SimpleNamespace(id="m1"),
    )
    return payloads


def _request_code(monkeypatch, market_name):
    """Ask for a code on the market's page, the way a stranger would."""
    from flask import Flask

    import api.applicant_auth as applicant_auth
    import api.applications as applications

    db = FakeDatabase(markets=[_published_market_doc(name=market_name)])
    monkeypatch.setattr(applicant_auth, "db", db)
    monkeypatch.setattr(applicant_auth, "challenges_collection", db["applicant_login_challenges"])
    monkeypatch.setattr(applications, "applications_collection", db["applications"])
    slug = market_name_slug(market_name)
    with Flask(__name__).test_request_context(
        f"/public/markets/{slug}/applicant-login/request-code",
        method="POST",
        json={"email": VENDOR},
    ):
        _body, status = applicant_auth.request_login_code(slug)
    assert status == 200
    return slug


class TestTheMarketsNameIsOnlyWords:
    def test_a_name_holding_a_link_and_a_header_line_reaches_the_mail_as_words(
        self, monkeypatch, sent,
    ):
        _request_code(monkeypatch, PHISHING_NAME)

        [mail] = sent
        assert "<a href=\"https://phish.example\">" not in mail["html"]
        assert "https://phish.example\">Fair" not in mail["html"]
        assert (
            "Spring &lt;a href=&quot;https://phish.example&quot;&gt;Fair&lt;/a&gt;\nBcc: x@example.com"
            in mail["html"]
        )
        assert mail["html"].count("&lt;a href=&quot;https://phish.example&quot;&gt;") == 2
        assert "\n" not in mail["subject"] and "\r" not in mail["subject"]
        assert mail["subject"] == (
            'Your sign-in code for Spring <a href="https://phish.example">Fair</a> '
            "Bcc: x@example.com (#1)"
        )
        assert "\nBcc:" not in mail["text"]
        assert one_line(PHISHING_NAME) in mail["text"]
        assert mail["to"] == [VENDOR]

    def test_a_plain_name_reads_exactly_as_before(self, monkeypatch, sent):
        slug = _request_code(monkeypatch, "Harbour Night Market")

        [mail] = sent
        assert mail["subject"] == "Your sign-in code for Harbour Night Market (#1)"
        assert "<strong>Harbour Night Market</strong>" in mail["html"]
        assert f'<a href="https://app.test/{slug}">your page for Harbour Night Market</a>' in mail["html"]
        assert 'your page for "Harbour Night Market".' in mail["text"]
        assert f"your page for Harbour Night Market: https://app.test/{slug}" in mail["text"]

    def test_the_code_mail_is_sent_through_the_one_send_with_its_kind(self, monkeypatch, mail_on):
        import api.applicant_auth as applicant_auth

        assert applicant_auth.send_mail is email_mod.send_mail
        kinds = []
        monkeypatch.setattr(
            applicant_auth, "send_mail",
            lambda kind, email, subject, html, text: kinds.append((kind, email)) or True,
        )

        _request_code(monkeypatch, "Harbour Night Market")

        assert kinds == [("applicant sign-in code", VENDOR)]


class TestOneLine:
    @pytest.mark.parametrize("given, read", [
        ("Harbour Night Market", "Harbour Night Market"),
        ("  Harbour   Night\tMarket  ", "Harbour Night Market"),
        ("Spring\r\nBcc: x@example.com", "Spring Bcc: x@example.com"),
        ("Spring\x00\x07\x1b[31mFair", "Spring [31mFair"),
        ("Spring \x85\x9f Fair", "Spring Fair"),
        ("Spring Fair Day", "Spring Fair Day"),
        ("\n\t ", ""),
        ("", ""),
    ])
    def test_every_run_of_whitespace_or_control_characters_is_one_space(self, given, read):
        assert one_line(given) == read


def _a_sent_response(request, **_kwargs):
    response = requests.Response()
    response.status_code = 200
    response._content = b'{"id": "m1"}'
    response.headers["Content-Type"] = "application/json"
    response.request = request
    return response


class TestASendGivesUpAfterTenSeconds:
    """Proven where the HTTP library sends, so it holds whatever the client keeps it in."""

    def test_the_send_asks_its_http_library_for_a_ten_second_timeout(self, monkeypatch, mail_on):
        timeouts = []

        def send(_adapter, request, **kwargs):
            timeouts.append(kwargs["timeout"])
            return _a_sent_response(request)

        monkeypatch.setattr(HTTPAdapter, "send", send)

        assert email_mod.send_otp_email("organizer@example.com", "583920") is True
        assert MAIL_TIMEOUT_SECONDS == 10
        assert timeouts == [10]

    def test_a_send_that_times_out_returns_false_and_logs_its_kind_and_type_only(
        self, monkeypatch, mail_on, caplog,
    ):
        address = "organizer-timed-out@example.com"

        def send(_adapter, request, **_kwargs):
            raise requests.exceptions.ReadTimeout(
                f"read timed out sending to {address}", request=request,
            )

        monkeypatch.setattr(HTTPAdapter, "send", send)

        with caplog.at_level("DEBUG"):
            assert email_mod.send_otp_email(address, "583920") is False

        assert "sign-in code" in caplog.text
        assert "ResendError" in caplog.text
        assert address not in caplog.text
        assert "timed out" not in caplog.text
        assert not any(record.exc_info for record in caplog.records)
