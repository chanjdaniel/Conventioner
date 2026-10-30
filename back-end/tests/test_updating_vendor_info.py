"""An organizer updates a vendor's info (E41/F01/S01).

The vendor's own answer is never written over: the update is kept beside it, with who made it and
when, and read in its place everywhere the organizer reads the application. A re-import, or the
vendor's own edit, rewrites what they wrote and leaves the update standing, and the organizer is
told when what they wrote has changed since.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.applicants as ApplicantsApi
import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.vendor_info as VendorInfo
import csv_import as CsvImport
import essential_fields as EF
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import MarketPerson, MarketPhase, MarketRole
from test_csv_import import GOOD_ROW, MAPPING, _csv, _market_doc

MARKET = "market-123"
EDITOR = MarketPerson(user_id="user-editor", email="editor@market.test")
VENDOR = "vendor@example.com"
FIELDS = [
    {"key": "shop", "label": "Shop name", "type": "text", "required": True, "options": [],
     "order": 0},
    {"key": "student", "label": "Are you a student?", "type": "select", "required": True,
     "options": ["Yes", "No"], "order": 1},
    {"key": "goods", "label": "What do you sell?", "type": "multi_select", "required": False,
     "options": ["Prints", "Cards", "Pins"], "order": 2},
]
ANSWERS = {"shop": "Ember Ceramcs", "student": "No", "goods": ["Prints"],
           EF.FULL_NAME_KEY: "Nadia Okonkwo"}


@pytest.fixture
def market(monkeypatch, applications, market_records):
    """A market in ``phase`` with one vendor's application on it, the asker holding ``role``."""
    def at(phase=MarketPhase.APPLICATIONS, role=None, **overrides):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(
            phase, applicationForm={"fields": FIELDS}, **overrides)))
        if role is None:
            monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        else:
            monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        applications.insert_one({
            "id": "app-1", "market_id": MARKET, "applicant_email": VENDOR,
            "form_data": dict(ANSWERS), "status": "open", "application_type": "main",
            "submitted_at": "2026-05-02T09:14:03+00:00", "updated_at": "2026-05-02T09:14:03+00:00",
            "verdict_at": None,
        })
        return applications
    return at


def _update(answers, by=EDITOR, application_id="app-1"):
    return VendorInfo.update_vendor_info(MARKET, application_id, answers, by)


def _stored(applications):
    return applications.find_one({"id": "app-1"})


class TestAnUpdateIsKeptBesideTheirAnswer:
    def test_their_answer_is_untouched_and_the_update_says_who_and_when(self, market):
        applications = market()

        result, status = _update({"shop": "Ember Ceramics", "student": "Yes"})

        assert status == 200
        stored = _stored(applications)
        assert stored["form_data"] == ANSWERS
        shop = stored["answer_updates"]["shop"]
        assert shop["value"] == "Ember Ceramics"
        assert shop["over"] == "Ember Ceramcs"
        assert shop["by"] == EDITOR.model_dump()
        assert shop["at"]
        assert stored["answer_updates"]["student"]["value"] == "Yes"
        assert result["application"]["formData"]["shop"] == "Ember Ceramics"

    def test_an_update_does_not_move_when_their_answers_last_changed(self, market):
        """A verdict is conditioned on ``updated_at``, the vendor's answers' time; an organizer's
        update is not the vendor changing their answers."""
        applications = market()

        _update({"shop": "Ember Ceramics"})

        assert _stored(applications)["updated_at"] == "2026-05-02T09:14:03+00:00"

    def test_an_answer_is_stored_as_the_form_stores_it(self, market):
        applications = market()

        _update({"shop": "  Ember Ceramics  ", "goods": ["Prints", " Cards"]})

        updates = _stored(applications)["answer_updates"]
        assert updates["shop"]["value"] == "Ember Ceramics"
        assert updates["goods"]["value"] == ["Prints", "Cards"]

    def test_setting_their_own_answer_back_takes_the_update_away(self, market):
        applications = market()
        _update({"shop": "Ember Ceramics"})

        _update({"shop": "Ember Ceramcs"})

        assert "shop" not in (_stored(applications).get("answer_updates") or {})

    def test_an_answer_restated_changes_nothing_and_keeps_who_made_it(self, market):
        applications = market()
        _update({"shop": "Ember Ceramics"})
        first = _stored(applications)["answer_updates"]["shop"]

        _update({"shop": "Ember Ceramics"}, by=MarketPerson(user_id="u2", email="sam@market.test"))

        assert _stored(applications)["answer_updates"]["shop"] == first


