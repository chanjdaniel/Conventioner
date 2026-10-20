"""A search on the results (E35/F02/S01).

The Result page finds a vendor's tables by what identifies them: the names they gave, their address,
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


def _terms(monkeypatch, docs, fields=FIELDS):
    fake = FakeApplicationsCollection()
    fake.documents = [{"market_id": "market-1", **doc} for doc in docs]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    monkeypatch.setattr(ApplicationsApi, "ensure_application_indexes", lambda: None)
    return ApplicationsApi.vendor_search_terms_for_market("market-1", fields)


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

    assert ApplicationsApi.vendor_search_terms_for_market("market-1", FIELDS) == {}
    assert terms == {"nadia@ember.test": ["Nadia"]}
