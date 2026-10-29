"""Exporting the market's vendors to a CSV (E42/F01/S01).

An organizer exports the vendors the Vendors page shows, choosing the columns, as a CSV for a Google
Sheet and YAMM. The file is built on the server from the same filters the dialog shows, so what is
exported is what the server holds; one row per vendor, the header the columns as named, UTF-8 with a
byte-order mark, and every cell of the applicant's own text written so a spreadsheet shows it as
text rather than running it.
"""
import csv
import io
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.vendor_export as VendorExport
import essential_fields as EF
from client_errors import BadRequestError, ForbiddenError
from datatypes import MarketPhase, MarketRole

PLAN = {
    "priority": [],
    "marketDates": [{"date": "2099-08-01"}, {"date": "2099-08-02"}],
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "locations": [{"name": "Nest"}],
    "sections": [
        {"name": "Atrium", "count": 4, "location": {"name": "Nest"},
         "tier": {"id": 0, "name": "Gold"}},
        {"name": "Hall", "count": 4, "location": {"name": "Nest"},
         "tier": {"id": 1, "name": "Silver"}},
    ],
    "assignmentOptions": {},
    "floorplans": [],
}

FORM = {
    "fields": [
        {"key": "business_name", "label": "Business name", "type": "text", "order": 1},
        {"key": "category", "label": "Category", "type": "select",
         "options": ["Crafts", "Food"], "order": 2},
        {"key": "tags", "label": "Tags", "type": "multi_select",
         "options": ["Vegan", "Local", "Handmade"], "order": 3},
        {"key": "student", "label": "UBC student", "type": "checkbox", "order": 4},
    ],
}


def _placed(email, date, table_code, section, tier, choice="Full Table"):
    return {
        "email": email, "date": date, "tableCode": table_code, "tableChoice": choice,
        "section": section, "tier": tier, "location": "Nest", "handPlaced": False,
    }


def _application(email, status, answers=None, **extra):
    return {
        "id": f"app-{email}", "market_id": "market-123", "applicant_email": email,
        "form_data": answers or {}, "status": status, "application_type": "main",
        "submitted_at": "2026-10-01T00:00:00Z", **extra,
    }


ADDED_BY = {"user_id": "user-editor", "email": "editor@market.test"}

APPLICATIONS = [
    _application("ana@example.com", "reviewer_approved", {
        EF.FULL_NAME_KEY: "Ana Lima", EF.PREFERRED_NAME_KEY: "Ana",
        "business_name": "=HYPERLINK(\"http://x.test\")", "category": "Crafts",
        "tags": ["Vegan", "Local"], "student": True,
    }),
    _application("ben@example.com", "reviewer_approved", {
        EF.FULL_NAME_KEY: "Ben Okafor", "business_name": "Ben's Buns", "category": "Food",
        "tags": ["Handmade"], "student": False,
    }),
    _application("cy@example.com", "reviewer_rejected", {
        EF.FULL_NAME_KEY: "Cy Tan", "category": "Food",
    }),
    _application("dee@example.com", "needs_follow_up", {EF.FULL_NAME_KEY: "Dee Park"}),
    _application("eve@example.com", "open", {EF.FULL_NAME_KEY: "Eve Moss"}),
    _application("fay@example.com", "reviewer_approved", {EF.FULL_NAME_KEY: "Fay Added"},
                 added_by=ADDED_BY, added_at="2099-08-02T09:00:00Z"),
]

PLACEMENTS = [
    _placed("ana@example.com", "2099-08-01", "Atrium 1", "Atrium", "Gold"),
    _placed("ana@example.com", "2099-08-02", "Hall 2", "Hall", "Silver"),
    _placed("fay@example.com", "2099-08-02", "Hall 1", "Hall", "Silver"),
]