class TestTheUpdateReadsInItsPlace:
    def test_the_organizers_view_reads_the_update_and_says_what_they_wrote(self, market):
        applications = market()
        _update({"shop": "Ember Ceramics"})

        view = ApplicantsApi.organizer_view(_stored(applications))

        assert view["formData"]["shop"] == "Ember Ceramics"
        assert view["formData"]["student"] == "No"
        update = view["answerUpdates"]["shop"]
        assert update["value"] == "Ember Ceramics"
        assert update["theyWrote"] == "Ember Ceramcs"
        assert update["by"] == {"userId": "user-editor", "email": "editor@market.test"}
        assert update["at"]
        assert update["changedSince"] is False

    def test_the_applicant_reads_their_own_answer(self, market):
        applications = market()
        _update({"shop": "Ember Ceramics"})
        from datatypes import Application

        own = ApplicantsApi._application_response(Application(**_stored(applications)), False)

        assert own["formData"]["shop"] == "Ember Ceramcs"
        assert "answerUpdates" not in own

    def test_every_reader_of_the_answers_reads_the_update(self, market):
        applications = market()
        _update({"shop": "Ember Ceramics"})

        assert ApplicationsApi.effective_answers(_stored(applications))["shop"] == "Ember Ceramics"
        terms = ApplicationsApi.vendor_search_terms_for_market(
            MARKET, MarketsApi.market_from_document(
                MarketsApi.markets_collection.doc).application_form.fields, [VENDOR])
        assert "Ember Ceramics" in terms[VENDOR]
        assert "Ember Ceramcs" not in terms[VENDOR]

    def test_the_export_reads_the_update(self, market):
        import api.vendor_export as VendorExport

        applications = market()
        _update({"shop": "Ember Ceramics"})
        market_model = MarketsApi.market_from_document(MarketsApi.markets_collection.doc)

        [vendor] = VendorExport._vendors(market_model)

        assert vendor.answers["shop"] == "Ember Ceramics"


class TestWhatMayBeUpdated:
    def test_an_answer_the_assignment_reads_is_refused_for_now(self, market):
        applications = market()

        with pytest.raises(BadRequestError, match="assignment reads"):
            _update({EF.FULL_NAME_KEY: "Nadia O."})

        assert not _stored(applications).get("answer_updates")

    def test_a_question_the_form_does_not_ask_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError, match="not on this market's form"):
            _update({"favourite_colour": "Teal"})

    def test_an_invalid_answer_is_refused_as_the_form_refuses_it(self, market):
        applications = market()

        with pytest.raises(BadRequestError) as refused:
            _update({"student": "Maybe"})

        assert str(refused.value) == "'Are you a student?' must be one of: Yes, No"
        assert not _stored(applications).get("answer_updates")

    def test_a_required_answer_cannot_be_emptied(self, market):
        market()

        with pytest.raises(BadRequestError, match="'Shop name' is required."):
            _update({"shop": "  "})

    def test_nothing_to_update_is_refused(self, market):
        market()

        with pytest.raises(BadRequestError):
            _update({})

    def test_an_application_of_another_market_is_not_found(self, market):
        applications = market()
        applications.insert_one({**_stored(applications), "id": "app-2", "market_id": "other"})

        with pytest.raises(NotFoundError):
            _update({"shop": "Ember Ceramics"}, application_id="app-2")


class TestWhoMay:
    def test_the_row_update_a_vendors_info_governs_it(self, market, monkeypatch):
        market()
        asked = []
        refusal = Actions.refusal

        def asking(row, *args):
            asked.append(row)
            return refusal(row, *args)

        monkeypatch.setattr(Actions, "refusal", asking)

        _update({"shop": "Ember Ceramics"})

        # The rules judge the update again, and the change row says whether a rule's rejection the
        # update no longer meets returns to open (E38/F06/S01).
        assert asked == [Actions.UPDATE_VENDOR_INFO, Actions.CHANGE_VERDICTS]
        assert Actions.UPDATE_VENDOR_INFO.default is MarketRole.EDITOR
        assert Actions.UPDATE_VENDOR_INFO.label == "Update a vendor's info"

    def test_a_viewer_is_refused_with_the_rows_sentence(self, market):
        applications = market(role=MarketRole.VIEWER)

        with pytest.raises(ForbiddenError) as refused:
            _update({"shop": "Ember Ceramics"})

        assert str(refused.value) == (
            "Only an Editor, an Admin or the owner may update this market's vendors' info."
        )
        assert not _stored(applications).get("answer_updates")

    def test_the_markets_own_row_governs_it(self, market):
        """A market that keeps its own row for it (E39/F01/S03) is asked that row, not the
        built-in default: an Editor is refused where the market asks for an Admin."""
        applications = market(role=MarketRole.EDITOR, permissions={
            "update-vendor-info": {"role": "admin", "source": "market"}})

        with pytest.raises(ForbiddenError) as refused:
            _update({"shop": "Ember Ceramics"})

        assert str(refused.value) == (
            "Only an Admin or the owner may update this market's vendors' info.")
        assert not _stored(applications).get("answer_updates")

    def test_an_editor_may(self, market):
        market(role=MarketRole.EDITOR)

        _result, status = _update({"shop": "Ember Ceramics"})

        assert status == 200

    def test_an_archived_market_refuses_it(self, market):
        applications = market(MarketPhase.ARCHIVED)

        with pytest.raises(ForbiddenError):
            _update({"shop": "Ember Ceramics"})

        assert not _stored(applications).get("answer_updates")

    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT,
                                       MarketPhase.MARKET_DAYS])
    def test_no_phase_owns_it(self, market, phase):
        market(phase)

        _result, status = _update({"shop": "Ember Ceramics"})

        assert status == 200


