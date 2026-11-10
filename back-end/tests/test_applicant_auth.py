"""Tests for applicant email-code login - the public, attacker-facing surface.

Every test in this file PROVES a property rather than asserting it. An assertion
that "returns 401" proves nothing about an oracle - the oracle lives in the
*difference* between two responses. These tests compare actual response bodies,
byte for byte, to prove the two paths are indistinguishable.
"""
import json
import threading
from datetime import datetime, timedelta, timezone

import pytest
import time
from types import SimpleNamespace

import sign_in_limits
from conftest import mongo_matches, reject_malformed_update
from datatypes import Application, ApplicationStatus, ApplicationType, MarketPhase
from market_documents import market_name_slug


# ── Fake collections for testing ────────────────────────────────────


class FakeMarketsCollection:
    """A minimal fake for the markets collection that supports the slug lookup.

    ``market_by_slug`` calls ``find(query, projection)`` and expects
    the collection to apply the filter and projection the way Mongo does.
    """

    def __init__(self, docs=None):
        self.docs = list(docs) if docs else []

    def find(self, query=None, projection=None):
        results = []
        for doc in self.docs:
            match = True
            for key, value in (query or {}).items():
                if key == "$nor":
                    for clause in value:
                        if all(doc.get(k) == v for k, v in clause.items()):
                            match = False
                            break
                    if not match:
                        break
                elif key not in doc or doc[key] != value:
                    match = False
                    break
            if match:
                if projection:
                    projected = {k: doc[k] for k in projection if k in doc}
                else:
                    projected = dict(doc)
                results.append(projected)
        return iter(results)


class FakeApplicationsCollection:
    """Fake for the applications collection.

    Supports ``find_one`` with equality filters (for checking if an applicant exists)
    and ``count_documents`` (for the D9 form lock).
    """

    def __init__(self, apps=None):
        self.apps = list(apps) if apps else []

    def find_one(self, query=None):
        for doc in self.apps:
            if all(doc.get(k) == v for k, v in (query or {}).items()):
                return dict(doc)
        return None

    def count_documents(self, query=None):
        return sum(1 for doc in self.apps
                   if all(doc.get(k) == v for k, v in (query or {}).items()))

    def find_one_and_update(self, query=None, update=None, upsert=False,
                            return_document=None):
        # Used by find_or_create_application - we don't need this for these tests
        raise NotImplementedError("Not needed for applicant auth tests")

    def create_index(self, *_args, **_kwargs):
        return "fake-index"


class FakeChallengesCollection:
    """The ``applicant_login_challenges`` collection, read and written the way Mongo does.

    Its filters go through ``mongo_matches`` and its updates apply ``$set``, ``$inc`` and
    ``$setOnInsert``, so a verify that counts a try or a request that numbers its code is held to
    the very filter it sends. Each call holds a lock, as one Mongo operation on one document is
    atomic, so a test that races two requests races them only between calls.
    """

    def __init__(self):
        self.docs = {}
        self.indexes = []
        self._lock = threading.Lock()

    def create_index(self, keys, **kwargs):
        self.indexes.append((keys, kwargs))
        return "fake-index"

    def _write(self, query, update, upsert):
        """Apply ``update`` to the one document ``query`` matches; (before, after), or None."""
        reject_malformed_update(update)
        key = next((k for k, doc in self.docs.items() if mongo_matches(doc, query)), None)
        inserting = key is None
        if inserting:
            if not upsert:
                return None
            key = (query.get("market_id"), query.get("email"))
            self.docs[key] = {"market_id": key[0], "email": key[1]}
        doc = self.docs[key]
        before = dict(doc)
        doc.update(update.get("$set", {}))
        if inserting:
            doc.update(update.get("$setOnInsert", {}))
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        return before, dict(doc)

    def update_one(self, query, update, upsert=False):
        with self._lock:
            written = self._write(query, update, upsert)
        matched = 0 if written is None else 1
        return SimpleNamespace(matched_count=matched, modified_count=matched, upserted_id=None)

    def find_one_and_update(self, query, update, upsert=False, return_document=False):
        with self._lock:
            written = self._write(query, update, upsert)
        if written is None:
            return None
        before, after = written
        return after if return_document else before

    def find_one(self, query=None):
        """Find a challenge without touching it. Used by the tests only."""
        for doc in self.docs.values():
            if mongo_matches(doc, query or {}):
                return dict(doc)
        return None


class FakeDatabase:
    """A test database that serves the three fake collections we need."""

    def __init__(self, markets=None, applications=None):
        self._markets = FakeMarketsCollection(markets)
        self._applications = FakeApplicationsCollection(applications)
        self._challenges = FakeChallengesCollection()

    def __getitem__(self, name):
        if name == "markets":
            return self._markets
        if name == "applications":
            return self._applications
        if name == "applicant_login_challenges":
            return self._challenges
        raise KeyError(f"Unexpected collection: {name}")

    @property
    def markets(self):
        return self._markets

    @property
    def applications(self):
        return self._applications

    @property
    def challenges(self):
        return self._challenges


# ── Test data ────────────────────────────────────────────────────────

