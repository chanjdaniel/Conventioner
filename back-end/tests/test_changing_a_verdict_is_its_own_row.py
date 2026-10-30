"""Giving a verdict and changing one are two rows of the table (E38/F06/S01).

One gate covered both, Editor and above, so an Editor could turn an approval into a rejection, or
overturn an automatic rejection, as freely as they gave a first verdict. A verdict is approved or
rejected. Giving one to an open application or a follow-up stays the row "Give verdicts and
follow-ups" (default Editor); any reviewer's write on an application already approved or rejected -
the other verdict, back to needs follow-up - and a write that returns a rule's rejection to open
is the row "Change a verdict, or overturn an automatic rejection" (default Admin), refused with the
row's sentence.
"""
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.market_actions as Actions  # noqa: E402
import api.markets as MarketsApi  # noqa: E402
import api.permissions as PermissionsApi  # noqa: E402
import api.users as UsersApi  # noqa: E402
import rejection_rules as Rules  # noqa: E402
from conftest import client_market, complete_setup, sessions_load_through_get_user, stored_market  # noqa: E402
from datatypes import (  # noqa: E402
    ApplicationForm, ApplicationStatus, MarketPhase, MarketRole, RejectionRule, VerdictGiver)

PEOPLE = {
    "owner@market.test": "user-owner",
    "admin@market.test": "user-admin",
    "editor@market.test": "user-editor",
    "viewer@market.test": "user-viewer",
}
ROLES = {"user-owner": "owner", "user-admin": "admin", "user-editor": "editor",
         "user-viewer": "viewer"}
RULE = {"kind": "rule", "user_id": None, "email": None, "rule": "no_shows"}
KAI = {"kind": "person", "user_id": "user-kai", "email": "kai@market.test", "rule": None}

OPEN = ApplicationStatus.OPEN
APPROVED = ApplicationStatus.REVIEWER_APPROVED
REJECTED = ApplicationStatus.REVIEWER_REJECTED
FOLLOW_UP = ApplicationStatus.NEEDS_FOLLOW_UP

CHANGE_REFUSED = (
    "Only an Admin or the owner may change a verdict or overturn an automatic rejection on this "
    "market.")


def _application(app_id, status, by=None, **answers):
    marked = status in (APPROVED, REJECTED, FOLLOW_UP)
    return {
        "id": app_id, "market_id": "market-1", "applicant_email": f"{app_id}@example.com",
        "form_data": answers, "status": status.value, "application_type": "main",
        "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z",
        "verdict_at": "2026-10-02T00:00:00+00:00" if marked else None,
        **({"verdict_by": by or KAI} if marked else {}),
        **({"verdict_reason": "Did not tick “I understand that no-shows”"} if by == RULE else {}),
        **({"follow_up_owner": {"user_id": "user-kai", "email": "kai@market.test"}}
           if status is FOLLOW_UP else {}),
    }


def _seen(doc):
    return {"status": doc["status"], "verdictAt": doc["verdict_at"]}


@pytest.fixture
def market_document():
    return stored_market(MarketPhase.APPLICATIONS, id="market-1", _id="mongo-1",
                         organizationId=None, roles=dict(ROLES))


@pytest.fixture
def client(monkeypatch, applications, market_document):
    import app as app_module

    monkeypatch.setattr(app_module.login_manager, "session_protection", None)

    def _get_user(email):
        if email not in PEOPLE:
            return None
        return SimpleNamespace(id=PEOPLE[email], email=email, is_active=True, is_authenticated=True,
                               is_anonymous=False, get_id=lambda e=email: e)

    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _get_user)

    class Markets:
        def find_one(self, query, *args, **kwargs):
            return dict(market_document) if query.get("id") in (None, "market-1") else None

    monkeypatch.setattr(MarketsApi, "markets_collection", Markets())
    applications.documents = [
        _application("open", OPEN),
        _application("follow-up", FOLLOW_UP),
        _application("approved", APPROVED),
        _application("rejected", REJECTED),
        _application("ruled-out", REJECTED, by=RULE),
    ]
    client = app_module.app.test_client()
    client.stored = {doc["id"]: doc for doc in applications.documents}
    return client


