"""A vendor who never applied is added by hand, on the day (E36/F03/S01).

A walk-in or a late arrangement is recorded as a vendor the market knows: a name, an address, who
added them and when. They are approved by the act of adding, seated by hand like anyone, and never
an input to the run, whose answers they may not have.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.added_vendors as AddedVendors
import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import assignment.vendor_input as VendorInput
import essential_fields as EF
from client_errors import ForbiddenError
from datatypes import ApplicationStatus, EssentialFormOptions, MarketPerson, MarketPhase

ADDER = MarketPerson(user_id="user-editor", email="editor@market.test")


@pytest.fixture
def stored(monkeypatch):
    """A market in ``phase`` and the applications written to it."""
    written = []

    def at(phase: MarketPhase, already_applied=()):
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(phase)))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        monkeypatch.setattr(
            AddedVendors.ApplicationsApi, "find_application_by_email",
            lambda _market_id, email: {"id": "app-1"} if email in already_applied else None)
        monkeypatch.setattr(
            AddedVendors.ApplicationsApi, "find_or_create_application",
            lambda application: written.append(application) or application)
        return written

    return at


@pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.MARKET_DAYS])
def test_an_editor_adds_a_vendor_while_assigning_or_on_the_day(stored, phase):
    written = stored(phase)

    result, status = AddedVendors.add_vendor(
        "market-123", {"name": "Walk-in Wares", "email": " Walk.In@Example.com "}, ADDER)

    assert status == 201
    [application] = written
    assert application.applicant_email == "walk.in@example.com"
    assert application.form_data == {EF.FULL_NAME_KEY: "Walk-in Wares"}
    assert application.status is ApplicationStatus.REVIEWER_APPROVED
    assert application.added_by == ADDER
    assert application.added_at
    assert result["application"]["addedBy"]["email"] == "editor@market.test"


@pytest.mark.parametrize("phase", [
    MarketPhase.DRAFT, MarketPhase.APPLICATIONS,
])
def test_before_the_assignment_a_vendor_applies_instead(stored, phase):
    written = stored(phase)

    with pytest.raises(AddedVendors.AddVendorRefused, match="from Assignment on"):
        AddedVendors.add_vendor("market-123", {"name": "A", "email": "a@example.com"}, ADDER)

    assert written == []


def test_an_archived_market_takes_nobody(stored):
    stored(MarketPhase.ARCHIVED)

    with pytest.raises(ForbiddenError):
        AddedVendors.add_vendor("market-123", {"name": "A", "email": "a@example.com"}, ADDER)


def test_an_address_that_already_applied_is_refused_naming_it(stored):
    written = stored(MarketPhase.MARKET_DAYS, already_applied={"ana@example.com"})

    with pytest.raises(AddedVendors.AddVendorRefused, match="ana@example.com"):
        AddedVendors.add_vendor(
            "market-123", {"name": "Ana", "email": "Ana@Example.com"}, ADDER)

    assert written == []


@pytest.mark.parametrize("data", [
    {"name": "", "email": "a@example.com"},
    {"name": "A", "email": ""},
    {"name": "A", "email": "not an address"},
])
def test_a_name_and_an_address_are_both_needed(stored, data):
    stored(MarketPhase.MARKET_DAYS)

    with pytest.raises(AddedVendors.AddVendorInvalid):
        AddedVendors.add_vendor("market-123", data, ADDER)


def test_an_added_vendor_is_never_an_input_to_the_run(monkeypatch):
    """Their answers may be missing, and a missing answer would refuse every run."""
    added = {
        "id": "app-2", "market_id": "market-123", "applicant_email": "walk.in@example.com",
        "form_data": {EF.FULL_NAME_KEY: "Walk-in Wares"}, "status": "reviewer_approved",
        "added_by": ADDER.model_dump(), "added_at": "2026-11-18T09:00:00",
    }
    monkeypatch.setattr(
        VendorInput.ApplicationsApi, "list_applications_with_status",
        lambda *_args, **_kwargs: [added])

    vendors, incomplete = VendorInput.approved_solver_vendors(
        "market-123", EssentialFormOptions(dates=["2026-11-18"]))

    assert (vendors, incomplete) == ([], [])


def test_the_organizer_reads_who_added_them():
    from api.applicants import organizer_view

    view = organizer_view({
        "id": "app-2", "market_id": "market-123", "applicant_email": "walk.in@example.com",
        "form_data": {}, "status": "reviewer_approved",
        "added_by": ADDER.model_dump(), "added_at": "2026-11-18T09:00:00",
    })

    assert view["addedBy"] == {"userId": "user-editor", "email": "editor@market.test"}
    assert view["addedAt"] == "2026-11-18T09:00:00"


# --- An added vendor without a table is unassigned (E38/F08/S02) --------------------------------

DAY_ONE, DAY_TWO = "2026-11-18", "2026-11-19"


def _application(email, status="reviewer_approved", added=False):
    from datatypes import Application

    return Application(**{
        "id": f"app-{email}", "market_id": "market-123", "applicant_email": email,
        "form_data": {EF.FULL_NAME_KEY: email}, "status": status,
        **({"added_by": ADDER.model_dump(), "added_at": "2026-11-18T09:00:00"} if added else {}),
    })


def _vendor(email):
    from assignment.vendor_input import SolverVendor

    return SolverVendor(
        application_id=f"app-{email}", email=email, available_dates=frozenset({DAY_ONE, DAY_TWO}),
        max_dates=None, accepted_tiers_by_date={}, table_choice="Full Table",
        table_share_email=None, section_ranking=(), table_type_ranking=(),
    )


def _seat(email, date, table_code, hand_placed=False):
    return {
        "email": email, "date": date, "tableCode": table_code, "tableChoice": "Full Table",
        "section": "A", "tier": "Gold", "location": "Main Hall", "handPlaced": hand_placed,
    }


def test_needing_a_table_is_said_apart_from_being_in_the_run():
    """The run's own vendors and a vendor added by hand need a table; a rejected applicant does
    not, seated or not (bug 10). Only the run's are in it."""
    run, added, rejected = (
        MarketsApi._placeable(_vendor("ana@example.com"), None),
        MarketsApi._placeable(_vendor("walk.in@example.com"),
                              _application("walk.in@example.com", added=True)),
        MarketsApi._placeable(_vendor("reza@example.com"),
                              _application("reza@example.com", status="reviewer_rejected")),
    )

    assert (run["inTheRun"], run["needsATable"]) == (True, True)
    assert (added["inTheRun"], added["needsATable"]) == (False, True)
    assert (rejected["inTheRun"], rejected["needsATable"]) == (False, False)