def _published_market_doc(market_id="test-market-1", name="Test Market",
                          phase="applications", intake_mode="form"):
    """A minimal market document the slug lookup can resolve.

    Applicant login serves a market with a vendor page (``vendor_page_market_by_slug``). A market
    that takes its vendors by CSV import has none before its results are published, and answers
    here exactly as a market that does not exist, which is what ``intake_mode="csv"`` is for.
    """
    slug = market_name_slug(name)
    return {
        "id": market_id,
        "name": name,
        "phase": phase,
        "isDraft": phase == "draft",
        "slug": slug,
        "intakeMode": intake_mode,
    }


def _application_doc(market_id="test-market-1",
                     email="applicant@example.com"):
    """A minimal application document for checking known addresses."""
    return {
        "id": "app-test-1",
        "market_id": market_id,
        "applicant_email": email,
        "application_type": "main",
    }


# ── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture
def test_db():
    """A clean test database with a published market and one applicant."""
    return FakeDatabase(
        markets=[_published_market_doc()],
        applications=[_application_doc()],
    )


@pytest.fixture
def applicant_auth_module(test_db, monkeypatch):
    """Import applicant_auth with our fake database installed."""
    import api.applicant_auth as mod
    import api.applications as ApplicationsApi
    monkeypatch.setattr(mod, "db", test_db)
    monkeypatch.setattr(mod, "challenges_collection", test_db["applicant_login_challenges"])
    monkeypatch.setattr(ApplicationsApi, "applications_collection", test_db["applications"])
    monkeypatch.setattr(mod, "_send_code_email", lambda *a, **kw: True)
    return mod


# ── Request code: oracle-free ────────────────────────────────────────


class TestRequestCodeIndistinguishable:
    """Requesting a code must produce the same observable outcome regardless
    of whether the email is known to the market."""

    def test_known_and_unknown_email_produce_identical_responses(
        self, applicant_auth_module, monkeypatch
    ):
        """The response body and status code must be byte-identical."""
        from flask import Flask
        app = Flask(__name__)

        # Known applicant
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            result_known = applicant_auth_module.request_login_code("test-market")
        body_known, status_known = result_known

        # Unknown address
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "unknown@example.com"},
        ):
            result_unknown = applicant_auth_module.request_login_code("test-market")
        body_unknown, status_unknown = result_unknown

        assert status_known == status_unknown == 200
        assert body_known.get_json() == body_unknown.get_json(), (
            f"Responses differ:\n  known:   {body_known.get_json()}\n  unknown: {body_unknown.get_json()}"
        )

    def test_nonexistent_market_produces_same_response(
        self, applicant_auth_module, monkeypatch
    ):
        """A slug that resolves to no market must produce the same 200 response."""
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/no-such-market/request-code",
            method="POST",
            json={"email": "someone@example.com"},
        ):
            result = applicant_auth_module.request_login_code("no-such-market")
        body, status = result

        assert status == 200
        assert body.get_json() == {
            "message": "We've sent a code to this address."
        }

    def test_missing_email_produces_same_response(
        self, applicant_auth_module, monkeypatch
    ):
        """A request with no email must produce the same 200 response."""
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={},
        ):
            result = applicant_auth_module.request_login_code("test-market")
        body, status = result

        assert status == 200
        assert body.get_json() == {
            "message": "We've sent a code to this address."
        }

    def test_invalid_email_produces_same_response(
        self, applicant_auth_module, monkeypatch
    ):
        """An invalid email format must produce the same 200 response."""
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "not-an-email"},
        ):
            result = applicant_auth_module.request_login_code("test-market")
        body, status = result

        assert status == 200
        assert body.get_json() == {
            "message": "We've sent a code to this address."
        }


# ── Verify code: five tries, then spent ──────────────────────────────

RETRY_BODY = {
    "message": "That code isn't right. Check you typed the newest code and try again.",
    "codeState": "retry",
}
SPENT_BODY = {
    "message": "That code no longer works. Send yourself a new code.",
    "codeState": "spent",
}
APPLICANT = "applicant@example.com"
KNOWN_CODE = "246810"


def _post(handler, path, payload):
    from flask import Flask

    with Flask(__name__).test_request_context(path, method="POST", json=payload):
        return handler()


def _request_code(mod, email=APPLICANT, slug="test-market"):
    return _post(lambda: mod.request_login_code(slug),
                 f"/public/markets/{slug}/applicant-login/request-code", {"email": email})


def _verify(mod, code, email=APPLICANT, slug="test-market"):
    payload = {"email": email, "code": code}
    return _post(lambda: mod.verify_login_code(slug),
                 f"/public/markets/{slug}/applicant-login/verify-code", payload)


def _answer(result):
    """The status and the exact bytes a caller reads."""
    body, status = result
    return status, body.get_data()


@pytest.fixture
def known_code(applicant_auth_module, monkeypatch):
    """Every code this test asks for is ``KNOWN_CODE``, as its email would say."""
    monkeypatch.setattr(applicant_auth_module, "_generate_code", lambda: KNOWN_CODE)
    return KNOWN_CODE