def _as(client, email):
    with client.session_transaction() as session:
        session["_user_id"] = email


def _review(client, app_id, status, seen=True):
    body = {"status": status.value}
    if seen:
        body["seen"] = _seen(client.stored[app_id])
    return client.put(f"/markets/market-1/applications/{app_id}/review", json=body)


def _select(client, ids, status):
    return client.post("/markets/market-1/applications/verdicts", json={
        "status": status.value,
        "applications": [{"id": i, "seen": _seen(client.stored[i])} for i in ids],
    })


class TestTheRow:
    def test_is_the_tables_with_admin_as_its_default(self):
        row = Actions.ACTIONS["change-verdicts"]

        assert row is Actions.CHANGE_VERDICTS
        assert (row.group, row.label, row.default, row.fixed) == (
            "Applications", "Change a verdict, or overturn an automatic rejection",
            MarketRole.ADMIN, False)
        assert Actions.refusal_sentence(row) == CHANGE_REFUSED

    def test_the_table_says_who_may_take_it_as_the_market_holds_it(self):
        def who(market):
            return next(r["whoMay"] for r in Actions.table(market) if r["id"] == "change-verdicts")

        assert who(client_market()) == "an Admin or the owner"
        moved = client_market(permissions={"change-verdicts": {"role": "editor", "source": "market"}})
        assert who(moved) == "an Editor, an Admin or the owner"

    def test_the_table_names_the_stricter_of_giving_and_changing_since_a_change_takes_both(self):
        def who(**rows):
            market = client_market(permissions={
                row: {"role": role, "source": "market"} for row, role in rows.items()})
            return next(r["whoMay"] for r in Actions.table(market) if r["id"] == "change-verdicts")

        # Set below the giving row, the change row still takes a reviewer: never a Viewer.
        assert who(**{"change-verdicts": "viewer"}) == "an Editor, an Admin or the owner"
        assert who(**{"change-verdicts": "viewer", "give-verdicts": "admin"}) == (
            "an Admin or the owner")
        assert who(**{"give-verdicts": "owner"}) == "the market's owner"
        # The giving row itself names only its own role.
        giving = next(r for r in Actions.table(client_market(permissions={
            "change-verdicts": {"role": "viewer", "source": "market"}})) if r["id"] == "give-verdicts")
        assert giving["whoMay"] == "an Editor, an Admin or the owner"

    def test_the_market_read_answers_it_for_each_role(self):
        rows = {}
        for role in MarketRole:
            refusals = MarketsApi.role_action_refusals(role, MarketPhase.APPLICATIONS, {})
            rows[role] = refusals["change-verdicts"]

        assert rows == {MarketRole.VIEWER: CHANGE_REFUSED, MarketRole.EDITOR: CHANGE_REFUSED,
                        MarketRole.ADMIN: None, MarketRole.OWNER: None}


GIVING = [(app_id, status) for app_id in ("open", "follow-up") for status in (APPROVED, REJECTED)]
CHANGING = [
    ("approved", REJECTED), ("rejected", APPROVED),
    ("approved", FOLLOW_UP), ("rejected", FOLLOW_UP),
    ("approved", APPROVED),
    ("ruled-out", APPROVED), ("ruled-out", FOLLOW_UP),
]