@pytest.fixture
def statistics_of(monkeypatch):
    """The Assignments page's statistics for a market of two days and three tables, whose run
    reads Ana alone, and whose applicants outside it are the vendors added by hand and Reza."""

    def read(seats, added=(), rejected=("reza@example.com",)):
        document = stored_market(
            MarketPhase.ASSIGNMENT,
            setupObject={
                "priority": [], "marketDates": [{"date": DAY_ONE}, {"date": DAY_TWO}],
                "tiers": [{"id": 1, "name": "Gold"}], "locations": [{"name": "Main Hall"}],
                "sections": [{"name": "A", "count": 3, "location": {"name": "Main Hall"},
                              "tier": {"id": 1, "name": "Gold"}}],
                "assignmentOptions": {"maxAssignmentsPerVendor": None,
                                      "maxHalfTableProportionPerSection": None},
            },
            assignmentObject={"assignmentDate": "2026-11-01", "vendorAssignments": seats,
                              "assignmentStatistics": None},
        )
        outside = [(_vendor(email), _application(email, added=True)) for email in added] + [
            (_vendor(email), _application(email, status="reviewer_rejected"))
            for email in rejected
        ]
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(document))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        monkeypatch.setattr(MarketsApi, "vendors_to_show", lambda _m: [_vendor("ana@example.com")])
        monkeypatch.setattr(MarketsApi, "outside_solver_vendors", lambda *_a: outside)
        monkeypatch.setattr(
            "assignment.assignment.held_solver_vendors",
            lambda _id, _options, addresses: [
                vendor for vendor, _application in outside if vendor.email in set(addresses)])
        monkeypatch.setattr(
            MarketsApi.ApplicationsApi, "vendor_names_for_market", lambda _id: {})

        result, status = MarketsApi.get_assignment_statistics("market-123", "editor@market.test")
        assert status == 200, result
        return result

    return read


def test_an_added_vendor_without_a_table_is_counted_unassigned(statistics_of):
    statistics = statistics_of(
        [_seat("ana@example.com", DAY_ONE, "A 1"), _seat("ana@example.com", DAY_TWO, "A 1")],
        added=["walk.in@example.com"],
    )

    assert statistics["unassignedVendors"] == ["walk.in@example.com"]
    assert (statistics["totalAssignedVendors"], statistics["totalVendors"]) == (1, 2)


def test_seating_an_added_vendor_on_any_day_takes_them_off_the_count(statistics_of):
    statistics = statistics_of(
        [_seat("ana@example.com", DAY_ONE, "A 1"),
         _seat("walk.in@example.com", DAY_ONE, "A 2", hand_placed=True)],
        added=["walk.in@example.com"],
    )

    assert statistics["unassignedVendors"] == []
    assert (statistics["totalAssignedVendors"], statistics["totalVendors"]) == (2, 2)


def test_an_added_vendors_orphaned_pin_counts_as_their_seat(statistics_of):
    """A seat the plan no longer has (an orphaned pin, "A 5" of three tables) is still the vendor's
    seat, as a run vendor's is: the statistics, the Vendors list that follows them and the export
    all hold the added vendor as seated, and the Assignments page asks to move or free them."""
    statistics = statistics_of(
        [_seat("ana@example.com", DAY_ONE, "A 1"),
         _seat("walk.in@example.com", DAY_ONE, "A 5", hand_placed=True)],
        added=["walk.in@example.com"],
    )

    assert statistics["unassignedVendors"] == []
    assert (statistics["totalAssignedVendors"], statistics["totalVendors"]) == (2, 2)


def test_a_rejected_applicant_is_never_counted_unassigned(statistics_of):
    statistics = statistics_of([_seat("ana@example.com", DAY_ONE, "A 1")])

    assert statistics["unassignedVendors"] == []
    assert statistics["totalVendors"] == 1
