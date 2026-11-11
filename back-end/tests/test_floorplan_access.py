"""Every floorplan action is checked against the role the caller holds on the floorplan's market.

A floorplan image belongs to the market it was uploaded for: the upload names the market, needs an
editor of it on a market that can still change, and the stored image remembers the market in its
GridFS metadata, so every later action on the image can be checked against that market.
"""
import io
import json
import sys
from types import SimpleNamespace

import pytest
from bson import ObjectId
from PIL import Image

from conftest import (
    FakeGridFS,
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.floorplans as FloorplansApi
import floorplan_limits as Limits
import utils.pdf_converter as PdfConverter
import api.floorplans_placement as FloorplansPlacementApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.users as UsersApi
import services.gridfs_service as GridfsService
import services.placement_service as Placement
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


def _one_page_pdf() -> bytes:
    """A real one-page PDF, a plan's outline drawn as one rectangle, built here so the suite holds
    no binary fixture."""
    return _pdf(pages=1)


def _pdf(*, pages: int) -> bytes:
    """A real PDF of ``pages`` pages, each a plan's outline drawn as one rectangle. Its
    cross-reference table is written with each object's true offset, so a strict reader takes it
    as it is."""
    content = b"4 w 72 72 451 698 re S"
    kids = b" ".join(b"%d 0 R" % (4 + page) for page in range(pages))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, pages),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ] + [
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 3 0 R /Resources << >> >>"
    ] * pages
    pdf = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(pdf)
    pdf += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    pdf += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return pdf


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
        monkeypatch.setattr(FloorplansApi, "pdf_to_images", lambda _pdf, **_k: [PNG, PNG, PNG])

        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(b"%PDF-1.4"), "hall.pdf", "application/pdf"),
        )

        assert response.status_code == 201
        pages = response.get_json()["pages"]
        assert len(pages) == 3
        for page in pages:
            assert images.metadata_of(page["gridfs_id"]) == {"marketId": MARKET_ID}

    def test_a_real_pdf_is_drawn_as_its_page_and_stored(self, sign_in, market, images, monkeypatch):
        """The zone offers PDF, so a real one is converted, with nothing stood in for the conversion
        and no program on the PATH: production's Vercel function has no system package to run, and
        a converter that ran poppler's tools answered every PDF there with a 500."""
        monkeypatch.setenv("PATH", "")
        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(_one_page_pdf()), "hall.pdf", "application/pdf"),
        )

        assert response.status_code == 201, response.get_json()
        (page,) = response.get_json()["pages"]
        assert images.metadata_of(page["gridfs_id"]) == {"marketId": MARKET_ID}
        # A4 (595 by 842 points) at the converter's 200 dpi, within a pixel of the exact edge.
        assert abs(page["width"] - 595 * 200 / 72) <= 1
        assert abs(page["height"] - 842 * 200 / 72) <= 1
        # The page is drawn, not just sized: white paper, with the outline's left edge (72 points
        # in, 200 pixels at 200 dpi) black.
        drawn = Image.open(io.BytesIO(images.files[ObjectId(page["gridfs_id"])]["data"]))
        assert drawn.convert("RGB").getpixel((800, 1000)) == (255, 255, 255)
        assert drawn.convert("RGB").getpixel((200, 1000)) == (0, 0, 0)

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