@pytest.fixture
def market(monkeypatch, applications):
    """The market and its applications, read by a person holding ``role`` on it."""
    def holding(role=MarketRole.VIEWER, phase=MarketPhase.ASSIGNMENT, name="Fall Market"):
        doc = stored_market(
            phase, name=name, setupObject=PLAN, applicationForm=FORM,
            assignmentObject={"vendorAssignments": PLACEMENTS, "assignmentStatistics": None},
        )
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
        monkeypatch.setattr(MarketsApi, "_load_organization", lambda _org_id: None)
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        applications.documents = [dict(app) for app in APPLICATIONS]
        return doc
    return holding


def _preview(filters=None, columns=None):
    body = {"filters": filters or {}}
    if columns is not None:
        body["columns"] = columns
    result, status = VendorExport.preview("market-123", body, "viewer@market.test")
    assert status == 200
    return result


def _file(filters=None, columns=None):
    body = {"filters": filters or {}, "columns": columns or ["name", "email", "status"]}
    return VendorExport.export("market-123", body, "viewer@market.test")


def _rows(content: str):
    assert content.startswith("\ufeff")
    return list(csv.reader(io.StringIO(content[1:])))


def _emails(content: str, at=1):
    return [row[at] for row in _rows(content)[1:]]


class TestWhoMayExport:
    def test_a_viewer_may_export(self, market):
        market(MarketRole.VIEWER)

        content, _filename = _file()

        assert len(_rows(content)) == 1 + len(APPLICATIONS)

    def test_a_person_with_no_role_on_the_market_is_refused(self, market):
        market(None)

        with pytest.raises(ForbiddenError, match="export this market's CSV"):
            _file()
        with pytest.raises(ForbiddenError, match="export this market's CSV"):
            _preview()


class TestTheFile:
    def test_it_is_utf8_with_a_byte_order_mark_so_a_spreadsheet_reads_accents(
            self, market, applications):
        market()
        applications.documents[1]["form_data"] = {EF.FULL_NAME_KEY: "Benoît Éclair"}

        content, _filename = _file()

        assert content.startswith("\ufeff")
        assert ["Benoît Éclair", "ben@example.com", "Approved"] in _rows(content)

    def test_it_is_named_for_the_market_and_the_day(self, market, monkeypatch):
        market(name="Fall Market: Nest/2026")
        monkeypatch.setattr(VendorExport, "_today", lambda: "2026-10-29")

        _content, filename = _file()

        assert filename == "Fall_Market_Nest_2026_vendors_2026-10-29.csv"

    def test_it_is_named_for_the_organizers_day_when_the_dialog_sends_it(self, market):
        """Their evening is the server's tomorrow."""
        market()

        _content, filename = VendorExport.export("market-123", {
            "filters": {}, "columns": ["email"], "day": "2026-10-28"}, "viewer@market.test")

        assert filename == "Fall_Market_vendors_2026-10-28.csv"

    def test_a_day_that_is_not_a_day_is_the_servers(self, market, monkeypatch):
        market()
        monkeypatch.setattr(VendorExport, "_today", lambda: "2026-10-29")

        _content, filename = VendorExport.export("market-123", {
            "filters": {}, "columns": ["email"], "day": "../../etc"}, "viewer@market.test")

        assert filename == "Fall_Market_vendors_2026-10-29.csv"

    def test_a_question_that_reads_like_a_formula_heads_its_column_as_text(self, market):
        doc = market()
        doc["applicationForm"] = {"fields": [
            {"key": "total", "label": "=1+1", "type": "text", "order": 1}]}

        content, _filename = _file(columns=["answer:total"])

        assert _rows(content)[0] == ["'=1+1"]

    def test_the_header_is_the_columns_as_shown(self, market):
        market()

        content, _filename = _file(columns=[
            "name", "preferredName", "email", "status", "answer:business_name"])

        assert _rows(content)[0] == ["Name", "Preferred name", "Email", "Status", "Business name"]

    def test_columns_come_in_the_order_chosen(self, market):
        market()

        content, _filename = _file(
            filters={"search": "ana@"}, columns=["answer:category", "email", "name"])

        assert _rows(content) == [
            ["Category", "Email", "Name"],
            ["Crafts", "ana@example.com", "Ana Lima"],
        ]

    def test_a_multi_select_answer_is_one_cell_joined_by_commas(self, market):
        market()

        content, _filename = _file(
            filters={"search": "ana@"}, columns=["email", "answer:tags", "answer:student"])

        assert _rows(content)[1] == ["ana@example.com", "Vegan, Local", "Yes"]

    def test_a_cell_that_begins_like_a_formula_is_exported_as_text(self, market):
        market()

        content, _filename = _file(
            filters={"search": "ana@"}, columns=["answer:business_name"])

        assert _rows(content)[1] == ["'=HYPERLINK(\"http://x.test\")"]

    @pytest.mark.parametrize("lead", ["=", "+", "-", "@"])
    def test_every_formula_lead_is_escaped(self, market, applications, lead):
        market()
        applications.documents[0]["form_data"]["business_name"] = f"{lead}1+1"

        content, _filename = _file(filters={"search": "ana@"}, columns=["answer:business_name"])

        assert _rows(content)[1] == [f"'{lead}1+1"]

    def test_a_status_is_in_the_organizers_words(self, market):
        market()

        content, _filename = _file(columns=["email", "status"])

        assert dict(_rows(content)[1:]) == {
            "ana@example.com": "Approved",
            "ben@example.com": "Approved",
            "cy@example.com": "Rejected",
            "dee@example.com": "Needs follow-up",
            "eve@example.com": "Open",
            "fay@example.com": "Added by hand",
        }

    def test_an_unanswered_question_is_a_blank_cell(self, market):
        market()

        content, _filename = _file(filters={"search": "eve@"}, columns=["email", "answer:tags"])

        assert _rows(content)[1] == ["eve@example.com", ""]


