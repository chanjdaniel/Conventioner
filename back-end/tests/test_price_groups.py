"""Price groups on the Pricing card (E43/F01/S02).

The card's rows are groups the organizer names, each a rule over the vendor's own answers to the
market's choice questions, all of whose conditions must hold; a vendor pays the cheapest group they
match (Daniel, T92 Q6), and one who matches none pays "Everyone else". The groups read a vendor's
answers as the organizer does, updates included. A condition on a question the form no longer asks
is broken: it prices nobody, and it keeps the market in draft until it is fixed.

The Example College table is one configuration of it: three groups and "Everyone else", Gold and Silver.
"""
import copy

import pytest

from conftest import COMPLETE_PLAN, FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import guards
import history as History
import pricing as Pricing
from assignment.utils import convert_keys_to_snake_case
from client_errors import BadRequestError
from datatypes import ApplicationForm, MarketPhase, MarketTableRow, SetupObject

STUDENT = "Current Example College student"
ALUMNI = "Example College alumni/staff"
CLUBS = ["Art Club", "Craft Club"]
NO_CLUB = "Not in any of these clubs"

FIELDS = [
    {"key": "affiliation", "label": "Are you an Example College student or alumni?", "type": "multi_select",
     "options": [STUDENT, ALUMNI]},
    {"key": "clubs", "label": "Which clubs are you a member of?", "type": "multi_select",
     "options": [*CLUBS, NO_CLUB]},
    {"key": "volunteer", "label": "I volunteered last year", "type": "checkbox"},
    {"key": "business", "label": "Business name", "type": "text"},
]

GOLD_AND_SILVER = {
    **COMPLETE_PLAN,
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "sections": [
        {"name": "North Wing", "count": 2, "location": {"name": "Main Hall"},
         "tier": {"id": 0, "name": "Gold"}},
        {"name": "Landing", "count": 2, "location": {"name": "Main Hall"},
         "tier": {"id": 1, "name": "Silver"}},
    ],
}


def _prices(gold, silver):
    return [{"tier": "Gold", "cents": gold}, {"tier": "Silver", "cents": silver}]


#: The attached Example College table, as an organizer enters it: three groups and "Everyone else".
UBC_TABLE = {
    "currency": "CAD",
    "halfTablePercent": 50,
    "groups": [
        {"name": "Example College student + club member",
         "conditions": [{"key": "affiliation", "answers": [STUDENT]},
                        {"key": "clubs", "answers": CLUBS}],
         "prices": _prices(1200, 1000)},
        {"name": "Example College student only",
         "conditions": [{"key": "affiliation", "answers": [STUDENT]}],
         "prices": _prices(1500, 1300)},
        {"name": "Example College alumni + club member",
         "conditions": [{"key": "affiliation", "answers": [ALUMNI]},
                        {"key": "clubs", "answers": CLUBS}],
         "prices": _prices(2500, 2200)},
    ],
    "everyoneElse": _prices(3500, 3000),
}


def _market(pricing=UBC_TABLE, fields=FIELDS, phase=MarketPhase.DRAFT):
    plan = copy.deepcopy(GOLD_AND_SILVER)
    plan["pricing"] = copy.deepcopy(pricing)
    return client_market(
        phase=phase, application_form=ApplicationForm(fields=fields),
        setup_object=SetupObject(**convert_keys_to_snake_case(plan)))


def _price(answers, tier="Gold", choice="Full Table", market=None):
    """What a vendor with these answers pays for one table-day, and the group that set it."""
    market = market or _market()
    groups = Pricing.Groups(market)
    return groups.price(answers, tier, choice)


class TestTheUbcTable:
    def test_a_student_club_member_pays_the_student_club_price(self):
        answers = {"affiliation": [STUDENT], "clubs": ["Art Club"]}

        assert _price(answers, "Gold") == (1200, "Example College student + club member")
        assert _price(answers, "Silver") == (1000, "Example College student + club member")

    def test_an_alumnus_with_no_club_pays_everyone_elses_price(self):
        answers = {"affiliation": [ALUMNI], "clubs": [NO_CLUB]}

        assert _price(answers, "Gold") == (3500, "Everyone else")
        assert _price(answers, "Silver") == (3000, "Everyone else")

    def test_an_alumnus_in_a_club_pays_the_alumni_club_price(self):
        assert _price({"affiliation": [ALUMNI], "clubs": ["Craft Club"]}) == (
            2500, "Example College alumni + club member")

    def test_a_half_table_is_the_share_of_the_groups_price(self):
        answers = {"affiliation": [STUDENT], "clubs": [NO_CLUB]}

        assert _price(answers, "Silver", "Half Table") == (650, "Example College student only")


