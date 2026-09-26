"""Fixing the application form without leaving the import (E20/F03/S01).

The wizard used to print four manual steps and two phase transitions, and the organizer lost their
upload on the way. This runs that chain - and the thing worth testing is not that it works, but
that it refuses BEFORE moving anything, and that a chain which stops partway says so.
"""
from types import SimpleNamespace

import pytest

import api.applications as ApplicationsApi
import api.form_amendment as Amend
import api.markets as MarketsApi
import api.permissions as PermissionsApi
from conftest import stored_market
from datatypes import MarketPhase

FORM_WITH_A_FIELD = {
    "fields": [{"key": "business_name", "label": "Business name", "type": "text", "order": 0}]
}
FORM_THAT_ASKS_NOTHING = {"fields": []}

# A plan that offers something, so the essential questions are asked and `FormHasFieldsGuard`
# passes on their account rather than on a custom field's.
PLAN = {
    "priority": [],
    "marketDates": [{"date": "2026-08-01"}],
    "tiers": [{"id": 0, "name": "Gold"}],
    "locations": [],
    "sections": [{"name": "Main Hall", "count": 4}, {"name": "Garden", "count": 4}],
    "assignmentOptions": {},
    "floorplans": [],
}

# A plan that offers NOTHING, so the essential questions ask nothing either - which is what makes
# an empty custom list a form that asks nothing at all.
BARE_PLAN = {
    "priority": [],
    "marketDates": [],
    "tiers": [],
    "locations": [],
    "sections": [],
    "assignmentOptions": {},
    "floorplans": [],
}


class WalkingMarkets:
    """A markets collection that actually applies the walk, so the chain is exercised for real.

    ``FakeMarketsCollection`` records an update without applying it, which is right for a writer
    under test and useless for a WALK: every hop after the first is conditional on the phase the
    previous hop wrote, so a fake that never writes one would pass a chain that could not run.
    """

    def __init__(self, doc):
        self.doc = doc
        self.writes: list = []

    def find_one(self, query, projection=None):
        if self.doc is None:
            return None
        if not all(self._holds(key, value) for key, value in (query or {}).items()):
            return None
        return dict(self.doc)

    def _holds(self, key, value):
        if isinstance(value, dict) and "$exists" in value:
            return (key in self.doc) == value["$exists"]
        return self.doc.get(key) == value

    def update_one(self, query, update):
        if self.doc is None or not all(
            self._holds(key, value) for key, value in (query or {}).items()
        ):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        self.writes.append(update)
        for key, value in (update.get("$set") or {}).items():
            # Dotted keys reach into a nested document, the way Mongo's `$set` does - the
            # finalization stamp is written as `applicationForm.publishedAt`.
            if "." in key:
                head, tail = key.split(".", 1)
                self.doc.setdefault(head, {})[tail] = value
                continue
            self.doc[key] = value
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    @property
    def phase(self):
        return self.doc["phase"]


@pytest.fixture
def markets(monkeypatch):
    def install(phase=MarketPhase.APPLICATIONS_OPEN, **overrides):
        document = {
            "setupObject": PLAN,
            "applicationForm": FORM_WITH_A_FIELD,
            **overrides,
        }
        fake = WalkingMarkets(stored_market(phase, **document))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(Amend.MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: 0)
        return fake

    return install


