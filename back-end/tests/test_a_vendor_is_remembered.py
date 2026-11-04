"""Remember me on the vendor page (T202, ADR 0022), at the HTTP seam a browser and an attacker meet.

A vendor who ticks "Remember me on this device" when they enter their code is given a cookie,
``__Host-vendor_remember_<market id>``, holding a random secret; the server keeps only the secret's
SHA-256, with the market, the address and when it ends. On their next visit the page asks
``applicant-login/resume``, which answers as a right code does while the cookie is live. It ends at
the earlier of the market's last date and 120 days, use never moves it, and Sign out ends it on the
server, so a copy of the cookie stops working too.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from types import SimpleNamespace

import pytest

import api.applicant_auth as ApplicantAuthApi
import app as app_module
import market_deletion
import remembered_sign_ins as RememberedSignIns
import sign_in_limits
from conftest import FakeSlugMarketsCollection, stored_market
from datatypes import MarketPhase, market_name_slug
from test_applicant_auth import FakeChallengesCollection
from utils.application_token import verify_application_token

SLUG = market_name_slug("Test Market")
MARKET_ID = "market-123"
COOKIE = f"__Host-vendor_remember_{MARKET_ID}"
OTHER_SLUG = market_name_slug("Other Market")
OTHER_ID = "market-456"
OTHER_COOKIE = f"__Host-vendor_remember_{OTHER_ID}"
VENDOR = "vendor@example.com"
CODE = "123456"
# The market's dates are 2099-08-01 and 2099-08-02; its last date has ended everywhere at noon UTC
# on the day after.
LAST_DATE_ENDS = datetime(2099, 8, 3, 12, 0, tzinfo=timezone.utc)
A_MONTH_BEFORE = datetime(2099, 7, 1, 9, 30, tzinfo=timezone.utc)
HALF_A_YEAR_BEFORE = datetime(2099, 2, 1, 9, 30, tzinfo=timezone.utc)


def _market(market_id=MARKET_ID, name="Test Market", phase=MarketPhase.APPLICATIONS):
    doc = stored_market(
        phase=phase,
        id=market_id,
        name=name,
        setupObject={"marketDates": [{"date": "2099-08-02"}, {"date": "2099-08-01"}]},
    )
    doc["intakeMode"] = "form"
    return doc


class Clock:
    """The server's clock for Remember me, which a test moves on instead of waiting."""

    def __init__(self, at):
        self.at = at

    def __call__(self):
        return self.at

    def move_to(self, at):
        self.at = at


@pytest.fixture
def clock(monkeypatch):
    clock = Clock(A_MONTH_BEFORE)
    monkeypatch.setattr(RememberedSignIns, "now", clock)
    return clock


@pytest.fixture
def markets(monkeypatch):
    """The markets the sign-in endpoints read: this one and another, both form markets."""
    collection = FakeSlugMarketsCollection(
        [_market(), _market(OTHER_ID, "Other Market")],
    )

    class _Db(dict):
        def __getitem__(self, name):
            assert name == "markets"
            return collection

    monkeypatch.setattr(ApplicantAuthApi, "db", _Db())
    return collection


@pytest.fixture
def signing_in(monkeypatch, markets, clock):
    """Codes asked for and tried against a challenges collection kept the way Mongo keeps it."""
    monkeypatch.setattr(ApplicantAuthApi, "challenges_collection", FakeChallengesCollection())
    monkeypatch.setattr(ApplicantAuthApi, "_generate_code", lambda: CODE)
    monkeypatch.setattr(ApplicantAuthApi, "_send_code_email", lambda *_a, **_k: True)


@pytest.fixture
def remembered(market_records):
    """The ``vendor_remembered_sign_ins`` collection (conftest's fake)."""
    return market_records.remembered


@pytest.fixture
def client():
    return app_module.app.test_client()