class TestTheCheapestGroupWins:
    def test_a_vendor_matching_two_groups_pays_the_cheaper(self):
        """Every student club member is a student too: $12, not $15."""
        answers = {"affiliation": [STUDENT], "clubs": ["Art Club"]}

        assert _price(answers) == (1200, "Example College student + club member")

    def test_a_vendor_who_ticked_both_student_and_alumni_pays_the_cheapest(self):
        answers = {"affiliation": [STUDENT, ALUMNI], "clubs": ["Art Club"]}

        assert _price(answers, "Gold") == (1200, "Example College student + club member")

    def test_the_cheapest_is_judged_at_the_tables_own_tier(self):
        """One group cheaper at Gold, another at Silver: each table-day pays its tier's cheapest."""
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][1]["prices"] = _prices(1100, 1300)
        answers = {"affiliation": [STUDENT], "clubs": ["Art Club"]}
        market = _market(pricing)

        assert _price(answers, "Gold", market=market) == (1100, "Example College student only")
        assert _price(answers, "Silver", market=market) == (1000, "Example College student + club member")

    def test_a_vendor_matching_none_pays_everyone_else(self):
        assert _price({"affiliation": [], "clubs": [NO_CLUB]}) == (3500, "Everyone else")
        assert _price({}) == (3500, "Everyone else")

    def test_a_group_dearer_than_everyone_else_still_prices_its_members(self):
        """"Everyone else" is for who matches no group, not a cap."""
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"] = [{"name": "Corporate", "conditions": [
            {"key": "volunteer", "answers": ["not ticked"]}], "prices": _prices(9000, 8000)}]

        assert _price({"volunteer": False}, market=_market(pricing)) == (9000, "Corporate")

    def test_a_group_with_no_price_at_a_tier_leaves_its_members_to_everyone_else_there(self):
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"] = [pricing["groups"][1] | {"prices": [{"tier": "Gold", "cents": 1500}]}]
        answers = {"affiliation": [STUDENT]}
        market = _market(pricing)

        assert _price(answers, "Gold", market=market) == (1500, "Example College student only")
        assert _price(answers, "Silver", market=market) == (3000, "Everyone else")

    def test_with_no_groups_the_price_names_no_group(self):
        pricing = {**UBC_TABLE, "groups": []}

        assert _price({"affiliation": [STUDENT]}, market=_market(pricing)) == (3500, None)

    def test_a_tier_nobody_prices_has_no_price(self):
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["everyoneElse"] = [{"tier": "Gold", "cents": 3500}]

        assert _price({"affiliation": [ALUMNI]}, "Silver", market=_market(pricing)) is None


class TestWhatAGroupMatches:
    def test_every_condition_must_hold(self):
        """An alumnus with no club meets the alumni condition but not the club one."""
        assert _price({"affiliation": [ALUMNI], "clubs": [NO_CLUB]})[1] == "Everyone else"

    def test_a_single_choice_answer_meets_a_condition(self):
        fields = [{**FIELDS[0], "type": "select"}, *FIELDS[1:]]
        market = _market(fields=fields)

        assert _price({"affiliation": STUDENT, "clubs": [NO_CLUB]}, market=market) == (
            1500, "Example College student only")

    def test_a_checkbox_condition(self):
        pricing = {**UBC_TABLE, "groups": [{"name": "Volunteers", "conditions": [
            {"key": "volunteer", "answers": ["ticked"]}], "prices": _prices(500, 400)}]}
        market = _market(pricing)

        assert _price({"volunteer": True}, market=market) == (500, "Volunteers")
        assert _price({"volunteer": False}, market=market) == (3500, "Everyone else")

    def test_a_group_with_no_condition_matches_nobody(self):
        pricing = {**UBC_TABLE, "groups": [
            {"name": "Being written", "conditions": [], "prices": _prices(100, 100)}]}

        assert _price({"affiliation": [STUDENT]}, market=_market(pricing))[1] == "Everyone else"

    def test_a_condition_with_no_answer_ticked_matches_nobody(self):
        pricing = {**UBC_TABLE, "groups": [{"name": "Being written", "conditions": [
            {"key": "affiliation", "answers": []}], "prices": _prices(100, 100)}]}

        assert _price({"affiliation": [STUDENT]}, market=_market(pricing))[1] == "Everyone else"

    def test_a_broken_condition_matches_nobody(self):
        """The form no longer asks "clubs": the student club group prices nobody, even a vendor
        whose stored answers still hold the old question."""
        market = _market(fields=[FIELDS[0]])

        assert _price({"affiliation": [STUDENT], "clubs": ["Art Club"]}, market=market) == (
            1500, "Example College student only")