class TestAnUploadIsHeldToItsLimits:
    """An upload larger than production's functions take, a PDF of too many pages, and a PDF that
    cannot be read are each refused with a sentence the organizer can act on (T257), never a 500."""

    def test_a_file_larger_than_the_limit_is_refused_by_its_length_before_it_is_read(
        self, sign_in, market, images, monkeypatch,
    ):
        read = []
        monkeypatch.setattr(FloorplansApi, "market_refusal", lambda *a, **k: read.append(1))
        big = b"\x89PNG\r\n\x1a\n" + b"\0" * (
            Limits.MAX_UPLOAD_BYTES + Limits.UPLOAD_FORM_ALLOWANCE_BYTES)

        response = _upload(
            sign_in("owner@example.com"), file=(io.BytesIO(big), "hall.png", "image/png"),
        )

        assert response.status_code == 413
        assert response.get_json() == {"error": "This file is larger than 4 MB."}
        assert read == [], "the body was read, the market asked, before the length refused it"
        assert images.files == {}

    def test_a_file_just_over_the_limit_is_refused_once_read(self, sign_in, market, images):
        """Within the form's allowance the length cannot tell the file's bytes from the form's, so
        the file's own length refuses it."""
        over = b"\x89PNG\r\n\x1a\n" + b"\0" * (Limits.MAX_UPLOAD_BYTES - 7)

        response = _upload(
            sign_in("owner@example.com"), file=(io.BytesIO(over), "hall.png", "image/png"),
        )

        assert response.status_code == 413
        assert response.get_json() == {"error": "This file is larger than 4 MB."}
        assert images.files == {}

    def test_a_file_at_the_limit_is_taken(self, sign_in, market, images):
        """The limit is the file's: the form's own bytes around it are not held against it."""
        exact = b"\x89PNG\r\n\x1a\n" + b"\0" * (Limits.MAX_UPLOAD_BYTES - 8)

        response = _upload(
            sign_in("owner@example.com"), file=(io.BytesIO(exact), "hall.png", "image/png"),
        )

        assert response.status_code == 201

    def test_a_pdf_of_more_pages_than_the_limit_is_refused(self, sign_in, market, images):
        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(_pdf(pages=Limits.MAX_PDF_PAGES + 1)), "hall.pdf", "application/pdf"),
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "This PDF has more than 20 pages. Send the page with the plan on it.",
        }
        assert images.files == {}

    def test_a_pdf_of_the_limit_is_taken(self, sign_in, market, images, monkeypatch):
        monkeypatch.setattr(FloorplansApi, "pdf_to_images", lambda _pdf, **_k: [PNG])

        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(_pdf(pages=Limits.MAX_PDF_PAGES)), "hall.pdf", "application/pdf"),
        )

        assert response.status_code == 201

    @pytest.mark.parametrize("damaged", [
        b"%PDF-1.4\nthis is no PDF at all",
        b" ",
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog",
    ])
    def test_a_damaged_pdf_is_refused_naming_the_file(self, sign_in, market, images, damaged):
        response = _upload(
            sign_in("owner@example.com"),
            file=(io.BytesIO(damaged), "Venue plan.pdf", "application/pdf"),
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Venue plan.pdf could not be read as a PDF."}
        assert images.files == {}


class TestThePdfConverter:
    """The converter says why a PDF gave no pages rather than answering an empty list, which the
    route could only read as a server error."""

    def test_a_pdf_it_cannot_open_raises(self):
        with pytest.raises(PdfConverter.UnreadablePdf):
            PdfConverter.pdf_to_images(b"%PDF-1.4 broken")

    def test_empty_bytes_raise(self):
        with pytest.raises(PdfConverter.UnreadablePdf):
            PdfConverter.pdf_to_images(b"")

    def test_a_pdf_of_more_pages_than_asked_raises(self):
        with pytest.raises(PdfConverter.TooManyPages):
            PdfConverter.pdf_to_images(_pdf(pages=3), max_pages=2)

    def test_each_page_is_drawn(self):
        assert len(PdfConverter.pdf_to_images(_pdf(pages=2), max_pages=2)) == 2


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


def _delete(client, gridfs_id):
    return client.delete(f"/floorplans/{gridfs_id}")


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


EDITING_ROUTES = {"delete": _delete, "calibrate": _calibrate}
EVERY_ROUTE = {**EDITING_ROUTES, "export": _export}


class TestTheRoutesThatTakeAnImage:
    """Delete and calibrate are an editor's work; export is open to anyone on the market."""

    def test_the_organizer_deletes_the_image(self, sign_in, market, hall, images):
        response = _delete(sign_in("owner@example.com"), hall)

        assert response.status_code == 200
        assert images.files == {}

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
        self, sign_in, market, hall, route,
    ):
        assert route(sign_in("editor@example.com"), hall).status_code == 200

    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_account_with_no_role_on_the_market_is_refused(
        self, sign_in, market, hall, images, route,
    ):
        response = route(sign_in("outsider@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json()["error"] in {
            Actions.refusal_sentence(Actions.READ), Actions.refusal_sentence(Actions.CHANGE_SETUP),
        }
        assert list(images.files) == [ObjectId(hall)]

    @pytest.mark.parametrize("route", EDITING_ROUTES.values(), ids=EDITING_ROUTES.keys())
    def test_a_viewer_is_refused_the_editing_routes(
        self, sign_in, market, hall, images, route,
    ):
        response = route(sign_in("viewer@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
        assert list(images.files) == [ObjectId(hall)]

    @pytest.mark.parametrize("route", EDITING_ROUTES.values(), ids=EDITING_ROUTES.keys())
    def test_an_archived_market_refuses_the_editing_routes(
        self, sign_in, market, hall, images, route,
    ):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = route(sign_in("owner@example.com"), hall)

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert list(images.files) == [ObjectId(hall)]

    def test_an_archived_market_still_exports(self, sign_in, market, hall):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _export(sign_in("viewer@example.com"), hall)

        assert response.status_code == 200
        assert response.mimetype == "image/png"

    @pytest.mark.parametrize("metadata", [None, {}])
    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_image_that_names_no_market_is_not_found(
        self, sign_in, market, images, route, metadata,
    ):
        unowned = images.put(_hall_png(), filename="hall.png", metadata=metadata)

        response = route(sign_in("owner@example.com"), str(unowned))

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}
        assert list(images.files) == [unowned]

    @pytest.mark.parametrize("route", EVERY_ROUTE.values(), ids=EVERY_ROUTE.keys())
    def test_an_unknown_image_is_not_found(self, sign_in, market, images, route):
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
        self, market, hall, images, route,
    ):
        response = route(app_module.app.test_client(), hall)

        assert response.status_code == 401
        assert list(images.files) == [ObjectId(hall)]


def _read(client, gridfs_id):
    return client.get(f"/floorplans/{gridfs_id}")


class TestReadingTheImage:
    """The image is read on the market it was uploaded for: anyone with a role on it reads the
    bytes, an archived market's too, and to anyone else the image is not there."""

    @pytest.mark.parametrize("email", [
        "owner@example.com", "editor@example.com", "viewer@example.com",
    ])
    def test_anyone_on_the_market_reads_the_image(self, sign_in, market, hall, email):
        response = _read(sign_in(email), hall)

        assert response.status_code == 200
        assert response.mimetype == "image/png"
        assert response.data == _hall_png()

    def test_an_archived_markets_image_is_still_read(self, sign_in, market, hall):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _read(sign_in("viewer@example.com"), hall)

        assert response.status_code == 200
        assert response.data == _hall_png()

    def test_a_read_without_a_session_is_asked_to_sign_in(self, market, hall):
        response = _read(app_module.app.test_client(), hall)

        assert response.status_code == 401
        assert response.data != _hall_png()

    def test_an_account_with_no_role_on_the_market_finds_no_image(self, sign_in, market, hall):
        response = _read(sign_in("outsider@example.com"), hall)

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}

    @pytest.mark.parametrize("metadata", [None, {}])
    def test_an_image_that_names_no_market_is_not_found(self, sign_in, market, images, metadata):
        unowned = images.put(_hall_png(), filename="hall.png", metadata=metadata)

        response = _read(sign_in("owner@example.com"), str(unowned))

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}

    @pytest.mark.parametrize("gridfs_id", [str(ObjectId()), "not-an-object-id"],
                             ids=["unknown", "malformed"])
    def test_an_unknown_image_is_not_found(self, sign_in, market, images, gridfs_id):
        response = _read(sign_in("owner@example.com"), gridfs_id)

        assert response.status_code == 404
        assert response.get_json() == {"error": "Image not found"}


