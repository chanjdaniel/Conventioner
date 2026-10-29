"""Every floorplan action is checked against the role the caller holds on the floorplan's market.

A floorplan image belongs to the market it was uploaded for: the upload names the market, needs an
editor of it on a market that can still change, and the stored image remembers the market in its
GridFS metadata, so every later action on the image can be checked against that market.
"""
import io
from types import SimpleNamespace

import pytest
from bson import ObjectId
from gridfs.errors import NoFile
from PIL import Image

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.floorplans as FloorplansApi
import api.floorplans_analysis as FloorplansAnalysisApi
import api.floorplans_placement as FloorplansPlacementApi
import api.market_actions as Actions
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


def _hall_png():
    """A small real image, so calibrate and export can read its size and draw on it."""
    out = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(out, format="PNG")
    return out.getvalue()


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

    def get(self, file_id):
        stored = self.files.get(file_id)
        if stored is None:
            raise NoFile(file_id)
        return SimpleNamespace(read=lambda: stored["data"])

    def delete(self, file_id):
        if file_id not in self.files:
            raise NoFile(file_id)
        del self.files[file_id]

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
        ("outsider@example.com", Actions.refusal_sentence(Actions.CHANGE_SETUP)),
        ("viewer@example.com", Actions.refusal_sentence(Actions.CHANGE_SETUP)),
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


# ── The routes that take an image id ─────────────────────────────────────────


@pytest.fixture
def hall(images):
    """The id of the market's floorplan image, uploaded for it."""
    return str(images.put(_hall_png(), filename="hall.png", metadata={"marketId": MARKET_ID}))


@pytest.fixture
def model_calls(monkeypatch):
    """The analysis model's calls, faked, with a placeholder key so the route reaches the model."""
    calls = []
    monkeypatch.setenv("GEMINI_API_KEY", "placeholder-key")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def analysed(image_bytes):
        calls.append(image_bytes)
        return {"walls": [], "obstacles": [], "rooms": []}

    monkeypatch.setattr(FloorplansAnalysisApi, "_call_gemini", analysed)
    return calls


def _delete(client, gridfs_id):
    return client.delete(f"/floorplans/{gridfs_id}")


def _analyze(client, gridfs_id):
    return client.post("/floorplans/analyze", json={"gridfs_id": gridfs_id})


def _calibrate(client, gridfs_id):
    return client.post("/floorplans/calibrate", json={
        "gridfs_id": gridfs_id,
        "reference_line": {"start_x": 100, "start_y": 150, "end_x": 300, "end_y": 150},
        "length_mm": 4000,
    })


def _export(client, gridfs_id):
    return client.post("/floorplans/export", json={
        "gridfs_id": gridfs_id,
        "placed_tables": [{
            "x_mm": 2000, "y_mm": 1500, "rotation": 0, "width_mm": 1800, "height_mm": 800,
            "table_code": "A1", "section_name": "A",
        }],
        "scale_px_per_mm": 0.05,
    })


EDITING_ROUTES = {"delete": _delete, "analyze": _analyze, "calibrate": _calibrate}
EVERY_ROUTE = {**EDITING_ROUTES, "export": _export}