class TestAnEditor:
    @pytest.mark.parametrize("app_id,status", GIVING)
    def test_gives_a_verdict_on_an_open_application_or_a_follow_up(self, client, app_id, status):
        _as(client, "editor@market.test")

        response = _review(client, app_id, status)

        assert response.status_code == 200
        assert client.stored[app_id]["status"] == status.value
        assert client.stored[app_id]["verdict_by"]["email"] == "editor@market.test"

    def test_marks_an_open_one_for_follow_up(self, client):
        _as(client, "editor@market.test")

        assert _review(client, "open", FOLLOW_UP).status_code == 200

    @pytest.mark.parametrize("app_id,status", CHANGING)
    def test_is_refused_a_change_with_the_rows_sentence(self, client, app_id, status):
        _as(client, "editor@market.test")
        before = dict(client.stored[app_id])

        response = _review(client, app_id, status)

        assert response.status_code == 403
        assert response.get_json() == {"error": CHANGE_REFUSED}
        assert client.stored[app_id] == before

    def test_is_refused_a_change_without_saying_what_they_saw(self, client):
        _as(client, "editor@market.test")

        response = _review(client, "approved", REJECTED, seen=False)

        assert response.status_code == 403
        assert client.stored["approved"]["status"] == APPROVED.value

    def test_who_saw_it_open_is_told_who_decided_it_in_between_and_nothing_is_written(
        self, client,
    ):
        _as(client, "editor@market.test")
        seen = _seen(client.stored["open"])
        client.stored["open"].update(status=APPROVED.value, verdict_by=KAI,
                                     verdict_at="2026-10-03T00:00:00+00:00")

        response = client.put("/markets/market-1/applications/open/review",
                              json={"status": REJECTED.value, "seen": seen})

        assert response.status_code == 409
        assert response.get_json()["error"] == (
            "kai@market.test approved this application since you opened it.")
        assert client.stored["open"]["status"] == APPROVED.value

    def test_a_selection_skips_each_decided_one_saying_why_and_writes_the_rest(self, client):
        _as(client, "editor@market.test")

        response = _select(client, ["open", "rejected", "ruled-out", "follow-up"], APPROVED)

        body = response.get_json()
        assert response.status_code == 200
        assert body["written"] == ["open", "follow-up"]
        assert body["skipped"] == [
            {"id": "rejected", "email": "rejected@example.com", "reason": CHANGE_REFUSED},
            {"id": "ruled-out", "email": "ruled-out@example.com", "reason": CHANGE_REFUSED},
        ]
        assert client.stored["rejected"]["status"] == REJECTED.value
        assert client.stored["ruled-out"]["verdict_by"] == RULE


class TestAnAdminAndTheOwner:
    @pytest.mark.parametrize("who", ["admin@market.test", "owner@market.test"])
    @pytest.mark.parametrize("app_id,status", CHANGING + GIVING)
    def test_change_a_verdict_and_give_one(self, client, who, app_id, status):
        _as(client, who)

        response = _review(client, app_id, status)

        assert response.status_code == 200
        assert client.stored[app_id]["status"] == status.value
        assert client.stored[app_id]["verdict_by"]["email"] == who

    def test_a_selection_changes_decided_ones(self, client):
        _as(client, "admin@market.test")

        body = _select(client, ["open", "rejected", "ruled-out"], APPROVED).get_json()

        assert body["written"] == ["open", "rejected", "ruled-out"]
        assert body["skipped"] == []


class TestAViewer:
    def test_gives_none_and_changes_none(self, client):
        _as(client, "viewer@market.test")

        for app_id, status in [("open", APPROVED), ("approved", REJECTED)]:
            response = _review(client, app_id, status)
            assert response.status_code == 403
            assert response.get_json()["error"] == (
                "Only an Editor, an Admin or the owner may give verdicts and follow-ups on this "
                "market.")


class TestAMarketThatMovesTheRow:
    def test_lets_an_editor_change_a_verdict_where_its_owner_set_the_row_to_editor(
        self, client, market_document,
    ):
        market_document["permissions"] = {
            "change-verdicts": {"role": "editor", "source": "market"}}
        _as(client, "editor@market.test")

        assert _review(client, "approved", REJECTED).status_code == 200

    def test_refuses_an_admin_where_its_owner_set_the_row_to_owner(self, client, market_document):
        market_document["permissions"] = {
            "change-verdicts": {"role": "owner", "source": "market"}}
        _as(client, "admin@market.test")

        response = _review(client, "approved", REJECTED)

        assert response.status_code == 403
        assert response.get_json()["error"] == (
            "Only the market's owner may change a verdict or overturn an automatic rejection on "
            "this market.")