class TestTheRoute:
    """It walks the EXISTING transition table; it adds no edge of its own."""

    def test_from_applications_open_it_is_two_hops(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        plan = Amend.plan_for(MarketsApi.market_from_document(fake.doc))

        assert plan.down == ["draft"]
        assert plan.up == ["applications_open"]
        assert len(plan.hops) == 2

    def test_from_applications_closed_it_is_four(self, markets):
        """There is no edge from `applications_closed` back to draft and none is added.

        The table allows only the open phase to return, on the grounds that a market which has
        closed applications has moved past the point where its form is a draft of anything. So the
        way down goes through the open phase, and so does the way back.
        """
        fake = markets(MarketPhase.APPLICATIONS_CLOSED)
        plan = Amend.plan_for(MarketsApi.market_from_document(fake.doc))

        assert plan.down == ["applications_open", "draft"]
        assert plan.up == ["applications_open", "applications_closed"]
        assert len(plan.hops) == 4

    def test_every_hop_it_plans_is_an_edge_that_already_exists(self, markets):
        from guards import VALID_TRANSITIONS

        for phase in (MarketPhase.APPLICATIONS_OPEN, MarketPhase.APPLICATIONS_CLOSED):
            fake = markets(phase)
            plan = Amend.plan_for(MarketsApi.market_from_document(fake.doc))
            for hop in plan.hops:
                assert hop in VALID_TRANSITIONS, f"{hop} is not in the transition table"

    def test_a_market_outside_the_import_phases_has_no_chain(self, markets):
        fake = markets(MarketPhase.REVIEW)

        with pytest.raises(Amend.AmendmentUnavailable):
            Amend.plan_for(MarketsApi.market_from_document(fake.doc))


class TestItRefusesBeforeMovingAnything:
    """Pre-flight, not rollback. A refusal leaves nothing to undo because nothing moved."""

    def test_a_form_that_would_ask_nothing_is_refused_and_the_phase_does_not_move(self, markets):
        # No plan either, so the essential questions ask nothing and the custom list is empty.
        fake = markets(MarketPhase.APPLICATIONS_OPEN, setupObject=BARE_PLAN)

        with pytest.raises(Amend.AmendmentRefused) as refusal:
            Amend.amend_application_form("market-123", FORM_THAT_ASKS_NOTHING, "user-1")

        assert [b.id for b in refusal.value.blockers] == ["form_has_fields"]
        assert fake.phase == "applications_open"
        assert fake.writes == [], "pre-flight moved something before refusing"

    def test_the_refusal_judges_the_PROPOSED_form_not_the_stored_one(self, markets):
        """The exact bug a stored-form pre-flight would have: the market's current form is fine.

        Handing the guards `market.application_form` would pass this, move the market to draft,
        write a form that asks nothing, and then be refused on the way back - which is the
        stranded market this design exists to prevent.
        """
        fake = markets(MarketPhase.APPLICATIONS_OPEN, setupObject=BARE_PLAN)
        assert fake.doc["applicationForm"] == FORM_WITH_A_FIELD

        with pytest.raises(Amend.AmendmentRefused):
            Amend.amend_application_form("market-123", FORM_THAT_ASKS_NOTHING, "user-1")

    def test_a_market_with_applications_is_refused_and_told_why(self, markets, monkeypatch):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: 3)

        with pytest.raises(Amend.AmendmentUnavailable) as refusal:
            Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert "frozen" in str(refusal.value)
        assert fake.phase == "applications_open"

    def test_and_the_dialog_is_told_that_before_it_opens(self, markets, monkeypatch):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: 1)

        availability = Amend.amendment_availability(MarketsApi.market_from_document(fake.doc))

        # Unavailable AND explained: a control that fails when pressed is a broken one.
        assert availability["available"] is False
        assert "1 application has" in availability["reason"]