def _sign_in(client, remember=None, slug=SLUG, email=VENDOR):
    assert client.post(
        f"/public/markets/{slug}/applicant-login/request-code", json={"email": email},
    ).status_code == 200
    body = {"email": email, "code": CODE}
    if remember is not None:
        body["remember"] = remember
    response = client.post(f"/public/markets/{slug}/applicant-login/verify-code", json=body)
    assert response.status_code == 200, response.get_json()
    return response


def _resume(client, slug=SLUG):
    return client.post(f"/public/markets/{slug}/applicant-login/resume")


def _sign_out(client, slug=SLUG):
    return client.post(f"/public/markets/{slug}/applicant-login/sign-out")


def _set_cookies(response, name=COOKIE):
    return [h for h in response.headers.getlist("Set-Cookie") if h.startswith(f"{name}=")]


def _set_cookie(response, name=COOKIE):
    """The value and the lower-cased attributes of the one ``Set-Cookie`` for ``name``."""
    headers = _set_cookies(response, name)
    assert len(headers) == 1, f"expected one {name} cookie, got {headers}"
    value, *attributes = [part.strip() for part in headers[0].split(";")]
    return value.split("=", 1)[1], [a.lower() for a in attributes]


def _expires(response, name=COOKIE):
    _value, attributes = _set_cookie(response, name)
    [expires] = [a.split("=", 1)[1] for a in attributes if a.startswith("expires=")]
    return parsedate_to_datetime(expires)


def _holds_the_host_prefix(attributes):
    """A browser refuses a ``__Host-`` cookie without ``Secure`` and ``Path=/``, or with a ``Domain``."""
    return (
        "secure" in attributes
        and "path=/" in attributes
        and not any(a.startswith("domain") for a in attributes)
    )


def _cleared(response, name=COOKIE):
    """Whether the answer tells the browser to drop the cookie now.

    A browser refuses a ``__Host-`` cookie that breaks the prefix's terms, a clearing one too, and
    would keep the live one, so every way of clearing is held to them here.
    """
    headers = _set_cookies(response, name)
    if len(headers) != 1:
        return False
    value, attributes = _set_cookie(response, name)
    return value == "" and _expires(response, name) < datetime.now(timezone.utc) and (
        _holds_the_host_prefix(attributes) and "samesite=none" in attributes
    )


def _held(client, name=COOKIE):
    cookie = client.get_cookie(name)
    return None if cookie is None else cookie.value


def _on_another_device(value, name=COOKIE):
    """A browser that holds only this cookie, as a copy of it would be."""
    fresh = app_module.app.test_client()
    fresh.set_cookie(name, value)
    return fresh


