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
    MarketPhase.DRAFT, MarketPhase.APPLICATIONS_OPEN, MarketPhase.APPLICATIONS_CLOSED,
    MarketPhase.REVIEW,
])
def test_before_the_assignment_a_vendor_applies_instead(stored, phase):
    written = stored(phase)

    with pytest.raises(AddedVendors.AddVendorRefused, match="assignment"):
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