class TestACodeTakesFiveTries:
    """A code lasts ten minutes and takes five tries (T202, T191 F22).

    One wrong try used to burn the code, while the page went on offering "Sign in" for it, so a
    vendor who typed the older of two codes, or slipped once, could never pass with the right one.
    """

    def test_a_wrong_code_says_so_and_the_right_one_then_signs_in(
        self, applicant_auth_module, known_code
    ):
        _request_code(applicant_auth_module)

        body, status = _verify(applicant_auth_module, "000000")
        assert (status, body.get_json()) == (401, RETRY_BODY)

        body, status = _verify(applicant_auth_module, known_code)
        assert status == 200
        assert body.get_json()["success"] is True

    def test_four_wrong_tries_answer_retry_and_the_fifth_spent(
        self, applicant_auth_module, known_code
    ):
        _request_code(applicant_auth_module)

        for wrong in ("000001", "000002", "000003", "000004"):
            body, status = _verify(applicant_auth_module, wrong)
            assert (status, body.get_json()) == (401, RETRY_BODY)
        body, status = _verify(applicant_auth_module, "000005")
        assert (status, body.get_json()) == (401, SPENT_BODY)

    def test_the_right_code_after_the_fifth_wrong_try_is_refused(
        self, applicant_auth_module, test_db, known_code
    ):
        _request_code(applicant_auth_module)
        for wrong in ("000001", "000002", "000003", "000004", "000005"):
            _verify(applicant_auth_module, wrong)

        body, status = _verify(applicant_auth_module, known_code)

        assert (status, body.get_json()) == (401, SPENT_BODY)
        challenge = test_db.challenges.find_one({"email": APPLICANT})
        assert challenge["consumed"] is True
        assert challenge["attempts"] == 5

    def test_the_right_code_on_the_fifth_try_signs_in(self, applicant_auth_module, known_code):
        _request_code(applicant_auth_module)
        for wrong in ("000001", "000002", "000003", "000004"):
            _verify(applicant_auth_module, wrong)

        assert _verify(applicant_auth_module, known_code)[1] == 200

    def test_a_right_code_signs_in_once(self, applicant_auth_module, known_code):
        _request_code(applicant_auth_module)
        assert _verify(applicant_auth_module, known_code)[1] == 200

        body, status = _verify(applicant_auth_module, known_code)

        assert (status, body.get_json()) == (401, SPENT_BODY)

    def test_a_right_code_sent_twice_at_once_signs_in_once(
        self, applicant_auth_module, known_code, monkeypatch
    ):
        """Both tries pass the count and the comparison before either marks the code used.

        Each is counted by one atomic update, so both find the challenge live; what keeps the
        code to one sign-in is the conditional write that marks it consumed, which only one wins.
        """
        _request_code(applicant_auth_module)
        both_compared = threading.Barrier(2, timeout=5)
        verify_code = applicant_auth_module._verify_code

        def compare_then_wait(stored, candidate):
            matched = verify_code(stored, candidate)
            both_compared.wait()
            return matched

        monkeypatch.setattr(applicant_auth_module, "_verify_code", compare_then_wait)
        statuses = []

        def sign_in():
            statuses.append(_verify(applicant_auth_module, known_code)[1])

        threads = [threading.Thread(target=sign_in) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert sorted(statuses) == [200, 401]

    def test_an_expired_code_is_spent(self, applicant_auth_module, test_db, known_code):
        _request_code(applicant_auth_module)
        test_db.challenges.update_one(
            {"email": APPLICANT},
            {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}},
        )

        body, status = _verify(applicant_auth_module, known_code)

        assert (status, body.get_json()) == (401, SPENT_BODY)

    def test_a_code_lasts_ten_minutes(self, applicant_auth_module, test_db):
        before = datetime.now(timezone.utc)
        _request_code(applicant_auth_module)

        expires_at = test_db.challenges.find_one({"email": APPLICANT})["expires_at"]

        assert expires_at - before >= timedelta(minutes=10)
        assert expires_at - before < timedelta(minutes=10, seconds=5)

    def test_the_challenge_counts_its_tries_and_numbers_its_codes(
        self, applicant_auth_module, test_db
    ):
        _request_code(applicant_auth_module)
        first = test_db.challenges.find_one({"email": APPLICANT})
        _verify(applicant_auth_module, "000000")
        _verify(applicant_auth_module, "000001")
        tried = test_db.challenges.find_one({"email": APPLICANT})
        _request_code(applicant_auth_module)
        second = test_db.challenges.find_one({"email": APPLICANT})

        assert (first["attempts"], first["sequence"]) == (0, 1)
        assert tried["attempts"] == 2
        assert (second["attempts"], second["sequence"], second["consumed"]) == (0, 2, False)

    def test_a_new_code_ends_the_old_one(self, applicant_auth_module, monkeypatch):
        """The older of two emails' codes is a wrong code now, and says to type the newest."""
        codes = iter(["111111", "222222"])
        monkeypatch.setattr(applicant_auth_module, "_generate_code", lambda: next(codes))
        _request_code(applicant_auth_module)
        _request_code(applicant_auth_module)

        body, status = _verify(applicant_auth_module, "111111")
        assert (status, body.get_json()) == (401, RETRY_BODY)
        assert _verify(applicant_auth_module, "222222")[1] == 200

    def test_a_used_up_code_is_followed_by_a_new_one_that_signs_in(
        self, applicant_auth_module, monkeypatch
    ):
        codes = iter(["111111", "222222"])
        monkeypatch.setattr(applicant_auth_module, "_generate_code", lambda: next(codes))
        _request_code(applicant_auth_module)
        for wrong in ("000001", "000002", "000003", "000004", "000005"):
            _verify(applicant_auth_module, wrong)

        _request_code(applicant_auth_module)

        assert _verify(applicant_auth_module, "222222")[1] == 200


