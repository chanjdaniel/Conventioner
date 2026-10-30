"""An Admin updates an answer the assignment reads (E41/F01/S02).

The essential answers - the dates, how many of them, the tiers on each, the table choice, the
table-share partner and the rankings - are updated in the same place as any other answer, kept
beside the vendor's own, and behind a row of their own, "Update info the assignment or price
reads", Admin by default. The solver reads the updated answer, so the next run uses it, and an
update after a run marks the assignment out of date.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.applicants as ApplicantsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.vendor_info as VendorInfo
import assignment.made_from as MadeFrom
import essential_fields as EF
import guards as Guards
from assignment.vendor_input import approved_solver_vendors
from client_errors import BadRequestError, ForbiddenError
from datatypes import MarketPerson, MarketPhase, MarketRole

MARKET = "market-123"
ADMIN = MarketPerson(user_id="user-admin", email="admin@market.test")
VENDOR = "vendor@example.com"
THU, FRI, SAT = "2026-11-19", "2026-11-20", "2026-11-21"
OPTIONS = {"dates": [THU, FRI, SAT], "tiers": ["Gold", "Silver"], "sections": [],
           "tableTypes": ["Standard"]}
PLAN = {
    "priority": [{"id": 0, "target": "application.submitted_at", "direction": "ascending"}],
    "marketDates": [{"date": THU}, {"date": FRI}, {"date": SAT}],
    "tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}],
    "locations": [{"name": "Atrium"}],
    "sections": [
        {"name": "A", "location": {"name": "Atrium"}, "tier": {"id": 1, "name": "Gold"}, "count": 2},
        {"name": "B", "location": {"name": "Atrium"}, "tier": {"id": 2, "name": "Silver"},
         "count": 2},
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 3, "maxHalfTableProportionPerSection": 50},
}
ANSWERS = {
    EF.FULL_NAME_KEY: "Nadia Okonkwo",
    EF.PREFERRED_NAME_KEY: "",
    EF.AVAILABLE_DATES_KEY: [THU, FRI],
    EF.MAX_DATES_KEY: 2,
    EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold", "Silver"]},
    EF.TABLE_CHOICE_KEY: "full",
    EF.TABLE_SHARE_EMAIL_KEY: "",
    EF.TABLE_SHARE_ALSO_KEY: [],
    EF.TABLE_SHARE_ANSWER_KEY: "",
    EF.SECTION_RANKING_KEY: [],
    EF.TABLE_TYPE_RANKING_KEY: [],
    EF.REQUEST_KEY: "",
    "shop": "Ember Ceramics",
}
SILVER_ON_THURSDAY = {
    EF.AVAILABLE_DATES_KEY: [THU, FRI],
    EF.TIER_PREFERENCE_KEY: {THU: ["Silver"], FRI: ["Gold", "Silver"]},
}


@pytest.fixture
def market(monkeypatch, applications):
    """A market in ``phase`` with one approved vendor on it, the asker holding ``role``."""
    def at(phase=MarketPhase.ASSIGNMENT, role=MarketRole.ADMIN, answers=None, **overrides):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(
            phase, **{"setupObject": PLAN, **overrides}, applicationForm={
                "fields": [{"key": "shop", "label": "Shop name", "type": "text",
                            "required": True, "options": [], "order": 0}],
                "essentialOptions": OPTIONS})))
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        applications.insert_one({
            "id": "app-1", "market_id": MARKET, "applicant_email": VENDOR,
            "form_data": dict(ANSWERS if answers is None else answers),
            "status": "reviewer_approved", "application_type": "main",
            "submitted_at": "2026-05-02T09:14:03+00:00", "updated_at": "2026-05-02T09:14:03+00:00",
            "verdict_at": "2026-05-03T09:14:03+00:00",
        })
        return applications
    return at


def _update(answers, by=ADMIN):
    return VendorInfo.update_vendor_info(MARKET, "app-1", answers, by)


def _stored(applications):
    return applications.find_one({"id": "app-1"})


def _solver_vendor():
    [vendor], incomplete = approved_solver_vendors(MARKET, EF.essential_options_from_snapshot(OPTIONS))
    assert incomplete == []
    return vendor


def _market():
    return MarketsApi.market_from_document(MarketsApi.markets_collection.doc)


class TestTheAssignmentReadsTheUpdate:
    def test_silver_on_thursday_is_what_the_next_run_reads(self, market):
        applications = market()

        _result, status = _update(SILVER_ON_THURSDAY)

        assert status == 200
        stored = _stored(applications)
        assert stored["form_data"] == ANSWERS
        # The dates did not change, so only the tiers carry an update.
        assert set(stored["answer_updates"]) == {EF.TIER_PREFERENCE_KEY}
        assert stored["answer_updates"][EF.TIER_PREFERENCE_KEY]["over"] == ANSWERS[
            EF.TIER_PREFERENCE_KEY]
        vendor = _solver_vendor()
        assert vendor.accepted_tiers_by_date[THU] == frozenset({"Silver"})
        assert not vendor.accepts_tier_on(THU, "Gold")
        assert vendor.accepts_tier_on(FRI, "Gold")

    def test_an_update_after_a_run_marks_the_assignment_out_of_date(self, market):
        market()
        ran_from = MadeFrom.fingerprint(_market().setup_object, [_solver_vendor()])
        doc = MarketsApi.markets_collection.doc
        doc["assignmentObject"] = {
            "vendorAssignments": [{"email": VENDOR, "date": THU, "tableCode": "A 1",
                                   "tableChoice": "full", "section": "A", "tier": "Gold",
                                   "location": "Atrium"}],
            "madeFrom": ran_from,
        }
        assert MadeFrom.changed_since_run(_market()) == []

        _update(SILVER_ON_THURSDAY)

        assert MadeFrom.changed_since_run(_market()) == ["applications"]

    def test_a_day_added_with_its_tiers_is_read(self, market):
        market()

        _update({EF.AVAILABLE_DATES_KEY: [THU, FRI, SAT],
                 EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold", "Silver"], SAT: ["Silver"]},
                 EF.MAX_DATES_KEY: 3})

        vendor = _solver_vendor()
        assert vendor.available_dates == frozenset({THU, FRI, SAT})
        assert vendor.max_dates == 3

    def test_the_table_share_answer_is_read_for_its_address(self, market):
        applications = market()

        _update({EF.TABLE_SHARE_EMAIL_KEY: "Seat me with Ana, Ana@Example.com"})

        updates = _stored(applications)["answer_updates"]
        assert updates[EF.TABLE_SHARE_ANSWER_KEY]["value"] == "Seat me with Ana, Ana@Example.com"
        assert updates[EF.TABLE_SHARE_EMAIL_KEY]["value"] == "ana@example.com"
        assert _solver_vendor().table_share_email == "ana@example.com"

    def test_the_table_share_notice_reads_the_update(self, market):
        market()

        _update({EF.TABLE_SHARE_EMAIL_KEY: "Seat me with ana@example.com",
                 EF.TABLE_CHOICE_KEY: "half"})

        result, _status = ApplicantsApi.list_market_applications(MARKET)
        [served] = result["applications"]
        assert served["tableShareNotice"] == {"reason": "no_applicant",
                                              "address": "ana@example.com"}

    def test_the_empty_tier_check_reads_the_update(self, market):
        """Allocating is refused while an approved vendor waits on a tier with no tables."""
        market(setupObject={**PLAN, "sections": [PLAN["sections"][0]]})
        guard = Guards.NoAskedForTierWithoutTablesGuard()
        assert guard.evaluate(_market(), None).passed is False

        _update({EF.AVAILABLE_DATES_KEY: [THU, FRI],
                 EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold"]}})

        assert guard.evaluate(_market(), None).passed is True

    def test_the_request_the_vendor_notes_show_reads_the_update(self, market):
        market(role=MarketRole.EDITOR)

        _update({EF.REQUEST_KEY: "An extra chair"})

        notes = MarketsApi.get_vendor_notes(MARKET, "editor@market.test")
        assert notes[VENDOR]["request"] == "An extra chair"


class TestItIsValidatedAsTheFormValidatesIt:
    def test_a_ticked_day_with_no_tiers_is_refused_with_the_forms_words(self, market):
        applications = market()

        with pytest.raises(BadRequestError) as refused:
            _update({EF.AVAILABLE_DATES_KEY: [THU, FRI, SAT],
                     EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold"]}})

        assert str(refused.value) == (
            f"'Tier preference' is missing for {SAT}. Choose at least one tier for that day, "
            "or mark it as one you cannot attend.")
        assert not _stored(applications).get("answer_updates")

    def test_tiers_on_a_day_they_cannot_attend_are_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="not among the dates you said you are available"):
            _update({EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold"], SAT: ["Gold"]}})

    def test_a_tier_the_market_does_not_offer_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="does not offer: Bronze"):
            _update({EF.TIER_PREFERENCE_KEY: {THU: ["Bronze"], FRI: ["Gold"]}})

    def test_more_dates_than_the_market_offers_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError) as refused:
            _update({EF.MAX_DATES_KEY: 4})

        assert str(refused.value) == (
            "'Number of dates you want' cannot exceed the 3 date(s) this market offers.")

    def test_a_table_choice_outside_the_three_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="'Table choice' must be one of"):
            _update({EF.TABLE_CHOICE_KEY: "two tables"})

    def test_an_imported_vendor_with_no_limit_keeps_none_while_another_answer_is_updated(
            self, market):
        """A row from a form that never asked how many dates holds no limit (bug 24); updating its
        tiers does not demand one."""
        applications = market(answers={**ANSWERS, EF.MAX_DATES_KEY: None})

        _update(SILVER_ON_THURSDAY)

        assert EF.MAX_DATES_KEY not in _stored(applications)["answer_updates"]

    def test_the_words_kept_for_the_share_answer_are_not_a_question_of_their_own(self, market):
        market()

        with pytest.raises(BadRequestError, match="not on this market's form"):
            _update({EF.TABLE_SHARE_ANSWER_KEY: "ana@example.com"})

    def test_restating_their_answer_changes_nothing(self, market, market_records):
        applications = market()

        _update({EF.AVAILABLE_DATES_KEY: [FRI, THU],
                 EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Silver", "Gold"]}})

        assert not _stored(applications).get("answer_updates")
        assert market_records.history.documents == []

    def test_setting_their_answer_back_takes_the_update_away(self, market):
        applications = market()
        _update(SILVER_ON_THURSDAY)

        _update({EF.TIER_PREFERENCE_KEY: ANSWERS[EF.TIER_PREFERENCE_KEY]})

        assert not _stored(applications).get("answer_updates")
        assert _solver_vendor().accepted_tiers_by_date[THU] == frozenset({"Gold"})


class TestWhoMay:
    def test_an_answer_the_assignment_reads_asks_its_own_row_too(self, market, monkeypatch):
        market()
        asked = []
        refusal = Actions.refusal

        def asking(row, *args):
            asked.append(row)
            return refusal(row, *args)

        monkeypatch.setattr(Actions, "refusal", asking)

        _update(SILVER_ON_THURSDAY)

        assert asked == [Actions.UPDATE_VENDOR_INFO, Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO]
        assert Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO.default is MarketRole.ADMIN
        assert Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO.label == (
            "Update info the assignment or price reads")

    @pytest.mark.parametrize("answers", [
        SILVER_ON_THURSDAY,
        {EF.MAX_DATES_KEY: 1},
        {EF.TABLE_CHOICE_KEY: "half"},
        {EF.TABLE_SHARE_EMAIL_KEY: "ana@example.com"},
    ])
    def test_an_editor_is_refused_with_the_rows_sentence(self, market, answers, market_records):
        applications = market(role=MarketRole.EDITOR)

        with pytest.raises(ForbiddenError) as refused:
            _update({**answers, "shop": "Ember & Co"})

        assert str(refused.value) == (
            "Only an Admin or the owner may update the answers this market's assignment reads.")
        assert not _stored(applications).get("answer_updates")
        assert market_records.history.documents == []

    @pytest.mark.parametrize("answers", [
        {EF.FULL_NAME_KEY: "Nadia Okonkwo-Reyes"},
        {EF.PREFERRED_NAME_KEY: "Nadia"},
        {EF.REQUEST_KEY: "An extra chair"},
    ])
    def test_an_editor_may_update_an_essential_answer_the_assignment_never_reads(
            self, market, answers):
        applications = market(role=MarketRole.EDITOR)

        _result, status = _update(answers)

        assert status == 200
        assert set(_stored(applications)["answer_updates"]) == set(answers)

    def test_the_markets_own_row_governs_it(self, market):
        """An Editor may where the market's own row asks for an Editor (E39/F01/S03)."""
        market(role=MarketRole.EDITOR, permissions={
            "update-assignment-or-price-info": {"role": "editor", "source": "market"}})

        _result, status = _update(SILVER_ON_THURSDAY)

        assert status == 200

    def test_an_archived_market_refuses_it(self, market):
        applications = market(MarketPhase.ARCHIVED)

        with pytest.raises(ForbiddenError):
            _update(SILVER_ON_THURSDAY)

        assert not _stored(applications).get("answer_updates")

    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT,
                                       MarketPhase.MARKET_DAYS])
    def test_no_phase_owns_it(self, market, phase):
        market(phase)

        _result, status = _update(SILVER_ON_THURSDAY)

        assert status == 200


class TestTheHistory:
    def test_the_update_is_one_entry_with_who_and_the_answer_before_and_after(
            self, market, market_records):
        market()

        _update(SILVER_ON_THURSDAY)

        [entry] = market_records.history.documents
        assert entry["actor"] == "admin@market.test"
        assert entry["at"]
        assert entry["action"] == "update-vendor-info"
        assert entry["vendors"] == [VENDOR]
        assert entry["subject"] == {"application_id": "app-1"}
        assert entry["detail"]["before"] == {
            EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold", "Silver"]}}
        assert entry["detail"]["after"] == {
            EF.TIER_PREFERENCE_KEY: {THU: ["Silver"], FRI: ["Gold", "Silver"]}}