class TestBrokenConditions:
    def test_a_condition_on_a_question_removed_from_the_form_is_broken(self):
        market = _market(fields=[FIELDS[0]])

        assert Pricing.Groups(market).broken() == [
            "Example College student + club member", "Example College alumni + club member"]

    def test_a_condition_on_an_answer_the_question_no_longer_offers_is_broken(self):
        fields = [{**FIELDS[0], "options": [STUDENT]}, *FIELDS[1:]]

        assert Pricing.Groups(_market(fields=fields)).broken() == ["Example College alumni + club member"]

    def test_a_condition_on_a_question_answered_in_words_is_broken(self):
        pricing = {**UBC_TABLE, "groups": [{"name": "Named", "conditions": [
            {"key": "business", "answers": ["Acme"]}], "prices": _prices(100, 100)}]}

        assert Pricing.Groups(_market(pricing)).broken() == ["Named"]

    def test_the_ubc_table_on_its_own_form_is_whole(self):
        assert Pricing.Groups(_market()).broken() == []

    def test_a_market_never_priced_has_nothing_broken(self):
        market = _market()
        market.setup_object.pricing = None

        assert Pricing.Groups(market).broken() == []


class TestTheQuestionsTheGroupsRead:
    def test_only_whole_conditions_keys_are_read(self):
        """A broken condition's key is no question of the form, so it never reaches the answers'
        projection, whatever it says."""
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][0]["conditions"].append({"key": "gone", "answers": ["x"]})

        assert Pricing.Groups(_market(pricing)).keys() == ["affiliation", "clubs"]

    def test_colliding_paths_are_never_projected_together(self, monkeypatch):
        """``a`` beside ``a.b`` is a projection Mongo refuses; only the form's slugs are read."""
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][0]["conditions"] = [
            {"key": "clubs", "answers": CLUBS}, {"key": "clubs.a", "answers": ["x"]}]
        read = []
        monkeypatch.setattr(Pricing.ApplicationsApi, "vendor_answers_for_market",
                            lambda _id, keys: read.append(keys) or {})

        Pricing.vendor_answers(Pricing.Groups(_market(pricing)), "market-123")

        assert read == [["clubs", "affiliation"]]


class TestLeavingDraft:
    def _blockers(self, market):
        return [result for result in guards.evaluate_transition(market, "draft", "applications", None)
                if not result.passed]

    def test_a_broken_group_blocks_leaving_draft_with_its_own_line(self):
        guard = guards.PriceGroupsStandGuard()

        result = guard.evaluate(_market(fields=[FIELDS[0]]), None)

        assert result.passed is False
        assert result.id == "price_groups_stand"
        assert "Example College student + club member" in result.message
        assert "Example College alumni + club member" in result.message
        assert "Example College student only" not in result.message
        assert result.resolution_link == "setup"

    def test_it_is_on_the_way_out_of_draft(self):
        ids = {guard.id for guard in guards.TRANSITION_GUARDS[("draft", "applications")]}

        assert "price_groups_stand" in ids

    def test_whole_groups_pass(self):
        assert guards.PriceGroupsStandGuard().evaluate(_market(), None).passed is True


def _with(pricing):
    plan = copy.deepcopy(GOLD_AND_SILVER)
    plan["pricing"] = pricing
    return {"setupObject": plan}


@pytest.fixture
def market(monkeypatch):
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

    def at(phase=MarketPhase.DRAFT, pricing=None):
        plan = copy.deepcopy(GOLD_AND_SILVER)
        if pricing is not None:
            plan["pricing"] = copy.deepcopy(pricing)
        fake = FakeMarketsCollection(stored_market(
            phase=phase, setupObject=plan, applicationForm={"fields": FIELDS}))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    return at