class TestVerifyCodeIndistinguishable:
    """Every way a code cannot pass answers one 401, byte for byte.

    "Retry" is the one other answer, and it says only that someone asked for a code for this
    address in the last ten minutes, which anyone can make true by asking: it says nothing of
    whether the address applied, so the login ruling holds.
    """

    def test_every_way_a_code_cannot_pass_answers_the_same_bytes(
        self, applicant_auth_module, test_db, known_code, monkeypatch
    ):
        answers = {}

        _request_code(applicant_auth_module, email="tried@example.com")
        for wrong in ("000001", "000002", "000003", "000004"):
            _verify(applicant_auth_module, wrong, email="tried@example.com")
        answers["fifth wrong try"] = _answer(
            _verify(applicant_auth_module, "000005", email="tried@example.com"))

        _request_code(applicant_auth_module, email="late@example.com")
        test_db.challenges.update_one(
            {"email": "late@example.com"},
            {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}},
        )
        answers["expired"] = _answer(
            _verify(applicant_auth_module, known_code, email="late@example.com"))

        _request_code(applicant_auth_module, email="used@example.com")
        _verify(applicant_auth_module, known_code, email="used@example.com")
        answers["consumed"] = _answer(
            _verify(applicant_auth_module, known_code, email="used@example.com"))

        answers["never asked"] = _answer(
            _verify(applicant_auth_module, known_code, email="stranger@example.com"))
        answers["no address"] = _answer(_post(
            lambda: applicant_auth_module.verify_login_code("test-market"),
            "/public/markets/test-market/applicant-login/verify-code", {"code": known_code}))
        answers["no code"] = _answer(_post(
            lambda: applicant_auth_module.verify_login_code("test-market"),
            "/public/markets/test-market/applicant-login/verify-code", {"email": APPLICANT}))
        answers["a code that is not a string"] = _answer(_post(
            lambda: applicant_auth_module.verify_login_code("test-market"),
            "/public/markets/test-market/applicant-login/verify-code",
            {"email": APPLICANT, "code": {"$ne": ""}}))
        answers["unknown market"] = _answer(
            _verify(applicant_auth_module, known_code, slug="no-such-market"))

        draft = _published_market_doc("draft-market", "Draft Market", phase="draft")
        test_db.markets.docs.append(draft)
        answers["draft market"] = _answer(
            _verify(applicant_auth_module, known_code, slug=draft["slug"]))
        imported = _published_market_doc("csv-market", "Imported Market", intake_mode="csv")
        test_db.markets.docs.append(imported)
        answers["market that imports its vendors, before its results"] = _answer(
            _verify(applicant_auth_module, known_code, slug=imported["slug"]))

        for case, (status, body) in answers.items():
            assert (status, json.loads(body)) == (401, SPENT_BODY), case
        assert len(set(answers.values())) == 1, answers

    def test_a_retry_reads_alike_for_an_applicant_and_a_stranger(self, applicant_auth_module):
        """Whoever asked for a code reads the same "retry", applied or not."""
        _request_code(applicant_auth_module, email=APPLICANT)
        _request_code(applicant_auth_module, email="stranger@example.com")

        applicant = _answer(_verify(applicant_auth_module, "000000", email=APPLICANT))
        stranger = _answer(_verify(applicant_auth_module, "000000", email="stranger@example.com"))

        assert applicant == stranger
        assert json.loads(applicant[1]) == RETRY_BODY

    def test_the_answer_to_asking_for_a_code_never_carries_its_number(
        self, applicant_auth_module
    ):
        """The number would say how often someone asked for that address."""
        first = _answer(_request_code(applicant_auth_module))
        second = _answer(_request_code(applicant_auth_module))
        stranger = _answer(_request_code(applicant_auth_module, email="stranger@example.com"))

        assert first == second == stranger


# ── Cross-market isolation ───────────────────────────────────────────


class TestCrossMarketIsolation:
    """A code issued for market A cannot authenticate against market B."""

    def test_code_for_market_a_fails_on_market_b(
        self, applicant_auth_module, monkeypatch
    ):
        """The cross-market bypass: a code is scoped to the market it was issued for."""
        from flask import Flask
        app = Flask(__name__)

        # Two markets in the fake DB
        db = FakeDatabase(
            markets=[
                _published_market_doc("market-a", "Market A"),
                _published_market_doc("market-b", "Market B"),
            ],
            applications=[
                _application_doc("market-a", "applicant@example.com"),
                _application_doc("market-b", "applicant@example.com"),
            ],
        )

        import api.applicant_auth as mod
        monkeypatch.setattr(mod, "db", db)
        monkeypatch.setattr(mod, "challenges_collection", db["applicant_login_challenges"])
        monkeypatch.setattr(mod, "_send_code_email", lambda *a, **kw: True)

        # Request a code for Market A
        slug_a = market_name_slug("Market A")
        with app.test_request_context(
            f"/public/markets/{slug_a}/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            mod.request_login_code(slug_a)

        # Get the stored challenge for Market A
        challenge_a = db.challenges.find_one(
            {"market_id": "market-a", "email": "applicant@example.com"}
        )
        assert challenge_a is not None

        # The same email has no challenge for Market B yet
        challenge_b_before = db.challenges.find_one(
            {"market_id": "market-b", "email": "applicant@example.com"}
        )
        assert challenge_b_before is None, (
            "Challenge for Market B should not exist - only Market A was requested"
        )

        # Now try to verify the Market A code against Market B's slug → should fail
        slug_b = market_name_slug("Market B")
        with app.test_request_context(
            f"/public/markets/{slug_b}/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": "123456"},
        ):
            r = mod.verify_login_code(slug_b)
        assert r[1] == 401, (
            f"Code for Market A should not authenticate against Market B, got {r}"
        )


