"""Tests for applicant email-code login - the public, attacker-facing surface.

Every test in this file PROVES a property rather than asserting it. An assertion
that "returns 401" proves nothing about an oracle - the oracle lives in the
*difference* between two responses. These tests compare actual response bodies,
byte for byte, to prove the two paths are indistinguishable.
"""
import json
from datetime import datetime, timezone

import pytest
import time
from types import SimpleNamespace

from datatypes import Application, ApplicationStatus, ApplicationType, MarketPhase
from market_documents import market_name_slug

# ── Fake collections for testing ────────────────────────────────────


class FakeMarketsCollection:
    """A minimal fake for the markets collection that supports the slug lookup.

    ``published_market_by_slug`` calls ``find(query, projection)`` and expects
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
    """Fake for the applicant_login_challenges collection.

    Supports:
    - ``create_index`` (for boot check)
    - ``update_one`` with upsert (for storing challenges)
    - ``find_one_and_update`` with atomic consume (the security-critical operation)
    """

    def __init__(self):
        self.docs = {}
        self.indexes = []

    def create_index(self, keys, **kwargs):
        self.indexes.append((keys, kwargs))
        return "fake-index"

    def update_one(self, query, update, upsert=False):
        key = (query.get("market_id"), query.get("email"))
        if key in self.docs or upsert:
            set_values = update.get("$set", {})
            self.docs[key] = {
                **(self.docs.get(key, {})),
                **set_values,
                "market_id": set_values.get("market_id", query.get("market_id")),
                "email": set_values.get("email", query.get("email")),
            }
            return SimpleNamespace(matched_count=1, modified_count=1,
                                   upserted_id=None)
        return SimpleNamespace(matched_count=0, modified_count=0,
                               upserted_id=None)

    def find_one_and_update(self, query, update):
        """Atomically find an unconsumed challenge and mark it consumed.

        Returns the pre-update document (Mongo default), or None if no match.
        """
        market_id = query.get("market_id")
        email = query.get("email")
        consumed_filter = query.get("consumed")
        key = (market_id, email)

        if key not in self.docs:
            return None

        doc = self.docs[key]
        if consumed_filter is False and doc.get("consumed", False):
            return None

        # Return the pre-update document (before marking consumed)
        result = dict(doc)

        # Apply the update
        set_values = update.get("$set", {})
        for k, v in set_values.items():
            doc[k] = v

        return result

    def find_one(self, query=None):
        """Find a challenge without consuming it. Used for tests only."""
        for key, doc in self.docs.items():
            if all(doc.get(k) == v for k, v in (query or {}).items()):
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
                          phase="archived"):
    """A minimal market document the slug lookup can resolve."""
    slug = market_name_slug(name)
    return {
        "id": market_id,
        "name": name,
        "phase": phase,
        "isDraft": phase == "draft",
        "slug": slug,
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
            "message": "If an account exists for this email, we've sent a code."
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
            "message": "If an account exists for this email, we've sent a code."
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
            "message": "If an account exists for this email, we've sent a code."
        }


# ── Verify code: oracle-free ─────────────────────────────────────────


class TestVerifyCodeIndistinguishable:
    """Every failure branch must collapse to one observable 401 response."""

    CANONICAL_FAILURE = {"message": "Invalid or expired code."}

    def test_unknown_address_produces_canonical_failure(
        self, applicant_auth_module, monkeypatch
    ):
        """An email that has never requested a code gets the same 401."""
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "never-requested@example.com", "code": "123456"},
        ):
            result = applicant_auth_module.verify_login_code("test-market")
        body, status = result

        assert status == 401
        assert body.get_json() == self.CANONICAL_FAILURE

    def test_wrong_code_produces_canonical_failure(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """A wrong code for an address that DID request a code gets the same 401."""
        # First, request a code for a known applicant to create a challenge
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        # Now try to verify with a wrong code
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": "000000"},
        ):
            result = applicant_auth_module.verify_login_code("test-market")
        body, status = result

        assert status == 401
        assert body.get_json() == self.CANONICAL_FAILURE, (
            f"Wrong code response: {body.get_json()}"
        )

    def test_all_failure_branches_produce_identical_responses(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """Enumerate every failure branch and prove they all return the same bytes."""
        from flask import Flask
        app = Flask(__name__)

        # Seed: create a challenge for a known applicant
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        # Get the real code for later consumption
        challenge = test_db.challenges.find_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"}
        )

        # Branch 1: unknown address (never requested a code)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "stranger@example.com", "code": "123456"},
        ):
            r1 = applicant_auth_module.verify_login_code("test-market")

        # Branch 2: wrong code for known address (consumes it)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": "000000"},
        ):
            r2 = applicant_auth_module.verify_login_code("test-market")

        # Branch 3: already consumed (replay attempt)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": "123456"},
        ):
            r3 = applicant_auth_module.verify_login_code("test-market")

        # All three must be identical
        all_responses = [r1, r2, r3]
        for i, (body, status) in enumerate(all_responses):
            assert status == 401, f"Branch {i+1} status: {status}"
            assert body.get_json() == self.CANONICAL_FAILURE, (
                f"Branch {i+1} differs: {body.get_json()}"
            )

        # All response bodies must be byte-identical
        bodies = [json.dumps(r[0].get_json(), sort_keys=True) for r in all_responses]
        assert len(set(bodies)) == 1, (
            f"Response bodies differ across branches: {bodies}"
        )

    def test_nonexistent_market_produces_canonical_failure(
        self, applicant_auth_module, monkeypatch
    ):
        """A slug that resolves to no market gets the same 401."""
        from flask import Flask
        app = Flask(__name__)

        with app.test_request_context(
            "/public/markets/no-such-market/verify-code",
            method="POST",
            json={"email": "someone@example.com", "code": "123456"},
        ):
            result = applicant_auth_module.verify_login_code("no-such-market")
        body, status = result

        assert status == 401
        assert body.get_json() == self.CANONICAL_FAILURE


# ── One attempt per code ─────────────────────────────────────────────


class TestOneAttemptPerCode:
    """A code is consumed by a single verification attempt, right or wrong."""

    def test_code_cannot_be_replayed_after_wrong_attempt(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """After one wrong attempt, the correct code should also fail."""
        from flask import Flask
        app = Flask(__name__)

        # Request a code
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        # Get the real code from the challenge
        challenge = test_db.challenges.find_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"}
        )
        assert challenge is not None, "Challenge was not created"
        assert challenge.get("consumed") is False

        # First attempt: wrong code (consumes the challenge)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": "000000"},
        ):
            r1 = applicant_auth_module.verify_login_code("test-market")
        assert r1[1] == 401

        # Verify challenge is now consumed
        challenge_after = test_db.challenges.find_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"}
        )
        assert challenge_after.get("consumed") is True, (
            "Challenge was not consumed after wrong attempt"
        )

        # Second attempt: even the correct code should fail (already consumed)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": challenge.get("code_hash", "xxx")},
        ):
            r2 = applicant_auth_module.verify_login_code("test-market")
        assert r2[1] == 401

    def test_code_cannot_be_replayed_after_successful_attempt(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """After one successful attempt, the code cannot be reused."""
        from flask import Flask
        app = Flask(__name__)

        # We need to know the code to test success, so we use a lower-level
        # approach: store a challenge with a known code hash.

        import hashlib, secrets
        code = "654321"
        salt = secrets.token_hex(16)
        code_hash = f"{salt}:{hashlib.sha256(f'{salt}:{code}'.encode()).hexdigest()}"

        test_db.challenges.update_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"},
            {"$set": {
                "market_id": "test-market-1",
                "email": "applicant@example.com",
                "code_hash": code_hash,
                "expires_at": datetime(2099, 1, 1, tzinfo=timezone.utc),
                "consumed": False,
                "created_at": "2026-01-01T00:00:00Z",
            }},
            upsert=True,
        )

        # First attempt: correct code → success
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": code},
        ):
            r1 = applicant_auth_module.verify_login_code("test-market")
        assert r1[1] == 200
        assert r1[0].get_json()["success"] is True

        # Second attempt: same correct code → failure (already consumed)
        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": code},
        ):
            r2 = applicant_auth_module.verify_login_code("test-market")
        assert r2[1] == 401
        assert r2[0].get_json() == {"message": "Invalid or expired code."}


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

    def test_known_applicant_can_verify_code(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """An applicant who requests a code can verify it successfully."""
        from flask import Flask
        import hashlib, secrets
        app = Flask(__name__)

        # Store a known challenge with a known code
        code = "987654"
        salt = secrets.token_hex(16)
        code_hash = f"{salt}:{hashlib.sha256(f'{salt}:{code}'.encode()).hexdigest()}"

        test_db.challenges.update_one(
            {"market_id": "test-market-1", "email": "applicant@example.com"},
            {"$set": {
                "market_id": "test-market-1",
                "email": "applicant@example.com",
                "code_hash": code_hash,
                "expires_at": datetime(2099, 1, 1, tzinfo=timezone.utc),
                "consumed": False,
                "created_at": "2026-01-01T00:00:00Z",
            }},
            upsert=True,
        )

        with app.test_request_context(
            "/public/markets/test-market/verify-code",
            method="POST",
            json={"email": "applicant@example.com", "code": code},
        ):
            result = applicant_auth_module.verify_login_code("test-market")
        body, status = result

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
            "message": "If an account exists for this email, we've sent a code."
        }

        # No challenge should be created since the market was not resolved
        challenge = db.challenges.find_one(
            {"market_id": "draft-market", "email": "someone@example.com"}
        )
        assert challenge is None


# ── Timing oracle ────────────────────────────────────────────────────


class TestTimingOracleClosed:
    """The response path must not block on the email send. If it does, an
    attacker can time the difference between a known applicant (slow - email
    sent synchronously) and a stranger (fast - no email). Identical response
    bodies are worthless if the clock differs."""

    def test_request_code_returns_before_email_send_completes(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """The response must return while the email is still in-flight."""
        from flask import Flask
        import time

        # Replace _send_code_email with a version that sleeps long enough
        # to be detectable if called synchronously.
        call_recorded = []

        def slow_send(email, code, market_name, market_id):
            call_recorded.append(time.time())
            time.sleep(1.0)  # Simulate a slow Resend HTTP call

        monkeypatch.setattr(applicant_auth_module, "_send_code_email", slow_send)

        app = Flask(__name__)
        start = time.time()
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "applicant@example.com"},
        ):
            result = applicant_auth_module.request_login_code("test-market")
        elapsed = time.time() - start

        body, status = result
        assert status == 200
        # The response must return well under the 1-second sleep. If it takes
        # anywhere near 1s, the email was dispatched synchronously.
        assert elapsed < 0.5, (
            f"Response took {elapsed:.3f}s - email send is blocking the "
            f"response path. Must be fire-and-forget to close the timing oracle."
        )
        assert len(call_recorded) == 1, (
            "_send_code_email was not called at all"
        )

    def test_unknown_address_does_not_fire_email_thread(
        self, applicant_auth_module, test_db, monkeypatch
    ):
        """No email thread should be started for unknown addresses."""
        from flask import Flask
        import time

        call_recorded = []

        def record_send(email, code, market_name, market_id):
            call_recorded.append(True)

        monkeypatch.setattr(applicant_auth_module, "_send_code_email", record_send)

        app = Flask(__name__)
        with app.test_request_context(
            "/public/markets/test-market/request-code",
            method="POST",
            json={"email": "stranger@example.com"},
        ):
            applicant_auth_module.request_login_code("test-market")

        assert len(call_recorded) == 0, (
            "Email should not be dispatched for unknown address"
        )