def _date_columns(date):
    return [f"date:{date}:{part}" for part in ("table", "section", "tier", "size")]


class TestTheAssignmentColumns:
    """Each market date's seat as columns, so one row carries a vendor's whole assignment
    (E42/F01/S02)."""

    def test_a_vendor_placed_on_two_of_three_dates_fills_two_date_groups_and_leaves_one_empty(
            self, market):
        doc = market()
        doc["setupObject"] = {**PLAN, "marketDates": [
            {"date": "2099-08-01"}, {"date": "2099-08-02"}, {"date": "2099-08-03"}]}

        content, _filename = _file(filters={"search": "ana@"}, columns=[
            "email", *_date_columns("2099-08-01"), *_date_columns("2099-08-02"),
            *_date_columns("2099-08-03"), "datesPlaced"])

        assert _rows(content) == [
            ["Email",
             "Sat 1 Aug - table", "Sat 1 Aug - section", "Sat 1 Aug - tier",
             "Sat 1 Aug - half or full",
             "Sun 2 Aug - table", "Sun 2 Aug - section", "Sun 2 Aug - tier",
             "Sun 2 Aug - half or full",
             "Mon 3 Aug - table", "Mon 3 Aug - section", "Mon 3 Aug - tier",
             "Mon 3 Aug - half or full",
             "Dates placed"],
            ["ana@example.com",
             "Atrium 1", "Atrium", "Gold", "Full table",
             "Hall 2", "Hall", "Silver", "Full table",
             "", "", "", "",
             "2"],
        ]

    def test_a_vendor_never_placed_has_empty_seats_and_no_dates(self, market):
        market()

        content, _filename = _file(
            filters={"search": "ben@"}, columns=[*_date_columns("2099-08-01"), "datesPlaced"])

        assert _rows(content)[1] == ["", "", "", "", "0"]

    def test_a_half_table_says_half(self, market):
        doc = market()
        doc["assignmentObject"]["vendorAssignments"] = [
            *PLACEMENTS,
            _placed("ben@example.com", "2099-08-01", "Atrium 2", "Atrium", "Gold",
                    choice="Half Table (Left)"),
        ]

        content, _filename = _file(
            filters={"search": "ben@"}, columns=_date_columns("2099-08-01"))

        assert _rows(content)[1] == ["Atrium 2", "Atrium", "Gold", "Half table"]

    def test_a_vendor_added_by_hand_exports_their_seats_like_anyone(self, market):
        market()

        content, _filename = _file(filters={"search": "fay@"}, columns=[
            "status", *_date_columns("2099-08-02"), "datesPlaced"])

        assert _rows(content)[1] == ["Added by hand", "Hall 1", "Hall", "Silver", "Full table", "1"]

    def test_a_pin_and_a_seat_moved_by_hand_export_where_the_assignments_page_shows_them(
            self, market):
        """The columns read the stored placements, the rows the Assignments page draws: a seat
        an organizer pinned a vendor in, or swapped them into, is the seat exported. Both are a
        stored row flagged as placed by hand (ADR 0002)."""
        doc = market()
        doc["assignmentObject"]["vendorAssignments"] = [
            {**_placed("ana@example.com", "2099-08-01", "Atrium 3", "Atrium", "Gold"),
             "handPlaced": True},
            {**_placed("ana@example.com", "2099-08-02", "Hall 1", "Hall", "Silver"),
             "handPlaced": True},
            {**_placed("fay@example.com", "2099-08-02", "Hall 2", "Hall", "Silver"),
             "handPlaced": True},
        ]

        content, _filename = _file(filters={"search": "@example.com"}, columns=[
            "email", "date:2099-08-01:table", "date:2099-08-02:table"])

        rows = {row[0]: row[1:] for row in _rows(content)[1:]}
        assert rows["ana@example.com"] == ["Atrium 3", "Hall 1"]
        assert rows["fay@example.com"] == ["", "Hall 2"]

    def test_a_date_that_is_not_a_calendar_day_heads_its_columns_as_written(self, market):
        doc = market()
        doc["setupObject"] = {**PLAN, "marketDates": [{"date": "Opening night"}]}
        doc["assignmentObject"]["vendorAssignments"] = [
            _placed("ana@example.com", "Opening night", "Atrium 1", "Atrium", "Gold")]

        content, _filename = _file(
            filters={"search": "ana@"}, columns=["date:Opening night:table", "datesPlaced"])

        assert _rows(content) == [["Opening night - table", "Dates placed"], ["Atrium 1", "1"]]

    def test_a_seat_on_a_date_the_plan_no_longer_holds_is_not_counted(self, market):
        """The count is the date groups filled, so it never says more than the row shows."""
        doc = market()
        doc["setupObject"] = {**PLAN, "marketDates": [{"date": "2099-08-01"}]}

        content, _filename = _file(filters={"search": "ana@"}, columns=["datesPlaced"])

        assert _rows(content)[1] == ["1"]

    def test_a_column_the_market_does_not_offer_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="column"):
            _file(columns=["answer:nobody_asked_this"])

    def test_no_columns_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="column"):
            VendorExport.export(
                "market-123", {"filters": {}, "columns": []}, "viewer@market.test")


