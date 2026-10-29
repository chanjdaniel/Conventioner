"""Which answers reject an application automatically: the organizer sets the rules (E33/F03/S01).

The real market rejects every applicant who does not agree to the no-show terms, or who is not a
UBC student, alumnus or another accepted affiliation - one card at a time. A rule names one choice
question and the answers that reject. The server is the authority on what a rule may say and when
it may change: free text is not a choice, an answer must be one the question offers, and the rules
close when the market can no longer return to review, where they judge.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.markets as MarketsApi  # noqa: E402
import rejection_rules as Rules  # noqa: E402
from conftest import client_market, complete_setup, stored_market  # noqa: E402
from client_errors import BadRequestError  # noqa: E402
from datatypes import ApplicationForm, MarketPhase  # noqa: E402

UBC = ["Current UBC student", "UBC alumni/staff", "Not a UBC student"]
FIELDS = [
    {"key": "affiliation", "label": "Are you a UBC student?", "type": "select", "options": UBC},
    {"key": "no_shows", "label": "I understand that no-shows", "type": "checkbox"},
    {"key": "selling", "label": "What will you sell?", "type": "multi_select",
     "options": ["Prints", "Stickers"]},
    {"key": "business", "label": "Business name", "type": "text"},
]


def _market(phase=MarketPhase.APPLICATIONS, **overrides):
    return client_market(phase=phase, application_form=ApplicationForm(fields=FIELDS),
                         setup_object=complete_setup(), **overrides)


class TestTheQuestionsARuleMayName:
    def test_every_choice_question_and_what_it_offers(self):
        questions = {q["key"]: q for q in Rules.Rulebook(_market()).questions}

        assert set(questions) == {"affiliation", "no_shows", "selling", "essential_table_choice",
                                  "essential_available_dates"}
        # The available dates in the words the applicant chose them by.
        assert questions["essential_available_dates"]["answers"] == [
            {"value": "2099-08-01", "label": "Saturday, August 1, 2099"}]
        assert [a["value"] for a in questions["affiliation"]["answers"]] == UBC
        # A checkbox's answers are whether it was ticked.
        assert [a["label"] for a in questions["no_shows"]["answers"]] == ["Ticked", "Not ticked"]
        # The essential table choice, in the words the applicant chose from.
        assert [a["label"] for a in questions["essential_table_choice"]["answers"]] == [
            "A whole table to myself", "Half a table, shared", "Either is fine"]
        assert questions["affiliation"]["label"] == "Are you a UBC student?"


class TestWhatARuleMaySay:
    def test_the_no_show_agreement_not_ticked_and_the_affiliations_not_accepted(self):
        rules = Rules.Rulebook(_market()).prepared([
            {"key": "no_shows", "answers": [Rules.NOT_TICKED]},
            {"key": "affiliation", "answers": ["Not a UBC student"]},
        ])

        assert rules == [
            {"key": "no_shows", "answers": [Rules.NOT_TICKED]},
            {"key": "affiliation", "answers": ["Not a UBC student"]},
        ]

    def test_free_text_is_refused(self):
        with pytest.raises(BadRequestError, match="Business name"):
            Rules.Rulebook(_market()).prepared([{"key": "business", "answers": ["Acme"]}])

    def test_an_answer_the_question_does_not_offer_is_refused(self):
        with pytest.raises(BadRequestError, match="does not offer"):
            Rules.Rulebook(_market()).prepared([{"key": "affiliation", "answers": ["Alumni"]}])

    def test_a_question_that_does_not_exist_is_refused(self):
        with pytest.raises(BadRequestError):
            Rules.Rulebook(_market()).prepared([{"key": "nothing", "answers": []}])

    def test_one_rule_a_question(self):
        with pytest.raises(BadRequestError, match="one rule"):
            Rules.Rulebook(_market()).prepared([{"key": "affiliation", "answers": []},
                                             {"key": "affiliation", "answers": []}])

    def test_a_rule_with_no_answer_yet_is_kept_and_rejects_nothing(self):
        assert Rules.Rulebook(_market()).prepared([{"key": "selling", "answers": []}]) == [
            {"key": "selling", "answers": []}]

    def test_a_repeated_answer_is_kept_once(self):
        rules = Rules.Rulebook(_market()).prepared([
            {"key": "selling", "answers": ["Prints", "Prints"]}])
        assert rules == [{"key": "selling", "answers": ["Prints"]}]


class TestWhenTheRulesClose:
    @pytest.mark.parametrize("phase", [MarketPhase.DRAFT, MarketPhase.APPLICATIONS])
    def test_open_while_the_market_can_still_review(self, phase):
        assert MarketsApi.rejection_rules_lock_reason(phase) is None

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.OFFERS,
                                       MarketPhase.MARKET_DAYS])
    def test_closed_from_assignment_on_saying_why(self, phase):
        assert "Assignment" in MarketsApi.rejection_rules_lock_reason(phase)

    def test_an_archived_market_says_it_is_archived(self):
        assert MarketsApi.rejection_rules_lock_reason(MarketPhase.ARCHIVED) == MarketsApi.ARCHIVED_REFUSAL


class TestTheWrite:
    @pytest.fixture
    def saved(self, monkeypatch):
        writes = []
        monkeypatch.setattr(MarketsApi, "_load_market_to_change",
                            lambda market_id, user, role, action: self.market)
        monkeypatch.setattr(MarketsApi.markets_collection, "update_one",
                            lambda query, update: writes.append((query, update)))
        return writes

    def test_it_writes_the_rules_on_a_locked_form(self, saved):
        # The form locked at the first application; the rules did not (decision 24).
        self.market = _market(phase=MarketPhase.APPLICATIONS)

        rules = MarketsApi.save_rejection_rules(
            "market-123", [{"key": "no_shows", "answers": [Rules.NOT_TICKED]}], "owner@x.test")

        assert rules == [{"key": "no_shows", "answers": [Rules.NOT_TICKED]}]
        assert saved == [({"id": "market-123"}, {"$set": {"rejectionRules": rules}})]

    def test_it_is_refused_from_assignment_on(self, saved):
        self.market = _market(phase=MarketPhase.ASSIGNMENT)

        with pytest.raises(BadRequestError, match="Assignment"):
            MarketsApi.save_rejection_rules("market-123", [], "owner@x.test")
        assert saved == []

    def test_the_market_read_says_what_a_rule_may_name_and_whether_it_may(self):
        document = stored_market(MarketPhase.APPLICATIONS,
                                 applicationForm={"fields": FIELDS},
                                 rejectionRules=[{"key": "no_shows", "answers": ["not ticked"]}])
        market = MarketsApi.market_from_document(document)

        served = MarketsApi.rejection_facts(market)

        assert served["rejectionRulesLockReason"] is None
        assert "affiliation" in [q["key"] for q in served["rejectionQuestions"]]
        assert served["rejectionRules"] == [{"key": "no_shows", "answers": ["not ticked"]}]


class TestAFormThatChanges:
    def test_a_rule_on_a_question_taken_away_is_served_as_gone_and_never_blocks_a_save(self):
        """A rule left naming a question the form no longer asks used to refuse every later write
        of the list, which always carries the whole list."""
        market = _market(rejection_rules=[
            {"key": "gone", "answers": ["x"]},
            {"key": "affiliation", "answers": ["Not a UBC student", "An answer since removed"]},
        ])
        book = Rules.Rulebook(market)

        assert book.served_rules() == [{"key": "affiliation", "answers": ["Not a UBC student"]}]
        assert book.prepared(book.served_rules()) == book.served_rules()

    def test_the_essentials_a_market_does_not_ask_are_not_offered(self):
        market = client_market(application_form=ApplicationForm(fields=FIELDS))

        keys = [q["key"] for q in Rules.Rulebook(market).questions]

        assert "essential_table_choice" not in keys and "essential_available_dates" not in keys
