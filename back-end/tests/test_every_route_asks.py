"""Every route asks for a session, and every route about a market, an organization, an image or a
template refuses a signed-in account that holds no place in it.

The walk reads ``app.url_map``, so a route added later is walked too. Each route-method (every
method a rule serves, but ``HEAD`` and ``OPTIONS``) falls in exactly one class:

- ``PUBLIC``: it needs no organizer session, for the reason beside it;
- ``CALLERS_OWN``: it is about the signed-in caller alone, or lists what is filtered to them;
- scoped: its rule names a market, an organization, an image or a template (``SCOPING_ARGUMENTS``),
  or it names its market or image in the body (``BODY_NAMES_THE_MARKET``,
  ``BODY_NAMES_THE_IMAGE``).

Without a session, every route-method but the public ones answers 401. A signed-in stranger, an
account with no role on the market and no place in the organization, gets 403 or 404 on every
scoped one, and the market, the organization, the image and the template are as they were.
"""
import copy
import io
from types import SimpleNamespace

import pytest
from bson import ObjectId

from conftest import (
    FakeGridFS,
    FakeMarketsCollection,
    FakeOrganizations,
    FakeTemplates,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.floorplans_templates as TemplatesApi
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
import services.gridfs_service as GridfsService
from datatypes import MarketPhase

MARKET_ID = "market-123"
ORG_ID = "org-1"
TEMPLATE_ID = "template-1"
OWNER = "owner@example.com"
STRANGER = "stranger@example.com"
ACCOUNTS = {OWNER: "user-owner", STRANGER: "user-stranger"}

APPLICANT_SURFACE = "the applicant's own surface, whose tests hold its token checks"

PUBLIC = {
    ("GET", "/healthz"): "the deployment's health check",
    ("POST", "/login"): "the password sign-in",
    ("POST", "/login-otp"): "the code sign-in",
    ("POST", "/register"): "the sign-up",
    ("POST", "/verify-email"): "the link a new account is verified by",
    ("POST", "/reset-password"): "the link a forgotten password is reset by",
    ("POST", "/request-otp"): "asks for a sign-in code",
    ("POST", "/request-password-reset"): "asks for a reset link",
    ("POST", "/resend-verification"): "asks for the verification link again",
    ("GET", "/public/markets/<market_slug>/vendor-page"): APPLICANT_SURFACE,
    ("GET", "/public/markets/<market_slug>/application-form"): APPLICANT_SURFACE,
    ("POST", "/public/markets/<market_slug>/applicant-login/request-code"): APPLICANT_SURFACE,
    ("POST", "/public/markets/<market_slug>/applicant-login/verify-code"): APPLICANT_SURFACE,
    ("POST", "/public/markets/<market_slug>/applicant-login/resume"): APPLICANT_SURFACE,
    ("POST", "/public/markets/<market_slug>/applicant-login/sign-out"): APPLICANT_SURFACE,
    ("GET", "/public/markets/<market_slug>/applicant/application"): APPLICANT_SURFACE,
    ("PUT", "/public/markets/<market_slug>/applicant/application"): APPLICANT_SURFACE,
    ("POST", "/public/markets/<market_slug>/vendor/check-in"): APPLICANT_SURFACE,
    ("DELETE", "/public/markets/<market_slug>/vendor/check-in"): APPLICANT_SURFACE,
}

CALLERS_OWN = {
    ("POST", "/logout"): "ends the caller's own session",
    ("GET", "/check-session"): "says who the caller is",
    ("POST", "/delete-user"): "deletes the caller's own account, and refuses any other",
    ("GET", "/csv-proposal/typesafe"): "says whether a start from a CSV may use TypeSafe",
    ("GET", "/markets"): "lists the markets the caller reaches",
    ("POST", "/markets"): "makes a market the caller owns",
    ("GET", "/organizations"): "lists the organizations the caller is in",
    ("POST", "/organizations"): "makes an organization the caller owns",
    ("GET", "/floorplans/templates"): "lists the caller's templates, or their organization's",
    ("POST", "/floorplans/templates"): "makes a template the caller owns",
}

SCOPING_ARGUMENTS = {"market_id", "org_id", "gridfs_id", "template_id"}

BODY_NAMES_THE_MARKET = {
    ("POST", "/floorplans/upload"): "stores an image for the market its form names",
    ("POST", "/floorplans/place-tables"): "places tables for the market its body names",
    ("POST", "/floorplans/save-to-market"): "saves a layout to the market its body names",
}

BODY_NAMES_THE_IMAGE = {
    ("POST", "/floorplans/calibrate"): "measures the image its body names",
    ("POST", "/floorplans/export"): "draws on the image its body names",
}

LISTS = {
    "PUBLIC": PUBLIC,
    "CALLERS_OWN": CALLERS_OWN,
    "BODY_NAMES_THE_MARKET": BODY_NAMES_THE_MARKET,
    "BODY_NAMES_THE_IMAGE": BODY_NAMES_THE_IMAGE,
}

# The image every ``gridfs_id`` names, in the rule and in the body.
IMAGE_ID = ObjectId()

PATH_VALUES = {
    "market_id": MARKET_ID,
    "org_id": ORG_ID,
    "gridfs_id": str(IMAGE_ID),
    "template_id": TEMPLATE_ID,
    "market_slug": "test-market",
    "vendor_email": "vendor@example.com",
    "application_id": "app-1",
    "payment_id": "pay-1",
    "action_id": "move-phase",
    # A viewer, so the role routes walk the caller's role check: the owner's role never changes.
    "user_id": "user-viewer",
    "date": "2026-11-01",
}

# What every request but a GET sends, unless ``BODIES`` gives the route-method its own: one value
# for each name a route reads its market, image, organization or person by.
DEFAULT_BODY = {
    "market_id": MARKET_ID,
    "gridfs_id": str(IMAGE_ID),
    "floorplan": {"sections": []},
    "name": "n",
    "organizationId": ORG_ID,
    "user_email": OWNER,
    "new_owner_email": STRANGER,
    "role": "viewer",
    "toPhase": "assignment",
    "email": "nobody@example.com",
}


def _png():
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (4, 3), "white").save(out, format="PNG")
    return out.getvalue()


