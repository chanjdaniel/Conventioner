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