class TestThePlanWrite:
    def test_the_groups_round_trip(self, market):
        collection = market()

        MarketsApi.save_plan("market-123", _with(UBC_TABLE), "user-1")

        assert collection.last_update["$set"]["setupObject"]["pricing"] == UBC_TABLE

    def test_a_group_on_a_question_the_form_no_longer_asks_still_saves(self, market):
        """A form change never makes the plan unsavable: the condition is kept, shown broken."""
        collection = market()
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][0]["conditions"][1]["key"] = "gone"

        MarketsApi.save_plan("market-123", _with(pricing), "user-1")

        assert collection.last_update["$set"]["setupObject"]["pricing"] == pricing

    @pytest.mark.parametrize("what, change", [
        ("a group with no name", lambda g: g.update(name="  ")),
        ("a group named as the last row", lambda g: g.update(name="Everyone else")),
        ("a price for a tier the plan lacks",
         lambda g: g.update(prices=[{"tier": "Bronze", "cents": 100}])),
        ("a tier priced twice", lambda g: g.update(prices=[
            {"tier": "Gold", "cents": 100}, {"tier": "Gold", "cents": 200}])),
        ("two conditions on one question", lambda g: g.update(conditions=[
            {"key": "affiliation", "answers": [STUDENT]},
            {"key": "affiliation", "answers": [ALUMNI]}])),
        ("a condition on no question", lambda g: g.update(conditions=[{"key": " ", "answers": []}])),
        ("a negative price", lambda g: g.update(prices=[{"tier": "Gold", "cents": -1}])),
    ])
    def test_it_refuses(self, market, what, change):
        collection = market()
        pricing = copy.deepcopy(UBC_TABLE)
        change(pricing["groups"][0])

        with pytest.raises(BadRequestError):
            MarketsApi.save_plan("market-123", _with(pricing), "user-1")
        assert collection.last_update is None

    @pytest.mark.parametrize("key", ["year_of_study.", "$where", "clubs.a", "Clubs", "a b"])
    def test_a_condition_key_outside_the_forms_key_pattern_is_refused(self, market, key):
        """A key reaches a Mongo projection: only the form's own slugs may (a request value is a
        string, never a query shape)."""
        collection = market()
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][0]["conditions"][1]["key"] = key

        with pytest.raises(BadRequestError, match="question"):
            MarketsApi.save_plan("market-123", _with(pricing), "user-1")
        assert collection.last_update is None

    def test_two_groups_with_one_name_are_refused(self, market):
        collection = market()
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][1]["name"] = "example college student + club member "

        with pytest.raises(BadRequestError, match="two groups"):
            MarketsApi.save_plan("market-123", _with(pricing), "user-1")
        assert collection.last_update is None

    def test_after_draft_a_group_change_is_refused(self, market):
        collection = market(MarketPhase.APPLICATIONS, pricing=UBC_TABLE)
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"].pop()

        with pytest.raises(BadRequestError, match="settled"):
            MarketsApi.save_plan("market-123", _with(pricing), "user-1")
        assert collection.last_update is None


class TestTheHistory:
    def test_adding_a_group_is_recorded_with_who_when_and_before_and_after(
            self, market, market_records):
        before = {**UBC_TABLE, "groups": UBC_TABLE["groups"][:2]}
        market(pricing=before)

        MarketsApi.save_plan("market-123", _with(UBC_TABLE), "dana@example.com")

        [entry] = [doc for doc in market_records.history.documents
                   if doc["kind"] == History.PRICING]
        assert entry["actor"] == "dana@example.com"
        assert entry["at"]
        assert entry["action"] == "change-setup"
        assert list(entry["detail"]["before"]) == ["groups"]
        assert [g["name"] for g in entry["detail"]["before"]["groups"]] == [
            "Example College student + club member", "Example College student only"]
        assert entry["detail"]["after"]["groups"][2] == {
            "name": "Example College alumni + club member",
            "conditions": [{"key": "affiliation", "answers": [ALUMNI]},
                           {"key": "clubs", "answers": CLUBS}],
            "prices": [{"tier": "Gold", "cents": 2500}, {"tier": "Silver", "cents": 2200}],
        }

    def test_a_market_never_priced_records_its_first_groups_from_no_group(self, market, market_records):
        market()

        MarketsApi.save_plan("market-123", _with(UBC_TABLE), "dana@example.com")

        [entry] = [doc for doc in market_records.history.documents
                   if doc["kind"] == History.PRICING]
        assert entry["detail"]["before"]["groups"] == []
        assert len(entry["detail"]["after"]["groups"]) == 3

    def test_a_groups_condition_changing_is_recorded(self, market, market_records):
        market(pricing=UBC_TABLE)
        pricing = copy.deepcopy(UBC_TABLE)
        pricing["groups"][0]["conditions"][1]["answers"] = ["Art Club"]

        MarketsApi.save_plan("market-123", _with(pricing), "dana@example.com")

        [entry] = [doc for doc in market_records.history.documents
                   if doc["kind"] == History.PRICING]
        assert entry["detail"]["after"]["groups"][0]["conditions"][1]["answers"] == ["Art Club"]