class TestTheHistory:
    def test_records_a_change_under_its_own_row_and_a_verdict_given_under_the_giving_row(
        self, client, market_records,
    ):
        _as(client, "admin@market.test")

        _review(client, "open", APPROVED)
        _review(client, "approved", REJECTED)

        actions = [entry["action"] for entry in market_records.history.documents]
        assert actions == ["give-verdicts", "change-verdicts"]

    def test_records_a_selection_that_changed_any_verdict_under_the_change_row(
        self, client, market_records,
    ):
        _as(client, "admin@market.test")

        _select(client, ["open", "follow-up"], REJECTED)
        _select(client, ["approved", "open"], APPROVED)

        assert [entry["action"] for entry in market_records.history.documents] == [
            "give-verdicts", "change-verdicts"]


# --- Overturning an automatic rejection by judging again ------------------------------------

NOT_TICKED = Rules.NOT_TICKED
FIELDS = [{"key": "no_shows", "label": "I understand that no-shows", "type": "checkbox"}]
NO_SHOW_RULE = RejectionRule(key="no_shows", answers=[NOT_TICKED])


def _rules_market(*rules):
    return client_market(id="market-1", phase=MarketPhase.APPLICATIONS,
                         application_form=ApplicationForm(fields=FIELDS),
                         setup_object=complete_setup(), rejection_rules=list(rules))


@pytest.fixture
def ruled_out(applications):
    applications.documents = [_application("ruled-out", REJECTED, by=RULE, no_shows=False)]
    return applications.documents[0]


@pytest.fixture
def holding(monkeypatch):
    """The person saving holds this role on the market, resolved as every check resolves it."""
    def hold(role):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
    return hold


class TestJudgingAgain:
    def test_returns_a_rule_rejection_no_rule_meets_when_it_may(self, ruled_out):
        Rules.judge(Rules.Rulebook(_rules_market()), "market-1")

        assert ruled_out["status"] == OPEN.value

    def test_leaves_it_standing_when_it_may_not(self, ruled_out):
        verdicts = Rules.judge(Rules.Rulebook(_rules_market()), "market-1", overturns=False)

        assert ruled_out["status"] == REJECTED.value
        assert ruled_out["verdict_by"] == RULE
        assert verdicts.returned == 0

    def test_still_rejects_an_undecided_one_when_it_may_not_return(self, applications):
        applications.documents = [_application("open", OPEN, no_shows=False)]

        Rules.judge(Rules.Rulebook(_rules_market(NO_SHOW_RULE)), "market-1", overturns=False)

        assert applications.documents[0]["status"] == REJECTED.value


class TestAWriteThatJudgesAgain:
    """An Editor who narrows or removes a rule, or a question, leaves what the rules already
    rejected standing; an Admin or the owner returns it to open, as the rules always did."""

    @pytest.fixture(autouse=True)
    def market(self, monkeypatch):
        monkeypatch.setattr(MarketsApi, "_load_market_to_change",
                            lambda *_a: _rules_market(NO_SHOW_RULE))
        monkeypatch.setattr(MarketsApi.markets_collection, "update_one", lambda *_a: None)

    @pytest.mark.parametrize("role,status", [
        (MarketRole.EDITOR, REJECTED), (MarketRole.ADMIN, OPEN), (MarketRole.OWNER, OPEN)])
    def test_the_rules_save(self, ruled_out, holding, role, status):
        holding(role)

        MarketsApi.save_rejection_rules("market-1", [], "someone@market.test")

        assert ruled_out["status"] == status.value

    @pytest.mark.parametrize("role,status", [(MarketRole.EDITOR, REJECTED), (MarketRole.ADMIN, OPEN)])
    def test_the_form_save(self, ruled_out, holding, monkeypatch, role, status):
        without_it = _rules_market(NO_SHOW_RULE).model_copy(
            update={"application_form": ApplicationForm(fields=[])})
        monkeypatch.setattr(MarketsApi, "_load_market_to_change", lambda *_a: without_it)
        monkeypatch.setattr(MarketsApi, "prepared_application_form", lambda *_a: {})
        monkeypatch.setattr(MarketsApi, "load_market_context",
                            lambda _id: MarketsApi.MarketContext({}, without_it, None, None))
        holding(role)

        MarketsApi.save_application_form("market-1", {"fields": []}, "someone@market.test")

        assert ruled_out["status"] == status.value

    @pytest.mark.parametrize("role,status", [(MarketRole.EDITOR, REJECTED), (MarketRole.ADMIN, OPEN)])
    def test_updating_a_vendors_info(self, ruled_out, holding, role, status):
        import api.vendor_info as VendorInfoApi
        from datatypes import MarketPerson

        holding(role)

        VendorInfoApi.update_vendor_info(
            "market-1", "ruled-out", {"no_shows": True},
            MarketPerson(user_id="user-someone", email="someone@market.test"))

        assert ruled_out["status"] == status.value

    def test_an_applicants_own_change_still_returns_it(self, ruled_out):
        """The applicant changed the answer the rule read; nobody overturned a decision."""
        ruled_out["form_data"] = {"no_shows": True}

        Rules.judge(Rules.Rulebook(_rules_market(NO_SHOW_RULE)), "market-1", "ruled-out")

        assert ruled_out["status"] == OPEN.value