class TestTheFilters:
    def test_unassigned_only_is_the_approved_vendors_with_no_seat(self, market):
        market()

        content, _filename = _file(filters={"statuses": ["approved"], "placed": "unplaced"})

        assert _emails(content) == ["ben@example.com"]

    def test_not_placed_on_a_date_is_the_vendors_without_a_seat_that_day(self, market):
        market()

        content, _filename = _file(filters={
            "statuses": ["approved", "added"], "placed": "unplaced", "date": "2099-08-01"})

        assert _emails(content) == ["ben@example.com", "fay@example.com"]

    def test_placed_on_any_date(self, market):
        market()

        content, _filename = _file(filters={"placed": "placed"})

        assert _emails(content) == ["ana@example.com", "fay@example.com"]

    def test_placed_on_a_date_in_a_tier_and_section(self, market):
        market()

        assert _emails(_file(filters={
            "placed": "placed", "date": "2099-08-01", "tier": "Silver"})[0]) == []
        assert _emails(_file(filters={
            "placed": "placed", "date": "2099-08-02", "tier": "Silver"})[0]) == [
            "ana@example.com", "fay@example.com"]
        assert _emails(_file(filters={"placed": "placed", "section": "Atrium"})[0]) == [
            "ana@example.com"]

    def test_a_section_and_tier_hold_of_the_same_seat(self, market):
        """Ana sits in Atrium (Gold) one day and Hall (Silver) the other: never Atrium in Silver."""
        market()

        content, _filename = _file(filters={
            "placed": "placed", "section": "Atrium", "tier": "Silver"})

        assert _emails(content) == []

    def test_a_status_filter_takes_any_of_its_statuses(self, market):
        market()

        content, _filename = _file(filters={"statuses": ["rejected", "follow_up", "open"]})

        assert _emails(content) == ["cy@example.com", "dee@example.com", "eve@example.com"]

    def test_added_by_hand_is_its_own_status(self, market):
        market()

        assert _emails(_file(filters={"statuses": ["added"]})[0]) == ["fay@example.com"]
        assert "fay@example.com" not in _emails(_file(filters={"statuses": ["approved"]})[0])

    def test_a_choice_answer_filter_takes_any_of_its_options(self, market):
        market()

        assert _emails(_file(filters={"answers": {"category": ["Food"]}})[0]) == [
            "ben@example.com", "cy@example.com"]
        assert _emails(_file(filters={"answers": {"tags": ["Local", "Handmade"]}})[0]) == [
            "ana@example.com", "ben@example.com"]

    def test_the_search_finds_a_vendor_by_name_or_address(self, market):
        market()

        assert _emails(_file(filters={"search": " ANA "})[0]) == ["ana@example.com"]
        assert _emails(_file(filters={"search": "okafor"})[0]) == ["ben@example.com"]

    def test_the_search_finds_the_name_they_chose(self, market):
        market()

        assert _emails(_file(filters={"search": "Ana"})[0]) == ["ana@example.com"]

    @pytest.mark.parametrize("filters", [
        {"statuses": "approved"},
        {"statuses": ["accepted"]},
        {"placed": "sometimes"},
        {"date": {"$ne": ""}},
        {"search": ["ana"]},
        {"answers": {"category": "Food"}},
        {"answers": {"business_name": ["x"]}},
        "approved",
    ])
    def test_a_filter_the_dialog_could_not_have_sent_is_refused(self, market, filters):
        market()

        with pytest.raises(BadRequestError):
            VendorExport.export(
                "market-123", {"filters": filters, "columns": ["email"]}, "viewer@market.test")


