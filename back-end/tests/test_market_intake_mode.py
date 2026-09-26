"""How a market says vendors reach it, who may write it, and when it stops being writable.

Intake mode gates the public applicant surface (E03/F02). This suite covers the field itself:
its default, its single writer, and the freeze. The gate it feeds is E03/F02/S02.
"""
import pytest

from conftest import FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import IntakeMode, MarketPhase, intake_mode_from_market_document
from market_documents import market_from_document


def _collection(monkeypatch, doc):
    fake = FakeMarketsCollection(doc)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return fake


class TestReadingItFromAStoredDocument:
    """Absence means CSV, so the public applicant surface is off unless a market says otherwise.

    Wrongly hiding an application surface is visible and gets complained about; wrongly exposing
    one is silent until a stranger applies.
    """

    def test_a_document_that_names_no_intake_mode_is_csv(self):
        assert intake_mode_from_market_document(stored_market()) is IntakeMode.CSV

    def test_a_document_that_names_form_intake_is_form(self):
        doc = stored_market(intakeMode="form")
        assert intake_mode_from_market_document(doc) is IntakeMode.FORM

    def test_only_the_camel_case_spelling_is_read(self):
        """The one spelling every write produces is the one spelling reads may name.

        A read-time fallback to snake_case would let a legacy key hold a value that is stale for
        ever, since writes only ever refresh the camelCase one.
        """
        doc = stored_market()
        doc.pop("intakeMode", None)
        doc["intake_mode"] = "form"
        assert intake_mode_from_market_document(doc) is IntakeMode.CSV

    def test_an_unrecognized_value_reads_as_csv_rather_than_raising(self):
        doc = stored_market(intakeMode="carrier_pigeon")
        assert intake_mode_from_market_document(doc) is IntakeMode.CSV

    def test_reading_an_unrecognized_value_does_not_rewrite_the_document(self):
        doc = stored_market(intakeMode="carrier_pigeon")
        intake_mode_from_market_document(doc)
        assert doc["intakeMode"] == "carrier_pigeon"

    def test_a_blank_value_is_csv(self):
        assert intake_mode_from_market_document(stored_market(intakeMode="")) is IntakeMode.CSV


class TestParsingAStoredMarket:
    def test_a_parsed_market_carries_the_stored_intake_mode(self):
        market = market_from_document(stored_market(intakeMode="form"))
        assert market.intake_mode is IntakeMode.FORM

    def test_a_parsed_market_with_no_stored_intake_mode_is_csv(self):
        assert market_from_document(stored_market()).intake_mode is IntakeMode.CSV

    def test_an_unrecognized_intake_mode_degrades_instead_of_failing_the_parse(self):
        market = market_from_document(stored_market(intakeMode="carrier_pigeon"))
        assert market.intake_mode is IntakeMode.CSV

    def test_an_unrecognized_phase_degrades_instead_of_failing_the_parse(self):
        """The same rule one field over, which ``market_from_document`` has always documented.

        A value no build recognizes must degrade rather than raise: the alternative is one
        unreadable document taking down every list that includes it.
        """
        doc = stored_market(phase=MarketPhase.ARCHIVED)
        doc["phase"] = "intermission"
        assert market_from_document(doc).phase is MarketPhase.ARCHIVED


class TestCreatingAMarket:
    def test_a_create_body_may_name_the_intake_mode(self, monkeypatch):
        fake = _collection(monkeypatch, None)
        MarketsApi.create_market(client_market(intake_mode=IntakeMode.FORM), "user-1")
        assert fake.inserted["intakeMode"] == "form"

    def test_a_market_created_without_one_is_csv(self, monkeypatch):
        fake = _collection(monkeypatch, None)
        MarketsApi.create_market(client_market(), "user-1")
        assert fake.inserted["intakeMode"] == "csv"


# Writing it - while a draft, and not after - is the plan write's to test now: the market PUT
# that carried it is gone (E21/F03/S06). See test_the_plan_saves_only_the_plan.py.
