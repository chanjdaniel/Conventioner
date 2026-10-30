"""The Stats tab's figures, counted on the server (E45/F01/S01, S02).

Both sections are counted here, so the page never fetches every application to count them.

Who applied: every application by its stored status, how many were added by hand, and only the
time each of the others applied, which the page turns into days in the reader's own calendar.

A chart per choice question: each select, multi-select and checkbox question of the market's form,
each option with how many gave it, a multi-select counting every option ticked, every answer the
form does not offer counted once as "Other", and those who gave none as "No answer". Free-text
questions are not counted. The counts come for every application, the approved ones and the assigned
ones, so the page's switch between them asks nothing more of the server.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, sessions_load_through_get_user, stored_market
import app as app_module
import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import market_stats as MarketStats
import api.users as UsersApi
from datatypes import FormField, MarketPhase

SELLING = {
    "key": "selling", "label": "What will you be selling at the event?", "type": "multi_select",
    "required": True, "options": ["Prints", "Stickers", "Jewelry"], "order": 1,
}
RETURNING = {
    "key": "returning", "label": "Have you vended with us before?", "type": "select",
    "required": False, "options": ["Yes", "No"], "order": 2,
}
OWN_WORK = {
    "key": "own_work", "label": "I certify the work is my own", "type": "checkbox",
    "required": False, "options": [], "order": 3,
}
BUSINESS = {
    "key": "business_name", "label": "Business name", "type": "text",
    "required": False, "options": [], "order": 0,
}
FORM = [BUSINESS, SELLING, RETURNING, OWN_WORK]


def _application(email, status, form_data, **more):
    return {
        "id": f"app-{email}", "market_id": "market-123", "applicant_email": email,
        "form_data": form_data, "status": status, "application_type": "main",
        "submitted_at": "2026-09-01T12:00:00Z", "updated_at": "2026-09-01T12:00:00Z", **more,
    }


APPLICATIONS = [
    _application("nadia@ember.test", "open", {
        "business_name": "Ember", "selling": ["Prints", "Stickers"], "returning": "Yes",
        "own_work": True,
    }),
    # A written-in "Other" answer, beside an option.
    _application("theo@thistle.test", "reviewer_approved", {
        "business_name": "Thistle", "selling": ["Prints", "Hand-bound zines"], "returning": "No",
        "own_work": True,
    }),
    # Two written in by one applicant are one "Other": each bar counts applicants, not words.
    _application("omar@kiln.test", "reviewer_approved", {
        "business_name": "Kiln", "selling": ["Jewelry", "Candles", "Soap"], "returning": "Yes",
        "own_work": True,
    }),
    # Rejected, and assigned by hand anyway: assigned, never approved.
    _application("lena@forge.test", "reviewer_rejected", {
        "business_name": "Forge", "selling": [], "returning": "", "own_work": False,
    }),
    # Added by hand: approved, and answered nothing.
    _application("walk.in@example.com", "reviewer_approved", {"full_name": "Walk-in Wares"},
                 added_by={"email": "owner@market.test"}, added_at="2026-09-02T12:00:00Z"),
]


def _seat(email, table):
    return {
        "email": email, "date": "2026-11-20", "tableCode": table, "tableChoice": "Full Table",
        "section": "A", "tier": "Gold", "location": "Atrium", "handPlaced": True,
    }


def _market_doc(fields=FORM, seats=None):
    return stored_market(
        MarketPhase.ASSIGNMENT,
        roles={"user-1": "owner", "user-viewer": "viewer"},
        applicationForm={"fields": fields},
        # The address as the seat stores it may be spelled otherwise than the application's.
        assignmentObject={
            "vendorAssignments": seats if seats is not None else [
                _seat("Omar@Kiln.test", "A1"), _seat("lena@forge.test", "A2"),
            ],
            "assignmentStatistics": None,
        },
    )


def _rows(question, among):
    return [
        (row["kind"], row.get("answer"), row["count"]) for row in question["answers"][among]
    ]


def _counted(fields=FORM, applications=APPLICATIONS, seated=("omar@kiln.test", "lena@forge.test")):
    return MarketStats.count_answers(
        [FormField(**field) for field in fields], applications, set(seated))


class TestWhoApplied:
    def test_every_application_is_counted_by_its_stored_status(self):
        counted = MarketStats.count_applicants(APPLICATIONS)

        assert counted["total"] == 5
        assert counted["statuses"] == {
            "open": 1, "reviewer_approved": 3, "reviewer_rejected": 1,
        }

    def test_a_vendor_added_by_hand_is_counted_apart_and_never_applied(self):
        counted = MarketStats.count_applicants(APPLICATIONS)

        assert counted["addedByHand"] == 1
        assert counted["submittedAt"] == ["2026-09-01T12:00:00Z"] * 4

    def test_only_when_each_applied_is_sent_never_who(self):
        counted = MarketStats.count_applicants(APPLICATIONS)

        assert set(counted) == {"total", "addedByHand", "statuses", "submittedAt"}

    def test_an_application_with_no_time_is_on_no_day(self):
        undated = [_application("ines@loom.test", "open", {}, submitted_at=None)]

        counted = MarketStats.count_applicants(undated)

        assert counted["total"] == 1
        assert counted["submittedAt"] == []

    def test_a_market_nobody_applied_to_counts_nothing(self):
        assert MarketStats.count_applicants([]) == {
            "total": 0, "addedByHand": 0, "statuses": {}, "submittedAt": [],
        }


class TestTheAnswerCounts:
    def test_the_groups_are_every_application_the_approved_and_the_assigned(self):
        assert _counted()["groups"] == {"all": 5, "approved": 3, "assigned": 2}

    def test_only_choice_questions_are_counted_in_the_forms_order(self):
        questions = _counted()["questions"]

        assert [q["key"] for q in questions] == ["selling", "returning", "own_work"]
        assert questions[0]["label"] == "What will you be selling at the event?"
        assert questions[0]["type"] == "multi_select"

    def test_a_multi_select_counts_each_option_ticked_and_every_write_in_as_one_other(self):
        selling = _counted()["questions"][0]

        assert _rows(selling, "all") == [
            ("option", "Prints", 2), ("option", "Stickers", 1), ("option", "Jewelry", 1),
            ("other", None, 2), ("none", None, 2),
        ]

    def test_an_answer_an_organizer_updated_is_counted_as_updated(self):
        """Counted as the organizer reads it, the update in the vendor's answer's place
        (E41/F01/S01): Theo said they never vended with us, and the organizer knows otherwise."""
        updated = [
            {**application, "answer_updates": {"returning": {
                "value": "Yes", "by": {"user_id": "u1", "email": "owner@market.test"},
                "at": "2026-10-30T09:00:00Z", "over": "No"}}}
            if application["applicant_email"] == "theo@thistle.test" else application
            for application in APPLICATIONS
        ]

        returning = _counted(applications=updated)["questions"][1]

        assert _rows(returning, "all") == [
            ("option", "Yes", 3), ("option", "No", 0), ("none", None, 2),
        ]

    def test_approved_narrows_every_chart_to_the_approved(self):
        selling, returning, own_work = _counted()["questions"]

        assert _rows(selling, "approved") == [
            ("option", "Prints", 1), ("option", "Stickers", 0), ("option", "Jewelry", 1),
            ("other", None, 2), ("none", None, 1),
        ]
        assert _rows(returning, "approved") == [
            ("option", "Yes", 1), ("option", "No", 1), ("none", None, 1),
        ]
        assert _rows(own_work, "approved") == [
            ("option", "Yes", 2), ("option", "No", 0), ("none", None, 1),
        ]

    def test_assigned_narrows_every_chart_to_those_with_an_assignment(self):
        selling, returning, own_work = _counted()["questions"]

        assert _rows(selling, "assigned") == [
            ("option", "Prints", 0), ("option", "Stickers", 0), ("option", "Jewelry", 1),
            ("other", None, 1), ("none", None, 1),
        ]
        assert _rows(returning, "assigned") == [
            ("option", "Yes", 1), ("option", "No", 0), ("none", None, 1),
        ]
        assert _rows(own_work, "assigned") == [("option", "Yes", 1), ("option", "No", 1)]

    def test_a_select_answer_the_form_no_longer_offers_is_other(self):
        retired = [_application("ines@loom.test", "open", {"returning": "Maybe"})]

        returning = _counted(fields=[RETURNING], applications=retired)["questions"][0]

        assert _rows(returning, "all") == [
            ("option", "Yes", 0), ("option", "No", 0), ("other", None, 1),
        ]

    def test_an_option_matches_whatever_spaces_surround_it(self):
        spaced = [_application("ines@loom.test", "open", {"selling": [" Prints "]})]

        selling = _counted(fields=[SELLING], applications=spaced)["questions"][0]

        assert _rows(selling, "all")[0] == ("option", "Prints", 1)

    def test_a_form_with_no_choice_question_counts_nothing(self):
        assert _counted(fields=[BUSINESS])["questions"] == []

    def test_a_market_nobody_applied_to_counts_every_option_at_zero(self):
        counted = _counted(applications=[], seated=())

        assert counted["groups"] == {"all": 0, "approved": 0, "assigned": 0}
        assert _rows(counted["questions"][1], "all") == [("option", "Yes", 0), ("option", "No", 0)]


PEOPLE = {"owner@market.test": "user-1", "viewer@market.test": "user-viewer",
          "outsider@x.test": "outsider"}
EMAILS = {uid: email for email, uid in PEOPLE.items()}


def _account(email):
    return SimpleNamespace(
        id=PEOPLE[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def market(monkeypatch, applications):
    doc = _market_doc()
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _org_id: None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user", lambda email: _account(email) if email in PEOPLE else None)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id", lambda uid: _account(EMAILS[uid]) if uid in EMAILS else None)
    applications.documents = [dict(document) for document in APPLICATIONS]
    return doc


def _signed_in(monkeypatch, email):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True
    return client


class TestTheRoute:
    def test_a_viewer_reads_the_figures_of_the_stored_market(self, monkeypatch, market):
        response = _signed_in(monkeypatch, "viewer@market.test").get(
            "/markets/market-123/stats")

        assert response.status_code == 200
        body = response.get_json()
        assert body["applicants"]["total"] == 5
        assert body["applicants"]["statuses"]["reviewer_approved"] == 3
        assert body["answers"]["groups"] == {"all": 5, "approved": 3, "assigned": 2}
        assert _rows(body["answers"]["questions"][0], "assigned") == [
            ("option", "Prints", 0), ("option", "Stickers", 0), ("option", "Jewelry", 1),
            ("other", None, 1), ("none", None, 1),
        ]

    def test_someone_who_may_not_read_the_market_is_refused(self, monkeypatch, market):
        response = _signed_in(monkeypatch, "outsider@x.test").get(
            "/markets/market-123/stats")

        assert response.status_code == 403
        assert response.get_json()["error"] == Actions.refusal_sentence(Actions.READ)

    def test_a_market_that_does_not_exist_is_not_found(self, monkeypatch, market):
        response = _signed_in(monkeypatch, "owner@market.test").get(
            "/markets/no-such-market/stats")

        assert response.status_code == 404

    def test_a_market_with_no_form_counts_no_question(self, monkeypatch, market, applications):
        no_form = {key: value for key, value in market.items() if key != "applicationForm"}
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(no_form))

        response = _signed_in(monkeypatch, "owner@market.test").get(
            "/markets/market-123/stats")

        assert response.status_code == 200
        assert response.get_json()["answers"]["questions"] == []
