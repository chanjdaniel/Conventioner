"""A search on the results (E35/F02/S01).

The Assignments page finds a vendor's tables by what identifies them: the names they gave, their address,
and their answers to the form's text and email questions - a business name, a business email, a
handle. The page has the addresses already; the server serves the rest beside the grid, keyed by
address, so the search reads the same applications every other surface does.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
import essential_fields as EF  # noqa: E402
from conftest import FakeApplicationsCollection  # noqa: E402
from datatypes import FormField  # noqa: E402

FIELDS = [
    FormField(key="business_name", label="Business name", type="text"),
    FormField(key="business_email", label="Business email", type="email"),
    FormField(key="category", label="Category", type="select", options=["Crafts", "Food"]),
    FormField(key="booth_count", label="Booths", type="number"),
]


def _terms(monkeypatch, docs, fields=FIELDS, placed=None):
    fake = FakeApplicationsCollection()
    fake.documents = [{"market_id": "market-1", **doc} for doc in docs]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    monkeypatch.setattr(ApplicationsApi, "ensure_application_indexes", lambda: None)
    if placed is None:
        placed = [doc["applicant_email"] for doc in docs]
    return ApplicationsApi.vendor_search_terms_for_market("market-1", fields, placed)


def test_names_and_text_answers_are_served_by_address(monkeypatch):
    terms = _terms(monkeypatch, [{
        "applicant_email": "Nadia@Ember.Test",
        "form_data": {
            EF.FULL_NAME_KEY: "Nadia Okafor",
            EF.PREFERRED_NAME_KEY: "Nadia O",
            "business_name": "Ember & Ash Ceramics",
            "business_email": "hello@emberash.test",
            "category": "Crafts",
            "booth_count": 2,
        },
    }])

    assert terms == {
        "nadia@ember.test": [
            "Nadia O", "Nadia Okafor", "Ember & Ash Ceramics", "hello@emberash.test",
        ],
    }


def test_a_choice_or_a_number_is_not_what_identifies_a_vendor(monkeypatch):
    terms = _terms(monkeypatch, [{
        "applicant_email": "theo@thistle.test",
        "form_data": {"category": "Crafts", "booth_count": 2},
    }])

    assert terms == {}


def test_a_blank_answer_is_left_out(monkeypatch):
    terms = _terms(monkeypatch, [{
        "applicant_email": "theo@thistle.test",
        "form_data": {EF.FULL_NAME_KEY: "Theo", "business_name": "  ", "business_email": None},
    }])

    assert terms == {"theo@thistle.test": ["Theo"]}


def test_another_markets_applications_are_not_read(monkeypatch):
    terms = _terms(monkeypatch, [
        {"applicant_email": "nadia@ember.test", "form_data": {EF.FULL_NAME_KEY: "Nadia"}},
    ])
    fake = ApplicationsApi.applications_collection
    fake.documents[0]["market_id"] = "market-2"

    assert ApplicationsApi.vendor_search_terms_for_market(
        "market-1", FIELDS, ["nadia@ember.test"]) == {}
    assert terms == {"nadia@ember.test": ["Nadia"]}


def test_only_the_vendors_at_a_table_are_served(monkeypatch):
    """The search finds tables; a vendor at none has nothing for it to find."""
    terms = _terms(monkeypatch, [
        {"applicant_email": "nadia@ember.test", "form_data": {EF.FULL_NAME_KEY: "Nadia"}},
        {"applicant_email": "theo@thistle.test", "form_data": {EF.FULL_NAME_KEY: "Theo"}},
    ], placed=["Nadia@Ember.Test"])

    assert terms == {"nadia@ember.test": ["Nadia"]}


def test_a_long_answer_is_a_description_not_what_identifies_them(monkeypatch):
    description = "Hand-thrown stoneware mugs and bowls, glazed in small batches " * 2
    terms = _terms(monkeypatch, [{
        "applicant_email": "nadia@ember.test",
        "form_data": {"business_name": "Ember & Ash", "business_email": description},
    }])

    assert terms == {"nadia@ember.test": ["Ember & Ash"]}


def test_the_vendors_the_place_dialog_offers_are_served_too(monkeypatch):
    """The placement dialog's "Who sits here" is searched by the same terms (E38/F08/S03), and
    offers vendors at no table that day, or at none, so they are served beside the seated."""
    import api.markets as MarketsApi
    from assignment.vendor_input import SolverVendor
    from datatypes import Application, ApplicationStatus, MarketTableRow
    from test_assignment_statistics_api import _sample_market_doc_with_setup

    def vendor(email):
        return SolverVendor(
            application_id=f"app-{email}", email=email, available_dates=frozenset({"2026-01-01"}),
            max_dates=None, accepted_tiers_by_date={}, table_choice=None, table_share_email=None,
            section_ranking=(), table_type_ranking=(),
        )

    walk_in = Application(
        id="app-3", market_id="market-123", applicant_email="walk.in@example.com",
        status=ApplicationStatus.REVIEWER_APPROVED, form_data={},
        added_by={"user_id": "user-1", "email": "editor@market.test"},
    )
    monkeypatch.setattr(
        MarketsApi.markets_collection, "find_one", lambda query: _sample_market_doc_with_setup())
    monkeypatch.setattr(MarketsApi.PermissionsApi, "user_has_permission", lambda *a, **k: True)
    monkeypatch.setattr(MarketsApi, "derive_market_table_rows", lambda _market: [MarketTableRow(
        date="2026-01-01", assignment=["held@example.com", "held@example.com"],
        assignment_slots=["held@example.com", "held@example.com"],
        location="Main Hall", section="A", table_choice="Full Table", table_code="A1", tier="Gold",
    )])
    monkeypatch.setattr(MarketsApi.ApplicationsApi, "vendor_names_for_market", lambda _id: {})
    monkeypatch.setattr(
        MarketsApi, "vendors_to_show",
        lambda _market: [vendor("ana@example.com"), vendor("ben@example.com")])
    monkeypatch.setattr(
        MarketsApi, "outside_solver_vendors",
        lambda *_args: [(vendor("walk.in@example.com"), walk_in)])
    asked = []
    monkeypatch.setattr(
        MarketsApi.ApplicationsApi, "vendor_search_terms_for_market",
        lambda _id, _fields, addresses: asked.extend(addresses) or {})

    MarketsApi.get_market_tables("market-123", "viewer@example.com")

    assert sorted(asked) == [
        "ana@example.com", "ben@example.com", "held@example.com", "walk.in@example.com"]