class TestTheHistory:
    def test_each_update_is_one_entry_with_who_and_the_answers_before_and_after(
            self, market, market_records):
        market()

        _update({"shop": "Ember Ceramics", "student": "Yes"})

        [entry] = market_records.history.documents
        assert entry["actor"] == "editor@market.test"
        assert entry["at"]
        assert entry["action"] == "update-vendor-info"
        assert entry["vendors"] == [VENDOR]
        assert entry["subject"] == {"application_id": "app-1"}
        assert entry["detail"]["before"] == {"shop": "Ember Ceramcs", "student": "No"}
        assert entry["detail"]["after"] == {"shop": "Ember Ceramics", "student": "Yes"}

    def test_going_back_to_their_answer_is_recorded_too(self, market, market_records):
        market()
        _update({"shop": "Ember Ceramics"})

        _update({"shop": "Ember Ceramcs"})

        entry = market_records.history.documents[-1]
        assert entry["detail"]["before"] == {"shop": "Ember Ceramics"}
        assert entry["detail"]["after"] == {"shop": "Ember Ceramcs"}

    def test_an_update_that_changes_nothing_records_nothing(self, market, market_records):
        market()

        _update({"shop": "Ember Ceramcs"})

        assert market_records.history.documents == []


class TestTheAutomaticRejectionsJudgeTheUpdate:
    def test_an_update_that_meets_a_rule_is_rejected_by_it(self, market, market_records):
        applications = market(rejectionRules=[{"key": "student", "answers": ["Yes"]}])

        _update({"student": "Yes"})

        assert _stored(applications)["status"] == "reviewer_rejected"
        assert market_records.history.documents[-1]["detail"]["rejected_by_rules"] is True

    def _rejected_by_the_rule(self, market, phase):
        """Rejected by the rule "No" on the student question, as a rule's verdict is stored."""
        applications = market(phase, rejectionRules=[{"key": "student", "answers": ["No"]}])
        applications.update_one({"id": "app-1"}, {"$set": {
            "status": "reviewer_rejected", "verdict_by": {"kind": "rule", "rule": "student"},
            "verdict_at": "2026-05-03T00:00:00+00:00", "verdict_reason": "Answered No"}})
        return applications

    def test_in_review_an_update_past_a_rule_returns_it_to_undecided(
            self, market, market_records):
        applications = self._rejected_by_the_rule(market, MarketPhase.APPLICATIONS)

        _update({"student": "Yes"})

        assert _stored(applications)["status"] == "open"
        assert market_records.history.documents[-1]["detail"]["returned_by_rules"] is True

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS])
    def test_past_review_the_update_stands_and_the_verdict_stays(
            self, market, market_records, phase):
        """The rules settle with the verdicts on entering assignment: an application they return to
        undecided then is one no verdict could decide again."""
        applications = self._rejected_by_the_rule(market, phase)

        _update({"student": "Yes"})

        stored = _stored(applications)
        assert stored["answer_updates"]["student"]["value"] == "Yes"
        assert stored["status"] == "reviewer_rejected"
        assert stored["verdict_by"] == {"kind": "rule", "rule": "student"}
        detail = market_records.history.documents[-1]["detail"]
        assert detail["returned_by_rules"] is False and detail["rejected_by_rules"] is False

    def test_past_review_an_update_that_meets_a_rule_rejects_nobody(self, market):
        applications = market(MarketPhase.ASSIGNMENT,
                              rejectionRules=[{"key": "student", "answers": ["Yes"]}])

        _update({"student": "Yes"})

        assert _stored(applications)["status"] == "open"


class TestAReImportKeepsTheUpdate:
    @pytest.fixture
    def imported(self, monkeypatch, applications, market_records):
        markets = FakeMarketsCollection(_market_doc(phase=MarketPhase.APPLICATIONS))
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        stored = applications.find_one({"applicant_email": "nadia@ember.test"})
        VendorInfo.update_vendor_info(
            stored["market_id"], stored["id"], {"business_name": "Ember Ceramics Studio"}, EDITOR)
        return markets, stored["id"]

    def _view(self, applications, app_id):
        return ApplicantsApi.organizer_view(applications.find_one({"id": app_id}))

    def test_the_same_original_keeps_the_update_silently(self, imported, applications):
        markets, app_id = imported

        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        view = self._view(applications, app_id)
        assert view["formData"]["business_name"] == "Ember Ceramics Studio"
        assert view["answerUpdates"]["business_name"]["changedSince"] is False

    def test_a_changed_original_keeps_the_update_and_says_so(self, imported, applications):
        markets, app_id = imported
        changed = GOOD_ROW.replace("Ember Ceramics", "Ember Pottery")

        CsvImport.import_applications(markets, markets.doc, _csv(changed), MAPPING)

        view = self._view(applications, app_id)
        assert view["formData"]["business_name"] == "Ember Ceramics Studio"
        update = view["answerUpdates"]["business_name"]
        assert update["changedSince"] is True
        assert update["theyWrote"] == "Ember Pottery"
        assert update["over"] == "Ember Ceramics"
