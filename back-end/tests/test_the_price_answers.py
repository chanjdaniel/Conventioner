"""Adding a vendor asks the price answers; updating them is an Admin's (E43/F01/S03).

A vendor added by hand is asked every question a price group reads, each required, so they are
priced like any other (Daniel, T92 Q14); a market whose card has no group asks nothing more. The
answers a price group reads are updated behind the same row as the assignment's, "Update info the
assignment or price reads", Admin by default. Each write is recorded in the market's history with
who, when and the answers before and after.

The Example College table is one configuration of it: no question is named by the code.
"""
import copy
import re

import pytest

from conftest import FakeMarketsCollection, stored_market
from test_price_groups import ALUMNI, CLUBS, EXAMPLE_TABLE, FIELDS, GOLD_AND_SILVER, NO_CLUB, STUDENT

import api.added_vendors as AddedVendors
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.vendor_info as VendorInfo
import essential_fields as EF
import pricing as Pricing
from client_errors import ForbiddenError
from datatypes import MarketPerson, MarketPhase, MarketRole

MARKET = "market-123"
ADMIN = MarketPerson(user_id="user-admin", email="admin@market.test")
EDITOR = MarketPerson(user_id="user-editor", email="editor@market.test")
VENDOR = "vendor@example.com"
STUDENT_IN_A_CLUB = {"affiliation": [STUDENT], "clubs": ["Art Club"]}
FORM_FIELDS = [{"required": False, "options": [], **field, "order": order}
               for order, field in enumerate(FIELDS)]

REFUSED = "Only an Admin or the owner may update the answers this market's assignment or prices read."


def _document(phase, pricing=EXAMPLE_TABLE, fields=FORM_FIELDS, **overrides):
    plan = copy.deepcopy(GOLD_AND_SILVER)
    plan["pricing"] = copy.deepcopy(pricing)
    return stored_market(phase, setupObject=plan,
                         applicationForm={"fields": fields}, **overrides)


@pytest.fixture
def adding(monkeypatch):
    """A market in market days with the Example College card, and the applications added to it."""
    written = []

    def at(pricing=EXAMPLE_TABLE, phase=MarketPhase.MARKET_DAYS, fields=FORM_FIELDS):
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(_document(phase, pricing, fields)))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        monkeypatch.setattr(
            AddedVendors.ApplicationsApi, "find_application_by_email", lambda *_a: None)
        monkeypatch.setattr(
            AddedVendors.ApplicationsApi, "find_or_create_application",
            lambda application: written.append(application) or application)
        return written

    return at


def _add(answers=None, name="Walk-in Wares"):
    data = {"name": name, "email": "Walk.In@Example.com"}
    if answers is not None:
        data["answers"] = answers
    return AddedVendors.add_vendor(MARKET, data, EDITOR)


def _market():
    return MarketsApi.market_from_document(MarketsApi.markets_collection.doc)