# The smallest body that passes a route's shape check, for each route that checks the shape before
# the caller's role: with the default body it would answer 400 and never reach the role check.
BODIES = {
    ("POST", "/markets/<market_id>/applications-stopped"): {"json": {"stopped": True}},
    ("PUT", "/markets/<market_id>/plan"): {"json": {"setupObject": {}}},
    ("PUT", "/markets/<market_id>/rejection-rules"): {"json": {"rules": []}},
    ("PUT", "/markets/<market_id>/review-highlights"): {"json": {"keys": []}},
    ("PUT", "/markets/<market_id>/reviewers"): {"json": {"reviewers": []}},
    ("PUT", "/markets/<market_id>/vendor-notes/<path:vendor_email>"): {"json": {"note": "n"}},
    ("PUT", "/markets/<market_id>/vendor-notes/<path:vendor_email>/request-handled"): {
        "json": {"handled": True}},
    ("POST", "/floorplans/upload"): {
        "data": lambda: {
            "market_id": MARKET_ID, "file": (io.BytesIO(_png()), "hall.png", "image/png")},
        "content_type": "multipart/form-data",
    },
}


def _route_methods():
    """Each (method, rule) the app serves, with its rule, in a stable order."""
    return sorted(
        ((method, rule) for rule in app_module.app.url_map.iter_rules()
         if rule.endpoint != "static" for method in rule.methods - {"HEAD", "OPTIONS"}),
        key=lambda route: (route[1].rule, route[0]),
    )


def _names(route_methods):
    return ", ".join(f"{method} {rule}" for method, rule in route_methods)


def _classes(method, rule):
    """The classes a route-method is in: each list that names it, and scoped by its rule when the
    rule names what it acts on."""
    classes = [name for name, entries in LISTS.items() if (method, rule.rule) in entries]
    named = sorted(SCOPING_ARGUMENTS & set(rule.arguments))
    if named:
        classes.append(f"scoped by its rule's {', '.join(named)}")
    return classes


def _scoped():
    """The route-methods a stranger is sent: those scoped by their rule or by their body."""
    return [
        (method, rule) for method, rule in _route_methods()
        if any(name not in ("PUBLIC", "CALLERS_OWN") for name in _classes(method, rule))
    ]


def _path(rule):
    return rule.build({arg: PATH_VALUES.get(arg, "x-1") for arg in rule.arguments})[1]


def _request(client, method, rule):
    sent = BODIES.get((method, rule.rule))
    if sent is None:
        sent = {} if method == "GET" else {"json": DEFAULT_BODY}
    sent = {key: value() if callable(value) else value for key, value in sent.items()}
    return client.open(_path(rule), method=method, **sent)


def _said(response):
    body = response.get_json(silent=True)
    if not isinstance(body, dict):
        return ""
    return str(body.get("error") or body.get("msg") or body.get("message") or "")