def _row(table_code, slots, tier, choice):
    return MarketTableRow(
        date="2099-08-01", assignment=[email for email in slots if email],
        assignment_slots=slots, location="Main Hall", section=table_code.rsplit(" ", 1)[0],
        table_choice=choice, table_code=table_code, tier=tier,
    )


class TestTheTablesRead:
    def _tables(self, monkeypatch, rows):
        plan = copy.deepcopy(GOLD_AND_SILVER)
        plan["pricing"] = copy.deepcopy(UBC_TABLE)
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(
            phase=MarketPhase.ASSIGNMENT, setupObject=plan, applicationForm={"fields": FIELDS})))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", lambda _market: [])
        monkeypatch.setattr(MarketsApi, "assignment_to_show", lambda market, vendors: market)
        monkeypatch.setattr(MarketsApi, "derive_market_table_rows", lambda _market: rows)
        monkeypatch.setattr(MarketsApi, "outside_solver_vendors", lambda *_a: [])
        result, status = MarketsApi.get_market_tables("market-123", "viewer@example.com")
        assert status == 200
        return result["rows"]

    def _apply(self, applications, email, answers, updates=None):
        applications.documents.append({
            "id": f"app-{email}", "market_id": "market-123", "applicant_email": email,
            "form_data": answers, **({"answer_updates": updates} if updates else {})})

    def test_each_vendor_is_priced_by_their_own_group(self, monkeypatch, applications):
        self._apply(applications, "ana@example.com", {"affiliation": [STUDENT], "clubs": CLUBS})
        self._apply(applications, "ben@example.com", {"affiliation": [ALUMNI], "clubs": [NO_CLUB]})

        rows = self._tables(monkeypatch, [
            _row("North Wing 1", ["ana@example.com", "ana@example.com"], "Gold", "Full Table"),
            _row("Landing 1", ["ana@example.com", "Ben@Example.com"], "Silver", "Half Table"),
        ])

        assert rows[0]["prices"] == [
            {"email": "ana@example.com", "cents": 1200, "group": "Example College student + club member"}]
        assert rows[1]["prices"] == [
            {"email": "ana@example.com", "cents": 500, "group": "Example College student + club member"},
            {"email": "Ben@Example.com", "cents": 1500, "group": "Everyone else"},
        ]

    def test_a_vendors_group_reads_their_updated_answers(self, monkeypatch, applications):
        """An organizer's update of an answer is what the price reads (E41/F01/S01)."""
        self._apply(applications, "ana@example.com", {"affiliation": [ALUMNI], "clubs": [NO_CLUB]},
                    updates={"clubs": {"value": ["Art Club"], "by": "dana@example.com",
                                       "at": "2099-01-01T00:00:00+00:00"}})

        rows = self._tables(monkeypatch, [
            _row("North Wing 1", ["ana@example.com", "ana@example.com"], "Gold", "Full Table"),
        ])

        assert rows[0]["prices"] == [
            {"email": "ana@example.com", "cents": 2500, "group": "Example College alumni + club member"}]

    def test_a_vendor_with_no_application_pays_everyone_else(self, monkeypatch):
        rows = self._tables(monkeypatch, [
            _row("North Wing 1", ["walk@example.com", "walk@example.com"], "Gold", "Full Table"),
        ])

        assert rows[0]["prices"] == [
            {"email": "walk@example.com", "cents": 3500, "group": "Everyone else"}]