class TestThePreview:
    def test_it_counts_the_vendors_and_columns_and_shows_the_first_three_rows(self, market):
        market()

        result = _preview(columns=["name", "email"])

        assert result["count"] == len(APPLICATIONS)
        assert result["header"] == ["Name", "Email"]
        assert result["rows"] == [
            ["Ana Lima", "ana@example.com"],
            ["Ben Okafor", "ben@example.com"],
            ["Cy Tan", "cy@example.com"],
        ]

    def test_it_reads_the_same_filters_as_the_file(self, market):
        market()

        result = _preview(filters={"statuses": ["approved"], "placed": "unplaced"},
                          columns=["email"])

        assert result["count"] == 1
        assert result["rows"] == [["ben@example.com"]]

    def test_it_offers_every_column_and_filter_the_market_has(self, market):
        market()

        offered = _preview()["offered"]

        assert offered["columns"] == [
            {"id": "name", "label": "Name", "group": "vendor"},
            {"id": "preferredName", "label": "Preferred name", "group": "vendor"},
            {"id": "email", "label": "Email", "group": "vendor"},
            {"id": "status", "label": "Status", "group": "vendor"},
            {"id": "answer:business_name", "label": "Business name", "group": "answers"},
            {"id": "answer:category", "label": "Category", "group": "answers"},
            {"id": "answer:tags", "label": "Tags", "group": "answers"},
            {"id": "answer:student", "label": "UBC student", "group": "answers"},
            *(
                {"id": f"date:{date}:{part}", "label": f"{day} - {words}", "group": "assignment"}
                for date, day in (("2099-08-01", "Sat 1 Aug"), ("2099-08-02", "Sun 2 Aug"))
                for part, words in (("table", "table"), ("section", "section"),
                                    ("tier", "tier"), ("size", "half or full"))
            ),
            {"id": "datesPlaced", "label": "Dates placed", "group": "assignment"},
        ]
        assert offered["groups"] == [
            {"id": "vendor", "label": "Vendor"},
            {"id": "answers", "label": "Answers"},
            {"id": "assignment", "label": "Assignment"},
        ]
        assert offered["defaultColumns"] == ["name", "email", "status"]
        assert offered["statuses"] == [
            {"id": "open", "label": "Open"},
            {"id": "follow_up", "label": "Needs follow-up"},
            {"id": "approved", "label": "Approved"},
            {"id": "rejected", "label": "Rejected"},
            {"id": "added", "label": "Added by hand"},
        ]
        assert offered["dates"] == ["2099-08-01", "2099-08-02"]
        assert offered["tiers"] == ["Gold", "Silver"]
        assert offered["sections"] == ["Atrium", "Hall"]
        assert offered["questions"] == [
            {"key": "category", "label": "Category", "options": ["Crafts", "Food"]},
            {"key": "tags", "label": "Tags", "options": ["Vegan", "Local", "Handmade"]},
            {"key": "student", "label": "UBC student", "options": ["Yes", "No"]},
        ]

    def test_with_no_columns_named_it_shows_the_default_ones(self, market):
        market()

        assert _preview()["header"] == ["Name", "Email", "Status"]

    def test_a_market_with_no_plan_and_no_form_still_exports_its_applicants(self, market):
        doc = market(phase=MarketPhase.REVIEW)
        doc.pop("setupObject")
        doc.pop("applicationForm")
        doc["assignmentObject"] = {"vendorAssignments": [], "assignmentStatistics": None}

        result = _preview(columns=["email"])

        assert result["count"] == len(APPLICATIONS)
        assert result["offered"]["dates"] == []
        assert result["offered"]["questions"] == []