class TestTheRoutesThatTakeAnImage:
    """Delete, analyze and calibrate are an editor's work; export is open to anyone on the market."""

    def test_the_organizer_deletes_the_image(self, sign_in, market, hall, images):
        response = _delete(sign_in("owner@example.com"), hall)

        assert response.status_code == 200
        assert images.files == {}

    def test_the_organizer_analyzes_the_image(self, sign_in, market, hall, model_calls):
        response = _analyze(sign_in("owner@example.com"), hall)

        assert response.status_code == 200
        assert response.get_json() == {"walls": [], "obstacles": [], "rooms": []}
        assert len(model_calls) == 1

    def test_the_organizer_calibrates_the_image(self, sign_in, market, hall):
        response = _calibrate(sign_in("owner@example.com"), hall)

        assert response.status_code == 200
        assert response.get_json()["scale_px_per_mm"] == pytest.approx(200 / 4000)

    @pytest.mark.parametrize("email", [
        "owner@example.com", "editor@example.com", "viewer@example.com",
    ])
    def test_anyone_on_the_market_exports_the_image(self, sign_in, market, hall, email):
        response = _export(sign_in(email), hall)

        assert response.status_code == 200
        assert response.mimetype == "image/png"

    @pytest.mark.parametrize("route", EDITING_ROUTES.values(), ids=EDITING_ROUTES.keys())
    def test_an_editor_may_use_the_editing_routes(
        self, sign_in, market, hall, model_calls, route,
    ):
        assert route(sign_in("editor@example.com"), hall).status_code == 200

    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_account_with_no_role_on_the_market_is_refused(
        self, sign_in, market, hall, images, model_calls, route,
    ):
        response = route(sign_in("outsider@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json()["error"] in {
            Actions.refusal_sentence(Actions.READ), Actions.refusal_sentence(Actions.CHANGE_SETUP),
        }
        assert list(images.files) == [ObjectId(hall)]
        assert model_calls == []

    @pytest.mark.parametrize("route", EDITING_ROUTES.values(), ids=EDITING_ROUTES.keys())
    def test_a_viewer_is_refused_the_editing_routes(
        self, sign_in, market, hall, images, model_calls, route,
    ):
        response = route(sign_in("viewer@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
        assert list(images.files) == [ObjectId(hall)]
        assert model_calls == []

    @pytest.mark.parametrize("route", EDITING_ROUTES.values(), ids=EDITING_ROUTES.keys())
    def test_an_archived_market_refuses_the_editing_routes(
        self, sign_in, market, hall, images, model_calls, route,
    ):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = route(sign_in("owner@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert list(images.files) == [ObjectId(hall)]
        assert model_calls == []

    def test_an_archived_market_still_exports(self, sign_in, market, hall):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _export(sign_in("viewer@example.com"), hall)

        assert response.status_code == 200
        assert response.mimetype == "image/png"

    @pytest.mark.parametrize("metadata", [None, {}])
    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_image_that_names_no_market_is_not_found(
        self, sign_in, market, images, model_calls, route, metadata,
    ):
        unowned = images.put(_hall_png(), filename="hall.png", metadata=metadata)

        response = route(sign_in("owner@example.com"), str(unowned))

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}
        assert list(images.files) == [unowned]
        assert model_calls == []

    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_unknown_image_is_not_found(self, sign_in, market, images, model_calls, route):
        response = route(sign_in("owner@example.com"), str(ObjectId()))

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}

    @pytest.mark.parametrize("route", [_calibrate, _export], ids=["calibrate", "export"])
    def test_an_image_id_that_is_not_a_string_is_refused(self, sign_in, market, hall, route):
        response = route(sign_in("owner@example.com"), {"$ne": None})

        assert response.status_code == 400
        assert response.get_json() == {"error": "gridfs_id (string) is required"}

    def test_the_image_is_checked_before_the_rest_of_the_body(self, sign_in, market, hall):
        """A caller with no role on the market learns nothing about what calibrate accepts."""
        response = sign_in("outsider@example.com").post(
            "/floorplans/calibrate", json={"gridfs_id": hall},
        )

        assert response.status_code == 403

    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_a_route_without_a_session_is_asked_to_sign_in(
        self, market, hall, images, model_calls, route,
    ):
        response = route(app_module.app.test_client(), hall)

        assert response.status_code == 401
        assert list(images.files) == [ObjectId(hall)]
        assert model_calls == []

    def test_the_image_itself_is_read_without_a_session(self, hall):
        response = app_module.app.test_client().get(f"/floorplans/{hall}")

        assert response.status_code == 200
        assert response.data == _hall_png()


# ── Auto-Place, which names its market ───────────────────────────────────────


@pytest.fixture
def placements(monkeypatch):
    """The placement service's calls, faked: each places one table of the first type."""
    calls = []

    def placed(**geometry):
        calls.append(geometry)
        return [{
            "x_mm": 1500.0, "y_mm": 1500.0, "rotation": 0.0, "width_mm": 1800, "height_mm": 900,
            "table_type_id": "type_6ft",
        }]

    monkeypatch.setattr(FloorplansPlacementApi, "auto_place_tables", placed)
    return calls


def _place(client, *, market_id=MARKET_ID):
    body = {
        "walls": [],
        "obstacles": [],
        "table_types": [{
            "id": "type_6ft", "name": "6ft Table", "width_mm": 1800, "height_mm": 900,
            "max_capacity": 2,
        }],
        "counts": {"type_6ft": 1},
        "scale_px_per_mm": 0.05,
        "room_mm": {"width_mm": 8000, "height_mm": 6000},
    }
    if market_id is not None:
        body["market_id"] = market_id
    return client.post("/floorplans/place-tables", json=body)


class TestPlacingTables:
    """Auto-Place is an editor's work on the market it names, while the market can still change."""

    @pytest.mark.parametrize("email", ["owner@example.com", "editor@example.com"])
    def test_an_editor_places_tables(self, sign_in, market, placements, email):
        response = _place(sign_in(email))

        assert response.status_code == 200
        assert [t["table_type_id"] for t in response.get_json()["placed_tables"]] == ["type_6ft"]
        assert len(placements) == 1

    @pytest.mark.parametrize("email", ["outsider@example.com", "viewer@example.com"])
    def test_anyone_but_an_editor_is_refused(self, sign_in, market, placements, email):
        response = _place(sign_in(email))

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.ASSIGN)}
        assert placements == []

    def test_an_archived_market_is_refused(self, sign_in, market, placements):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _place(sign_in("owner@example.com"))

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert placements == []

    @pytest.mark.parametrize("market_id", [None, "", 42, {"$ne": None}, ["market-123"]])
    def test_a_request_that_names_no_market_is_refused(
        self, sign_in, market, placements, market_id,
    ):
        response = _place(sign_in("owner@example.com"), market_id=market_id)

        assert response.status_code == 400
        assert response.get_json() == {"error": "market_id is required"}
        assert placements == []

    def test_an_unknown_market_is_not_found(self, sign_in, market, placements):
        response = _place(sign_in("owner@example.com"), market_id="market-unknown")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}
        assert placements == []

    def test_the_market_is_checked_before_the_geometry(self, sign_in, market, placements):
        """A caller with no role on the market learns nothing about what the route accepts."""
        response = sign_in("outsider@example.com").post(
            "/floorplans/place-tables", json={"market_id": MARKET_ID},
        )

        assert response.status_code == 403

    def test_a_request_without_a_session_is_asked_to_sign_in(self, market, placements):
        response = _place(app_module.app.test_client())

        assert response.status_code == 401
        assert placements == []


