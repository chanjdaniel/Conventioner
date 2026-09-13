"""Tests for the essential form fields: the answers the assignment solver reads directly.

``essential_fields.py`` is the single owner of the contract: the reserved answer keys, the
derivation of what the essential questions offer (from the market plan, never a second list),
the validation of an applicant's essential answers, and the freeze that stops the offering from
moving under recorded answers (the D9 principle extended to the offering).
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, FakeSlugMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import db_config as test_db_config
import essential_fields as EssentialFields
from api.applicants import get_public_application_form, save_applicant_application
from datatypes import Application, ApplicationForm, ApplicationStatus, EssentialFormOptions


DATES = ["2026-08-01", "2026-08-08", "2026-08-15"]
SECTIONS = ["Main Hall", "Garden"]
TABLE_TYPES = ["Full Table", "Half Table"]
TIERS = ["Gold", "Silver"]

OPTIONS = EssentialFormOptions(
    dates=DATES, sections=SECTIONS, table_types=TABLE_TYPES, tiers=TIERS,
)

# What a market PLAN offers today: table type is stubbed to one type, so it differs from OPTIONS.
# OPTIONS keeps two so the ranking validation still has something to rank - a frozen snapshot
# written before the stub may legitimately hold more than one.
STUB_TABLE_TYPES = [EssentialFields.STUB_TABLE_TYPE]
PLAN_OPTIONS = EssentialFormOptions(
    dates=DATES, sections=SECTIONS, table_types=STUB_TABLE_TYPES, tiers=TIERS,
)

SETUP_SNAKE = {
    "market_dates": [{"date": date} for date in DATES],
    "sections": [{"name": name, "count": 4} for name in SECTIONS],
    "tiers": [{"id": index, "name": name} for index, name in enumerate(TIERS)],
    "floorplans": [
        {"table_types": [{"name": "Stale Type"}]},
        {"table_types": [{"name": name} for name in TABLE_TYPES]},
    ],
}

# The same plan as Mongo stores it: camelCase throughout, complete enough for ``Market`` to
# parse (the organizer endpoint loads the market through ``market_from_document``).
def _camel_table_type(name: str) -> dict:
    return {"name": name, "widthMm": 1800.0, "heightMm": 800.0, "maxCapacity": 2}


SETUP_CAMEL = {
    "colNames": [],
    "colValues": [],
    "colInclude": [],
    "enumPriorityOrder": [],
    "priority": [],
    "marketDates": [{"date": date} for date in DATES],
    "tiers": [{"id": index, "name": name} for index, name in enumerate(TIERS)],
    "locations": [],
    "sections": [{"name": name, "count": 4} for name in SECTIONS],
    "assignmentOptions": {},
    "floorplans": [
        {"tableTypes": [_camel_table_type("Stale Type")]},
        {"tableTypes": [_camel_table_type(name) for name in TABLE_TYPES]},
    ],
}

VALID_ANSWERS = {
    "essential_available_dates": ["2026-08-08", "2026-08-01"],
    "essential_max_dates": 2,
    "essential_tier_preference": ["Silver", "Gold"],
    "essential_table_choice": "half",
    "essential_table_share_email": "buddy@example.com",
    "essential_section_ranking": ["Garden", "Main Hall"],
    "essential_table_type_ranking": ["Full Table", "Half Table"],
}


class TestEssentialOptionsFromSetup:
    def test_reads_dates_sections_and_tiers_from_the_plan(self):
        options = EssentialFields.essential_options_from_setup(SETUP_SNAKE)

        assert options.dates == DATES
        assert options.sections == SECTIONS
        assert options.tiers == TIERS

    def test_tiers_come_from_the_plan_not_the_floorplan(self):
        """Tier is a price band on the plan; unlike table types it owes nothing to a floorplan."""
        options = EssentialFields.essential_options_from_setup({
            "tiers": [{"id": 0, "name": "Gold"}],
            "floorplans": [{"table_types": [{"name": "Full Table"}]}],
        })

        assert options.tiers == ["Gold"]

    def test_table_type_is_stubbed_to_one_type_and_ignores_the_floorplan(self):
        """STUB until the floorplan ships (E01/F01/S03).

        Table type is a property of an individual table, not of its section - any table in any
        section may be any type - so only a floorplan can truly describe it, and the floorplan
        GUI is out of MVP scope. Until then a market has exactly one type, whatever floorplans
        it happens to carry.
        """
        options = EssentialFields.essential_options_from_setup(SETUP_SNAKE)

        assert options.table_types == [EssentialFields.STUB_TABLE_TYPE]
        assert "Stale Type" not in options.table_types
        assert "Full Table" not in options.table_types

    def test_a_market_with_no_plan_offers_nothing(self):
        assert EssentialFields.essential_options_from_setup(None) == EssentialFormOptions()

    def test_blank_and_duplicate_names_are_dropped(self):
        options = EssentialFields.essential_options_from_setup({
            "market_dates": [{"date": "2026-08-01"}, {"date": ""}, {"date": "2026-08-01"}],
            "sections": [{"name": "  Garden  "}, {"name": "Garden"}],
        })

        assert options.dates == ["2026-08-01"]
        assert options.sections == ["Garden"]


class TestEffectiveEssentialOptions:
    def test_live_offering_comes_from_the_stored_camel_case_plan(self):
        doc = stored_market(setupObject=SETUP_CAMEL)

        options = EssentialFields.effective_essential_options(doc)

        assert options == PLAN_OPTIONS

    def test_a_frozen_snapshot_wins_over_the_live_plan(self):
        """Once an answer froze the offering, later plan edits must never reach the form."""
        doc = stored_market(
            setupObject=SETUP_CAMEL,
            applicationForm={
                "fields": [],
                "essentialOptions": {
                    "dates": ["2026-01-01"],
                    "sections": ["Old Hall"],
                    "tableTypes": ["Old Table"],
                },
            },
        )

        options = EssentialFields.effective_essential_options(doc)

        assert options.dates == ["2026-01-01"]
        assert options.sections == ["Old Hall"]
        assert options.table_types == ["Old Table"]


class TestValidatedEssentialAnswers:
    def test_valid_answers_are_stored_under_the_reserved_keys(self):
        error, stored = EssentialFields.validated_essential_answers(VALID_ANSWERS, OPTIONS)

        assert error is None
        # Dates are canonicalized to the plan's order.
        assert stored["essential_available_dates"] == ["2026-08-01", "2026-08-08"]
        assert stored["essential_max_dates"] == 2
        # Accepted tiers are canonicalized to the plan's order, like dates.
        assert stored["essential_tier_preference"] == ["Gold", "Silver"]
        assert stored["essential_table_choice"] == "half"
        assert stored["essential_table_share_email"] == "buddy@example.com"
        assert stored["essential_section_ranking"] == ["Garden", "Main Hall"]
        assert stored["essential_table_type_ranking"] == ["Full Table", "Half Table"]

    @pytest.mark.parametrize("missing_key,expected", [
        ("essential_available_dates", "'Available dates' is required"),
        ("essential_max_dates", "'Number of dates you want' is required"),
        ("essential_tier_preference", "'Tier preference' is required"),
        ("essential_table_choice", "'Table choice' is required"),
        ("essential_section_ranking", "'Section preference' is required"),
        ("essential_table_type_ranking", "'Table type preference' is required"),
    ])
    def test_every_essential_answer_is_required(self, missing_key, expected):
        answers = {key: value for key, value in VALID_ANSWERS.items() if key != missing_key}

        error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is not None and expected in error
        assert stored == {}

    def test_a_date_the_market_does_not_offer_is_refused(self):
        answers = {**VALID_ANSWERS, "essential_available_dates": ["2027-01-01"]}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert "does not offer" in error

    def test_max_dates_must_be_a_whole_number_of_at_least_one(self):
        for bad in (0, -1, "abc", 1.5, True):
            answers = {**VALID_ANSWERS, "essential_max_dates": bad}
            error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)
            assert error is not None, f"{bad!r} should be refused"

    def test_max_dates_cannot_exceed_the_offered_dates(self):
        answers = {**VALID_ANSWERS, "essential_max_dates": len(DATES) + 1}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert "cannot exceed" in error

    def test_max_dates_may_exceed_the_available_dates(self):
        """STUB (product decision pending): max > len(available) is accepted; consumers treat
        the effective cap as min(max_dates, len(available_dates))."""
        answers = {**VALID_ANSWERS, "essential_available_dates": ["2026-08-01"],
                   "essential_max_dates": 3}

        error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is None
        assert stored["essential_max_dates"] == 3

    def test_a_partial_ranking_is_refused(self):
        """STUB (product decision pending): rankings are total; every offered option must be
        ranked."""
        answers = {**VALID_ANSWERS, "essential_section_ranking": ["Garden"]}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert "must rank every option" in error
        assert "Main Hall" in error

    def test_a_ranking_may_not_repeat_or_invent_options(self):
        repeated = {**VALID_ANSWERS, "essential_section_ranking": ["Garden", "Garden"]}
        invented = {**VALID_ANSWERS, "essential_table_type_ranking": ["Full Table", "Podium"]}

        assert EssentialFields.validated_essential_answers(repeated, OPTIONS)[0] is not None
        assert "does not offer" in EssentialFields.validated_essential_answers(invented, OPTIONS)[0]

    def test_questions_with_an_empty_offering_are_not_asked(self):
        """A plan with no sections or table types yet omits those questions; their answers
        store empty. Dates likewise."""
        error, stored = EssentialFields.validated_essential_answers({}, EssentialFormOptions())

        assert error is None
        assert stored == {
            "essential_available_dates": [],
            "essential_max_dates": None,
            "essential_tier_preference": [],
            "essential_table_choice": None,
            "essential_table_share_email": "",
            "essential_section_ranking": [],
            "essential_table_type_ranking": [],
        }


class TestTierPreference:
    """Tier is a HARD FILTER, not a ranking.

    The tier determines what an applicant pays for a table on a given day, so a vendor is never
    placed at a tier they did not accept - even if that leaves them unassigned. The answer is
    therefore the SET of tiers they accept, not an ordering of all of them.
    """

    def test_the_applicant_may_accept_a_subset_of_the_offered_tiers(self):
        """Unlike a ranking, this is not total: accepting only Gold is a complete answer."""
        answers = {**VALID_ANSWERS, "essential_tier_preference": ["Gold"]}

        error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is None
        assert stored["essential_tier_preference"] == ["Gold"]

    def test_a_tier_the_market_does_not_offer_is_refused(self):
        answers = {**VALID_ANSWERS, "essential_tier_preference": ["Platinum"]}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert "does not offer" in error

    def test_a_tier_name_is_matched_whole_never_as_a_substring(self):
        """The regression this question was split out to kill.

        The solver used to decide placement with ``table.tier.name in <the applicant's answer
        string>``, so a tier named 'A' matched an answer of 'AB'. An explicit set of accepted
        tier names cannot express that confusion: 'AB' is simply not on offer.
        """
        options = EssentialFormOptions(dates=DATES, tiers=["A"])
        answers = {
            "essential_available_dates": ["2026-08-01"],
            "essential_max_dates": 1,
            "essential_tier_preference": ["AB"],
        }

        error, _ = EssentialFields.validated_essential_answers(answers, options)

        assert error is not None and "does not offer" in error

    def test_a_repeated_tier_is_refused(self):
        answers = {**VALID_ANSWERS, "essential_tier_preference": ["Gold", "Gold"]}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is not None

    def test_an_empty_selection_is_refused_when_tiers_are_offered(self):
        answers = {**VALID_ANSWERS, "essential_tier_preference": []}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is not None and "'Tier preference' is required" in error

    def test_a_market_with_no_tiers_does_not_ask(self):
        options = EssentialFormOptions(dates=DATES)
        answers = {
            "essential_available_dates": ["2026-08-01"],
            "essential_max_dates": 1,
            "essential_table_choice": "half",
        }

        error, stored = EssentialFields.validated_essential_answers(answers, options)

        assert error is None
        assert stored["essential_tier_preference"] == []


class TestRankingSuppression:
    """A ranking of fewer than two options is not a question.

    The offering-empty rule generalises: asking someone to rank a list of one is the kind of
    detail that makes software feel unserious, and it reads correctly for the real case too - a
    market with genuinely one section has nothing to ask about section preference. It applies to
    rankings ONLY. A single offered date or tier is still a real question, because the applicant
    may be unable or unwilling to take it.
    """

    def test_a_single_option_ranking_is_not_asked(self):
        options = EssentialFormOptions(dates=DATES, sections=["Main Hall"], table_types=["Standard"])
        answers = {
            "essential_available_dates": ["2026-08-01"],
            "essential_max_dates": 1,
            "essential_table_choice": "half",
        }

        error, stored = EssentialFields.validated_essential_answers(answers, options)

        assert error is None
        assert stored["essential_section_ranking"] == []
        assert stored["essential_table_type_ranking"] == []

    def test_a_single_offered_date_is_still_asked(self):
        """Not a ranking: the applicant may simply not be available that day."""
        options = EssentialFormOptions(dates=["2026-08-01"])

        error, _ = EssentialFields.validated_essential_answers({}, options)

        assert error is not None and "'Available dates' is required" in error

    def test_a_single_offered_tier_is_still_asked(self):
        """Not a ranking: accepting the only tier is a real commitment about what they pay."""
        options = EssentialFormOptions(dates=["2026-08-01"], tiers=["Gold"])
        answers = {"essential_available_dates": ["2026-08-01"], "essential_max_dates": 1}

        error, _ = EssentialFields.validated_essential_answers(answers, options)

        assert error is not None and "'Tier preference' is required" in error


class TestTableChoiceAndSharePartner:
    """Whether the applicant wants a whole table, and who they would like to share one with.

    Every table holds one full-table vendor or two halves. Table choice is required because the
    half-table machinery has no default that is safe to guess. The partner is optional: most
    applicants have nobody in mind, and one who names nobody is paired with whoever else wants a
    half table - possibly a stranger.
    """

    def test_the_three_table_choices_are_accepted(self):
        for choice in ("full", "half", "either"):
            answers = {**VALID_ANSWERS, "essential_table_choice": choice}

            error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

            assert error is None, f"{choice!r} should be accepted"
            assert stored["essential_table_choice"] == choice

    def test_a_choice_outside_the_three_is_refused(self):
        answers = {**VALID_ANSWERS, "essential_table_choice": "banquet"}

        error, _ = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is not None and "'Table choice'" in error

    def test_a_blank_partner_email_is_a_complete_answer(self):
        """Naming nobody is the common case, not an omission."""
        for blank in (None, "", "   "):
            answers = {**VALID_ANSWERS, "essential_table_share_email": blank}

            error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

            assert error is None, f"{blank!r} should be accepted"
            assert stored["essential_table_share_email"] == ""

    def test_a_missing_partner_email_key_is_a_complete_answer(self):
        answers = {k: v for k, v in VALID_ANSWERS.items() if k != "essential_table_share_email"}

        error, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert error is None
        assert stored["essential_table_share_email"] == ""

    def test_a_partner_email_is_trimmed(self):
        answers = {**VALID_ANSWERS, "essential_table_share_email": "  buddy@example.com  "}

        _, stored = EssentialFields.validated_essential_answers(answers, OPTIONS)

        assert stored["essential_table_share_email"] == "buddy@example.com"

    def test_a_market_with_no_plan_asks_neither(self):
        """Both follow max_dates: with no dates offered there is nothing to be assigned to."""
        error, stored = EssentialFields.validated_essential_answers({}, EssentialFormOptions())

        assert error is None
        assert stored["essential_table_choice"] is None
        assert stored["essential_table_share_email"] == ""


class TestReservedKeyPrefix:
    def test_the_builder_refuses_custom_fields_in_the_essential_namespace(self, monkeypatch,
                                                                           applications):
        monkeypatch.setattr(MarketsApi, "markets_collection",
                            FakeMarketsCollection(stored_market()))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        form = {"fields": [
            {"key": "essential_available_dates", "label": "Sneaky", "type": "text"},
        ]}

        with pytest.raises(ValueError, match="reserved 'essential_' prefix"):
            MarketsApi.save_application_form("market-123", form, "user-1")

    def test_a_client_cannot_forge_the_frozen_offering(self, monkeypatch, applications):
        """``essential_options`` is server-owned, like ``published_at``: whatever a payload
        carries is discarded."""
        markets = FakeMarketsCollection(stored_market())
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        form = {
            "fields": [{"key": "business_name", "label": "Business Name", "type": "text"}],
            "essential_options": {"dates": ["2027-01-01"], "sections": [], "table_types": []},
        }

        MarketsApi.save_application_form("market-123", form, "user-1")

        written = markets.last_update["$set"]["applicationForm"]
        assert written["essentialOptions"] is None


class FakeFreezeMarketsCollection:
    def __init__(self):
        self.calls = []

    def update_one(self, filter_, update):
        self.calls.append((filter_, update))
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)


class TestFreezeEssentialOptions:
    def test_the_snapshot_is_written_once_in_camel_case_behind_an_unset_guard(self):
        markets = FakeFreezeMarketsCollection()

        EssentialFields.freeze_essential_options(markets, "market-123", OPTIONS)

        (filter_, update), = markets.calls
        assert filter_["id"] == "market-123"
        # None matches both a missing key and the explicit null the form save writes;
        # either way, an existing snapshot is never overwritten.
        assert filter_["applicationForm.essentialOptions"] is None
        assert filter_["applicationForm"] == {"$type": "object"}
        written = update["$set"]["applicationForm.essentialOptions"]
        assert written == {
            "dates": DATES, "sections": SECTIONS, "tableTypes": TABLE_TYPES,
            "tiers": TIERS,
            "tiers": TIERS,
        }


def _applicant_market_doc(**overrides):
    from datatypes import MarketPhase

    return stored_market(
        phase=MarketPhase.APPLICATIONS_OPEN,
        setupObject=SETUP_CAMEL,
        applicationForm={"fields": [
            {"key": "business_name", "label": "Business Name", "type": "text",
             "required": True, "options": [], "order": 0},
        ]},
        **overrides,
    )


@pytest.fixture
def applicant_db(monkeypatch):
    markets = FakeSlugMarketsCollection(_applicant_market_doc())

    class _Db(dict):
        def __getitem__(self, name):
            assert name == "markets"
            return markets

    monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())
    return markets


def _token(app_id="app-1", market_id="market-123", email="vendor@example.com"):
    return {"application_id": app_id, "market_id": market_id, "email": email}


def _seed_application(applications):
    applications.insert_one(Application(
        id="app-1",
        market_id="market-123",
        applicant_email="vendor@example.com",
        form_data={},
        status=ApplicationStatus.OPEN,
    ).model_dump())


class TestApplicantSave:
    def test_a_save_stores_the_essential_answers_beside_the_custom_ones(
        self, applicant_db, applications,
    ):
        _seed_application(applications)

        body, status = save_applicant_application(
            "test-market", _token(),
            {**VALID_ANSWERS, "business_name": "Acme"},
        )

        assert status == 200, body
        stored = applications.find_one({"id": "app-1"})["form_data"]
        assert stored["business_name"] == "Acme"
        assert stored["essential_available_dates"] == ["2026-08-01", "2026-08-08"]
        assert stored["essential_max_dates"] == 2
        assert stored["essential_section_ranking"] == ["Garden", "Main Hall"]
        # The offering here comes from the market plan, where table type is stubbed to one type,
        # so the ranking is suppressed and stores empty whatever the applicant sent.
        assert stored["essential_table_type_ranking"] == []

    def test_a_save_missing_an_essential_answer_is_refused(self, applicant_db, applications):
        _seed_application(applications)

        body, status = save_applicant_application(
            "test-market", _token(), {"business_name": "Acme"},
        )

        assert status == 422
        assert "Available dates" in body["error"]

    def test_the_first_recorded_answer_freezes_the_offering(self, applicant_db, applications):
        _seed_application(applications)

        _, status = save_applicant_application(
            "test-market", _token(), {**VALID_ANSWERS, "business_name": "Acme"},
        )

        assert status == 200
        frozen = applicant_db.last_update["$set"]["applicationForm.essentialOptions"]
        assert frozen == {
            "dates": DATES, "sections": SECTIONS, "tableTypes": STUB_TABLE_TYPES,
            "tiers": TIERS,
            "tiers": TIERS,
        }

    def test_answers_are_validated_against_the_frozen_offering_not_the_live_plan(
        self, monkeypatch, applications,
    ):
        """After the freeze, a plan edit must not admit answers the frozen form never offered."""
        doc = _applicant_market_doc()
        doc["applicationForm"]["essentialOptions"] = {
            "dates": ["2026-08-01"], "sections": ["Main Hall"], "tableTypes": ["Full Table"],
                "tiers": [],
        }
        markets = FakeSlugMarketsCollection(doc)

        class _Db(dict):
            def __getitem__(self, name):
                return markets

        monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())
        _seed_application(applications)

        body, status = save_applicant_application(
            "test-market", _token(), {**VALID_ANSWERS, "business_name": "Acme"},
        )

        assert status == 422
        assert "does not offer" in body["error"]

    def test_a_save_losing_the_freeze_race_is_validated_against_the_winning_offering(
        self, monkeypatch, applications,
    ):
        """The freeze is attempted before the answers are persisted; when a concurrent save
        froze a different offering first, the answers are re-validated against the winner and
        nothing is stored on failure."""
        doc = _applicant_market_doc()
        markets = FakeSlugMarketsCollection(doc)
        original_update = markets.update_one

        def losing_freeze(filter_, update):
            doc["applicationForm"]["essentialOptions"] = {
                "dates": ["2026-08-01"], "sections": ["Main Hall"], "tableTypes": ["Full Table"],
                "tiers": [],
            }
            return original_update(filter_, update)

        markets.update_one = losing_freeze

        class _Db(dict):
            def __getitem__(self, name):
                return markets

        monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())
        _seed_application(applications)

        body, status = save_applicant_application(
            "test-market", _token(), {**VALID_ANSWERS, "business_name": "Acme"},
        )

        assert status == 422
        assert "does not offer" in body["error"]
        assert applications.find_one({"id": "app-1"})["form_data"] == {}


class TestPublicForm:
    def test_the_public_form_carries_the_essential_offering(self, applicant_db):
        body, status = get_public_application_form("test-market")

        assert status == 200
        assert body["essential_options"] == {
            "dates": DATES, "sections": SECTIONS, "tableTypes": STUB_TABLE_TYPES,
            "tiers": TIERS,
        }

    def test_the_organizer_form_endpoint_carries_the_effective_offering(
        self, monkeypatch, applications,
    ):
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(_applicant_market_doc()),
        )
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

        result = MarketsApi.get_application_form("market-123", "user-1")

        assert result["essential_options"] == {
            "dates": DATES, "sections": SECTIONS, "tableTypes": STUB_TABLE_TYPES,
            "tiers": TIERS,
        }


class TestWhichQuestionsAnOfferingAsks:
    """``asked_essential_keys`` is the one statement of the offering-empty rule.

    Both the applicant validator and the solver's input translation read it, so a market can
    never be in a state where the form accepted an answer the solver then calls missing.
    """

    def _offering(self, **overrides):
        base = dict(
            dates=["2026-06-01", "2026-06-02"],
            sections=["Artisan", "Food"],
            table_types=[EssentialFields.STUB_TABLE_TYPE],
            tiers=["A", "B"],
        )
        base.update(overrides)
        return EssentialFormOptions(**base)

    def test_a_full_offering_asks_everything_except_the_stubbed_table_type(self):
        asked = EssentialFields.asked_essential_keys(self._offering())

        assert EssentialFields.AVAILABLE_DATES_KEY in asked
        assert EssentialFields.MAX_DATES_KEY in asked
        assert EssentialFields.TIER_PREFERENCE_KEY in asked
        assert EssentialFields.TABLE_CHOICE_KEY in asked
        assert EssentialFields.SECTION_RANKING_KEY in asked
        assert EssentialFields.TABLE_TYPE_RANKING_KEY not in asked

    def test_a_market_with_no_dates_asks_nothing_that_depends_on_having_dates(self):
        asked = EssentialFields.asked_essential_keys(self._offering(dates=[]))

        assert EssentialFields.AVAILABLE_DATES_KEY not in asked
        assert EssentialFields.MAX_DATES_KEY not in asked
        assert EssentialFields.TABLE_CHOICE_KEY not in asked
        assert EssentialFields.TABLE_SHARE_EMAIL_KEY not in asked

    def test_a_single_section_is_not_a_ranking_question(self):
        assert EssentialFields.SECTION_RANKING_KEY not in EssentialFields.asked_essential_keys(
            self._offering(sections=["Artisan"])
        )

    def test_a_single_offered_date_is_still_a_real_question(self):
        """The fewer-than-two rule is for rankings only: one date may still be refused."""
        assert EssentialFields.AVAILABLE_DATES_KEY in EssentialFields.asked_essential_keys(
            self._offering(dates=["2026-06-01"])
        )

    def test_the_table_share_partner_is_never_required(self):
        assert EssentialFields.TABLE_SHARE_EMAIL_KEY not in EssentialFields.REQUIRED_ESSENTIAL_KEYS
        assert set(EssentialFields.REQUIRED_ESSENTIAL_KEYS) | {EssentialFields.TABLE_SHARE_EMAIL_KEY} == set(
            EssentialFields.SOLVER_RELEVANT_KEYS
        )
