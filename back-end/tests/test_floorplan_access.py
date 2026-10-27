"""Every floorplan action is checked against the role the caller holds on the floorplan's market.

A floorplan image belongs to the market it was uploaded for: the upload names the market, needs an
editor of it on a market that can still change, and the stored image remembers the market in its
GridFS metadata, so every later action on the image can be checked against that market.
"""
import io
from types import SimpleNamespace

import pytest
from bson import ObjectId

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.floorplans as FloorplansApi
import api.markets as MarketsApi
import api.users as UsersApi
import services.gridfs_service as GridfsService
from datatypes import MarketPhase

MARKET_ID = "market-123"
ACCOUNTS = {
    "owner@example.com": "user-owner",
    "editor@example.com": "user-editor",
    "viewer@example.com": "user-viewer",
    "outsider@example.com": "user-outsider",
}
ROLES = {"user-owner": "owner", "user-editor": "editor", "user-viewer": "viewer"}

PNG = b"\x89PNG\r\n\x1a\n"


class FakeGridFS:
    """The floorplan image store, holding each file's bytes, name and metadata as GridFS does."""

    def __init__(self):
        self.files = {}

    def put(self, data, filename=None, metadata=None):
        file_id = ObjectId()
        self.files[file_id] = {"data": data, "filename": filename, "metadata": metadata}
        return file_id

    def find_one(self, file_filter):
        stored = self.files.get(file_filter.get("_id"))
        if stored is None:
            return None
        return SimpleNamespace(_id=file_filter["_id"], **stored)

    def metadata_of(self, gridfs_id):
        return self.files[ObjectId(gridfs_id)]["metadata"]


@pytest.fixture
def images(monkeypatch):
    store = FakeGridFS()
    monkeypatch.setattr(GridfsService, "_fs", store)
    return store


@pytest.fixture
def market(monkeypatch):
    """The market every request names; a test changes its phase through ``.doc``."""
    markets = FakeMarketsCollection(stored_market(MarketPhase.DRAFT, roles=dict(ROLES)))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    return markets


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def sign_in(monkeypatch):
    """A client signed in as one of the accounts (the suite's origin list is the loopback pattern)."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _account)

    def signed_in(email):
        client = app_module.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = email
            session["_fresh"] = True
        return client

    return signed_in


def _upload(client, *, market_id=MARKET_ID, file=None, headers=None):
    data = {"file": file or (io.BytesIO(PNG), "hall.png", "image/png")}
    if market_id is not None:
        data["market_id"] = market_id
    return client.post(
        "/floorplans/upload", data=data, content_type="multipart/form-data", headers=headers or {},
    )


class TestUploadingAnImage:

    @pytest.mark.parametrize("email", ["owner@example.com", "editor@example.com"])
    def test_an_editor_upload_is_stored_for_its_market(self, sign_in, market, images, email):
        response = _upload(sign_in(email))

        assert response.status_code == 201
        gridfs_id = response.get_json()["gridfs_id"]
        assert images.metadata_of(gridfs_id) == {"marketId": MARKET_ID}
        assert GridfsService.get_image_market_id(gridfs_id) == MARKET_ID

    def test_each_page_of_a_pdf_is_stored_for_its_market(
        self, sign_in, market, images, monkeypatch,
    ):
        monkeypatch.setattr(FloorplansApi, "pdf_to_images", lambda _pdf: [PNG, PNG, PNG])

        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(b"%PDF-1.4"), "hall.pdf", "application/pdf"),
        )

        assert response.status_code == 201
        pages = response.get_json()["pages"]
        assert len(pages) == 3
        for page in pages:
            assert images.metadata_of(page["gridfs_id"]) == {"marketId": MARKET_ID}

    @pytest.mark.parametrize("email,error", [
        ("outsider@example.com", "User does not have permission to edit this market"),
        ("viewer@example.com", "User does not have permission to edit this market"),
    ])
    def test_an_upload_by_anyone_but_an_editor_is_refused_and_stores_nothing(
        self, sign_in, market, images, email, error,
    ):
        response = _upload(sign_in(email))

        assert response.status_code == 403
        assert response.get_json() == {"error": error}
        assert images.files == {}

    def test_an_upload_to_an_archived_market_is_refused_and_stores_nothing(
        self, sign_in, market, images,
    ):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _upload(sign_in("owner@example.com"))

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert images.files == {}

    @pytest.mark.parametrize("market_id", [None, ""])
    def test_an_upload_that_names_no_market_is_refused(self, sign_in, market, images, market_id):
        response = _upload(sign_in("owner@example.com"), market_id=market_id)

        assert response.status_code == 400
        assert response.get_json() == {"error": "market_id is required"}
        assert images.files == {}

    def test_an_upload_for_an_unknown_market_is_not_found(self, sign_in, market, images):
        response = _upload(sign_in("owner@example.com"), market_id="market-unknown")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}
        assert images.files == {}

    def test_the_market_is_checked_before_the_file(self, sign_in, market, images):
        """A caller with no role on the market learns nothing about what the route accepts."""
        response = _upload(
            sign_in("outsider@example.com"),
            file=(io.BytesIO(b"text"), "notes.txt", "text/plain"),
        )

        assert response.status_code == 403

    def test_an_upload_without_a_session_is_asked_to_sign_in(self, market, images):
        response = _upload(app_module.app.test_client())

        assert response.status_code == 401
        assert images.files == {}


class TestAnImagesMarket:
    """What the store says about the market an image belongs to."""

    def test_an_unknown_or_malformed_id_names_no_market(self, images):
        assert GridfsService.get_image_market_id(str(ObjectId())) is None
        assert GridfsService.get_image_market_id("not-an-object-id") is None

    @pytest.mark.parametrize("metadata", [None, {}, {"marketId": 42}, {"marketId": ""}])
    def test_an_image_stored_without_a_market_names_none(self, images, metadata):
        file_id = images.put(PNG, filename="hall.png", metadata=metadata)

        assert GridfsService.get_image_market_id(str(file_id)) is None
