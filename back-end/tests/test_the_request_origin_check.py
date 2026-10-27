"""A write is taken only from the app's own origins, or from a client that is not a browser.

CORS decides which origins may read a response; it does not stop a request from being sent, and a
plain form post goes without a preflight. The session cookie is ``SameSite=None``, so the browser
attaches it to such a post. The request-origin check refuses a state-changing request whose browser
reports it came from an origin outside the CORS list, before the route runs, and lets every request
from the app, and every request from a client that sends neither header, through.
"""
import io
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.applicants as ApplicantsApi
import api.floorplans as FloorplansApi
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
from datatypes import MarketPhase
from utils.cors import LOOPBACK_ORIGINS
from utils.request_origin import REQUEST_ORIGIN_REFUSAL, request_origin_allowed

OWNER_EMAIL = "owner@example.com"
OTHER_ORIGIN = "https://other.example"
APP_ORIGIN = "http://127.0.0.1:5173"

FROM_ANOTHER_SITE = {"Origin": OTHER_ORIGIN, "Sec-Fetch-Site": "cross-site"}
FROM_THE_APP = {"Origin": APP_ORIGIN, "Sec-Fetch-Site": "same-site"}


class TestTheDecision:
    """The decision on its own, for the lists a deployment can have."""

    PRODUCTION = ["https://app.example.com"]
    LOCAL = [LOOPBACK_ORIGINS]

    @pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS", "get"])
    @pytest.mark.parametrize("fetch_site,origin", [
        ("cross-site", OTHER_ORIGIN),
        ("cross-site", None),
        (None, "null"),
    ])
    def test_a_read_or_a_preflight_passes_whatever_its_headers(self, method, fetch_site, origin):
        assert request_origin_allowed(method, fetch_site, origin, self.PRODUCTION)

    @pytest.mark.parametrize("fetch_site", ["same-origin", "none"])
    def test_a_request_the_browser_calls_its_own_passes(self, fetch_site):
        assert request_origin_allowed("POST", fetch_site, None, self.PRODUCTION)
        assert request_origin_allowed("POST", fetch_site, OTHER_ORIGIN, self.PRODUCTION)

    def test_a_request_with_neither_header_passes(self):
        """A script, the E2E API helper or a health check sends neither, and there is nothing to
        check."""
        assert request_origin_allowed("POST", None, None, self.PRODUCTION)

    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_a_listed_origin_passes_and_any_other_is_refused(self, method):
        assert request_origin_allowed(method, "same-site", "https://app.example.com", self.PRODUCTION)
        assert not request_origin_allowed(method, "same-site", OTHER_ORIGIN, self.PRODUCTION)
        assert not request_origin_allowed(method, "cross-site", OTHER_ORIGIN, self.PRODUCTION)

    def test_a_listed_origin_is_read_as_cors_reads_it(self):
        """A host is not case-sensitive, and flask-cors compares a string entry without case."""
        assert request_origin_allowed("POST", "same-site", "https://APP.example.com", self.PRODUCTION)
        assert not request_origin_allowed(
            "POST", "same-site", "https://app.example.com.other.example", self.PRODUCTION,
        )

    def test_the_loopback_pattern_takes_any_port_and_nothing_else(self):
        assert request_origin_allowed("POST", "same-site", "http://localhost:5193", self.LOCAL)
        assert request_origin_allowed("POST", "same-site", APP_ORIGIN, self.LOCAL)
        assert not request_origin_allowed("POST", "cross-site", OTHER_ORIGIN, self.LOCAL)
        assert not request_origin_allowed(
            "POST", "same-site", "http://127.0.0.1:5173.other.example", self.LOCAL,
        )

    def test_a_browser_request_with_no_origin_is_refused(self):
        """Every browser that sends Fetch Metadata sends ``Origin`` on a write."""
        assert not request_origin_allowed("POST", "cross-site", None, self.PRODUCTION)
        assert not request_origin_allowed("POST", "same-site", None, self.PRODUCTION)

    def test_an_opaque_origin_is_refused(self):
        assert not request_origin_allowed("POST", None, "null", self.PRODUCTION)
        assert not request_origin_allowed("POST", "cross-site", "null", self.LOCAL)