class TestNoModelReadsAFloorplan:
    """The vision endpoint, which sent a floorplan image to a hosted model, is gone: no screen called it."""

    def test_an_editors_analysis_request_is_not_served(self, sign_in, market, hall):
        """The address now reads as an image id, whose route takes no POST, so it answers 405."""
        response = sign_in("editor@example.com").post(
            "/floorplans/analyze", json={"gridfs_id": hall},
        )

        assert response.status_code == 405

    def test_no_analysis_blueprint_is_registered(self):
        assert "floorplans_analysis" not in app_module.app.blueprints


# ── Auto-Place, which names its market ───────────────────────────────────────


@pytest.fixture
def placements(monkeypatch):
    """The placement service's calls, faked: each places one table of the first type."""
    calls = []

    def placed(**geometry):
        calls.append(geometry)
        return Placement.PlacementResult(placed=[{
            "x_mm": 1500.0, "y_mm": 1500.0, "rotation": 0.0, "width_mm": 1800, "height_mm": 900,
            "table_type_id": "type_6ft",
        }], timed_out=False)

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
        assert response.get_json()["timed_out"] is False
        assert len(placements) == 1

    def test_the_answer_says_when_the_grid_ran_out_of_time(self, sign_in, market, monkeypatch):
        """On production's path, with no time to place anything, it answers so rather than blame the room."""
        monkeypatch.setitem(sys.modules, "pyckingsolver", None)
        monkeypatch.setattr(Placement, "GRID_TIME_LIMIT_S", 0.0)

        response = _place(sign_in("owner@example.com"))

        assert response.status_code == 200
        assert response.get_json() == {"placed_tables": [], "timed_out": True}

    @pytest.mark.parametrize("email", ["outsider@example.com", "viewer@example.com"])
    def test_anyone_but_an_editor_is_refused(self, sign_in, market, placements, email):
        response = _place(sign_in(email))

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
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


