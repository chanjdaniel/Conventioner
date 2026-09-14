"""Who the caller is comes from the session, never from something the caller sends.

The vulnerability this pins was proven by request on 2026-09-14 (E07/F01/S02). Every organizer route
carried ``@login_required`` and then authorized against ``request.headers.get('X-Owner-Email')``.
``@login_required`` proves the caller is *some* authenticated user; it never constrains *which* user
the header may claim to be. So a second account with no relationship to a market read all 232 of its
applicants and rejected one of its applications, by naming the victim in that header. The same
account asking honestly got a correct 403.

Two tests, deliberately different in kind:

- The behavioural one walks the exact proven attack through the route it was proven on.
- The structural one is the regression guard. A behavioural test protects the route it names; the
  hole was 33 routes wide, and the next one gets written by copying a neighbour.
"""
import os
import re
import sys
from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.applicants as ApplicantsApi
import api.markets as MarketsApi
import api.users as UsersApi
from datatypes import MarketPhase


APP_PY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py")

OWNER = "owner@example.com"
OWNER_ID = "id-owner"
OUTSIDER = "outsider@example.com"
OUTSIDER_ID = "id-outsider"

MARKET_ID = "market-1"


class TestNoRouteAuthorizesOnAHeader:
    """The regression guard. Nothing in app.py may read a caller identity off the wire."""

    def test_no_identity_header_is_read_anywhere(self):
        source = open(APP_PY, encoding="utf-8").read()

        offenders = re.findall(
            r"request\.headers\.get\(\s*['\"](X-Owner-Email|X-User-Email)['\"]", source
        )

        assert offenders == [], (
            f"{len(offenders)} route(s) still take the caller's identity from a request header. "
            "Use authenticated_email(); the header is not an authorization input."
        )

    def test_the_seam_that_replaced_them_exists_and_reads_the_session(self):
        """If this is ever reimplemented to read a header, the test above stops meaning anything."""
        source = open(APP_PY, encoding="utf-8").read()

        seam = re.search(r"def authenticated_email\(\).*?\n(?=\n@|\ndef |\n# )", source, re.S)

        assert seam, "authenticated_email() is the one seam supplying a verified identity"
        assert "current_user" in seam.group(0)
        assert "headers" not in seam.group(0)


def _market_doc():
    return {
        "id": MARKET_ID,
        "name": "Test Market",
        "creationDate": "2026-01-01",
        "roles": {OWNER_ID: "owner"},
        "modificationList": [],
        "assignmentObject": {},
        "isDraft": False,
        "phase": MarketPhase.APPLICATIONS_OPEN.value,
        "applicationForm": {"fields": []},
        "organizationId": None,
    }


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc

    def find_one(self, query, *args, **kwargs):
        return dict(self.doc) if query.get("id") in (None, self.doc["id"]) else None


@pytest.fixture
def client(monkeypatch):
    """Login enabled, with two real accounts: one owns the market, one is a stranger."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)

    known = {
        OWNER: SimpleNamespace(id=OWNER_ID, email=OWNER),
        OUTSIDER: SimpleNamespace(id=OUTSIDER_ID, email=OUTSIDER),
    }

    def _get_user(email):
        user = known.get(email)
        if user is None:
            return None
        return SimpleNamespace(
            id=user.id, email=user.email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        )

    monkeypatch.setattr(UsersApi, "get_user", _get_user)
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(_market_doc()))
    monkeypatch.setattr(
        ApplicantsApi, "list_market_applications",
        lambda market_id: ({"applications": [{"applicantEmail": "vendor@example.com"}]}, 200),
    )
    return app_module.app.test_client()


def _signed_in_as(client, email):
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True


def _list_applications(client, header_email=None):
    headers = {"X-Owner-Email": header_email} if header_email else {}
    return client.get(f"/markets/{MARKET_ID}/applications", headers=headers)


class TestTheProvenAttack:
    """Walked on GET /markets/<id>/applications, the route it was proven on."""

    def test_a_stranger_asking_honestly_is_refused(self, client):
        """This already worked. It is here so the fix is visibly not 'trust the header less'."""
        _signed_in_as(client, OUTSIDER)

        response = _list_applications(client, header_email=OUTSIDER)

        assert response.status_code == 403

    def test_a_stranger_naming_the_owner_is_refused(self, client):
        """The attack: same account, same market, one header changed. Was 200 with 232 rows."""
        _signed_in_as(client, OUTSIDER)

        response = _list_applications(client, header_email=OWNER)

        assert response.status_code == 403
        assert "applications" not in (response.get_json() or {})

    def test_the_owner_still_gets_their_own_market(self, client):
        """The fix must not close the door on the person it belongs to."""
        _signed_in_as(client, OWNER)

        response = _list_applications(client)

        assert response.status_code == 200
        assert response.get_json()["applications"]

    def test_the_owner_is_unaffected_by_a_header_naming_someone_else(self, client):
        """The header is ignored, not consulted-then-overridden."""
        _signed_in_as(client, OWNER)

        response = _list_applications(client, header_email=OUTSIDER)

        assert response.status_code == 200

    def test_no_session_is_refused_before_any_of_this(self, client):
        response = _list_applications(client, header_email=OWNER)

        assert response.status_code == 401