class TestAddingAVendorAsksThePriceAnswers:
    def test_the_answers_are_stored_and_price_the_vendor_like_any_other(self, adding):
        written = adding()

        _result, status = _add(STUDENT_IN_A_CLUB)

        assert status == 201
        [application] = written
        assert application.form_data == {
            EF.FULL_NAME_KEY: "Walk-in Wares", **STUDENT_IN_A_CLUB}
        price = Pricing.Groups(_market()).price(application.form_data, "Gold", "Full Table")
        assert price == (1200, "Example College student + club member")

    @pytest.mark.parametrize("answers, missing", [
        ({}, "Are you an Example College student or alumni?"),
        ({"clubs": ["Art Club"]}, "Are you an Example College student or alumni?"),
        ({"affiliation": [ALUMNI]}, "Do you belong to any of these clubs?"),
        ({"affiliation": [ALUMNI], "clubs": []}, "Do you belong to any of these clubs?"),
    ])
    def test_each_question_a_group_reads_is_required(self, adding, answers, missing):
        """Though the form leaves it optional: an added vendor is priced by it."""
        written = adding()

        with pytest.raises(AddedVendors.AddVendorInvalid, match=re.escape(f"'{missing}' is required.")):
            _add(answers)

        assert written == []

    def test_no_answers_at_all_is_refused_too(self, adding):
        adding()

        with pytest.raises(AddedVendors.AddVendorInvalid, match="is required"):
            _add()

    def test_an_answer_the_question_does_not_offer_is_refused(self, adding):
        written = adding()

        with pytest.raises(AddedVendors.AddVendorInvalid):
            _add({"affiliation": ["Visiting scholar"], "clubs": [NO_CLUB]})

        assert written == []

    def test_a_question_no_group_reads_is_not_asked(self, adding):
        written = adding()

        with pytest.raises(AddedVendors.AddVendorInvalid, match="not asked"):
            _add({**STUDENT_IN_A_CLUB, "business": "Walk-in Wares Ltd"})

        assert written == []

    def test_a_checkbox_left_unticked_is_an_answer(self, adding):
        """"Not ticked" is one of a checkbox's two answers, so it is never missing."""
        written = adding({**EXAMPLE_TABLE, "groups": [{
            "name": "Volunteers", "conditions": [{"key": "volunteer", "answers": ["ticked"]}],
            "prices": [{"tier": "Gold", "cents": 500}]}]})

        _add({})

        [application] = written
        assert application.form_data["volunteer"] is False
        price = Pricing.Groups(_market()).price(application.form_data, "Gold", "Full Table")
        assert price == (3500, Pricing.EVERYONE_ELSE)

    @pytest.mark.parametrize("pricing", [None, {**EXAMPLE_TABLE, "groups": []}])
    def test_a_market_without_groups_asks_nothing_more(self, adding, pricing):
        written = adding(pricing)

        _result, status = _add()

        assert status == 201
        assert written[0].form_data == {EF.FULL_NAME_KEY: "Walk-in Wares"}

    def test_a_condition_on_a_question_the_form_no_longer_asks_asks_nothing(self, adding):
        """A broken condition prices nobody (E43/F01/S02), so there is nothing to ask for it."""
        written = adding({**EXAMPLE_TABLE, "groups": [{
            "name": "First years", "conditions": [{"key": "year_of_study", "answers": ["First"]}],
            "prices": [{"tier": "Gold", "cents": 1000}]}]})

        _add({})

        assert written[0].form_data == {EF.FULL_NAME_KEY: "Walk-in Wares"}

    def test_the_market_read_serves_the_questions_the_groups_read(self, adding):
        adding()

        assert MarketsApi.price_facts(_market()) == {"priceReads": ["affiliation", "clubs"]}

    def test_the_history_entry_says_who_and_the_answers_given(self, adding, market_records):
        adding()

        _add(STUDENT_IN_A_CLUB)

        [entry] = market_records.history.documents
        assert entry["actor"] == "editor@market.test"
        assert entry["at"]
        assert entry["action"] == "add-vendor"
        # The vendor's drawer reads the entries that name them.
        assert entry["vendors"] == ["walk.in@example.com"]
        assert entry["detail"]["before"] == {"name": None, "status": None, "answers": None}
        assert entry["detail"]["after"] == {
            "name": "Walk-in Wares", "status": "reviewer_approved",
            "answers": STUDENT_IN_A_CLUB}

    def test_a_price_answer_keyed_status_keeps_the_real_status(self, adding, market_records):
        """A group may read a question the form keys `status`; the entry keeps both apart."""
        fields = [{"key": "status", "label": "Student or staff?", "type": "select",
                   "options": ["Student", "Staff"], "order": 0}]
        pricing = {**EXAMPLE_TABLE, "groups": [{
            "name": "Students", "conditions": [{"key": "status", "answers": ["Student"]}],
            "prices": [{"tier": "Gold", "cents": 1200}]}]}
        adding(pricing, fields=fields)

        _add({"status": "Student"})

        [entry] = market_records.history.documents
        assert entry["detail"]["before"] == {"name": None, "status": None, "answers": None}
        assert entry["detail"]["after"] == {
            "name": "Walk-in Wares", "status": "reviewer_approved",
            "answers": {"status": "Student"}}