SIX_FOOT = {"id": "type_6ft", "name": "6ft Table", "width_mm": 1800, "height_mm": 900, "max_capacity": 2}
TOO_MANY_TABLES = "Auto-Place places up to 500 tables at a time."
TABLE_SIDES = "A table type's width and height must be between 100 mm and 20,000 mm."
ROOM_TOO_LARGE = "The room must be at most 500 m on each side."
AISLES = "The wall buffer and table spacing must be between 0 and 10,000 mm."
TOO_MUCH_GEOMETRY = "Auto-Place takes up to 100 walls, 100 obstacle zones and 100 points in each."
UNBOUNDED = "A floorplan's measurements must be finite numbers no larger than 10,000,000."


def _placement_body(**changes):
    body = {
        "market_id": MARKET_ID,
        "walls": [],
        "obstacles": [],
        "table_types": [dict(SIX_FOOT)],
        "counts": {"type_6ft": 1},
        "scale_px_per_mm": 0.05,
        "room_mm": {"width_mm": 8000, "height_mm": 6000},
        "aisle_config": {"wallBufferMm": 1500, "tableSpacingMm": 1200},
    }
    body.update(changes)
    return body


def _place_body(client, body):
    return client.post("/floorplans/place-tables", json=body)


def _place_raw(client, text):
    """Send a body as text, since no JSON library writes ``NaN`` or ``Infinity``, though Flask reads them."""
    return client.post("/floorplans/place-tables", data=text, content_type="application/json")


def _wall(n):
    return {"start": [n * 10, 0], "end": [n * 10 + 10, 0], "thickness_mm": 200, "is_exterior": True}


def _square_walls(side_mm):
    corners = [(0, 0), (side_mm, 0), (side_mm, side_mm), (0, side_mm)]
    return [
        {"start": list(corners[i]), "end": list(corners[(i + 1) % 4]), "thickness_mm": 200}
        for i in range(4)
    ]


def _zone(points):
    return {"polygon": [[i, i % 2] for i in range(points)], "type": "pillar"}