def test_a_selection_skips_one_decided_since_it_was_seen_with_the_change_rows_sentence(
    applications,
):
    """Seen open, but approved by now: for someone who may not change it, the reason is the row's,
    since even unchanged it would not be theirs to decide."""
    applications.documents = [_application("approved", APPROVED)]

    body, _ = ApplicantsApi.review_selection(
        "market-1", [("approved", ApplicantsApi.seen_from({"status": "open", "verdictAt": None}))],
        REJECTED, by=VerdictGiver(kind="person", user_id="u", email="e@market.test"),
        change_refused=CHANGE_REFUSED)

    assert body == {"written": [], "skipped": [
        {"id": "approved", "email": "approved@example.com", "reason": CHANGE_REFUSED}]}
    assert applications.documents[0]["status"] == APPROVED.value


def test_the_selection_function_skips_decided_ones_with_the_reason_given(applications):
    applications.documents = [_application("approved", APPROVED)]

    body, _ = ApplicantsApi.review_selection(
        "market-1", [("approved", ApplicantsApi.seen_from(_seen(applications.documents[0])))],
        REJECTED, by=VerdictGiver(kind="person", user_id="u", email="e@market.test"),
        change_refused=CHANGE_REFUSED)

    assert body == {"written": [], "skipped": [
        {"id": "approved", "email": "approved@example.com", "reason": CHANGE_REFUSED}]}


class TestAnImport:
    """An import judges the rules again: a rule's rejection no rule meets any longer returns to open
    only for an importer the change row allows."""

    @pytest.fixture
    def imported(self, applications, monkeypatch):
        import csv_import as CsvImport
        from conftest import FakeMarketsCollection
        from test_csv_import import GOOD_ROW, MAPPING, _csv, _market_doc

        applications.documents = [{**_application("ruled-out", REJECTED, by=RULE),
                                   "market_id": "market-123"}]
        markets = FakeMarketsCollection(_market_doc())
        asked = []

        def run(may):
            monkeypatch.setattr(MarketsApi, "may_overturn",
                                lambda who, _m: asked.append(who) or may)
            body, status = CsvImport.import_applications(
                markets, markets.doc, _csv(GOOD_ROW), MAPPING, by="someone@market.test")
            assert status == 200, body
            return applications.documents[0], body, asked

        return run

    def test_leaves_it_standing_for_an_importer_who_may_not(self, imported):
        ruled_out, body, asked = imported(False)

        assert asked == ["someone@market.test"]
        assert ruled_out["status"] == REJECTED.value
        assert body["returnedByRules"] == 0

    def test_returns_it_for_one_who_may(self, imported):
        ruled_out, body, _ = imported(True)

        assert ruled_out["status"] == OPEN.value
        assert body["returnedByRules"] == 1
