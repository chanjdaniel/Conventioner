"""An exception never reaches a client: what a client reads when a route refuses or fails.

A refusal meant for the client is a client error, answered with its own status and the copy our
code wrote. Anything else is the server's fault: logged once with its traceback, and answered
``{"error": "Internal server error"}``, 500, with nothing of the exception in it. Flask's own
answers (an unknown URL, a wrong method, Flask-Login's 401) pass through untouched.

Pinned through the test client against the real app: the assignment reads, the organization and
market role routes, the market setup routes, the application form, amendment and phase routes, the
assignment and placement routes, and the applicant, review, import and door routes.
"""
import logging
from types import SimpleNamespace

import flask
import pytest

from conftest import (
    COMPLETE_PLAN,
    FakeMarketsCollection,
    FakeSlugMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.added_vendors as AddedVendorsApi
import api.applicant_auth as ApplicantAuthApi
import api.applications as ApplicationsApi
import api.applicants as ApplicantsApi
import api.attendance as AttendanceApi
import api.door as DoorApi
import api.form_amendment as FormAmendmentApi
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.users as UsersApi
import api.vendor_info as VendorInfoApi
import csv_import as CsvImport
import csv_proposal as CsvProposal
import csv_start as CsvStart
import db_config
import rejection_rules as RejectionRules
import services.placement_service as PlacementService
from client_errors import (
    BadRequestError,
    ClientError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from datatypes import MarketPhase, market_name_slug
from guards import PreconditionResult
from utils.request_body import NO_DATA_PROVIDED, NOT_AN_OBJECT


OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"

# Shaped like what a failing library writes into its message: a host and a password. A client must
# never read it, and the log must.
SECRET = "authentication failed on db-primary.test:27017 with password hunter2-s3cr3t"

ASSIGNMENT_READS = [
    ("/markets/market-123/assignment", "get_assigned_market"),
    ("/markets/market-123/assignment-statistics", "get_assignment_statistics"),
    ("/markets/market-123/assignment-csv", "get_assignment_csv"),
    ("/markets/market-123/tables", "get_market_tables"),
]


@pytest.fixture
def client(monkeypatch):
    """Signed in as the market's owner, through the session as in production."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=OWNER_ID, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
    )
    monkeypatch.setattr(
        MarketsApi, "markets_collection",
        FakeMarketsCollection(
            stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=COMPLETE_PLAN)
        ),
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


def fail_with(exception):
    def _raise(*_args, **_kwargs):
        raise exception
    return _raise


class TestTheTypes:
    """What a raise site gets to say, and that a refusal is never mistaken for a builtin one."""

    def test_each_type_carries_its_status_and_its_copy(self):
        for error_type, status in (
            (BadRequestError, 400), (ForbiddenError, 403), (NotFoundError, 404), (ConflictError, 409),
        ):
            error = error_type("Organization name required")
            assert isinstance(error, ClientError)
            assert error.status == status
            assert error.message == "Organization name required"
            assert error.body() == {"error": "Organization name required"}

    @pytest.mark.parametrize("error_type", [
        ClientError, BadRequestError, ForbiddenError, NotFoundError, ConflictError,
    ])
    def test_a_client_error_is_no_builtin_refusal(self, error_type):
        assert not issubclass(error_type, (ValueError, PermissionError))

    @pytest.mark.parametrize("refusal, client_error", [
        (MarketsApi.MarketNotFoundError, NotFoundError),
        (MarketsApi.MarketArchivedError, ForbiddenError),
        (MarketsApi.MoveUnavailable, BadRequestError),
        (MarketsApi.ApplicationFormLockedError, ConflictError),
        (MarketsApi.PhaseChangedUnderRequest, ConflictError),
        (PlacementsApi.PlacementError, BadRequestError),
        (PlacementsApi.SeatTakenError, BadRequestError),
        (PlacementsApi.AssignPhaseError, ConflictError),
        (AddedVendorsApi.AddVendorRefused, ConflictError),
        (AddedVendorsApi.AddVendorInvalid, BadRequestError),
        (FormAmendmentApi.AmendmentUnavailable, ConflictError),
        (FormAmendmentApi.AmendmentRefused, ConflictError),
        (FormAmendmentApi.AmendmentStalled, ConflictError),
        (CsvStart.ConfirmRefused, ConflictError),
        (OrgsApi.OrganizationHasLiveMarkets, ConflictError),
    ])
    def test_the_domain_refusals_are_client_errors_and_nothing_else(self, refusal, client_error):
        assert issubclass(refusal, client_error)
        assert not issubclass(refusal, (ValueError, PermissionError))


class TestAMarketsApiRefusal:
    """A refusal the markets API decides is answered with its status and copy, even by a route whose
    own ladder never caught it."""

    def test_an_unreadable_market_refuses_the_vendor_notes_in_our_words(
        self, client, monkeypatch, caplog,
    ):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        with caplog.at_level(logging.WARNING):
            response = client.get("/markets/market-123/vendor-notes")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}
        assert "unreadable-sections" not in response.get_data(as_text=True)


ORG_ID = "org-1"
ORG_NAME = "Night Market Society"


class FakeOrganizations:
    def __init__(self, *docs):
        self.docs = list(docs)

    def find_one(self, query):
        return next(
            (dict(d) for d in self.docs if all(d.get(k) == v for k, v in query.items())), None,
        )


class FakeOrganizationMarkets:
    def __init__(self, *docs):
        self.docs = list(docs)

    def find(self, query):
        return iter([dict(d) for d in self.docs if all(d.get(k) == v for k, v in query.items())])


@pytest.fixture
def organization(monkeypatch):
    """One organization, owned by whoever ``owner`` names, holding the markets given."""
    def install(owner=OWNER_ID, markets=()):
        monkeypatch.setattr(OrgsApi, "organizations_collection", FakeOrganizations({
            "_id": "org-object-id", "id": ORG_ID, "name": ORG_NAME, "owner": owner,
            "admins": [], "members": [],
        }))
        monkeypatch.setattr(OrgsApi, "markets_collection", FakeOrganizationMarkets(*markets))
    return install


def refusals_raised_by(monkeypatch, owner, name):
    """Every client error the real function raises, kept as it passes to the route."""
    raised = []
    real = getattr(owner, name)

    def spying(*args, **kwargs):
        try:
            return real(*args, **kwargs)
        except ClientError as refusal:
            raised.append(refusal)
            raise
    monkeypatch.setattr(owner, name, spying)
    return raised


def assert_answered_as_raised(response, raised):
    """The route answers exactly what the client error says it will, so the migration that lets it
    reach the handler changes nothing a client reads."""
    [refusal] = raised
    assert response.status_code == refusal.status
    assert response.get_json() == refusal.body()


class TestEveryOtherModulesRefusals:
    """A refusal decided outside the markets API carries the status and body its route answers today.

    Each is raised for real where it can be reached through a route, and spied on as it passes."""

    def test_a_placement_that_names_no_vendor(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, PlacementsApi, "write_placement")

        response = client.put("/markets/market-123/placements", json={"date": "2026-08-01"})

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "An assignment must name the vendor it assigns."}

    def test_a_seat_someone_else_holds(self, client, monkeypatch):
        taken = PlacementsApi.SeatTakenError("ana@example.com already holds Hall A 1.")
        monkeypatch.setattr(PlacementsApi, "write_placement", fail_with(taken))

        response = client.put("/markets/market-123/placements", json={"date": "2026-08-01"})

        assert_answered_as_raised(response, [taken])
        assert response.status_code == 409

    def test_freeing_a_seat_without_naming_it(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, PlacementsApi, "remove_placement")

        response = client.delete("/markets/market-123/placements", json={})

        assert_answered_as_raised(response, raised)
        assert response.status_code == 400

    def test_a_swap_without_two_vendors(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, PlacementsApi, "swap_placements")

        response = client.post("/markets/market-123/placements/swap", json={"date": "2026-08-01"})

        assert_answered_as_raised(response, raised)
        assert response.status_code == 400

    def test_an_assignment_run_in_a_draft(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.DRAFT, setupObject=COMPLETE_PLAN))
        raised = refusals_raised_by(monkeypatch, PlacementsApi, "run_assignment")

        response = client.post("/markets/market-123/assignment")

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_a_vendor_added_with_no_name(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, AddedVendorsApi, "add_vendor")

        response = client.post(
            "/markets/market-123/vendors", json={"name": "", "email": "ana@example.com"},
        )

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "Give the vendor's name."}

    def test_a_vendor_added_to_a_draft(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.DRAFT, setupObject=COMPLETE_PLAN))
        raised = refusals_raised_by(monkeypatch, AddedVendorsApi, "add_vendor")

        response = client.post(
            "/markets/market-123/vendors", json={"name": "Ana", "email": "ana@example.com"},
        )

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_an_amendment_outside_the_import_phases(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, FormAmendmentApi, "amend_application_form")

        response = client.post(
            "/markets/market-123/application-form/amendment",
            json={"applicationForm": {"fields": []}},
        )

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_an_amendment_the_preflight_refuses_keeps_its_blockers(self, client, monkeypatch):
        refused = FormAmendmentApi.AmendmentRefused(
            "The form as edited would not let this market reopen applications.",
            [PreconditionResult(
                id="form_has_fields", passed=False, message="The form asks nothing.",
                resolution_link="application-form", resolution_label="Add a question",
            )],
        )
        monkeypatch.setattr(FormAmendmentApi, "amend_application_form", fail_with(refused))

        response = client.post(
            "/markets/market-123/application-form/amendment",
            json={"applicationForm": {"fields": []}},
        )

        assert_answered_as_raised(response, [refused])
        assert response.get_json()["blockers"][0]["resolutionLabel"] == "Add a question"

    @pytest.mark.parametrize("path, function", [
        ("/markets/market-123/application-form/amendment", "amend_application_form"),
        ("/markets/market-123/application-form/amendment/resume", "resume_amendment"),
    ])
    def test_a_stalled_amendment_keeps_its_resume_offer(self, client, monkeypatch, path, function):
        stalled = FormAmendmentApi.AmendmentStalled(
            "This market moved to 'review' while the amendment was running.",
            at_phase="review", remaining=["applications_open"], return_phase="applications_open",
        )
        monkeypatch.setattr(FormAmendmentApi, function, fail_with(stalled))

        response = client.post(path, json={"applicationForm": {"fields": []}})

        assert_answered_as_raised(response, [stalled])
        assert response.get_json()["canResume"] is True

    def test_resuming_with_nothing_unfinished(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.APPLICATIONS_OPEN))
        raised = refusals_raised_by(monkeypatch, FormAmendmentApi, "resume_amendment")

        response = client.post("/markets/market-123/application-form/amendment/resume")

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_rejection_rules_that_are_not_a_list(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))
        raised = refusals_raised_by(monkeypatch, RejectionRules.Rulebook, "prepared")

        response = client.put("/markets/market-123/rejection-rules", json={"rules": "all of them"})

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "rules must be a list."}

    def test_a_csv_start_confirmed_on_a_market_past_draft(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, CsvStart, "confirmed_update")

        response = client.post(
            "/markets/market-123/csv-proposal/confirm", json={"csvContent": "Name\nAna\n"},
        )

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_an_organization_that_already_exists(self, client, monkeypatch, organization):
        organization()
        raised = refusals_raised_by(monkeypatch, OrgsApi, "create_organization")

        response = client.post("/organizations", json={"name": ORG_NAME})

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "Organization already exists"}

    def test_an_organization_changed_by_someone_not_its_owner(
        self, client, monkeypatch, organization,
    ):
        organization(owner="user-2")
        raised = refusals_raised_by(monkeypatch, OrgsApi, "update_organization")

        response = client.put(f"/organizations/{ORG_ID}", json={"name": "Renamed"})

        assert_answered_as_raised(response, raised)
        assert response.status_code == 403

    def test_an_admin_with_no_account(self, client, monkeypatch, organization):
        organization()
        raised = refusals_raised_by(monkeypatch, OrgsApi, "add_org_admin")

        response = client.post(
            f"/organizations/{ORG_ID}/admins", json={"user_email": "nobody@example.com"},
        )

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "User not found"}

    def test_removing_the_organizations_owner(self, client, monkeypatch, organization):
        organization()
        raised = refusals_raised_by(monkeypatch, OrgsApi, "remove_org_user")

        response = client.delete(f"/organizations/{ORG_ID}/users/{OWNER_ID}")

        assert_answered_as_raised(response, raised)
        assert response.status_code == 400

    def test_the_deletion_preview_of_no_organization(self, client, monkeypatch, organization):
        organization()
        raised = refusals_raised_by(monkeypatch, OrgsApi, "organization_deletion_preview")

        response = client.get("/organizations/org-missing/deletion-preview")

        assert_answered_as_raised(response, raised)
        assert response.get_json() == {"error": "Organization not found"}

    def test_deleting_an_organization_with_a_market_under_way_names_it(
        self, client, monkeypatch, organization,
    ):
        organization(markets=[stored_market(
            phase=MarketPhase.REVIEW, name="Spring Fair", organizationId=ORG_ID,
        )])
        raised = refusals_raised_by(monkeypatch, OrgsApi, "delete_organization")

        response = client.delete(f"/organizations/{ORG_ID}")

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409
        assert response.get_json()["blockingMarkets"][0]["name"] == "Spring Fair"

    def test_walls_that_enclose_no_room_are_refused_in_our_words(self):
        along_one_line = [
            {"start": (0, 0), "end": (1000, 0), "thickness_mm": 100},
            {"start": (1000, 0), "end": (2000, 0), "thickness_mm": 100},
        ]

        with pytest.raises(BadRequestError, match="do not enclose a room"):
            PlacementService.auto_place_tables(
                walls=along_one_line, obstacles=[], table_types=[], counts={},
                scale_px_per_mm=1.0,
            )


# Each organization and market role route, with a body it accepts and the API function it answers
# through. The list of a user's organizations has no refusal of its own, so it is here only to fail.
ORGANIZATION_AND_ROLE_ROUTES = [
    ("get", "/organizations", None, OrgsApi, "get_organizations_for_user"),
    ("post", "/organizations", {"name": "Spring Collective"}, OrgsApi, "create_organization"),
    ("get", f"/organizations/{ORG_ID}", None, OrgsApi, "get_organization"),
    ("put", f"/organizations/{ORG_ID}", {"name": "Renamed"}, OrgsApi, "update_organization"),
    ("get", f"/organizations/{ORG_ID}/deletion-preview", None,
     OrgsApi, "organization_deletion_preview"),
    ("delete", f"/organizations/{ORG_ID}", None, OrgsApi, "delete_organization"),
    ("post", f"/organizations/{ORG_ID}/admins", {"user_email": "admin@example.com"},
     OrgsApi, "add_org_admin"),
    ("post", f"/organizations/{ORG_ID}/members", {"user_email": "member@example.com"},
     OrgsApi, "add_org_member"),
    ("delete", f"/organizations/{ORG_ID}/users/user-2", None, OrgsApi, "remove_org_user"),
    ("post", f"/organizations/{ORG_ID}/transfer", {"new_owner_email": "next@example.com"},
     OrgsApi, "transfer_org_ownership"),
    ("post", "/markets/market-123/roles", {"user_email": "editor@example.com", "role": "editor"},
     MarketsApi, "add_market_role"),
    ("delete", "/markets/market-123/roles/user-2", None, MarketsApi, "remove_market_role"),
    ("put", "/markets/market-123/roles/user-2", {"role": "viewer"},
     MarketsApi, "update_market_role"),
]


def call(client, method, path, body=None):
    kwargs = {} if body is None else {"json": body}
    return getattr(client, method)(path, **kwargs)


class TestTheOrganizationAndRoleRoutes:
    """The organization and market role routes answer through the handler: each refusal with the
    status and copy an organizer reads, and anything else as the generic 500."""

    def test_an_organization_needs_a_name(self, client):
        response = client.post("/organizations", json={"name": "   "})

        assert response.status_code == 400
        assert response.get_json() == {"error": "Organization name required"}

    def test_reading_an_organization_that_does_not_exist(self, client, organization):
        organization()

        response = client.get("/organizations/org-missing")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Organization not found"}

    @pytest.mark.parametrize("method, path, body", [
        ("put", "/organizations/org-missing", {"name": "Renamed"}),
        ("delete", "/organizations/org-missing", None),
        ("post", "/organizations/org-missing/admins", {"user_email": "admin@example.com"}),
        ("post", "/organizations/org-missing/members", {"user_email": "member@example.com"}),
        ("delete", "/organizations/org-missing/users/user-2", None),
        ("post", "/organizations/org-missing/transfer", {"new_owner_email": "next@example.com"}),
    ])
    def test_an_organization_that_does_not_exist_is_not_found(
        self, client, organization, method, path, body,
    ):
        organization()

        response = call(client, method, path, body)

        assert response.status_code == 404
        assert response.get_json() == {"error": "Organization not found"}

    def test_the_owner_cannot_be_added_as_a_member(self, client, organization):
        organization()

        response = client.post(
            f"/organizations/{ORG_ID}/members", json={"user_email": OWNER_EMAIL},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Owner cannot be added as member"}

    def test_ownership_handed_to_no_account(self, client, organization):
        organization()

        response = client.post(
            f"/organizations/{ORG_ID}/transfer", json={"new_owner_email": "nobody@example.com"},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "New owner user not found"}

    @pytest.mark.parametrize("method, path, body", [
        ("post", "/markets/market-missing/roles", {"user_email": OWNER_EMAIL, "role": "editor"}),
        ("delete", "/markets/market-missing/roles/user-2", None),
        ("put", "/markets/market-missing/roles/user-2", {"role": "viewer"}),
    ])
    def test_a_role_on_a_market_that_does_not_exist_is_not_found(self, client, method, path, body):
        response = call(client, method, path, body)

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_a_role_that_does_not_exist(self, client):
        response = client.post(
            "/markets/market-123/roles", json={"user_email": OWNER_EMAIL, "role": "Wizard"},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid role: Wizard"}

    def test_removing_a_role_nobody_holds(self, client):
        response = client.delete("/markets/market-123/roles/user-9")

        assert response.status_code == 400
        assert response.get_json() == {"error": "User does not have a role in this market"}

    def test_the_owners_role_cannot_be_changed(self, client):
        response = client.put(f"/markets/market-123/roles/{OWNER_ID}", json={"role": "viewer"})

        assert response.status_code == 403
        assert response.get_json() == {"error": "Cannot change owner's role"}

    @pytest.mark.parametrize("method, path, body, api, function", ORGANIZATION_AND_ROLE_ROUTES)
    def test_an_unexpected_failure_answers_only_internal_server_error(
        self, client, monkeypatch, caplog, organization, method, path, body, api, function,
    ):
        organization()
        monkeypatch.setattr(api, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            response = call(client, method, path, body)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert method.upper() in record.getMessage()
        if "/markets/" in path:
            assert "market-123" in record.getMessage()
        elif ORG_ID in path:
            assert ORG_ID in record.getMessage()
        assert "example.com" not in caplog.text


# A new market's body the model takes, in an organization its creator owns.
NEW_MARKET = {
    "name": "Spring Market", "creationDate": "2026-01-01T00:00:00Z", "organizationId": ORG_ID,
    "modificationList": [], "assignmentObject": {},
}

# Each market setup route, with a body it accepts and the markets API function it answers through.
# The list of a user's markets has no refusal a signed-in user can reach, so it is here only to fail.
MARKET_SETUP_ROUTES = [
    ("get", "/markets/market-123", None, "get_market_for_user"),
    ("get", "/markets", None, "get_markets_for_user"),
    ("post", "/markets", NEW_MARKET, "create_owned_market"),
    ("put", "/markets/market-123/name", {"name": "Autumn Market"}, "rename_market"),
    ("put", "/markets/market-123/plan", {"setupObject": COMPLETE_PLAN}, "save_plan"),
    ("get", "/markets/market-123/vendor-notes", None, "get_vendor_notes"),
    ("put", "/markets/market-123/vendor-notes/vendor@example.com", {"note": "Extra chair"},
     "save_vendor_note"),
    ("put", "/markets/market-123/vendor-notes/vendor@example.com/request-handled",
     {"handled": True}, "mark_vendor_request_handled"),
    ("put", "/markets/market-123/review-highlights", {"keys": ["business_name"]},
     "save_review_highlights"),
    ("put", "/markets/market-123/rejection-rules", {"rules": []}, "save_rejection_rules"),
    ("delete", "/markets/market-123", None, "delete_market"),
]


class TestTheMarketSetupRoutes:
    """Reading, creating, renaming, planning and deleting a market, and its notes, highlights and
    rejection rules, answer through the handler: each refusal with the status and copy an organizer
    reads, and anything else as the generic 500."""

    def test_a_market_the_user_cannot_see_is_not_found(self, client):
        response = client.get("/markets/market-missing")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found or access denied"}

    def test_a_new_market_in_no_organization_says_so(self, client, organization):
        organization()

        response = client.post("/markets", json={**NEW_MARKET, "organizationId": "org-missing"})

        assert response.status_code == 400
        assert response.get_json() == {"error": "Organization not found"}

    def test_a_new_market_that_breaks_an_invariant_is_the_servers_fault(
        self, client, monkeypatch, caplog, organization,
    ):
        organization()
        invariant = "Market must have exactly one owner in roles dict"
        monkeypatch.setattr(MarketsApi, "create_market", fail_with(ValueError(invariant)))

        with caplog.at_level(logging.ERROR):
            response = client.post("/markets", json=NEW_MARKET)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert invariant not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is ValueError
        assert str(record.exc_info[1]) == invariant

    def test_a_market_needs_a_name(self, client):
        response = client.put("/markets/market-123/name", json={"name": "  "})

        assert response.status_code == 400
        assert response.get_json() == {"error": "A market needs a name."}

    def test_a_market_past_draft_keeps_its_name(self, client):
        response = client.put("/markets/market-123/name", json={"name": "Autumn Market"})

        assert response.status_code == 400
        assert response.get_json() == {"error": MarketsApi.RENAME_REFUSED_AFTER_DRAFT}

    def test_renaming_a_market_that_does_not_exist(self, client):
        response = client.put("/markets/market-missing/name", json={"name": "Autumn Market"})

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_a_plan_write_carries_only_the_plan(self, client):
        response = client.put(
            "/markets/market-123/plan", json={"setupObject": COMPLETE_PLAN, "name": "Renamed"},
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "The plan write carries only the plan; it does not accept name.",
        }

    def test_the_notes_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/vendor-notes")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_a_note_on_an_archived_market(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.ARCHIVED))

        response = client.put(
            "/markets/market-123/vendor-notes/vendor@example.com", json={"note": "Extra chair"},
        )

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}

    def test_a_request_marked_without_saying_how(self, client):
        response = client.put(
            "/markets/market-123/vendor-notes/vendor@example.com/request-handled",
            json={"handled": "yes"},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "handled is required"}

    def test_highlights_on_an_archived_market(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.ARCHIVED))

        response = client.put("/markets/market-123/review-highlights", json={"keys": []})

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}

    def test_rejection_rules_once_they_are_settled(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.MARKET_DAYS))

        response = client.put("/markets/market-123/rejection-rules", json={"rules": []})

        assert response.status_code == 400
        assert response.get_json() == {"error": MarketsApi.REJECTION_RULES_SETTLED}

    def test_deleting_a_market_that_does_not_exist(self, client):
        response = client.delete("/markets/market-missing")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_deleting_a_market_that_cannot_be_read(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        response = client.delete("/markets/market-123")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}

    @pytest.mark.parametrize("method, path, body, function", MARKET_SETUP_ROUTES)
    def test_an_unexpected_failure_answers_only_internal_server_error(
        self, client, monkeypatch, caplog, organization, method, path, body, function,
    ):
        organization()
        monkeypatch.setattr(MarketsApi, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            response = call(client, method, path, body)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert method.upper() in record.getMessage()
        if "/markets/" in path:
            assert "market-123" in record.getMessage()
        assert "example.com" not in caplog.text


# Each application form, amendment and phase route, with a body it accepts and the function it
# answers through.
FORM_AND_PHASE_ROUTES = [
    ("get", "/markets/market-123/application-form/amendment", None,
     FormAmendmentApi, "amendment_availability"),
    ("post", "/markets/market-123/application-form/amendment", {"applicationForm": {"fields": []}},
     FormAmendmentApi, "amend_application_form"),
    ("post", "/markets/market-123/application-form/amendment/resume", None,
     FormAmendmentApi, "resume_amendment"),
    ("put", "/markets/market-123/application-form", {"fields": []},
     MarketsApi, "save_application_form"),
    ("get", "/markets/market-123/application-form", None, MarketsApi, "get_application_form"),
    ("post", "/markets/market-123/transition", {"toPhase": "offers"}, MarketsApi, "take_move"),
    ("get", "/markets/market-123/pending-offers-count", None,
     ApplicationsApi, "count_applications_with_status"),
]


class TestTheFormAndPhaseRoutes:
    """Reading and saving the application form, amending it, moving the phase and counting the
    pending offers answer through the handler: each refusal with the status and copy an organizer
    reads, and anything else as the generic 500."""

    def test_amending_the_form_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/application-form/amendment")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_an_amendment_needs_a_form(self, client):
        response = client.post(
            "/markets/market-123/application-form/amendment", json={"applicationForm": []},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "applicationForm is required"}

    def test_resuming_on_a_market_that_cannot_be_read(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        response = client.post("/markets/market-123/application-form/amendment/resume")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}

    def test_a_stalled_amendment_is_logged_with_its_market_and_answered_with_its_offer(
        self, client, monkeypatch, caplog,
    ):
        use_market(monkeypatch, stored_market(
            phase=MarketPhase.DRAFT,
            formAmendment={"returnPhase": "applications_open", "startedAt": "2026-09-24T00:00:00Z"},
        ))
        monkeypatch.setattr(MarketsApi, "apply_phase_transition", fail_with(
            MarketsApi.PhaseChangedUnderRequest("review", "draft", "applications_open"),
        ))
        raised = refusals_raised_by(monkeypatch, FormAmendmentApi, "resume_amendment")

        with caplog.at_level(logging.WARNING):
            response = client.post("/markets/market-123/application-form/amendment/resume")

        assert_answered_as_raised(response, raised)
        assert response.get_json()["canResume"] is True
        [record] = [r for r in caplog.records if "stalled" in r.getMessage()]
        assert "market-123" in record.getMessage()
        assert "review" in record.getMessage()
        assert [r for r in caplog.records if r.name == "client_errors"] == []

    def test_a_form_past_draft_is_locked(self, client, monkeypatch):
        raised = refusals_raised_by(monkeypatch, MarketsApi, "save_application_form")

        response = client.put("/markets/market-123/application-form", json={"fields": []})

        assert_answered_as_raised(response, raised)
        assert response.status_code == 409

    def test_the_form_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/application-form")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    @pytest.mark.parametrize("to_phase", [7, ["offers"], {"phase": "offers"}])
    def test_a_phase_that_is_not_a_name_is_unknown(self, client, to_phase):
        response = client.post("/markets/market-123/transition", json={"toPhase": to_phase})

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("Unknown phase: ")

    def test_the_pending_offers_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/pending-offers-count")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    @pytest.mark.parametrize("method, path, body, api, function", FORM_AND_PHASE_ROUTES)
    def test_an_unexpected_failure_answers_only_internal_server_error(
        self, client, monkeypatch, caplog, method, path, body, api, function,
    ):
        monkeypatch.setattr(api, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            response = call(client, method, path, body)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert method.upper() in record.getMessage()
        assert "market-123" in record.getMessage()
        assert [r for r in caplog.records if SECRET in r.getMessage()] == []
        assert "example.com" not in caplog.text


# Each assignment write and placement route, with a body it accepts and the function it answers
# through.
ASSIGNMENT_AND_PLACEMENT_ROUTES = [
    ("post", "/markets/market-123/assignment", None, PlacementsApi, "run_assignment"),
    ("post", "/markets/market-123/vendors", {"name": "Ana", "email": "ana@example.com"},
     AddedVendorsApi, "add_vendor"),
    ("put", "/markets/market-123/placements",
     {"email": "ana@example.com", "date": "2099-08-01", "tableCode": "Main Hall 1",
      "tableChoice": "Full Table"},
     PlacementsApi, "write_placement"),
    ("get", "/markets/market-123/placement-history", None, MarketsApi, "get_placement_history"),
    ("post", "/markets/market-123/placements/swap",
     {"date": "2099-08-01", "emails": ["ana@example.com", "ben@example.com"]},
     PlacementsApi, "swap_placements"),
    ("delete", "/markets/market-123/placements", {"email": "ana@example.com", "date": "2099-08-01"},
     PlacementsApi, "remove_placement"),
]


class TestTheAssignmentAndPlacementRoutes:
    """Running the assignment, adding a vendor, and writing, swapping and freeing a placement, and
    reading their history, answer through the handler: each refusal with the status and copy an
    organizer reads, and anything else as the generic 500."""

    def test_an_assignment_run_on_a_market_that_does_not_exist(self, client):
        response = client.post("/markets/market-missing/assignment")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_an_assignment_run_over_incomplete_answers_names_them(self, client, monkeypatch):
        from assignment.assignment import IncompleteApplicationsError
        from assignment.vendor_input import IncompleteApplication

        incomplete = IncompleteApplicationsError(
            [IncompleteApplication("app-1", "ana@example.com", ("Table choice",))]
        )
        monkeypatch.setattr(PlacementsApi, "solver_vendors_for", fail_with(incomplete))

        response = client.post("/markets/market-123/assignment")

        assert response.status_code == 400
        assert response.get_json() == {
            "error": incomplete.message(), "incomplete": incomplete.applicants(),
        }

    def test_a_vendor_added_to_a_market_that_does_not_exist(self, client):
        response = client.post(
            "/markets/market-missing/vendors", json={"name": "Ana", "email": "ana@example.com"},
        )

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_a_vendor_who_already_applied_is_not_added_twice(self, client, monkeypatch):
        monkeypatch.setattr(
            ApplicationsApi, "find_application_by_email", lambda _market, _address: object(),
        )

        response = client.post(
            "/markets/market-123/vendors", json={"name": "Ana", "email": "ana@example.com"},
        )

        assert response.status_code == 409
        assert response.get_json() == {"error": (
            "ana@example.com already has an application in this market. "
            "Assign them on the Result page."
        )}

    def test_a_placement_for_someone_who_never_applied(self, client):
        response = client.put("/markets/market-123/placements", json={
            "email": "ana@example.com", "date": "2099-08-01", "tableCode": "Main Hall 1",
            "tableChoice": "Full Table",
        })

        assert response.status_code == 400
        assert response.get_json() == {"error": (
            "ana@example.com has no application in this market, so they cannot be given a seat. "
            "Add them as a vendor first."
        )}

    def test_a_placement_on_an_archived_market(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.ARCHIVED, setupObject=COMPLETE_PLAN))

        response = client.put("/markets/market-123/placements", json={
            "email": "ana@example.com", "date": "2099-08-01", "tableCode": "Main Hall 1",
            "tableChoice": "Full Table",
        })

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}

    def test_the_history_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/placement-history")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_the_history_of_a_market_that_cannot_be_read(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        response = client.get("/markets/market-123/placement-history")

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}

    def test_a_vendor_cannot_swap_with_themselves(self, client):
        response = client.post("/markets/market-123/placements/swap", json={
            "date": "2099-08-01", "emails": ["ana@example.com", "ana@example.com"],
        })

        assert response.status_code == 400
        assert response.get_json() == {"error": "A vendor cannot swap seats with themselves."}

    @pytest.mark.parametrize("emails", ["ana@example.com", {"ana": "ben"}, 2])
    def test_a_swap_whose_vendors_are_not_a_list_names_none(self, client, emails):
        response = client.post(
            "/markets/market-123/placements/swap", json={"date": "2099-08-01", "emails": emails},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "A swap must name a date and two vendors."}

    def test_freeing_a_seat_with_no_body_says_what_it_needs(self, client):
        response = client.delete("/markets/market-123/placements")

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Removing an assignment must name the vendor and the date.",
        }

    def test_freeing_a_seat_on_a_market_that_does_not_exist(self, client):
        response = client.delete(
            "/markets/market-missing/placements",
            json={"email": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    @pytest.mark.parametrize("method, path, body, api, function", ASSIGNMENT_AND_PLACEMENT_ROUTES)
    def test_an_unexpected_failure_answers_only_internal_server_error(
        self, client, monkeypatch, caplog, method, path, body, api, function,
    ):
        monkeypatch.setattr(api, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            response = call(client, method, path, body)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert method.upper() in record.getMessage()
        assert "market-123" in record.getMessage()
        assert [r for r in caplog.records if SECRET in r.getMessage()] == []
        assert "example.com" not in caplog.text

    def test_a_builtin_permission_error_is_the_servers_fault(self, client, monkeypatch):
        monkeypatch.setattr(
            PlacementsApi, "write_placement", fail_with(PermissionError(SECRET)),
        )

        response = client.put("/markets/market-123/placements", json={"date": "2099-08-01"})

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}


SLUG = market_name_slug("Test Market")
CSV = "Timestamp,Email Address,Full Name\n1/5/2026 9:00:00,p1@mail.test,Wren Okafor\n"
APPLICANT_SESSION_EXPIRED = (
    "Authentication required. Your session may have expired. Please sign in again."
)

# Each applicant, review, import and door route, with a body it accepts, the function it answers
# through, and the view argument its failure is logged with.
APPLICANT_REVIEW_IMPORT_AND_DOOR_ROUTES = [
    ("get", f"/public/markets/{SLUG}/vendors/ana@example.com/assignments", None,
     AttendanceApi, "get_vendor_assignment_summary", SLUG),
    ("get", f"/public/markets/{SLUG}/check-in", None, AttendanceApi, "get_checkin_page", SLUG),
    ("delete", f"/public/markets/{SLUG}/attendance/checkin",
     {"vendorEmail": "ana@example.com", "date": "2099-08-01"},
     AttendanceApi, "get_published_market_by_slug", SLUG),
    ("post", f"/public/markets/{SLUG}/attendance/checkin",
     {"vendorEmail": "ana@example.com", "date": "2099-08-01"},
     AttendanceApi, "get_published_market_by_slug", SLUG),
    ("post", f"/public/markets/{SLUG}/applicant-login/request-code", {"email": "ana@example.com"},
     ApplicantAuthApi, "request_login_code", SLUG),
    ("post", f"/public/markets/{SLUG}/applicant-login/verify-code",
     {"email": "ana@example.com", "code": "123456"},
     ApplicantAuthApi, "verify_login_code", SLUG),
    ("get", f"/public/markets/{SLUG}/application-form", None,
     ApplicantsApi, "get_public_application_form", SLUG),
    ("get", f"/public/markets/{SLUG}/applicant/application", None,
     ApplicantsApi, "authenticate_request", SLUG),
    ("put", f"/public/markets/{SLUG}/applicant/application", {"formData": {}},
     ApplicantsApi, "authenticate_request", SLUG),
    ("get", "/markets/market-123/applications", None,
     ApplicantsApi, "list_market_applications", "market-123"),
    ("put", "/markets/market-123/applications/app-1/review", {"status": "reviewer_approved"},
     MarketsApi, "verdict_refusal", "market-123"),
    ("post", "/markets/market-123/applications/verdicts",
     {"status": "reviewer_approved", "applications": [{"id": "app-1"}]},
     MarketsApi, "verdict_refusal", "market-123"),
    ("post", "/markets/market-123/review/next", {}, MarketsApi, "verdict_refusal", "market-123"),
    ("put", "/markets/market-123/applications/app-1/claim", None,
     MarketsApi, "verdict_refusal", "market-123"),
    ("put", "/markets/market-123/applications/app-1/follow-up-owner",
     {"ownerEmail": "ana@example.com"}, MarketsApi, "verdict_refusal", "market-123"),
    ("put", "/markets/market-123/applications/app-1/answers", {"answers": {"shop": "Ember"}},
     VendorInfoApi, "update_vendor_info", "market-123"),
    ("post", "/markets/market-123/publish-results", None,
     ApplicantsApi, "publish_results", "market-123"),
    ("post", "/markets/market-123/csv-proposal", {"csvContent": CSV},
     CsvProposal, "propose", "market-123"),
    ("post", "/markets/market-123/csv-proposal/confirm", {"csvContent": CSV, "year": 2026},
     CsvStart, "confirm", "market-123"),
    ("post", "/markets/market-123/applications/import/inspect", {"csvContent": CSV},
     CsvImport, "import_refusal", "market-123"),
    ("post", "/markets/market-123/applications/import/preview", {"csvContent": CSV, "mapping": {}},
     CsvImport, "import_refusal", "market-123"),
    ("post", "/markets/market-123/applications/import", {"csvContent": CSV, "mapping": {}},
     CsvImport, "import_refusal", "market-123"),
    ("get", "/markets/market-123/attendance", None,
     AttendanceApi, "attendance_roster", "market-123"),
    ("post", "/markets/market-123/attendance",
     {"vendorEmail": "ana@example.com", "date": "2099-08-01"}, DoorApi, "check_in", "market-123"),
    ("delete", "/markets/market-123/attendance",
     {"vendorEmail": "ana@example.com", "date": "2099-08-01"},
     DoorApi, "undo_check_in", "market-123"),
]


class TestTheApplicantReviewImportAndDoorRoutes:
    """The public applicant and check-in routes, the application list and review routes, the CSV
    start and the application import, Publish Results, attendance and the organizer's door answer
    through the handler: each refusal with the status and copy its reader reads, and anything else
    as the generic 500."""

    # Public

    def test_a_check_in_where_there_is_no_market(self, monkeypatch):
        monkeypatch.setattr(AttendanceApi, "get_published_market_by_slug", lambda _slug: None)
        monkeypatch.setattr(AttendanceApi, "get_check_in_market", lambda _slug: None)

        response = app_module.app.test_client().post(
            f"/public/markets/{SLUG}/attendance/checkin",
            json={"vendorEmail": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    @pytest.mark.parametrize("method", ["get", "put"])
    def test_an_applicant_whose_session_expired_is_asked_to_sign_in_again(self, method):
        response = call(
            app_module.app.test_client(), method,
            f"/public/markets/{SLUG}/applicant/application", {"formData": {}},
        )

        assert response.status_code == 401
        assert response.get_json() == {"error": APPLICANT_SESSION_EXPIRED}

    def test_an_application_that_loses_every_race_names_the_market_not_the_applicant(
        self, applications, monkeypatch,
    ):
        from pymongo.errors import DuplicateKeyError, PyMongoError
        from datatypes import Application, ApplicationStatus, ApplicationType

        monkeypatch.setattr(
            applications, "find_one_and_update", fail_with(DuplicateKeyError("E11000")),
        )
        monkeypatch.setattr(applications, "find_one", lambda *_a, **_kw: None)

        with pytest.raises(PyMongoError) as raised:
            ApplicationsApi.find_or_create_application(Application(
                market_id="market-123", applicant_email="vendor@example.com",
                application_type=ApplicationType.MAIN, form_data={},
                status=ApplicationStatus.OPEN,
            ))

        assert "market-123" in str(raised.value)
        assert "example.com" not in str(raised.value)

    # Review

    def test_a_verdict_that_names_no_status(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))

        response = client.put(
            "/markets/market-123/applications/app-1/review", json={"status": "maybe-later"},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid status: maybe-later"}

    @pytest.mark.parametrize("status", [["reviewer_approved"], {"status": "x"}, 7])
    def test_a_selection_whose_status_is_not_a_name(self, client, monkeypatch, status):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))

        response = client.post("/markets/market-123/applications/verdicts", json={
            "status": status, "applications": [{"id": "app-1"}],
        })

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("Invalid status: ")

    def test_a_follow_up_handed_to_someone_off_the_market(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))

        response = client.put("/markets/market-123/applications/app-1/review", json={
            "status": "needs_follow_up", "ownerEmail": "stranger@example.com",
        })

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "A follow-up's owner must have a role on this market.",
        }

    def test_a_follow_up_reassigned_to_nobody(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))

        response = client.put("/markets/market-123/applications/app-1/follow-up-owner", json={})

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "A follow-up's owner must have a role on this market.",
        }

    def test_a_verdict_after_the_review_closed(self, client):
        response = client.put(
            "/markets/market-123/applications/app-1/review", json={"status": "reviewer_approved"},
        )

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.VERDICTS_SETTLED}

    def test_the_applications_of_a_market_that_does_not_exist(self, client):
        response = client.get("/markets/market-missing/applications")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_an_application_that_cannot_be_read_is_logged_without_its_answers(
        self, client, monkeypatch, caplog,
    ):
        unreadable = {
            "id": "app-9", "market_id": "market-123", "applicant_email": "ana@example.com",
            "application_type": "main", "status": "open", "form_data": "ana@example.com",
        }
        monkeypatch.setattr(
            ApplicationsApi, "list_applications_for_market", lambda _market: [unreadable],
        )

        with caplog.at_level(logging.WARNING):
            response = client.get("/markets/market-123/applications")

        assert response.status_code == 200
        assert "app-9" in caplog.text
        assert "form_data (dict_type)" in caplog.text
        assert "example.com" not in caplog.text

    def test_results_published_for_a_market_that_does_not_exist(self, client):
        response = client.post("/markets/market-missing/publish-results")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    # The CSV start and the import

    def test_a_start_confirmed_past_draft_is_refused_in_its_words(self, client):
        response = client.post(
            "/markets/market-123/csv-proposal/confirm", json={"csvContent": CSV, "year": 2026},
        )

        assert response.status_code == 409
        assert response.get_json() == {
            "error": "Only a draft market can be started from a Google Form's responses.",
        }

    @pytest.mark.parametrize("raised", [
        BadRequestError("Invalid plan: sections.0.count: Input should be a valid integer"),
        MarketsApi.ApplicationFormLockedError("The form is locked."),
        CsvStart.ConfirmRefused("Say which year the file's dates are in."),
    ])
    def test_a_start_the_plan_or_the_form_refuses_answers_as_raised(
        self, client, monkeypatch, raised,
    ):
        use_market(monkeypatch, stored_market(setupObject=COMPLETE_PLAN))
        monkeypatch.setattr(CsvStart, "confirmed_update", fail_with(raised))

        response = client.post(
            "/markets/market-123/csv-proposal/confirm", json={"csvContent": CSV},
        )

        assert_answered_as_raised(response, [raised])

    def test_a_builtin_value_error_in_the_start_is_the_servers_fault(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(setupObject=COMPLETE_PLAN))
        monkeypatch.setattr(CsvStart, "confirmed_update", fail_with(ValueError(SECRET)))

        response = client.post(
            "/markets/market-123/csv-proposal/confirm", json={"csvContent": CSV},
        )

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}

    def test_an_import_past_its_phases_says_which_phase(self, client):
        response = client.post(
            "/markets/market-123/applications/import/inspect", json={"csvContent": CSV},
        )

        assert response.status_code == 409
        assert response.get_json() == {
            "error": CsvImport.import_refusal(stored_market(phase=MarketPhase.ASSIGNMENT)),
            "phase": "assignment",
        }

    @pytest.mark.parametrize("path", [
        "/markets/market-123/applications/import/inspect",
        "/markets/market-123/applications/import/preview",
        "/markets/market-123/applications/import",
        "/markets/market-123/csv-proposal",
    ])
    def test_a_file_that_is_not_sent(self, client, monkeypatch, path):
        use_market(monkeypatch, stored_market(phase=(
            MarketPhase.DRAFT if path.endswith("csv-proposal") else MarketPhase.APPLICATIONS_OPEN
        )))

        response = client.post(path, json={"csvContent": ["Name"]})

        assert response.status_code == 400
        assert response.get_json() == {"error": "csvContent is required"}

    # The door

    def test_a_check_in_at_a_market_that_does_not_exist(self, client):
        response = client.post(
            "/markets/market-missing/attendance",
            json={"vendorEmail": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}

    def test_a_check_in_before_the_market_days(self, client):
        response = client.post(
            "/markets/market-123/attendance",
            json={"vendorEmail": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 409
        assert response.get_json() == {"error": DoorApi.NOT_PUBLISHED}

    def test_a_check_in_on_an_archived_market(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(phase=MarketPhase.ARCHIVED, setupObject=COMPLETE_PLAN))

        response = client.delete(
            "/markets/market-123/attendance",
            json={"vendorEmail": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}

    def test_a_check_in_on_a_market_that_cannot_be_read(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        response = client.post(
            "/markets/market-123/attendance",
            json={"vendorEmail": "ana@example.com", "date": "2099-08-01"},
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}

    @pytest.mark.parametrize(
        "method, path, body, api, function, logged_as", APPLICANT_REVIEW_IMPORT_AND_DOOR_ROUTES,
    )
    def test_an_unexpected_failure_answers_only_internal_server_error(
        self, client, monkeypatch, caplog, method, path, body, api, function, logged_as,
    ):
        # The attendance read finds the market's document through its own module's collection.
        monkeypatch.setattr(AttendanceApi, "markets_collection", MarketsApi.markets_collection)
        monkeypatch.setattr(api, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            response = call(client, method, path, body)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert method.upper() in record.getMessage()
        assert logged_as in record.getMessage()
        assert [r for r in caplog.records if SECRET in r.getMessage()] == []
        assert "example.com" not in caplog.text


# Every route in app.py that reads a JSON body, by its rule, with the phase its market must be in
# for the route to reach its body. A body is read with `json_object`: a required one refuses no body
# as `NO_DATA_PROVIDED`, and an optional one reads it as `{}`.
REQUIRED_BODIES = [
    ("post", "/organizations", None),
    ("put", "/organizations/<org_id>", None),
    ("post", "/organizations/<org_id>/admins", None),
    ("post", "/organizations/<org_id>/members", None),
    ("post", "/organizations/<org_id>/transfer", None),
    ("post", "/markets/<market_id>/roles", None),
    ("put", "/markets/<market_id>/roles/<user_id>", None),
    ("post", "/markets", None),
    ("put", "/markets/<market_id>/plan", None),
    ("put", "/markets/<market_id>/application-form", None),
    ("post", "/markets/<market_id>/transition", None),
    ("post", "/markets/<market_id>/vendors", None),
    ("put", "/markets/<market_id>/placements", None),
    ("put", "/public/markets/<market_slug>/applicant/application", None),
    ("put", "/markets/<market_id>/applications/<application_id>/review", MarketPhase.REVIEW),
    ("put", "/markets/<market_id>/applications/<application_id>/answers", None),
    ("post", "/markets/<market_id>/csv-proposal/confirm", MarketPhase.DRAFT),
    ("post", "/markets/<market_id>/vendor-export", None),
    ("post", "/markets/<market_id>/vendor-export/preview", None),
]
OPTIONAL_BODIES = [
    ("put", "/markets/<market_id>/name", None),
    ("put", "/markets/<market_id>/vendor-notes/<path:vendor_email>", None),
    ("put", "/markets/<market_id>/vendor-notes/<path:vendor_email>/request-handled", None),
    ("put", "/markets/<market_id>/review-highlights", None),
    ("put", "/markets/<market_id>/rejection-rules", None),
    ("post", "/markets/<market_id>/application-form/amendment", None),
    ("post", "/markets/<market_id>/placements/swap", None),
    ("delete", "/markets/<market_id>/placements", None),
    ("post", "/public/markets/<market_slug>/attendance/checkin", None),
    ("delete", "/public/markets/<market_slug>/attendance/checkin", None),
    ("post", "/markets/<market_id>/applications/verdicts", MarketPhase.REVIEW),
    ("post", "/markets/<market_id>/review/next", MarketPhase.REVIEW),
    ("put", "/markets/<market_id>/applications/<application_id>/follow-up-owner",
     MarketPhase.REVIEW),
    ("post", "/markets/<market_id>/csv-proposal", MarketPhase.DRAFT),
    ("post", "/markets/<market_id>/applications/import/inspect", MarketPhase.APPLICATIONS_OPEN),
    ("post", "/markets/<market_id>/applications/import/preview", MarketPhase.APPLICATIONS_OPEN),
    ("post", "/markets/<market_id>/applications/import", MarketPhase.APPLICATIONS_OPEN),
    ("post", "/markets/<market_id>/attendance", None),
    ("delete", "/markets/<market_id>/attendance", None),
]
HANDED_ON = ({"handed_on": True}, 200)
DELETED = SimpleNamespace(deleted_count=1)

# Each write route in app.py that takes no body, with what to stub so its view runs to its success
# answer: a body read anywhere on that path is then caught.
READS_NO_BODY = [
    ("post", "/logout", []),
    ("delete", "/organizations/<org_id>", [(OrgsApi, "delete_organization", DELETED)]),
    ("delete", "/organizations/<org_id>/users/<user_id>", [(OrgsApi, "remove_org_user", True)]),
    ("delete", "/markets/<market_id>/roles/<user_id>", [(MarketsApi, "remove_market_role", True)]),
    ("post", "/markets/<market_id>/application-form/amendment/resume",
     [(FormAmendmentApi, "resume_amendment", {"resumed": True})]),
    ("delete", "/markets/<market_id>", [(MarketsApi, "delete_market", DELETED)]),
    ("post", "/markets/<market_id>/assignment", [(PlacementsApi, "run_assignment", HANDED_ON)]),
    ("put", "/markets/<market_id>/applications/<application_id>/claim", [
        (ApplicationsApi, "find_application_by_id", {"market_id": "market-123"}),
        (ApplicationsApi, "renew_claim", True),
    ]),
    ("delete", "/markets/<market_id>/applications/<application_id>/claim", [
        (ApplicationsApi, "find_application_by_id", {"market_id": "market-123"}),
        (ApplicationsApi, "release_claim", None),
    ]),
    ("post", "/markets/<market_id>/publish-results", [(ApplicantsApi, "publish_results", HANDED_ON)]),
]
# Each write route in app.py with a body another module reads: the view hands `request` to the
# account API in api/users.py, or the applicant sign-in in api/applicant_auth.py reads it for its
# uniform answers. Each with the module and function its view hands the request to.
BODY_READ_ELSEWHERE = [
    ("post", "/register-user", UsersApi, "register_user"),
    ("post", "/login", UsersApi, "login"),
    ("post", "/register", UsersApi, "register_user_with_captcha"),
    ("post", "/verify-email", UsersApi, "verify_email"),
    ("post", "/resend-verification", UsersApi, "resend_verification_email"),
    ("post", "/request-password-reset", UsersApi, "request_password_reset"),
    ("post", "/reset-password", UsersApi, "reset_password"),
    ("post", "/request-otp", UsersApi, "request_otp"),
    ("post", "/login-otp", UsersApi, "login_with_otp"),
    ("post", "/delete-user", UsersApi, "delete_user"),
    ("post", "/public/markets/<market_slug>/applicant-login/request-code",
     ApplicantAuthApi, "request_login_code"),
    ("post", "/public/markets/<market_slug>/applicant-login/verify-code",
     ApplicantAuthApi, "verify_login_code"),
]
BODY_VIEW_ARGS = {
    "<org_id>": ORG_ID, "<market_id>": "market-123", "<user_id>": "user-2",
    "<application_id>": "app-1", "<market_slug>": SLUG,
    "<path:vendor_email>": "vendor@example.com",
}
NOT_OBJECTS = [["Autumn Market"], [], "Autumn Market", "", 7, 0, True, False]


def path_for(rule):
    path = rule
    for arg, value in BODY_VIEW_ARGS.items():
        path = path.replace(arg, value)
    return path


def body_reads(monkeypatch):
    """Every read of the request's body while a route answers: `get_json` (and `request.json`),
    `get_data` (and `request.data`) and the form parser each record their name and raise."""
    reads = []

    def reader(name):
        def read(*_args, **_kwargs):
            reads.append(name)
            raise RuntimeError(f"the view read the body with {name}")
        return read

    for name in ("get_json", "get_data", "_load_form_data"):
        monkeypatch.setattr(flask.Request, name, reader(name))
    return reads


def send_body(client, monkeypatch, method, rule, phase, **kwargs):
    """``kwargs`` sent to the route at ``rule``, on a market in ``phase``, by an applicant signed in
    where the route is theirs; the public check-in finds no market."""
    use_market(monkeypatch, stored_market(
        phase=phase or MarketPhase.REVIEW, setupObject=COMPLETE_PLAN,
    ))
    monkeypatch.setattr(AttendanceApi, "get_published_market_by_slug", lambda _slug: None)
    monkeypatch.setattr(AttendanceApi, "get_check_in_market", lambda _slug: None)
    monkeypatch.setattr(
        ApplicantsApi, "authenticate_request",
        lambda _header: {"market_id": "market-123", "email": "vendor@example.com"},
    )
    return getattr(client, method)(
        path_for(rule), headers={"Authorization": "Bearer token"}, **kwargs,
    )


class TestABodyThatIsNotAnObject:
    """Every write route in app.py is classified once, by `app.url_map`, as reading a required or an
    optional body in its view, as taking no body, or as having a body another module reads; each
    body route refuses a body that is not a JSON object in the same words, 400: never Werkzeug's
    HTML 415, a model's own words, or the generic 500 of an ``AttributeError``; and no other view
    reads the body at all."""

    def test_every_write_route_is_classified(self):
        groups = {
            "required": {(method, rule) for method, rule, _phase in REQUIRED_BODIES},
            "optional": {(method, rule) for method, rule, _phase in OPTIONAL_BODIES},
            "takes no body": {(method, rule) for method, rule, _stubs in READS_NO_BODY},
            "a body another module reads": {
                (method, rule) for method, rule, *_ in BODY_READ_ELSEWHERE
            },
        }
        assert sum(len(group) for group in groups.values()) == len(set().union(*groups.values()))

        write_views = {
            (method.lower(), rule.rule)
            for rule in app_module.app.url_map.iter_rules()
            for method in rule.methods - {"HEAD", "OPTIONS"}
            if method in ("POST", "PUT", "DELETE")
            and app_module.app.view_functions[rule.endpoint].__module__ == app_module.__name__
        }

        assert write_views == set().union(*groups.values())

    @pytest.mark.parametrize("method, rule, stubs", READS_NO_BODY)
    def test_a_route_that_takes_no_body_reads_none(self, client, monkeypatch, method, rule, stubs):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))
        for module, function, answer in stubs:
            monkeypatch.setattr(module, function, lambda *_args, answer=answer, **_kwargs: answer)
        reads = body_reads(monkeypatch)

        response = getattr(client, method)(path_for(rule), json=["a body"])

        assert response.status_code == 200
        assert reads == []

    @pytest.mark.parametrize("method, rule, api, function", BODY_READ_ELSEWHERE)
    def test_a_route_whose_body_another_module_reads_reads_none_in_its_view(
        self, client, monkeypatch, method, rule, api, function,
    ):
        monkeypatch.setattr(api, function, lambda *_args, **_kwargs: HANDED_ON)
        reads = body_reads(monkeypatch)

        response = getattr(client, method)(path_for(rule), json=["a body"])

        assert (response.status_code, response.get_json()) == (200, {"handed_on": True})
        assert reads == []

    @pytest.mark.parametrize("not_an_object", NOT_OBJECTS)
    @pytest.mark.parametrize("method, rule, phase", REQUIRED_BODIES + OPTIONAL_BODIES)
    def test_json_that_is_not_an_object_is_refused_as_one(
        self, client, monkeypatch, method, rule, phase, not_an_object,
    ):
        response = send_body(client, monkeypatch, method, rule, phase, json=not_an_object)

        assert response.status_code == 400
        assert response.get_json() == {"error": NOT_AN_OBJECT}

    @pytest.mark.parametrize("no_body", [
        {}, {"json": None}, {"json": {}},
        {"data": "name=Renamed", "content_type": "text/plain"},
        {"data": "{not json", "content_type": "application/json"},
    ], ids=["none", "null", "empty-object", "not-json", "broken-json"])
    @pytest.mark.parametrize("method, rule, phase", REQUIRED_BODIES)
    def test_a_required_body_that_is_not_there_is_no_data(
        self, client, monkeypatch, method, rule, phase, no_body,
    ):
        response = send_body(client, monkeypatch, method, rule, phase, **no_body)

        assert response.status_code == 400
        assert response.get_json() == {"error": NO_DATA_PROVIDED}

    @pytest.mark.parametrize("method, rule, phase", OPTIONAL_BODIES)
    def test_an_optional_body_that_is_not_there_is_read_as_empty(
        self, client, monkeypatch, method, rule, phase,
    ):
        response = send_body(client, monkeypatch, method, rule, phase)

        assert response.status_code != 500
        assert response.get_json() not in ({"error": NO_DATA_PROVIDED}, {"error": NOT_AN_OBJECT})

    @pytest.mark.parametrize("name", [["Autumn Market"], {"en": "Autumn Market"}, 7])
    def test_a_name_that_is_not_a_string_is_no_name(self, client, monkeypatch, name):
        use_market(monkeypatch, stored_market(phase=MarketPhase.DRAFT))

        response = client.put("/markets/market-123/name", json={"name": name})

        assert response.status_code == 400
        assert response.get_json() == {"error": "A market needs a name."}

    @pytest.mark.parametrize("keys", ["business_name", {"business_name": True}, [7], 7])
    def test_highlights_that_are_not_a_list_of_keys(self, client, keys):
        response = client.put("/markets/market-123/review-highlights", json={"keys": keys})

        assert response.status_code == 400
        assert response.get_json() == {"error": "keys is required"}

    def test_a_ticked_application_that_is_not_an_object_is_not_one_here(
        self, client, monkeypatch,
    ):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, setupObject=COMPLETE_PLAN))
        monkeypatch.setattr(ApplicationsApi, "find_application_by_id", lambda _id: None)

        response = client.post("/markets/market-123/applications/verdicts", json={
            "status": "reviewer_approved", "applications": ["app-1", 7, None],
        })

        assert response.status_code == 200
        assert response.get_json() == {"written": [], "skipped": [
            {"id": "", "email": None, "reason": "Not an application here."},
        ] * 3}


class TestAClientError:
    def test_is_answered_with_its_status_and_copy(self, client, monkeypatch):
        monkeypatch.setattr(
            MarketsApi, "get_assignment_statistics",
            fail_with(ConflictError("Someone else moved this market on")),
        )

        response = client.get("/markets/market-123/assignment-statistics")

        assert response.status_code == 409
        assert response.get_json() == {"error": "Someone else moved this market on"}

    def test_with_a_structured_body_is_answered_as_given(self, client, monkeypatch):
        class Blocked(ConflictError):
            def body(self):
                return {"error": self.message, "blockers": [{"id": "form-locked"}]}

        monkeypatch.setattr(
            MarketsApi, "get_market_tables", fail_with(Blocked("The form is locked")),
        )

        response = client.get("/markets/market-123/tables")

        assert response.status_code == 409
        assert response.get_json() == {
            "error": "The form is locked", "blockers": [{"id": "form-locked"}],
        }

    def test_is_not_logged_as_a_failure(self, client, monkeypatch, caplog):
        monkeypatch.setattr(
            MarketsApi, "get_assignment_csv", fail_with(NotFoundError("Market not found")),
        )

        with caplog.at_level(logging.INFO, logger="client_errors"):
            response = client.get("/markets/market-123/assignment-csv")

        assert response.status_code == 404
        assert [r for r in caplog.records if r.name == "client_errors"] == []


class TestAnUnexpectedFailure:
    @pytest.mark.parametrize("path, function", ASSIGNMENT_READS)
    def test_answers_only_internal_server_error(self, client, monkeypatch, path, function):
        monkeypatch.setattr(MarketsApi, function, fail_with(RuntimeError(SECRET)))

        response = client.get(path)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)

    @pytest.mark.parametrize("path, function", ASSIGNMENT_READS)
    def test_is_logged_once_with_its_traceback_and_the_market(
        self, client, monkeypatch, caplog, path, function,
    ):
        monkeypatch.setattr(MarketsApi, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            client.get(path)

        records = [r for r in caplog.records if r.name == "client_errors"]
        assert len(records) == 1
        record = records[0]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert SECRET in caplog.text  # the traceback, for whoever is on call
        assert "GET" in record.getMessage()
        assert function in record.getMessage()
        assert "market-123" in record.getMessage()
        assert OWNER_EMAIL not in caplog.text

    def test_inside_the_api_function_answers_the_same(self, client, monkeypatch, caplog):
        """What the four API functions caught and echoed now reaches the handler unanswered."""
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", fail_with(KeyError(SECRET)))

        with caplog.at_level(logging.ERROR):
            responses = [client.get(path) for path, _function in ASSIGNMENT_READS]

        for response in responses:
            assert response.status_code == 500
            assert response.get_json() == {"error": "Internal server error"}
            assert SECRET not in response.get_data(as_text=True)
        assert len([r for r in caplog.records if r.name == "client_errors"]) == len(responses)

    def test_in_the_csv_writer_is_not_echoed(self, client, monkeypatch):
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", lambda _market: [])
        monkeypatch.setattr(
            MarketsApi, "market_csv_to_string", fail_with(ValueError(SECRET)),
        )

        response = client.get("/markets/market-123/assignment-csv")

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)

    def test_never_logs_a_vendors_address_the_path_or_the_body(self, client, monkeypatch, caplog):
        monkeypatch.setattr(MarketsApi, "save_vendor_note", fail_with(RuntimeError("boom")))

        with caplog.at_level(logging.ERROR):
            response = client.put(
                "/markets/market-123/vendor-notes/ana.vendor@example.com?ref=ana.vendor@example.com",
                json={"note": "Ana asked for a corner table"},
            )

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert "market-123" in record.getMessage()
        assert "ana.vendor@example.com" not in caplog.text
        assert "vendor-notes" not in record.getMessage()
        assert "corner table" not in caplog.text


# What a parser's message carries besides the field and what was wrong: the input, the error's type,
# a link to the library's docs. A refusal names the field and says what was wrong, and no more.
PARSER_DETAIL = ("errors.pydantic.dev", "input_value", "input_type", "int_parsing", "type=")


def use_market(monkeypatch, doc):
    collection = FakeMarketsCollection(doc)
    monkeypatch.setattr(MarketsApi, "markets_collection", collection)
    return collection


def assert_no_parser_detail(response, *inputs):
    text = response.get_data(as_text=True)
    for detail in (*PARSER_DETAIL, *inputs):
        assert detail not in text


class TestTheCopyIsOurs:
    """A refusal that comes of a failed parse is in our words: the parser's message is logged, not
    answered, and the log holds nothing an applicant wrote."""

    def test_a_number_question_answered_in_words_says_so_and_no_more(
        self, monkeypatch, applications, caplog,
    ):
        doc = stored_market(
            phase=MarketPhase.APPLICATIONS_OPEN, intakeMode="form", setupObject=COMPLETE_PLAN,
            applicationForm={"fields": [
                {"key": "booths", "label": "Booths", "type": "number", "required": True,
                 "options": [], "order": 0},
            ]},
        )
        markets = FakeSlugMarketsCollection(doc)
        monkeypatch.setattr(db_config, "get_database", lambda *_a, **_kw: {"markets": markets})
        monkeypatch.setattr(
            ApplicantsApi, "authenticate_request",
            lambda _header: {"market_id": "market-123", "email": "vendor@example.com"},
        )

        with caplog.at_level(logging.DEBUG):
            response = app_module.app.test_client().put(
                f"/public/markets/{market_name_slug('Test Market')}/applicant/application",
                json={"formData": {"booths": "a dozen or so"}},
                headers={"Authorization": "Bearer token"},
            )

        assert response.status_code == 422
        assert response.get_json() == {"error": "'Booths' must be a number."}
        assert_no_parser_detail(response, "a dozen", "could not convert")
        assert "a dozen" not in caplog.text

    def test_a_file_that_is_not_csv_says_so_and_logs_why(self, client, monkeypatch, caplog):
        use_market(monkeypatch, stored_market(phase=MarketPhase.APPLICATIONS_OPEN))
        # One answer longer than Python's reader allows a field to be.
        oversized = 'Name,Notes\n"Ana Rivera","' + "x" * 200_000 + '"\n'

        with caplog.at_level(logging.WARNING):
            response = client.post(
                "/markets/market-123/applications/import/inspect", json={"csvContent": oversized},
            )

        assert response.status_code == 400
        assert response.get_json() == {"error": "That file could not be read as CSV."}
        assert "field larger than field limit" in caplog.text
        assert "Ana Rivera" not in caplog.text

    def test_a_plan_with_a_wrong_typed_field_names_the_field(self, client, monkeypatch, caplog):
        use_market(monkeypatch, stored_market(setupObject=COMPLETE_PLAN))
        plan = {
            **COMPLETE_PLAN,
            "sections": [{**COMPLETE_PLAN["sections"][0], "count": "plenty-of-tables"}],
        }

        with caplog.at_level(logging.WARNING):
            response = client.put("/markets/market-123/plan", json={"setupObject": plan})

        assert response.status_code == 400
        error = response.get_json()["error"]
        assert error.startswith("Invalid plan: sections.0.count: ")
        assert_no_parser_detail(response, "plenty-of-tables")
        assert "sections.0.count" in caplog.text
        assert "plenty-of-tables" not in caplog.text

    def test_a_plan_that_is_not_an_object_is_refused_as_one(self, client, monkeypatch):
        use_market(monkeypatch, stored_market(setupObject=COMPLETE_PLAN))

        response = client.put("/markets/market-123/plan", json={"setupObject": ["a", "plan"]})

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("Invalid plan: ")
        assert_no_parser_detail(response)

    def test_a_form_with_a_wrong_typed_field_names_the_field(
        self, client, monkeypatch, applications, caplog,
    ):
        use_market(monkeypatch, stored_market(setupObject=COMPLETE_PLAN))
        form = {"fields": [
            {"key": "booths", "label": "Booths", "type": "number", "order": "first-of-all"},
        ]}

        with caplog.at_level(logging.WARNING):
            response = client.put("/markets/market-123/application-form", json=form)

        assert response.status_code == 400
        error = response.get_json()["error"]
        assert error.startswith("Invalid application form data: fields.0.order: ")
        assert_no_parser_detail(response, "first-of-all")
        assert "fields.0.order" in caplog.text
        assert "first-of-all" not in caplog.text

    def test_a_new_market_with_a_wrong_typed_field_names_the_field(
        self, client, monkeypatch, caplog,
    ):
        use_market(monkeypatch, None)
        body = {
            "name": "Spring Market", "creationDate": "2026-01-01T00:00:00Z",
            "organizationId": "org-1", "modificationList": "none-whatsoever",
        }

        with caplog.at_level(logging.WARNING):
            response = client.post("/markets", json=body)

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("Invalid market: modification_list: ")
        assert_no_parser_detail(response, "none-whatsoever")
        assert "modification_list" in caplog.text
        assert "none-whatsoever" not in caplog.text

    def test_a_stored_market_that_cannot_be_read_says_only_that(self, client, monkeypatch, caplog):
        use_market(monkeypatch, stored_market(
            setupObject={**COMPLETE_PLAN, "sections": "unreadable-sections"},
        ))

        with caplog.at_level(logging.WARNING):
            response = client.put("/markets/market-123/plan", json={"setupObject": COMPLETE_PLAN})

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}
        assert "market-123" in caplog.text
        assert "setup_object.sections" in caplog.text
        assert "unreadable-sections" not in caplog.text


    def test_a_stored_organization_that_cannot_be_read_logs_only_where(
        self, client, monkeypatch, caplog,
    ):
        use_market(monkeypatch, stored_market(phase=MarketPhase.REVIEW, organizationId=ORG_ID))
        unreadable = FakeOrganizations({
            "_id": "mongo-org", "id": ORG_ID, "name": ORG_NAME, "owner": "user-9",
            "markets": "unreadable-markets",
        })
        monkeypatch.setattr(OrgsApi, "organizations_collection", unreadable)
        monkeypatch.setattr(PermissionsApi, "organizations_collection", unreadable)

        with caplog.at_level(logging.WARNING):
            response = client.put("/markets/market-123/name", json={"name": "Autumn Market"})

        assert response.status_code == 400
        assert response.get_json() == {"error": MarketsApi.RENAME_REFUSED_AFTER_DRAFT}
        assert ORG_ID in caplog.text
        assert "markets (list_type)" in caplog.text
        assert "unreadable-markets" not in caplog.text

class TestFlasksOwnAnswers:
    def test_an_unknown_url_is_still_flasks_404(self, client):
        response = client.get("/no-such-route")

        assert response.status_code == 404
        assert response.get_json() is None
        assert "Not Found" in response.get_data(as_text=True)

    def test_a_wrong_method_is_still_flasks_405(self, client):
        response = client.delete("/markets/market-123/assignment-statistics")

        assert response.status_code == 405
        assert response.get_json() is None
        assert "Method Not Allowed" in response.get_data(as_text=True)

    def test_a_signed_out_call_is_still_flask_logins_401(self, monkeypatch):
        called = []
        monkeypatch.setattr(
            MarketsApi, "get_assignment_statistics", lambda *args: called.append(args),
        )

        response = app_module.app.test_client().get("/markets/market-123/assignment-statistics")

        assert response.status_code == 401
        assert response.get_json() is None
        assert "Unauthorized" in response.get_data(as_text=True)
        assert called == []