def _owner(email):
    if email != OWNER_EMAIL:
        return None
    return SimpleNamespace(
        id="user-1", email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def client(monkeypatch):
    """A client signed in as the market's owner (the suite's list is the loopback pattern)."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _owner)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


def _assert_refused(response):
    assert response.status_code == 403
    assert response.get_json() == {"error": REQUEST_ORIGIN_REFUSAL}


class TestPublishingResults:

    @pytest.fixture
    def published(self, monkeypatch):
        """The market loads and the caller may publish; what reaches the publish is recorded."""
        monkeypatch.setattr(
            MarketsApi, "markets_collection",
            FakeMarketsCollection(stored_market(MarketPhase.ASSIGNMENT)),
        )
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        calls = []

        def publish(market_id):
            calls.append(market_id)
            return {"message": "Results published"}, 200

        monkeypatch.setattr(ApplicantsApi, "publish_results", publish)
        return calls

    def test_a_post_from_another_site_is_refused_and_publishes_nothing(self, client, published):
        response = client.post("/markets/market-123/publish-results", headers=FROM_ANOTHER_SITE)

        _assert_refused(response)
        assert published == []

    def test_a_form_post_from_another_site_is_refused_the_same(self, client, published):
        response = client.post(
            "/markets/market-123/publish-results",
            data={"anything": "1"},
            headers=FROM_ANOTHER_SITE,
        )

        _assert_refused(response)
        assert published == []

    @pytest.mark.parametrize("headers", [
        FROM_THE_APP,
        {"Sec-Fetch-Site": "same-origin"},
        {},
    ], ids=["listed origin, same-site", "same-origin, no Origin", "neither header"])
    def test_a_post_from_the_app_or_a_client_publishes(self, client, published, headers):
        response = client.post("/markets/market-123/publish-results", headers=headers)

        assert response.status_code == 200
        assert published == ["market-123"]

    def test_a_browser_post_with_no_origin_is_refused(self, client, published):
        response = client.post(
            "/markets/market-123/publish-results", headers={"Sec-Fetch-Site": "cross-site"},
        )

        _assert_refused(response)
        assert published == []

    def test_an_opaque_origin_is_refused(self, client, published):
        response = client.post("/markets/market-123/publish-results", headers={"Origin": "null"})

        _assert_refused(response)
        assert published == []


class TestSigningOut:

    def test_a_sign_out_from_another_site_is_refused_and_the_session_stays(self, client):
        _assert_refused(client.post("/logout", headers=FROM_ANOTHER_SITE))

        assert client.get("/check-session").status_code == 200

    def test_a_sign_out_from_the_app_signs_out(self, client):
        assert client.post("/logout", headers=FROM_THE_APP).status_code == 200

        assert client.get("/check-session").status_code == 401

    def test_the_refusal_comes_before_the_sign_in_check(self):
        """A caller with no session is answered for its origin, not asked to sign in."""
        _assert_refused(app_module.app.test_client().post("/logout", headers=FROM_ANOTHER_SITE))


class TestUploadingAFloorplan:

    @pytest.fixture
    def stored(self, monkeypatch):
        """The market loads and the caller may edit it; what reaches the image store is recorded."""
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(stored_market()),
        )
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        images = []

        def upload_image(data, filename, market_id):
            images.append(filename)
            return "image-1"

        monkeypatch.setattr(FloorplansApi, "upload_image", upload_image)
        return images

    def _upload(self, client, headers):
        return client.post(
            "/floorplans/upload",
            data={
                "market_id": "market-123",
                "file": (io.BytesIO(b"\x89PNG\r\n\x1a\n"), "hall.png", "image/png"),
            },
            content_type="multipart/form-data",
            headers=headers,
        )

    def test_an_upload_from_another_site_is_refused_and_stores_nothing(self, client, stored):
        _assert_refused(self._upload(client, FROM_ANOTHER_SITE))

        assert stored == []

    def test_an_upload_from_the_app_is_stored(self, client, stored):
        response = self._upload(client, FROM_THE_APP)

        assert response.status_code == 201
        assert stored == ["hall.png"]


class TestReads:

    def test_a_read_from_another_site_passes(self, client):
        response = client.get("/check-session", headers=FROM_ANOTHER_SITE)

        assert response.status_code == 200

    def test_a_preflight_from_the_app_is_answered_by_cors(self, client):
        response = client.options("/logout", headers={
            "Origin": APP_ORIGIN,
            "Sec-Fetch-Site": "same-site",
            "Access-Control-Request-Method": "POST",
        })

        assert response.status_code == 200
        assert response.headers.get("Access-Control-Allow-Origin") == APP_ORIGIN