# ── Every floorplan route but the image read needs a sign-in ─────────────────

FLOORPLAN_BLUEPRINTS = {
    "floorplans", "floorplans_placement", "floorplans_templates", "floorplans_analysis",
    "floorplans_calibrate", "floorplans_export", "floorplans_save",
}
PUBLIC_ROUTES = {("GET", "/floorplans/<gridfs_id>")}


def _floorplan_routes():
    """Each (method, rule) the floorplan blueprints register, as the app serves them."""
    return sorted(
        ((method, rule) for rule in app_module.app.url_map.iter_rules()
         if rule.endpoint.partition(".")[0] in FLOORPLAN_BLUEPRINTS
         for method in rule.methods - {"HEAD", "OPTIONS"}),
        key=lambda route: (route[1].rule, route[0]),
    )


class TestEveryFloorplanRouteNeedsASignIn:
    """The regression guard: a floorplan route without ``@login_required`` fails here, new or old.

    It asks each registered route without a session, so it also catches a decorator in the wrong
    order, which a route's source would still show.
    """

    def test_the_floorplan_blueprints_are_all_registered(self):
        registered = {endpoint.partition(".")[0] for endpoint in app_module.app.view_functions}

        assert FLOORPLAN_BLUEPRINTS <= registered

    def test_every_route_but_the_image_read_asks_for_a_sign_in(self, market, images):
        client = app_module.app.test_client()
        open_routes = []
        for method, rule in _floorplan_routes():
            if (method, rule.rule) in PUBLIC_ROUTES:
                continue
            values = {arg: str(ObjectId()) for arg in rule.arguments}
            path = rule.build(values, append_unknown=False)[1]
            if client.open(path, method=method, json={}).status_code != 401:
                open_routes.append(f"{method} {rule.rule}")

        assert open_routes == [], (
            f"These floorplan routes answer without a sign-in: {', '.join(open_routes)}. "
            "Give each @login_required, under its @route."
        )

    def test_the_public_image_read_is_still_served(self):
        """The exemption names a route that exists, so it cannot outlive the route it excused."""
        served = {(method, rule.rule) for method, rule in _floorplan_routes()}

        assert PUBLIC_ROUTES <= served