def _hash(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


class TestTickingRememberMe:

    def test_it_sets_the_cookie_secure_httponly_and_samesite_none(self, client, signing_in):
        _value, attributes = _set_cookie(_sign_in(client, remember=True))

        assert "secure" in attributes
        assert "httponly" in attributes
        assert "samesite=none" in attributes
        assert "path=/" in attributes

    def test_its_name_has_the_host_prefix_a_subdomain_cannot_overwrite(self, client, signing_in):
        """OWASP's Session Management Cheat Sheet: the browser holds a ``__Host-`` cookie to this
        one host, so a subdomain cannot set or shadow it."""
        response = _sign_in(client, remember=True)

        assert RememberedSignIns.cookie_name(MARKET_ID) == f"__Host-vendor_remember_{MARKET_ID}"
        _value, attributes = _set_cookie(response, f"__Host-vendor_remember_{MARKET_ID}")
        assert _holds_the_host_prefix(attributes)

    def test_it_lasts_until_the_last_date_has_ended(self, client, signing_in):
        assert _expires(_sign_in(client, remember=True)) == LAST_DATE_ENDS

    def test_it_never_lasts_more_than_120_days(self, client, signing_in, clock):
        clock.move_to(HALF_A_YEAR_BEFORE)

        assert _expires(_sign_in(client, remember=True)) == (
            HALF_A_YEAR_BEFORE + timedelta(days=120)
        ).replace(microsecond=0)

    @pytest.mark.parametrize("remember", [None, False, "true", 1], ids=[
        "absent", "false", "a string", "a number"])
    def test_unticked_sets_no_cookie_and_keeps_nothing(self, client, signing_in, remembered,
                                                       remember):
        response = _sign_in(client, remember=remember)

        assert _set_cookies(response) == []
        assert remembered.documents == []

    def test_after_the_last_date_it_signs_in_and_remembers_nothing(
        self, client, signing_in, remembered, clock,
    ):
        clock.move_to(LAST_DATE_ENDS)

        response = _sign_in(client, remember=True)

        assert response.get_json()["token"]
        assert _set_cookies(response) == []
        assert remembered.documents == []

    def test_the_server_keeps_the_secrets_hash_never_the_secret(
        self, client, signing_in, remembered,
    ):
        secret, _attributes = _set_cookie(_sign_in(client, remember=True))

        [doc] = remembered.documents
        assert doc == {
            "_id": _hash(secret),
            "market_id": MARKET_ID,
            "email": VENDOR,
            "expires_at": LAST_DATE_ENDS,
            "created_at": A_MONTH_BEFORE,
        }
        assert secret not in repr(remembered.documents)

    def test_the_secret_is_32_random_bytes(self, client, signing_in):
        first, _ = _set_cookie(_sign_in(client, remember=True))
        second, _ = _set_cookie(_sign_in(client, remember=True))

        assert first != second
        assert len(first) >= 43  # 32 bytes, base64url

    def test_signing_in_again_unticked_ends_the_one_this_device_held(
        self, client, signing_in, remembered,
    ):
        """Someone else signing in on a shared device leaves it remembering nobody."""
        _sign_in(client, remember=True)
        kept = _held(client)

        response = _sign_in(client, remember=False)

        assert _cleared(response)
        assert remembered.documents == []
        assert _resume(_on_another_device(kept)).status_code == 401

    def test_ticking_it_again_replaces_the_one_this_device_held(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)
        old = _held(client)

        _sign_in(client, remember=True)

        assert _held(client) != old
        assert [doc["_id"] for doc in remembered.documents] == [_hash(_held(client))]

    def test_a_remembered_sign_in_elsewhere_changes_nothing_here(self, client, signing_in):
        _sign_in(client, remember=True)
        here = _held(client)

        _sign_in(client, remember=True, slug=OTHER_SLUG)

        assert _held(client) == here
        assert _resume(client).status_code == 200
        assert _resume(client, OTHER_SLUG).status_code == 200


class TestResuming:

    def test_a_live_cookie_answers_as_a_right_code_does(self, client, signing_in):
        signed_in = _sign_in(client, remember=True).get_json()

        response = _resume(_on_another_device(_held(client)))
        body = response.get_json()

        assert response.status_code == 200
        assert body.keys() == signed_in.keys()
        assert {k: v for k, v in body.items() if k != "token"} == {
            "success": True, "marketId": MARKET_ID, "applicantEmail": VENDOR,
        }
        claims = verify_application_token(body["token"])
        assert (claims["market_id"], claims["email"]) == (MARKET_ID, VENDOR)

    def test_use_never_moves_when_it_ends(self, client, signing_in, remembered, clock):
        _sign_in(client, remember=True)

        clock.move_to(A_MONTH_BEFORE + timedelta(days=20))
        response = _resume(client)

        assert response.status_code == 200
        assert _set_cookies(response) == []
        assert remembered.documents[0]["expires_at"] == LAST_DATE_ENDS

    def test_it_ends_when_the_last_date_has_ended(self, client, signing_in, clock):
        _sign_in(client, remember=True)

        clock.move_to(LAST_DATE_ENDS - timedelta(seconds=1))
        assert _resume(client).status_code == 200
        clock.move_to(LAST_DATE_ENDS)
        assert _resume(client).status_code == 401


class TestEveryRefusalIsOne:
    """A cookie that cannot sign in answers one 401, whatever was wrong with it, and is cleared."""

    def _refusal(self, response):
        assert response.status_code == 401
        return response.get_data()

    def _no_cookie(self, client):
        return _resume(app_module.app.test_client())

    def _tampered(self, client):
        value = _held(client)
        return _resume(_on_another_device(value[:-2] + ("AA" if value[-2:] != "AA" else "BB")))

    def _expired(self, client):
        RememberedSignIns.now.move_to(LAST_DATE_ENDS + timedelta(days=1))
        return _resume(client)

    def _signed_out(self, client):
        kept = _held(client)
        assert _sign_out(client).status_code == 204
        return _resume(_on_another_device(kept))

    def _another_markets(self, client):
        """This market's secret, sent under the other market's name."""
        return _resume(_on_another_device(_held(client), name=OTHER_COOKIE), OTHER_SLUG)

    def _gated(self, client):
        """The market taken back to draft: its page answers as absent, and so does its cookie."""
        ApplicantAuthApi.db["markets"].docs[0].update({"phase": "draft", "isDraft": True})
        return _resume(client)

    CASES = ["_tampered", "_expired", "_signed_out", "_another_markets", "_gated"]

    @pytest.mark.parametrize("case", CASES)
    def test_it_answers_as_no_cookie_at_all(self, client, signing_in, case):
        _sign_in(client, remember=True)
        refused = self._refusal(getattr(self, case)(client))

        assert refused == self._refusal(self._no_cookie(client))

    @pytest.mark.parametrize("case", CASES)
    def test_it_clears_the_cookie(self, client, signing_in, case):
        _sign_in(client, remember=True)
        response = getattr(self, case)(client)

        name = OTHER_COOKIE if case == "_another_markets" else COOKIE
        assert _cleared(response, name)

    def test_a_refused_cookie_stays_refused_once_the_market_is_back(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)
        kept = _held(client)
        self._gated(client)

        ApplicantAuthApi.db["markets"].docs[0].update({"phase": "applications", "isDraft": False})

        assert _resume(_on_another_device(kept)).status_code == 401
        assert remembered.documents == []

    def test_another_markets_cookie_leaves_this_ones_sign_in_alone(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)
        self._another_markets(client)

        assert len(remembered.documents) == 1
        assert _resume(client).status_code == 200

    def test_a_request_with_no_cookie_clears_nothing(self, client, signing_in):
        response = self._no_cookie(client)

        assert response.headers.getlist("Set-Cookie") == []

    def test_an_unknown_slug_answers_alike(self, client, signing_in):
        _sign_in(client, remember=True)

        assert self._refusal(_resume(client, "no-such-market")) == self._refusal(
            self._no_cookie(client)
        )


class TestTheResumeLimit:

    def test_a_caller_past_the_limit_is_refused(self, client, signing_in):
        for _ in range(sign_in_limits.RESUME_PER_CALLER.attempts):
            assert _resume(client).status_code == 401

        response = _resume(client)

        assert response.status_code == 429
        assert "Too many sign-in attempts" in response.get_json()["message"]

    def test_the_limit_is_300_in_15_minutes_per_caller(self):
        assert sign_in_limits.RESUME_PER_CALLER == sign_in_limits.SignInLimit(
            "resume:caller", attempts=300, window=timedelta(minutes=15),
        )
        assert sign_in_limits.RESUME_PER_CALLER in sign_in_limits.LIMITS

    def test_the_caller_is_counted_before_the_cookie_is_read(
        self, client, signing_in, monkeypatch,
    ):
        _sign_in(client, remember=True)
        events = []
        count_attempt = sign_in_limits.count_attempt
        monkeypatch.setattr(sign_in_limits, "count_attempt", lambda limit, subject, *rest: (
            events.append(f"count {limit.name}") or count_attempt(limit, subject, *rest)
        ))
        held_secret = RememberedSignIns.held_secret
        monkeypatch.setattr(RememberedSignIns, "held_secret", lambda market_id: (
            events.append("read cookie") or held_secret(market_id)
        ))

        assert _resume(client).status_code == 200

        assert events == ["count resume:caller", "read cookie"]

    def test_a_refused_resume_reads_no_cookie_and_clears_none(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)
        for _ in range(sign_in_limits.RESUME_PER_CALLER.attempts):
            _resume(app_module.app.test_client())

        response = _resume(client)

        assert response.status_code == 429
        assert _set_cookies(response) == []
        assert len(remembered.documents) == 1


class TestSigningOut:

    def test_it_ends_the_sign_in_on_the_server_and_clears_the_cookie(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)
        kept = _held(client)

        response = _sign_out(client)

        assert response.status_code == 204
        assert _cleared(response)
        assert remembered.documents == []
        assert _resume(_on_another_device(kept)).status_code == 401

    def test_with_no_cookie_it_answers_the_same(self, client, signing_in):
        response = _sign_out(client)

        assert response.status_code == 204
        assert response.get_data() == b""

    def test_it_ends_only_this_markets(self, client, signing_in, remembered):
        _sign_in(client, remember=True)
        _sign_in(client, remember=True, slug=OTHER_SLUG)

        _sign_out(client)

        assert [doc["market_id"] for doc in remembered.documents] == [OTHER_ID]
        assert _resume(client, OTHER_SLUG).status_code == 200

    def test_a_gated_markets_sign_out_still_ends_it(self, client, signing_in, remembered):
        _sign_in(client, remember=True)
        ApplicantAuthApi.db["markets"].docs[0].update({"phase": "draft", "isDraft": True})

        response = _sign_out(client)

        assert response.status_code == 204
        assert _cleared(response)
        assert remembered.documents == []


FROM_ANOTHER_SITE = {"Origin": "https://attacker.example", "Sec-Fetch-Site": "cross-site"}


class TestFromAnotherSite:

    def test_a_resume_from_another_site_is_refused(self, client, signing_in):
        _sign_in(client, remember=True)

        response = client.post(
            f"/public/markets/{SLUG}/applicant-login/resume", headers=FROM_ANOTHER_SITE,
        )

        assert response.status_code == 403
        assert "token" not in (response.get_json() or {})

    def test_a_sign_out_from_another_site_is_refused_and_ends_nothing(
        self, client, signing_in, remembered,
    ):
        _sign_in(client, remember=True)

        response = client.post(
            f"/public/markets/{SLUG}/applicant-login/sign-out", headers=FROM_ANOTHER_SITE,
        )

        assert response.status_code == 403
        assert _set_cookies(response) == []
        assert len(remembered.documents) == 1
        assert _resume(client).status_code == 200


class TestTheCollection:

    def test_the_boot_check_builds_its_expiry_index(self, monkeypatch, remembered):
        built = []
        monkeypatch.setattr(remembered, "create_index", lambda keys, **kw: built.append((keys, kw)))
        monkeypatch.setattr(ApplicantAuthApi, "_indexes_ready", False)

        ApplicantAuthApi.ensure_applicant_login_indexes()

        assert built == [
            ([("expires_at", 1)], {"expireAfterSeconds": 0, "name": "remembered_sign_in_ttl"}),
        ]

    def test_the_boot_check_refuses_without_it(self, monkeypatch, remembered):
        from pymongo.errors import OperationFailure

        def refuse(*_a, **_k):
            raise OperationFailure("no index for you")

        monkeypatch.setattr(remembered, "create_index", refuse)
        monkeypatch.setattr(ApplicantAuthApi, "_indexes_ready", False)

        with pytest.raises(ApplicantAuthApi.ApplicantLoginIndexError, match="remembered"):
            ApplicantAuthApi.ensure_applicant_login_indexes()

    def test_deleting_a_market_deletes_its_remembered_sign_ins(self, clock, remembered):
        RememberedSignIns.remember(MARKET_ID, VENDOR, ["2099-08-01"])
        RememberedSignIns.remember(OTHER_ID, VENDOR, ["2099-08-01"])

        market_deletion.delete_market_and_records(
            SimpleNamespace(delete_one=lambda _q: SimpleNamespace(deleted_count=1)), MARKET_ID,
        )

        assert [doc["market_id"] for doc in remembered.documents] == [OTHER_ID]