class TestItWalksAndComesBack:
    def test_from_applications_open_it_returns_to_applications_open(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)

        result = Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert fake.phase == "applications_open"
        assert result["phase"] == "applications_open"
        assert result["hops"] == 2

    def test_from_applications_closed_it_returns_to_applications_closed(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_CLOSED)

        result = Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert fake.phase == "applications_closed"
        assert result["phase"] == "applications_closed"
        assert result["hops"] == 4

    def test_the_form_it_wrote_is_the_one_stored(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        amended = {
            "fields": [{"key": "what_you_sell", "label": "What you sell", "type": "text", "order": 0}]
        }

        Amend.amend_application_form("market-123", amended, "user-1")

        assert [f["key"] for f in fake.doc["applicationForm"]["fields"]] == ["what_you_sell"]

    def test_the_market_is_in_draft_while_the_form_is_written(self, markets, monkeypatch):
        """Through the ordinary writer, in the one phase the form is writable in.

        Going around `save_application_form` would go around the D9 lock with it, which is the
        thing that keeps the form frozen once an applicant has answered.
        """
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        seen: list = []
        real = MarketsApi.save_application_form

        def spy(market_id, data, user):
            seen.append(fake.phase)
            return real(market_id, data, user)

        monkeypatch.setattr(MarketsApi, "save_application_form", spy)
        Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert seen == ["draft"]

    def test_the_amendment_re_dates_the_form_and_that_is_correct(self, markets):
        """Leaving draft IS finalizing (E18/F03/S01), so coming back stamps a new date.

        The amend is invisible in the workflow but not in the record, and the dialog says so.
        """
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        fake.doc["applicationForm"] = {**FORM_WITH_A_FIELD, "publishedAt": "2020-01-01T00:00:00Z"}

        Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert fake.doc["applicationForm"]["publishedAt"] != "2020-01-01T00:00:00Z"
        assert fake.doc["applicationForm"]["publishedAt"] is not None


class TestWhenItStopsPartway:
    """The one failure pre-flight cannot prevent: the market moves between two hops."""

    def test_it_says_where_it_stopped_rather_than_failing_silently(self, markets, monkeypatch):
        fake = markets(MarketPhase.APPLICATIONS_CLOSED)
        hops: list = []
        real = MarketsApi.apply_phase_transition

        def derail(market_id, document, to_phase):
            hops.append(to_phase)
            if len(hops) == 3:
                # Somebody else moved it while the chain was walking back.
                fake.doc["phase"] = "review"
            return real(market_id, document, to_phase)

        monkeypatch.setattr(MarketsApi, "apply_phase_transition", derail)

        with pytest.raises(Amend.AmendmentStalled) as stall:
            Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert stall.value.return_phase == "applications_closed"
        assert stall.value.remaining
        assert "was not taken" in str(stall.value)

    def test_the_intent_is_recorded_before_the_first_step_so_it_can_be_finished(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)
        Amend._record_intent("market-123", Amend.plan_for(MarketsApi.market_from_document(fake.doc)))

        market = MarketsApi.market_from_document(fake.doc)
        assert market.form_amendment is not None
        assert market.form_amendment.return_phase == "applications_open"

    def test_and_is_cleared_once_the_chain_finishes(self, markets):
        fake = markets(MarketPhase.APPLICATIONS_OPEN)

        Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")

        assert MarketsApi.market_from_document(fake.doc).form_amendment is None

    def test_resuming_returns_the_market_to_where_it_was_going(self, markets):
        # A market left in draft by a chain that stopped before walking back.
        fake = markets(
            MarketPhase.DRAFT,
            formAmendment={"returnPhase": "applications_closed", "startedAt": "2026-09-24T00:00:00Z"},
        )

        result = Amend.resume_amendment("market-123", "user-1")

        assert fake.phase == "applications_closed"
        assert result["phase"] == "applications_closed"
        assert MarketsApi.market_from_document(fake.doc).form_amendment is None

    def test_resuming_a_market_that_already_arrived_just_clears_the_note(self, markets):
        fake = markets(
            MarketPhase.APPLICATIONS_OPEN,
            formAmendment={"returnPhase": "applications_open", "startedAt": "2026-09-24T00:00:00Z"},
        )

        result = Amend.resume_amendment("market-123", "user-1")

        assert result["hops"] == 0
        assert MarketsApi.market_from_document(fake.doc).form_amendment is None

    def test_resuming_a_market_with_nothing_pending_says_so(self, markets):
        markets(MarketPhase.APPLICATIONS_OPEN)

        with pytest.raises(Amend.AmendmentUnavailable):
            Amend.resume_amendment("market-123", "user-1")


class TestPermission:
    def test_it_takes_ADMIN_because_it_moves_phases(self, markets, monkeypatch):
        """An amendment an EDITOR could run would be a way around the phase endpoint's own bar."""
        markets(MarketPhase.APPLICATIONS_OPEN)
        from datatypes import MarketRole

        monkeypatch.setattr(
            PermissionsApi,
            "user_has_permission",
            lambda _u, _m, role, *_a, **_kw: role != MarketRole.ADMIN,
        )

        with pytest.raises(PermissionError):
            Amend.amend_application_form("market-123", FORM_WITH_A_FIELD, "user-1")