def test_an_application_another_market_holds_is_not_exported(market, applications):
    market()
    applications.documents.append({
        **_application("zed@example.com", "reviewer_approved"), "market_id": "market-999"})

    content, _filename = _file()

    assert "zed@example.com" not in _emails(content)


@pytest.fixture
def client(market, monkeypatch):
    """Signed in through the session, as in production, as a Viewer of the market."""
    import app as App
    import api.users as UsersApi
    from conftest import sessions_load_through_get_user

    market()
    monkeypatch.setattr(App.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id="user-viewer", email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    ))
    client = App.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = "viewer@market.test"
        session["_fresh"] = True
    return client


def test_the_route_answers_a_csv_download(client):
    response = client.post(
        "/markets/market-123/vendor-export", json={"filters": {}, "columns": ["email"]})

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert response.headers["Content-Disposition"].startswith(
        'attachment; filename="Fall_Market_vendors_')
    assert response.get_data(as_text=True).startswith("\ufeffEmail\r\n")


def test_the_preview_route_answers_json(client):
    response = client.post(
        "/markets/market-123/vendor-export/preview", json={"filters": {}, "columns": ["email"]})

    assert response.status_code == 200
    assert response.get_json()["count"] == len(APPLICATIONS)


def test_a_body_that_is_not_an_object_is_refused(client):
    response = client.post("/markets/market-123/vendor-export", json=["email"])

    assert response.status_code == 400