@pytest.fixture
def updating(monkeypatch, applications):
    """A market with the Example College card and one approved vendor, the asker holding ``role``."""
    def at(role=MarketRole.ADMIN, phase=MarketPhase.ASSIGNMENT, **overrides):
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(_document(phase, **overrides)))
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        applications.insert_one({
            "id": "app-1", "market_id": MARKET, "applicant_email": VENDOR,
            "form_data": {EF.FULL_NAME_KEY: "Nadia Okonkwo", "affiliation": [ALUMNI],
                          "clubs": [NO_CLUB], "volunteer": False, "business": "Ember Ceramics"},
            "status": "reviewer_approved", "application_type": "main",
            "submitted_at": "2026-05-02T09:14:03+00:00", "updated_at": "2026-05-02T09:14:03+00:00",
        })
        return applications
    return at


def _update(answers, by):
    return VendorInfo.update_vendor_info(MARKET, "app-1", answers, by)


class TestUpdatingAPriceAnswerIsAnAdmins:
    @pytest.mark.parametrize("answers", [
        {"affiliation": [STUDENT]},
        {"clubs": CLUBS},
        {"affiliation": [STUDENT], "business": "Ember & Co"},
        # Refused before it is judged: told the row, not what is wrong with the answer.
        {"affiliation": ["Visiting scholar"]},
        {"business": "Ember & Co", "clubs": "not a list"},
    ])
    def test_an_editor_is_refused_with_the_rows_sentence(self, updating, answers, market_records):
        applications = updating(MarketRole.EDITOR)

        with pytest.raises(ForbiddenError) as refused:
            _update(answers, EDITOR)

        assert str(refused.value) == REFUSED
        assert not applications.find_one({"id": "app-1"}).get("answer_updates")
        assert market_records.history.documents == []

    def test_an_editor_may_update_a_question_no_group_reads(self, updating):
        applications = updating(MarketRole.EDITOR)

        _result, status = _update({"business": "Ember & Co"}, EDITOR)

        assert status == 200
        assert set(applications.find_one({"id": "app-1"})["answer_updates"]) == {"business"}

    def test_an_admin_updates_it_and_the_price_follows(self, updating, market_records):
        applications = updating()

        _result, status = _update({"affiliation": [STUDENT], "clubs": ["Craft Club"]}, ADMIN)

        assert status == 200
        stored = applications.find_one({"id": "app-1"})
        assert set(stored["answer_updates"]) == {"affiliation", "clubs"}
        answers = Pricing.vendor_answers(Pricing.Groups(_market()), MARKET)[VENDOR]
        assert Pricing.Groups(_market()).price(answers, "Silver", "Full Table") == (
            1000, "Example College student + club member")
        [entry] = market_records.history.documents
        assert (entry["actor"], entry["action"], entry["vendors"]) == (
            "admin@market.test", "update-vendor-info", [VENDOR])
        assert entry["at"]
        assert entry["detail"]["before"] == {"affiliation": [ALUMNI], "clubs": [NO_CLUB]}
        assert entry["detail"]["after"] == {"affiliation": [STUDENT], "clubs": ["Craft Club"]}

    def test_the_markets_own_row_governs_it(self, updating):
        """An Editor may where the market's own row asks for an Editor (E39/F01/S03)."""
        updating(MarketRole.EDITOR, permissions={
            "update-assignment-or-price-info": {"role": "editor", "source": "market"}})

        _result, status = _update({"affiliation": [STUDENT]}, EDITOR)

        assert status == 200

    def test_a_market_without_groups_leaves_every_question_an_editors(self, updating):
        updating(MarketRole.EDITOR, pricing=None)

        _result, status = _update({"affiliation": [STUDENT]}, EDITOR)

        assert status == 200
