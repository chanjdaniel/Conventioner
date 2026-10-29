"""The rules reject, with a reason (E33/F03/S02).

An undecided application whose answers meet a rule is stored rejected, the rule its giver and the
answer its reason. Rules are applied when an application arrives, online or by import, and again
whenever a rule changes: a rule that no longer matches returns its own rejections to undecided. A
verdict a person gave is never touched, and the applicant never sees the reason.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
import rejection_rules as Rules  # noqa: E402
from conftest import FakeApplicationsCollection, client_market, complete_setup  # noqa: E402
from datatypes import (  # noqa: E402
    Application, ApplicationForm, ApplicationStatus, MarketPhase, RejectionRule, VerdictGiver)

NOT_UBC = "No, I am not a UBC student"
FIELDS = [
    {"key": "affiliation", "label": "Are you a UBC student?", "type": "select",
     "options": ["Yes, a current student", NOT_UBC]},
    {"key": "no_shows", "label": "I understand that no-shows", "type": "checkbox"},
    {"key": "clubs", "label": "Which clubs?", "type": "multi_select", "options": ["Art", "Print"]},
]
NO_SHOW_RULE = RejectionRule(key="no_shows", answers=[Rules.NOT_TICKED])
AFFILIATION_RULE = RejectionRule(key="affiliation", answers=[NOT_UBC])
ALEX = VerdictGiver(kind="person", user_id="user-alex", email="alex@market.test")


def _market(*rules, **overrides):
    return client_market(phase=MarketPhase.REVIEW, application_form=ApplicationForm(fields=FIELDS),
                         setup_object=complete_setup(), rejection_rules=list(rules), **overrides)


def _app(app_id, status=ApplicationStatus.OPEN, **answers):
    return {"id": app_id, "market_id": "market-123", "applicant_email": f"{app_id}@x.test",
            "form_data": answers, "status": status.value, "application_type": "main",
            "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z"}


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake.documents


class TestWhichAnswerRejects:
    def test_an_unticked_agreement(self):
        assert Rules.Rulebook(_market(NO_SHOW_RULE)).rejecting({"no_shows": False}) == (
            "no_shows", "Did not tick “I understand that no-shows”")
        # No answer at all is not an unticked box: a checkbox added since, or a column an import
        # left out, would otherwise reject every application at once.
        assert Rules.Rulebook(_market(NO_SHOW_RULE)).rejecting({}) is None
        assert Rules.Rulebook(_market(NO_SHOW_RULE)).rejecting({"no_shows": True}) is None

    def test_a_choice_names_the_answer_given(self):
        assert Rules.Rulebook(_market(AFFILIATION_RULE)).rejecting({"affiliation": NOT_UBC}) == (
            "affiliation", f"Answered “{NOT_UBC}” to “Are you a UBC student?”")

    def test_a_multi_select_rejects_on_any_answer_it_names(self):
        rule = RejectionRule(key="clubs", answers=["Print"])
        assert Rules.Rulebook(_market(rule)).rejecting({"clubs": ["Art", "Print"]})[0] == "clubs"
        assert Rules.Rulebook(_market(rule)).rejecting({"clubs": ["Art"]}) is None

    def test_a_rule_naming_no_answer_rejects_nobody(self):
        rule = RejectionRule(key="affiliation", answers=[])
        assert Rules.Rulebook(_market(rule)).rejecting({"affiliation": NOT_UBC}) is None


class TestJudgingTheMarket:
    def test_an_undecided_application_is_rejected_with_the_rule_and_the_reason(self, stored):
        stored.append(_app("a", no_shows=False))

        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")

        assert stored[0]["status"] == ApplicationStatus.REVIEWER_REJECTED.value
        assert stored[0]["verdict_by"] == {"kind": "rule", "rule": "no_shows",
                                           "user_id": None, "email": None}
        assert stored[0]["verdict_reason"] == "Did not tick “I understand that no-shows”"

    def test_a_persons_verdict_is_never_touched(self, stored):
        given = {"verdict_by": ALEX.model_dump(), "verdict_at": "2026-10-02T00:00:00Z"}
        stored.append({**_app("a", ApplicationStatus.REVIEWER_APPROVED, no_shows=False), **given})
        stored.append({**_app("b", ApplicationStatus.REVIEWER_REJECTED, no_shows=True), **given})

        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")

        assert [a["status"] for a in stored] == ["reviewer_approved", "reviewer_rejected"]
        assert all(a["verdict_by"]["kind"] == "person" for a in stored)

    def test_a_rule_that_no_longer_matches_returns_its_rejections_to_undecided(self, stored):
        stored.append(_app("a", no_shows=False, affiliation=NOT_UBC))
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")

        Rules.judge(Rules.Rulebook(_market()), "market-123")

        assert stored[0]["status"] == ApplicationStatus.OPEN.value
        assert "verdict_by" not in stored[0] and "verdict_reason" not in stored[0]

    def test_another_rule_still_matching_keeps_it_rejected_with_its_own_reason(self, stored):
        stored.append(_app("a", no_shows=False, affiliation=NOT_UBC))
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE, AFFILIATION_RULE)), "market-123")

        Rules.judge(Rules.Rulebook(_market(AFFILIATION_RULE)), "market-123")

        assert stored[0]["status"] == ApplicationStatus.REVIEWER_REJECTED.value
        assert stored[0]["verdict_by"]["rule"] == "affiliation"

    def test_one_application_alone_when_it_arrives(self, stored):
        stored.extend([_app("a", no_shows=False), _app("b", no_shows=False)])

        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123", application_id="b")

        assert [a["status"] for a in stored] == ["open", "reviewer_rejected"]


class TestWhatJudgingNeverDoes:
    def test_return_a_rejection_its_applicant_has_seen(self, stored):
        stored.append(_app("a", no_shows=False))
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")

        Rules.judge(Rules.Rulebook(_market(results_published=True)), "market-123")

        assert stored[0]["status"] == ApplicationStatus.REVIEWER_REJECTED.value

    def test_overwrite_a_verdict_given_after_it_read_the_application(self, stored, monkeypatch):
        stored.append(_app("a", no_shows=False))
        read = ApplicationsApi.judgeable_applications

        def read_then_a_person_decides(market_id, application_id=None):
            docs = [dict(doc) for doc in read(market_id, application_id)]
            ApplicantsApi.review_application(
                "market-123", "a", ApplicationStatus.REVIEWER_APPROVED, by=ALEX)
            return docs

        monkeypatch.setattr(ApplicationsApi, "judgeable_applications", read_then_a_person_decides)

        assert Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123") == Rules.Judged()
        assert stored[0]["status"] == ApplicationStatus.REVIEWER_APPROVED.value
        assert stored[0]["verdict_by"]["kind"] == "person"


class TestWhoSeesTheReason:
    def _rejected(self):
        return Application(**{**_app("a", ApplicationStatus.REVIEWER_REJECTED),
                              "verdict_by": {"kind": "rule", "rule": "no_shows"},
                              "verdict_reason": "Did not tick “I understand that no-shows”"})

    def test_the_organizer_sees_it(self):
        served = ApplicantsApi._application_response_organizer(self._rejected())
        assert served["verdictReason"] == "Did not tick “I understand that no-shows”"
        assert served["verdictBy"]["kind"] == "rule"

    def test_the_applicant_never_does(self):
        for published in (False, True):
            served = ApplicantsApi._application_response(self._rejected(), published)
            assert "no-shows" not in repr(served)
            assert "verdictBy" not in served and "verdictReason" not in served

    def test_a_person_overturning_it_makes_it_theirs(self, stored):
        stored.append(_app("a", no_shows=False))
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")

        ApplicantsApi.review_application(
            "market-123", "a", ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

        assert stored[0]["verdict_by"]["kind"] == "person"
        assert "verdict_reason" not in stored[0]
        # A person's verdict is theirs: the rule, judged again, leaves it.
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")
        assert stored[0]["status"] == ApplicationStatus.REVIEWER_APPROVED.value


class TestTheyApplyWhen:
    def test_a_rule_changes(self, stored, monkeypatch):
        import api.markets as MarketsApi

        stored.append(_app("a", affiliation=NOT_UBC))
        monkeypatch.setattr(MarketsApi, "_load_market_to_change", lambda *_a: _market())
        monkeypatch.setattr(MarketsApi.markets_collection, "update_one", lambda *_a: None)

        MarketsApi.save_rejection_rules(
            "market-123", [{"key": "affiliation", "answers": [NOT_UBC]}], "owner@x.test")

        assert stored[0]["status"] == ApplicationStatus.REVIEWER_REJECTED.value

    def test_an_import_writes_its_rows(self, applications):
        import csv_import as CsvImport
        import essential_fields as EssentialFields
        from conftest import FakeMarketsCollection
        from test_csv_import import GOOD_ROW, MAPPING, _csv, _market_doc

        markets = FakeMarketsCollection(_market_doc(rejectionRules=[
            {"key": EssentialFields.TABLE_CHOICE_KEY, "answers": ["half"]}]))

        body, status = CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        assert status == 200 and body["rejectedByRules"] == 1
        stored = applications.find_one({"applicant_email": "nadia@ember.test"})
        assert stored["status"] == ApplicationStatus.REVIEWER_REJECTED.value
        assert stored["verdict_reason"] == "Answered “Half a table, shared” to “Table choice”"

    def test_an_applicant_applies_online_and_is_told_only_that_it_is_submitted(
        self, applications, monkeypatch,
    ):
        import db_config
        from conftest import FakeSlugMarketsCollection
        from test_essential_fields import VALID_ANSWERS, _applicant_market_doc, _token

        markets = FakeSlugMarketsCollection(_applicant_market_doc(rejectionRules=[
            {"key": "essential_table_choice", "answers": ["half"]}]))
        monkeypatch.setattr(db_config, "get_database",
                            lambda *_a, **_kw: type("Db", (dict,), {
                                "__getitem__": lambda self, name: markets})())

        body, status = ApplicantsApi.save_applicant_application(
            "test-market", _token(), {**VALID_ANSWERS, "business_name": "Acme"})

        assert status == 200, body
        stored = applications.find_one({"applicant_email": "vendor@example.com"})
        assert stored["status"] == ApplicationStatus.REVIEWER_REJECTED.value
        # Submitted, as an undecided one reads (E36/F05/S01): nothing tells the rule's verdict.
        assert body["application"]["status"] == ApplicationStatus.OPEN.value
        assert "Half" not in repr(body)

    def test_the_form_changes(self, stored, monkeypatch):
        """A question taken away judges nobody, and what it rejected is judged again."""
        import api.markets as MarketsApi

        stored.append(_app("a", no_shows=False))
        Rules.judge(Rules.Rulebook(_market(NO_SHOW_RULE)), "market-123")
        without_it = _market(NO_SHOW_RULE).model_copy(update={"application_form": ApplicationForm(
            fields=[f for f in FIELDS if f["key"] != "no_shows"])})
        monkeypatch.setattr(MarketsApi, "_load_market_to_change", lambda *_a: without_it)
        monkeypatch.setattr(MarketsApi, "prepared_application_form", lambda *_a: {})
        monkeypatch.setattr(MarketsApi.markets_collection, "update_one", lambda *_a: None)
        monkeypatch.setattr(MarketsApi, "load_market_context",
                            lambda _id: MarketsApi.MarketContext({}, without_it, None, None))

        MarketsApi.save_application_form("market-123", {"fields": []}, "owner@x.test")

        assert stored[0]["status"] == ApplicationStatus.OPEN.value