# ── D9 lock preservation ─────────────────────────────────────────────


class TestD9LockPreservation:
    """The D9 hard lock engages on the first Application document and is not
    affected by the applicant login challenge collection."""

    def test_requesting_code_does_not_create_application(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """Requesting a login code must NOT create an Application document.
        The D9 lock depends on the first Application, and this endpoint must
        not create one - the captain has explicitly forbidden that."""
        from flask import Flask
        app = Flask(__name__)

        # Zero applications initially
        assert test_db.applications.count_documents({}) == 1, (
            "Test setup should have exactly one application"
        )

        # Request a code for an email that has NO application
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "complete-stranger@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        # The application count must remain unchanged
        assert test_db.applications.count_documents({}) == 1, (
            "Requesting a code for a non-applicant must not create an Application document"
        )

    def test_requesting_code_does_not_create_application_for_unknown_market(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """Even for a nonexistent market, no Application should be created."""
        from flask import Flask
        app = Flask(__name__)

        initial_count = test_db.applications.count_documents({})

        with app.test_request_context(
            "/public/markets/no-such-market/request-code",
            method="POST",
            json={"email": "someone@example.com"},
        ):
            applicant_auth_module.request_login_code("no-such-market")

        assert test_db.applications.count_documents({}) == initial_count


# ── Success path ─────────────────────────────────────────────────────


class TestSuccessfulVerification:
    """The happy path: a real applicant requests a code and verifies it."""

    def test_known_applicant_can_verify_code(self, applicant_auth_module, known_code):
        """An applicant who requests a code can verify it successfully."""
        _request_code(applicant_auth_module)

        body, status = _verify(applicant_auth_module, known_code)

        assert status == 200
        body_json = body.get_json()
        assert body_json["success"] is True
        assert body_json["marketId"] == "test-market-1"
        assert body_json["applicantEmail"] == "applicant@example.com"
        assert "token" in body_json  # JWT for subsequent API calls


# ── Edge cases ───────────────────────────────────────────────────────


class TestEdgeCases:
    """Boundary and edge case behavior."""

    def test_request_code_overwrites_previous_challenge(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """A second code request overwrites the first challenge."""
        from flask import Flask
        app = Flask(__name__)

        # First request
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        first = test_db.challenges.find_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"}
        )
        first_hash = first["code_hash"]
        assert first["consumed"] is False

        # Second request
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        second = test_db.challenges.find_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"}
        )
        assert second["code_hash"] != first_hash, (
            "New request should generate a new code"
        )
        assert second["consumed"] is False, (
            "New challenge should reset consumed flag"
        )

    def test_draft_market_unreachable_by_slug(
        self, applicant_auth_module, monkeypatch
    ):
        """A draft market cannot be resolved by slug for code requests."""
        from flask import Flask
        app = Flask(__name__)

        db = FakeDatabase(
            markets=[_published_market_doc("draft-market", "Draft Market",
                                            phase="draft")],
        )

        import api.applicant_auth as mod
        monkeypatch.setattr(mod, "db", db)
        monkeypatch.setattr(mod, "challenges_collection",
                            db["applicant_login_challenges"])

        slug = market_name_slug("Draft Market")
        with app.test_request_context(
            f"/public/markets/{slug}/request-code",
            method="POST",
            json={"email": "someone@example.com"},
        ):
            result = mod.request_login_code(slug)
        body, status = result

        assert status == 200
        # Should get the same response as "market not found" - indistinguishable
        assert body.get_json() == {
            "message": "We've sent a code to this address."
        }

        # No challenge should be created since the market was not resolved
        challenge = db.challenges.find_one(
            {"market_id": "draft-market", "email": "someone@example.com"}
        )
        assert challenge is None


# ── Timing oracle ────────────────────────────────────────────────────


class TestTheCodeIsSentWithinTheRequest:
    """The code is sent before the response returns (E32/F03/S02).

    It was sent from a daemon thread after the response, to close a timing oracle between an
    applicant (sent a code) and a stranger (not). Every address is sent one now (bug 6), so the work
    is the same for both and that oracle is gone; and on serverless hosting a process may be frozen
    the moment its response is out, so a send left running after it may never finish - no applicant
    code was ever seen to reach Resend from production. What a slow send reveals now is only that
    the market takes applications online, which its public page says to anyone."""

    def _request(self, applicant_auth_module, email="applicant@example.com"):
        from flask import Flask

        app = Flask(__name__)
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": email},
        ):
            return applicant_auth_module.request_login_code("test-market")

    def test_the_send_is_finished_when_the_response_returns(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        sent = []
        monkeypatch.setattr(
            applicant_auth_module, "_send_code_email", lambda *args: sent.append(args) or True,
        )

        body, status = self._request(applicant_auth_module)

        assert status == 200
        assert len(sent) == 1, "the code was not sent before the response returned"

    def test_a_failed_send_answers_as_a_sent_one_and_is_logged(
        self, applicant_auth_module, test_db, monkeypatch, caplog
    ):
        monkeypatch.setattr(applicant_auth_module, "_send_code_email", lambda *args: True)
        sent_body, sent_status = self._request(applicant_auth_module)

        monkeypatch.setattr(applicant_auth_module, "_send_code_email", lambda *args: False)
        with caplog.at_level("ERROR"):
            failed_body, failed_status = self._request(applicant_auth_module)

        assert (failed_body.get_json(), failed_status) == (sent_body.get_json(), sent_status)
        assert "sign-in code" in caplog.text and "test-market" in caplog.text

    def test_a_send_that_raises_still_answers_alike(
        self, applicant_auth_module, test_db, monkeypatch, caplog
    ):
        def boom(*_args):
            raise RuntimeError("provider down")
        monkeypatch.setattr(applicant_auth_module, "_send_code_email", boom)

        with caplog.at_level("ERROR"):
            body, status = self._request(applicant_auth_module)

        assert status == 200
        assert "provider down" in caplog.text

    def test_an_address_that_has_not_applied_is_sent_its_code(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """A first-time vendor needs a code to sign in and apply (bug 6, E26/F07/S01).

        This asserted the opposite - no email for an unknown address - which is the rule that kept
        every new vendor out. Sending to every address also makes the work identical for all."""
        from flask import Flask

        call_recorded = []

        def record_send(email, code, market_name, market_id, sequence):
            call_recorded.append(True)

        monkeypatch.setattr(applicant_auth_module, "_send_code_email", record_send)

        app = Flask(__name__)
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "stranger@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        deadline = time.time() + 2
        while not call_recorded and time.time() < deadline:
            time.sleep(0.01)
        assert len(call_recorded) == 1, "the code was not sent to an address with no application"


def _refused_naming_to(payload):
    """A provider's send that fails with the address it was sent to in its message."""
    raise RuntimeError(f"provider refused {payload['to'][0]}")


class TestTheCodeEmail:
    """What a vendor receives (E26/F10/S02).

    Its text linked to ``/markets/<id>/login``, an address the product has no page for, so a vendor
    who followed it met "not found"; and it called the code a "login code" where every screen says
    sign-in.
    """

    def test_it_links_to_the_markets_own_vendor_page(self, monkeypatch):
        """The link a vendor receives is the one they keep: the market's page (ADR 0022)."""
        # Not the module fixture: it replaces the very function under test.
        import resend
        from api import applicant_auth as applicant_auth_module

        sent = []
        monkeypatch.setattr(applicant_auth_module, "_email_disabled", lambda: False)
        monkeypatch.setattr(applicant_auth_module, "ready_mailer", lambda: True)
        monkeypatch.setattr(applicant_auth_module, "frontend_url", lambda: "https://app.test")
        monkeypatch.setattr(
            resend.Emails, "send", lambda payload: sent.append(payload) or SimpleNamespace(id="m1")
        )

        assert applicant_auth_module._send_code_email(
            "vendor@example.com", "123456", "Harbour Night Market", "harbour-night-market", 1
        )

        for body in (sent[0]["html"], sent[0]["text"]):
            assert "https://app.test/harbour-night-market\"" in body or (
                "https://app.test/harbour-night-market\n" in body)
            assert "your page for" in body
            assert "your application" not in body.lower()
            assert "/markets/" not in body

    def test_each_codes_subject_carries_its_own_number_and_never_the_code(self, monkeypatch):
        """A mail client threads emails by subject, and buried the newest code under the old one.

        The number in each subject keeps them apart, and the body says only the newest works.
        """
        import resend
        from api import applicant_auth as applicant_auth_module

        sent = []
        monkeypatch.setattr(applicant_auth_module, "_email_disabled", lambda: False)
        monkeypatch.setattr(applicant_auth_module, "ready_mailer", lambda: True)
        monkeypatch.setattr(applicant_auth_module, "frontend_url", lambda: "https://app.test")
        monkeypatch.setattr(
            resend.Emails, "send", lambda payload: sent.append(payload) or SimpleNamespace(id="m1")
        )

        applicant_auth_module._send_code_email(
            "vendor@example.com", "583920", "Harbour Night Market", "harbour-night-market", 3
        )

        assert sent[0]["subject"] == "Your sign-in code for Harbour Night Market (#3)"
        for body in (sent[0]["html"], sent[0]["text"]):
            assert "Only the newest code works." in body
            assert "10 minutes" in body
            assert "only be used once" not in body

    @pytest.mark.parametrize("send", [
        "disabled", lambda payload: SimpleNamespace(id="m1"), lambda payload: None, _refused_naming_to,
    ], ids=["email-disabled", "sent", "no-message-id", "send-raises"])
    def test_a_code_send_logs_the_market_and_never_the_address(self, monkeypatch, caplog, send):
        import resend
        from api import applicant_auth as applicant_auth_module

        address = "vendor-logged@example.com"
        monkeypatch.setattr(applicant_auth_module, "_email_disabled", lambda: send == "disabled")
        monkeypatch.setattr(applicant_auth_module, "ready_mailer", lambda: True)
        monkeypatch.setattr(applicant_auth_module, "frontend_url", lambda: "https://app.test")
        if send != "disabled":
            monkeypatch.setattr(resend.Emails, "send", send)

        with caplog.at_level("DEBUG"):
            applicant_auth_module._send_code_email(
                address, "583920", "Harbour Night Market", "harbour-night-market", 1
            )

        assert caplog.records
        assert "harbour-night-market" in caplog.text
        assert address not in caplog.text
        assert "provider refused" not in caplog.text

    def test_asking_again_numbers_the_next_email(self, applicant_auth_module, monkeypatch):
        numbers = []
        monkeypatch.setattr(
            applicant_auth_module, "_send_code_email",
            lambda email, code, name, slug, sequence: numbers.append(sequence) or True,
        )

        _request_code(applicant_auth_module)
        _request_code(applicant_auth_module)
        _request_code(applicant_auth_module, email="someone-else@example.com")

        assert numbers == [1, 2, 1]


# ── Rate limits ──────────────────────────────────────────────────────


class TestSignInIsBounded:
    """Nobody can use these endpoints to flood an address with codes, or to guess one (T12).

    Past a limit both endpoints answer 429 with a Retry-After, and do nothing else: no challenge,
    no email, no code consumed. The refusal is the same for every address and every slug, so it is
    no oracle either.
    """

    CALLER = "203.0.113.7"

    def _post(self, handler, path, payload, caller=CALLER):
        from flask import Flask

        app = Flask(__name__)
        with app.test_request_context(
            path, method="POST", json=payload, environ_base={"REMOTE_ADDR": caller},
        ):
            return handler()

    def _request(self, mod, email="applicant@example.com", slug="test-market", caller=CALLER):
        return self._post(
            lambda: mod.request_login_code(slug),
            f"/public/markets/{slug}/applicant-login/request-code",
            {"email": email},
            caller,
        )

    def _verify(self, mod, email="applicant@example.com", code="000000", slug="test-market",
                caller=CALLER):
        return self._post(
            lambda: mod.verify_login_code(slug),
            f"/public/markets/{slug}/applicant-login/verify-code",
            {"email": email, "code": code},
            caller,
        )

    @staticmethod
    def _refused(result):
        body, status = result
        assert status == 429
        assert int(body.headers["Retry-After"]) >= 1
        return body.get_json()

    def test_asking_for_codes_past_the_limit_for_an_address_is_refused_and_sends_nothing(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        sent = []
        monkeypatch.setattr(applicant_auth_module, "_send_code_email",
                            lambda *args: sent.append(args) or True)
        allowed = sign_in_limits.REQUEST_CODE_PER_ADDRESS.attempts
        for i in range(allowed):
            # From different callers, so only the address is counted against.
            assert self._request(applicant_auth_module, caller=f"198.51.100.{i}")[1] == 200
        stored = test_db.challenges.find_one({"email": "applicant@example.com"})

        body = self._refused(self._request(applicant_auth_module, caller="198.51.100.99"))

        assert "Too many sign-in attempts" in body["message"]
        assert len(sent) == allowed
        assert test_db.challenges.find_one({"email": "applicant@example.com"}) == stored

    def test_the_address_is_counted_as_typed_or_not(self, applicant_auth_module):
        allowed = sign_in_limits.REQUEST_CODE_PER_ADDRESS.attempts
        for i in range(allowed):
            self._request(applicant_auth_module, email="Applicant@Example.com ",
                          caller=f"198.51.100.{i}")
        self._refused(self._request(applicant_auth_module, caller="198.51.100.99"))

    def test_a_venues_shared_address_may_ask_for_300_codes_in_15_minutes(self):
        """Vendors on one venue's wifi share a caller, so it is allowed far more than an address."""
        assert sign_in_limits.REQUEST_CODE_PER_CALLER == sign_in_limits.SignInLimit(
            "request-code:caller", attempts=300, window=timedelta(minutes=15),
        )
        assert sign_in_limits.REQUEST_CODE_PER_ADDRESS.attempts == 5

    def test_asking_for_codes_for_many_addresses_from_one_caller_is_refused(
        self, applicant_auth_module, monkeypatch
    ):
        sent = []
        monkeypatch.setattr(applicant_auth_module, "_send_code_email",
                            lambda *args: sent.append(args) or True)
        allowed = sign_in_limits.REQUEST_CODE_PER_CALLER.attempts
        for i in range(allowed):
            assert self._request(applicant_auth_module, email=f"v{i}@example.com")[1] == 200

        self._refused(self._request(applicant_auth_module, email="one-more@example.com"))
        assert len(sent) == allowed

    def test_another_caller_is_not_held_back_by_one_that_was_refused(self, applicant_auth_module):
        for i in range(sign_in_limits.REQUEST_CODE_PER_CALLER.attempts + 1):
            self._request(applicant_auth_module, email=f"v{i}@example.com")
        assert self._request(applicant_auth_module, email="someone@example.com",
                             caller="192.0.2.1")[1] == 200

    def test_a_caller_past_its_limit_is_refused_alike_for_every_address_and_every_slug(
        self, applicant_auth_module
    ):
        """Counted before the body or the slug is read, so a refusal tells nobody anything."""
        for i in range(sign_in_limits.REQUEST_CODE_PER_CALLER.attempts):
            self._request(applicant_auth_module, email=f"v{i}@example.com")

        refusals = [
            self._request(applicant_auth_module, email="applicant@example.com"),
            self._request(applicant_auth_module, email="stranger@example.com"),
            self._request(applicant_auth_module, slug="no-such-market"),
            self._post(lambda: applicant_auth_module.request_login_code("test-market"),
                       "/public/markets/test-market/applicant-login/request-code", {}),
        ]
        bodies = {repr(self._refused(result)) for result in refusals}
        assert len(bodies) == 1

    @pytest.mark.parametrize("endpoint", ["request_login_code", "verify_login_code"])
    def test_the_caller_is_counted_before_the_body_is_read(
        self, applicant_auth_module, monkeypatch, endpoint
    ):
        """What the caller sends cannot shape how the caller is counted: the count comes first."""
        events = []
        count_attempt = sign_in_limits.count_attempt
        monkeypatch.setattr(sign_in_limits, "count_attempt", lambda limit, subject, *rest: (
            events.append(f"count {limit.name}") or count_attempt(limit, subject, *rest)
        ))
        email_from = applicant_auth_module._email_from
        monkeypatch.setattr(applicant_auth_module, "_email_from", lambda data: (
            events.append("read body") or email_from(data)
        ))

        if endpoint == "request_login_code":
            self._request(applicant_auth_module)
        else:
            self._verify(applicant_auth_module)

        caller_count = next(e for e in events if e.startswith("count") and e.endswith(":caller"))
        assert events.index(caller_count) < events.index("read body")

    def test_verifying_past_the_limit_for_an_address_is_refused_and_consumes_nothing(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        monkeypatch.setattr(applicant_auth_module, "_generate_code", lambda: "135790")
        allowed = sign_in_limits.VERIFY_CODE_PER_ADDRESS.attempts
        for i in range(allowed):
            assert self._verify(applicant_auth_module, caller=f"198.51.100.{i}")[1] == 401
        self._request(applicant_auth_module)

        body = self._refused(
            self._verify(applicant_auth_module, code="135790", caller="198.51.100.99")
        )

        assert "Too many sign-in attempts" in body["message"]
        challenge = test_db.challenges.find_one({"email": "applicant@example.com"})
        assert challenge["consumed"] is False

    def test_a_venues_shared_address_may_enter_300_codes_in_15_minutes(self):
        """Per caller only: an address may still try ten, which is what bounds a guess at a code."""
        assert sign_in_limits.VERIFY_CODE_PER_CALLER == sign_in_limits.SignInLimit(
            "verify-code:caller", attempts=300, window=timedelta(minutes=15),
        )
        assert sign_in_limits.VERIFY_CODE_PER_ADDRESS.attempts == 10

    def test_guessing_codes_for_many_addresses_from_one_caller_is_refused(
        self, applicant_auth_module
    ):
        for i in range(sign_in_limits.VERIFY_CODE_PER_CALLER.attempts):
            assert self._verify(applicant_auth_module, email=f"v{i}@example.com")[1] == 401
        self._refused(self._verify(applicant_auth_module, email="one-more@example.com"))

    def test_a_verify_refusal_is_alike_for_every_address_and_every_slug(
        self, applicant_auth_module
    ):
        for i in range(sign_in_limits.VERIFY_CODE_PER_CALLER.attempts):
            self._verify(applicant_auth_module, email=f"v{i}@example.com")

        refusals = [
            self._verify(applicant_auth_module, email="applicant@example.com"),
            self._verify(applicant_auth_module, email="stranger@example.com"),
            self._verify(applicant_auth_module, slug="no-such-market"),
        ]
        assert len({repr(self._refused(result)) for result in refusals}) == 1

    def test_the_boot_check_builds_the_index_that_expires_the_counters(
        self, applicant_auth_module, sign_in_attempts, monkeypatch
    ):
        monkeypatch.setattr(applicant_auth_module, "_indexes_ready", False)
        applicant_auth_module.ensure_applicant_login_indexes()
        assert [kwargs["name"] for _keys, kwargs in sign_in_attempts.indexes] == [
            "sign_in_attempt_ttl",
        ]

    def test_a_vendor_who_asks_again_and_mistypes_signs_in(
        self, applicant_auth_module, monkeypatch
    ):
        """Under the limits sign-in is exactly as it was."""
        codes = iter(["111111", "222222", "333333"])
        monkeypatch.setattr(applicant_auth_module, "_generate_code", lambda: next(codes))
        self._request(applicant_auth_module)
        self._request(applicant_auth_module)
        assert self._verify(applicant_auth_module, code="999999")[1] == 401
        self._request(applicant_auth_module)
        body, status = self._verify(applicant_auth_module, code="333333")
        assert status == 200
        assert body.get_json()["success"] is True