class TestAPlacementRequestIsBounded:
    """Auto-Place parses its body and holds it to ``floorplan_limits``' bounds before it places (T272).

    It read the body field by field and handed it to the service, so a wall missing its thickness or
    walls enclosing nothing answered "Internal server error", and any number of tables in any size of
    room held an instance for as long as the grid took.
    """

    @pytest.mark.parametrize("changes, sentence", [
        ({"counts": {"type_6ft": 501}}, TOO_MANY_TABLES),
        ({"table_types": [dict(SIX_FOOT), dict(SIX_FOOT, id="type_8ft")],
          "counts": {"type_6ft": 300, "type_8ft": 201}}, TOO_MANY_TABLES),
        ({"table_types": [dict(SIX_FOOT, width_mm=99.9)]}, TABLE_SIDES),
        ({"table_types": [dict(SIX_FOOT, height_mm=99)]}, TABLE_SIDES),
        ({"table_types": [dict(SIX_FOOT, width_mm=20001)]}, TABLE_SIDES),
        ({"table_types": [dict(SIX_FOOT, height_mm=20000.5)]}, TABLE_SIDES),
        ({"room_mm": {"width_mm": 500001, "height_mm": 6000}}, ROOM_TOO_LARGE),
        ({"room_mm": {"width_mm": 8000, "height_mm": 500001}}, ROOM_TOO_LARGE),
        ({"aisle_config": {"wallBufferMm": -1, "tableSpacingMm": 1200}}, AISLES),
        ({"aisle_config": {"wallBufferMm": 10001, "tableSpacingMm": 1200}}, AISLES),
        ({"aisle_config": {"wallBufferMm": 1500, "tableSpacingMm": -0.5}}, AISLES),
        ({"aisle_config": {"wallBufferMm": 1500, "tableSpacingMm": 10001}}, AISLES),
        ({"walls": [_wall(n) for n in range(101)]}, TOO_MUCH_GEOMETRY),
        ({"obstacles": [_zone(3) for _ in range(101)]}, TOO_MUCH_GEOMETRY),
        ({"obstacles": [_zone(3), _zone(101)]}, TOO_MUCH_GEOMETRY),
    ])
    def test_a_request_one_over_a_bound_is_refused_with_its_sentence(
        self, sign_in, market, placements, changes, sentence,
    ):
        response = _place_body(sign_in("owner@example.com"), _placement_body(**changes))

        assert response.status_code == 400
        assert response.get_json() == {"error": sentence}
        assert placements == []

    @pytest.mark.parametrize("changes", [
        {"counts": {"type_6ft": 500}},
        {"table_types": [dict(SIX_FOOT, width_mm=100, height_mm=20000)]},
        {"room_mm": {"width_mm": 500000, "height_mm": 500000}},
        {"aisle_config": {"wallBufferMm": 0, "tableSpacingMm": 10000}},
        {"aisle_config": {"wallBufferMm": 10000, "tableSpacingMm": 0}},
        {"walls": [_wall(n) for n in range(100)]},
        {"obstacles": [_zone(100) for _ in range(100)]},
    ])
    def test_a_request_at_every_bound_places(self, sign_in, market, placements, changes):
        response = _place_body(sign_in("owner@example.com"), _placement_body(**changes))

        assert response.status_code == 200
        assert len(placements) == 1

    def test_a_table_type_left_out_of_the_counts_is_one_table_toward_the_bound(
        self, sign_in, market, placements,
    ):
        """The service places one of a type the counts do not name, so the bound counts it too."""
        body = _placement_body(
            table_types=[dict(SIX_FOOT), dict(SIX_FOOT, id="type_8ft")], counts={"type_6ft": 500},
        )

        response = _place_body(sign_in("owner@example.com"), body)

        assert response.status_code == 400
        assert response.get_json() == {"error": TOO_MANY_TABLES}

    @pytest.mark.parametrize("changes, named", [
        ({"walls": [{"start": [0, 0], "end": [9000, 0], "is_exterior": True}]},
         "walls.0.thickness_mm: Field required"),
        ({"walls": "not a list"}, "walls: Input should be a valid list"),
        ({"obstacles": [{"polygon": [[0, 0], [1, 1], [0, 1]]}]}, "obstacles.0.type: Field required"),
        ({"table_types": [{"id": "type_6ft", "width_mm": 1800, "height_mm": 900,
                           "max_capacity": 2}]}, "table_types.0.name: Field required"),
        ({"counts": {"type_6ft": -1}}, "counts.type_6ft: Input should be greater than or equal to 0"),
        ({"counts": {"type_6ft": 1.5}}, "counts.type_6ft: Input should be a valid integer"),
        ({"counts": {"type_6ft": True}}, "counts.type_6ft: Input should be a valid integer"),
        ({"counts": {"type_6ft": "3"}}, "counts.type_6ft: Input should be a valid integer"),
        ({"counts": [1]}, "counts: Input should be a valid dictionary"),
        ({"scale_px_per_mm": "wide"}, "scale_px_per_mm: Input should be a valid number"),
        ({"room_mm": {"width_mm": 0, "height_mm": 6000}},
         "room_mm.width_mm: Input should be greater than 0"),
        ({"room_mm": {"width_mm": 8000}}, "room_mm.height_mm: Field required"),
        ({"aisle_config": {"wallBufferMm": "wide"}},
         "aisle_config.wallBufferMm: Input should be a valid number, unable to parse string as a "
         "number"),
    ])
    def test_a_malformed_field_is_refused_by_name(
        self, sign_in, market, placements, changes, named,
    ):
        response = _place_body(sign_in("owner@example.com"), _placement_body(**changes))

        assert response.status_code == 400
        assert response.get_json() == {"error": f"Invalid placement request: {named}"}
        assert placements == []

    @pytest.mark.parametrize("field", ["walls", "obstacles", "table_types", "counts",
                                       "scale_px_per_mm"])
    def test_a_missing_field_is_refused_by_name(self, sign_in, market, placements, field):
        body = _placement_body()
        del body[field]

        response = _place_body(sign_in("owner@example.com"), body)

        assert response.status_code == 400
        assert response.get_json() == {"error": f"Invalid placement request: {field}: Field required"}

    @pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
    @pytest.mark.parametrize("changes", [
        {"walls": [{"start": ["@@", 0], "end": [9000, 0], "thickness_mm": 200}]},
        {"walls": [{"start": [0, 0], "end": [9000, 0], "thickness_mm": "@@"}]},
        {"obstacles": [{"polygon": [[0, 0], [1, "@@"], [0, 1]], "type": "pillar"}]},
        {"table_types": [dict(SIX_FOOT, width_mm="@@")]},
        {"aisle_config": {"wallBufferMm": 1500, "tableSpacingMm": "@@"}},
    ])
    def test_a_number_that_is_not_finite_in_the_geometry_is_refused(
        self, sign_in, market, placements, token, changes,
    ):
        text = json.dumps(_placement_body(**changes)).replace('"@@"', token)

        response = _place_raw(sign_in("owner@example.com"), text)

        assert response.status_code == 400
        assert response.get_json() == {"error": UNBOUNDED}
        assert placements == []

    @pytest.mark.parametrize("token", ["NaN", "Infinity"])
    @pytest.mark.parametrize("changes, named", [
        ({"scale_px_per_mm": "@@"}, "scale_px_per_mm"),
        ({"room_mm": {"width_mm": "@@", "height_mm": 6000}}, "room_mm.width_mm"),
    ])
    def test_a_number_that_is_not_finite_in_the_request_is_refused_by_name(
        self, sign_in, market, placements, token, changes, named,
    ):
        text = json.dumps(_placement_body(**changes)).replace('"@@"', token)

        response = _place_raw(sign_in("owner@example.com"), text)

        assert response.status_code == 400
        assert response.get_json()["error"].startswith(f"Invalid placement request: {named}: ")
        assert placements == []

    def test_a_number_too_large_in_the_geometry_is_refused(self, sign_in, market, placements):
        body = _placement_body(walls=[{"start": [0, 0], "end": [10_000_001, 0], "thickness_mm": 200}])

        response = _place_body(sign_in("owner@example.com"), body)

        assert response.status_code == 400
        assert response.get_json() == {"error": UNBOUNDED}

    def test_a_request_with_neither_walls_nor_a_size_is_asked_to_calibrate(
        self, sign_in, market, placements,
    ):
        response = _place_body(sign_in("owner@example.com"), _placement_body(room_mm=None))

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "The floor plan's size is needed to place tables: calibrate it first, "
                     "or draw its walls.",
        }

    def test_a_body_that_is_not_an_object_is_refused(self, sign_in, market, placements):
        response = _place_raw(sign_in("owner@example.com"), "[1, 2]")

        assert response.status_code == 400
        assert placements == []

    # The real service from here: what it refuses reaches the organizer as its sentence.

    def test_walls_that_enclose_nothing_say_so(self, sign_in, market):
        walls = [
            {"start": [0, 0], "end": [10000, 0], "thickness_mm": 200},
            {"start": [10000, 0], "end": [20000, 0], "thickness_mm": 200},
        ]

        response = _place_body(sign_in("owner@example.com"), _placement_body(walls=walls, room_mm=None))

        assert response.status_code == 400
        assert response.get_json() == {"error": "The walls drawn do not enclose a room."}

    def test_walls_drawn_more_than_500_m_apart_are_refused(self, sign_in, market):
        response = _place_body(
            sign_in("owner@example.com"), _placement_body(walls=_square_walls(500_001), room_mm=None),
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": ROOM_TOO_LARGE}

    def test_walls_500_m_apart_are_a_room(self, sign_in, market, monkeypatch):
        monkeypatch.setitem(sys.modules, "pyckingsolver", None)

        response = _place_body(
            sign_in("owner@example.com"), _placement_body(walls=_square_walls(500_000), room_mm=None),
        )

        assert response.status_code == 200
        assert len(response.get_json()["placed_tables"]) == 1

    def test_the_organizers_wall_buffer_is_the_one_kept(self, sign_in, market, monkeypatch):
        """The wizard sends the aisle values camel-cased, and the service reads them, not its defaults."""
        monkeypatch.setitem(sys.modules, "pyckingsolver", None)
        body = _placement_body(
            room_mm={"width_mm": 20000, "height_mm": 20000}, counts={"type_6ft": 3},
            aisle_config={"wallBufferMm": 5000, "tableSpacingMm": 1200},
        )

        response = _place_body(sign_in("owner@example.com"), body)

        assert response.status_code == 200
        placed = response.get_json()["placed_tables"]
        assert len(placed) == 3
        for table in placed:
            half_w, half_h = table["width_mm"] / 2, table["height_mm"] / 2
            if table["rotation"] == 90:
                half_w, half_h = half_h, half_w
            assert 5000 - 1 <= table["x_mm"] - half_w and table["x_mm"] + half_w <= 15000 + 1
            assert 5000 - 1 <= table["y_mm"] - half_h and table["y_mm"] + half_h <= 15000 + 1


# ── Every floorplan route needs a sign-in ────────────────────────────────────

FLOORPLAN_BLUEPRINTS = {
    "floorplans", "floorplans_placement", "floorplans_templates", "floorplans_calibrate",
    "floorplans_export", "floorplans_save",
}


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

    def test_every_route_asks_for_a_sign_in(self, market, images):
        client = app_module.app.test_client()
        open_routes = []
        for method, rule in _floorplan_routes():
            values = {arg: str(ObjectId()) for arg in rule.arguments}
            path = rule.build(values, append_unknown=False)[1]
            if client.open(path, method=method, json={}).status_code != 401:
                open_routes.append(f"{method} {rule.rule}")

        assert open_routes == [], (
            f"These floorplan routes answer without a sign-in: {', '.join(open_routes)}. "
            "Give each @login_required, under its @route."
        )