class TestEveryRouteIsClassified:

    def test_every_route_method_is_in_a_class(self):
        unclassified = [
            (method, rule.rule) for method, rule in _route_methods() if not _classes(method, rule)
        ]

        assert unclassified == [], (
            f"These routes are in no class: {_names(unclassified)}. Put each on PUBLIC (no session "
            "needed), CALLERS_OWN (about the caller alone), BODY_NAMES_THE_MARKET or "
            "BODY_NAMES_THE_IMAGE (its body names what it acts on), with its reason, or name the "
            "market, organization, image or template in its rule "
            f"({', '.join(sorted(SCOPING_ARGUMENTS))})."
        )

    def test_no_route_method_is_in_two_classes(self):
        twice = [
            f"{method} {rule.rule} ({' and '.join(classes)})"
            for method, rule in _route_methods() if len(classes := _classes(method, rule)) > 1
        ]

        assert twice == [], (
            f"These routes are in more than one class: {'; '.join(twice)}. Keep each in the one "
            "that says what it acts on."
        )

    def test_every_listed_route_is_registered(self):
        served = {(method, rule.rule) for method, rule in _route_methods()}
        stale = [
            f"{method} {rule} (on {name})"
            for name, entries in LISTS.items() for method, rule in entries
            if (method, rule) not in served
        ]

        assert stale == [], (
            f"These listed routes are not served: {'; '.join(stale)}. "
            "Take each off its list, or spell it as the app registers it."
        )

    def test_every_body_names_a_registered_route(self):
        served = {(method, rule.rule) for method, rule in _route_methods()}

        assert sorted(set(BODIES) - served) == [], "Each row of BODIES names a served route."


class TestWithoutASession:

    def test_every_route_but_the_public_ones_asks_for_a_sign_in(self, walked):
        client = app_module.app.test_client()
        answered = []
        for method, rule in _route_methods():
            if (method, rule.rule) in PUBLIC:
                continue
            response = _request(client, method, rule)
            if response.status_code != 401:
                answered.append(f"{method} {rule.rule} ({response.status_code})")

        assert answered == [], (
            f"These routes answer without a session: {'; '.join(answered)}. "
            "Put @login_required under each one's @route, or put it on PUBLIC with its reason."
        )
        walked.assert_unchanged()


class TestASignedInStranger:

    def test_every_scoped_route_refuses_an_account_with_no_place_in_it(self, walked, stranger):
        answered = []
        for method, rule in _scoped():
            response = _request(stranger, method, rule)
            if response.status_code not in (403, 404):
                answered.append(
                    f"{method} {rule.rule} ({response.status_code} {_said(response)!r})")

        assert answered == [], (
            f"These routes did not refuse a signed-in stranger: {'; '.join(answered)}. "
            "Check the caller's role on what the route acts on before anything else; a route whose "
            "shape check answers first needs a row in BODIES that passes it."
        )
        walked.assert_unchanged()

    def test_the_stranger_is_signed_in(self, stranger):
        """The refusals above are a stranger's, not a missing session's."""
        response = stranger.get("/check-session")

        assert response.status_code == 200


# ── The market, organization, image and template the walk names ──────────────


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, organizations=[], get_id=lambda e=email: e,
    )


@pytest.fixture
def walked(monkeypatch):
    """The one market, organization, image and template every request names, owned by
    ``user-owner`` (the market has a viewer too), and a check that the walk left them as they
    were."""
    markets = FakeMarketsCollection(stored_market(
        MarketPhase.APPLICATIONS, roles={"user-owner": "owner", "user-viewer": "viewer"},
        organizationId=ORG_ID))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)

    organizations = FakeOrganizations({
        "_id": "mongo-org-1", "id": ORG_ID, "name": "Org", "owner": "user-owner", "admins": [],
        "members": [], "markets": [MARKET_ID],
    })
    for module in (OrgsApi, PermissionsApi, TemplatesApi):
        monkeypatch.setattr(module, "organizations_collection", organizations)

    images = FakeGridFS()
    images.files[IMAGE_ID] = {
        "data": _png(), "filename": "hall.png", "metadata": {"marketId": MARKET_ID}}
    monkeypatch.setattr(GridfsService, "_fs", images)

    templates = FakeTemplates({
        "id": TEMPLATE_ID, "name": "Main hall", "ownerUserId": "user-owner",
        "organizationId": ORG_ID, "tableTypes": [], "aisles": {},
    })
    monkeypatch.setattr(TemplatesApi, "templates_collection", templates)

    def stored():
        return {
            "market": markets.doc, "organization": organizations.docs, "image": images.files,
            "template": templates.docs,
            # The fake markets collection keeps its one document and records each write beside it.
            "market write": (markets.last_update, markets.inserted),
        }

    before = copy.deepcopy(stored())

    def assert_unchanged():
        after = stored()
        changed = sorted(name for name in before if after[name] != before[name])
        assert changed == [], f"The walk changed the stored {', '.join(changed)}."

    return SimpleNamespace(assert_unchanged=assert_unchanged)


@pytest.fixture
def stranger(monkeypatch):
    """A client signed in as an account with no role on the market and no place in the
    organization (the suite's origin list is the loopback pattern)."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    monkeypatch.setattr(UsersApi, "get_user_raw", lambda email: (
        {"id": ACCOUNTS[email], "email": email} if email in ACCOUNTS else None))

    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = STRANGER
        session["_fresh"] = True
    return client
