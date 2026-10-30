"""Every write that changes a market records one entry in its history (E40/F01/S02).

Each write route is sent once, through the Flask client as the screen sends it, and leaves exactly
one entry: who made the change, the table's action it was (``api.market_actions``), what it was
about, and the changed fields before and after - or, for an import or a run, its counts. A write
route this file does not send fails ``test_every_write_route_records_or_says_why_not``, and an
action no write records fails ``test_every_action_in_the_table_records_or_says_why_not``, so a new
write cannot be permitted without being recorded unless someone says here why it is not a change.
"""
import copy
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Callable, Dict, Optional, Tuple

import bson
import pytest

from conftest import (
    COMPLETE_PLAN, FakeApplicationsCollection, a_solver_vendor, mongo_matches, mongo_project, reject_malformed_update,
    sessions_load_through_get_user, skip_without_real_dependencies, stored_market,
)

skip_without_real_dependencies()

import app as app_module  # noqa: E402
import api.applicants as ApplicantsApi  # noqa: E402
import api.attendance as AttendanceApi  # noqa: E402
import api.floorplans as FloorplansApi  # noqa: E402
import api.floorplans_access as FloorplansAccess  # noqa: E402
import api.floorplans_save as FloorplansSave  # noqa: E402
import api.market_actions as Actions  # noqa: E402
import api.markets as MarketsApi  # noqa: E402
import api.permissions as PermissionsApi  # noqa: E402
import api.placements as PlacementsApi  # noqa: E402
import api.users as UsersApi  # noqa: E402
import csv_import as CsvImport  # noqa: E402
import db_config  # noqa: E402
import history as History  # noqa: E402
from bson.errors import InvalidDocument  # noqa: E402
from datatypes import MarketPerson, MarketPhase  # noqa: E402
from test_csv_import import MAPPING, _csv, _market_doc  # noqa: E402
from test_csv_proposal_api import CSV as A_GOOGLE_FORM_EXPORT  # noqa: E402
from test_essential_fields import VALID_ANSWERS, _applicant_market_doc  # noqa: E402
from test_the_placement_endpoint import SETUP_OBJECT, placement  # noqa: E402

MARKET = "market-123"
OWNER = "owner@example.com"
VENDOR = "vendor@example.com"
SAM = "sam@example.com"
DATE = "2026-08-01"
QUESTION = {"key": "shop", "label": "Shop", "type": "text"}
FORM_WITH_A_FIELD = {
    "fields": [{"key": "business_name", "label": "Business name", "type": "text", "order": 0}]
}
STUDENT = {"key": "student", "label": "Are you a student?", "type": "select",
           "options": ["Yes", "No"], "required": True}


def _value(doc: Dict[str, Any], dotted: str) -> Any:
    for part in dotted.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return _ABSENT
        doc = doc[part]
    return doc


_ABSENT = object()


def _matches(doc: Dict[str, Any], query: Dict[str, Any]) -> bool:
    """Mongo's filter over one document, dotted paths and the operators the writes use."""
    for key, condition in (query or {}).items():
        if key in ("$and", "$or", "$nor"):
            met = [_matches(doc, branch) for branch in condition]
            if not {"$and": all, "$or": any, "$nor": lambda m: not any(m)}[key](met):
                return False
            continue
        value = _value(doc, key)
        if isinstance(condition, dict) and condition and all(k.startswith("$") for k in condition):
            if "$size" in condition and (
                    not isinstance(value, list) or len(value) != condition["$size"]):
                return False
            if "$type" in condition and not isinstance(value, dict):
                return False
            if "$exists" in condition and (value is not _ABSENT) != condition["$exists"]:
                return False
            if any(k not in ("$size", "$type", "$exists") for k in condition) and not mongo_matches(
                    {key: None if value is _ABSENT else value},
                    {key: {k: v for k, v in condition.items() if k in ("$ne", "$in")}}):
                return False
        elif (None if value is _ABSENT else value) != condition:
            return False
    return True


class LiveMarkets:
    """The markets collection holding one market, applying each write the way Mongo does, so a
    write that reads its market again - a walk of phases, the form judged after it is saved - reads
    what the write before it left."""

    def __init__(self):
        self.doc: Optional[Dict[str, Any]] = None

    def find_one(self, query, projection=None):
        if self.doc is None or not _matches(self.doc, query):
            return None
        return mongo_project(dict(self.doc), projection)

    def find(self, query, projection=None):
        found = self.find_one(query, projection)
        return iter([found] if found is not None else [])

    def update_one(self, query, update, **_kwargs):
        reject_malformed_update(update)
        if self.doc is None or not _matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        for key, value in (update.get("$set") or {}).items():
            *parents, last = key.split(".")
            target = self.doc
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = value
        for key in update.get("$unset") or {}:
            self.doc.pop(key, None)
        for key, value in (update.get("$push") or {}).items():
            added = value["$each"] if isinstance(value, dict) and "$each" in value else [value]
            self.doc.setdefault(key, []).extend(added)
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)


class Attendance(FakeApplicationsCollection):
    """The check-ins, written by an upsert keyed by vendor and date."""

    def update_one(self, query, update, upsert=False):
        result = super().update_one(query, update)
        if not result.matched_count and upsert:
            self.insert_one({**query, **update.get("$set", {})})
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="new")
        return result


def _account(email: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"user-{email.split('@')[0]}", email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda: email,
    )


@pytest.fixture
def world(monkeypatch, applications, market_records):
    markets = LiveMarkets()
    for module in (MarketsApi, AttendanceApi, FloorplansSave):
        monkeypatch.setattr(module, "markets_collection", markets)
    monkeypatch.setattr(db_config, "get_database", lambda *_a, **_k: {"markets": markets})
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id", lambda user_id: _account(f"{user_id[len('user-'):]}@example.com"))

    def market(phase: MarketPhase, **overrides) -> Dict[str, Any]:
        # A copy, as a write reaches into the document it holds, and a plan here is a shared one.
        markets.doc = copy.deepcopy(stored_market(phase, **overrides))
        return markets.doc

    attendance = Attendance()
    monkeypatch.setattr(AttendanceApi, "attendance_collection", attendance)

    return SimpleNamespace(
        market=market, markets=markets, applications=applications,
        attendance=attendance, history=market_records.history,
        patch=monkeypatch.setattr,
    )


@pytest.fixture
def client(monkeypatch, world):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER
        session["_fresh"] = True
    return client


def _application(app_id: str, email: str, **fields) -> Dict[str, Any]:
    return {
        "id": app_id, "market_id": MARKET, "applicant_email": email, "form_data": {},
        "status": "open", "application_type": "main", "submitted_at": None,
        "updated_at": "2026-10-01T00:00:00Z", "verdict_at": None, **fields,
    }


def _seated(*emails: str) -> Dict[str, Any]:
    return {"vendorAssignments": [
        {"email": email, "date": DATE, "tableCode": f"Hall A {index}", "tableChoice": "Full Table",
         "section": "Hall A", "tier": "Gold", "location": "Main Hall", "handPlaced": True}
        for index, email in enumerate(emails, start=1)
    ], "assignmentStatistics": None}


@dataclass(frozen=True)
class Write:
    """One write route, sent as the screen sends it, and the entry it must leave."""

    name: str
    method: str
    rule: str
    #: The table's row the entry names, or ``History.APPLY`` for the applicant's own.
    action: Any
    kind: Optional[str]
    send: Callable[[Any, Any], Any]
    #: None for the vendors' public check-in page, which proves nobody.
    actor: Optional[str] = OWNER
    vendors: Tuple[str, ...] = ()
    subject: Dict[str, Any] = None
    #: False for an entry of counts - an import, a run - rather than fields before and after.
    before_after: bool = True
    #: Keys the detail must hold, beyond before and after.
    detail_keys: Tuple[str, ...] = ()

    @property
    def action_id(self) -> str:
        return self.action if isinstance(self.action, str) else self.action.id


# --- Market Setup ---------------------------------------------------------------------------------

def _rename(client, world):
    world.market(MarketPhase.DRAFT)
    return client.put(f"/markets/{MARKET}/name", json={"name": "Spring Market"})


def _plan(changes: Dict[str, Any], intake: Optional[str] = None):
    def send(client, world):
        world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN, intakeMode="csv")
        body = {"setupObject": {**COMPLETE_PLAN, **changes}}
        if intake:
            body["intakeMode"] = intake
        return client.put(f"/markets/{MARKET}/plan", json=body)
    return send


def _save_floorplan(client, world):
    world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN)
    return client.post("/floorplans/save-to-market", json={"market_id": MARKET, "floorplan": {
        "id": "fp-1",
        "sections": [{"name": "Hall A", "locationName": "Main Hall", "tierId": "tier_0",
                      "tableIds": ["t1", "t2"]}],
    }})


def _delete_floorplan_image(client, world):
    world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN)
    for module in (FloorplansAccess, FloorplansApi):
        world.patch(module, "get_image_market_id", lambda _id: MARKET)
    world.patch(FloorplansApi, "delete_image", lambda _id: True)
    return client.delete("/floorplans/img-1")


# --- The form ---------------------------------------------------------------------------------------

def _save_form(client, world):
    world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN)
    return client.put(f"/markets/{MARKET}/application-form", json={"fields": [QUESTION]})


def _review_highlights(client, world):
    world.market(MarketPhase.APPLICATIONS, applicationForm=FORM_WITH_A_FIELD)
    return client.put(f"/markets/{MARKET}/review-highlights", json={"keys": ["business_name"]})


def _rejection_rules(client, world):
    world.market(MarketPhase.APPLICATIONS, applicationForm=FORM_WITH_A_FIELD,
                 rejectionRules=[{"key": "business_name", "answers": ["None"]}])
    return client.put(f"/markets/{MARKET}/rejection-rules", json={"rules": []})


# --- Vendors coming in ------------------------------------------------------------------------------

#: More rows than any market takes, so one entry cannot pass for one per row.
ROWS = 212


def _import(client, world):
    world.markets.doc = copy.deepcopy(_market_doc(phase=MarketPhase.APPLICATIONS))
    rows = [
        f'2026/05/02 9:14:03,v{n}@ember.test,Nadia Okonkwo,Ember Ceramics {n},'
        f'"2026-08-01, 2026-08-08",2,Gold,half,,"Garden, Main Hall"'
        for n in range(ROWS)
    ]
    return client.post(f"/markets/{MARKET}/applications/import",
                       json={"csvContent": _csv(*rows), "mapping": MAPPING})


def _start_from_a_csv(client, world):
    world.market(MarketPhase.DRAFT, applicationForm={"fields": []})
    return client.post(f"/markets/{MARKET}/csv-proposal/confirm",
                       json={"csvContent": A_GOOGLE_FORM_EXPORT, "year": 2026})


def _applicant(first: bool):
    def apply(client, business_name: str):
        return client.put("/public/markets/test-market/applicant/application", json={
            "formData": {**VALID_ANSWERS, "business_name": business_name}})

    def send(client, world):
        world.markets.doc = copy.deepcopy(_applicant_market_doc())
        world.patch(ApplicantsApi, "authenticate_request",
                    lambda _header: {"market_id": MARKET, "email": VENDOR})
        if not first:
            # Their application as their first save left it, and only the edit's entry after it.
            assert apply(client, "Acme").status_code == 200
            world.history.documents.clear()
        return apply(client, "Ember Ceramics")
    return send


def _add_vendor(client, world):
    world.market(MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    return client.post(f"/markets/{MARKET}/vendors",
                       json={"name": "Wren Okafor", "email": "wren@example.com"})


# --- The review -------------------------------------------------------------------------------------

def _verdict(client, world):
    world.market(MarketPhase.APPLICATIONS)
    world.applications.insert_one(_application("app-1", VENDOR))
    return client.put(f"/markets/{MARKET}/applications/app-1/review",
                      json={"status": "reviewer_approved"})


def _verdicts(client, world):
    world.market(MarketPhase.APPLICATIONS)
    world.applications.insert_one(_application("app-1", VENDOR))
    world.applications.insert_one(_application("app-2", "ben@example.com"))
    return client.post(f"/markets/{MARKET}/applications/verdicts", json={
        "status": "reviewer_rejected", "applications": [{"id": "app-1"}, {"id": "app-2"}]})


def _follow_up_owner(client, world):
    world.market(MarketPhase.APPLICATIONS)
    world.applications.insert_one(_application(
        "app-1", VENDOR, status="needs_follow_up",
        follow_up_owner={"user_id": "user-owner", "email": OWNER}))
    world.patch(MarketsApi, "follow_up_owner",
                lambda *_a: MarketPerson(user_id="user-sam", email=SAM))
    return client.put(f"/markets/{MARKET}/applications/app-1/follow-up-owner",
                      json={"ownerEmail": SAM})


def _update_info(client, world):
    world.market(MarketPhase.APPLICATIONS, applicationForm={"fields": [QUESTION]})
    world.applications.insert_one(_application("app-1", VENDOR, form_data={"shop": "Ember"}))
    return client.put(f"/markets/{MARKET}/applications/app-1/answers",
                      json={"answers": {"shop": "Ember Ceramics"}})


# --- The market's life ------------------------------------------------------------------------------

def _move_phase(client, world):
    world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN, applicationForm=FORM_WITH_A_FIELD)
    world.patch(MarketsApi, "evaluate_transition", lambda *_a: [])
    return client.post(f"/markets/{MARKET}/transition", json={"toPhase": "applications"})


def _stop_applications(client, world):
    world.market(MarketPhase.APPLICATIONS, intakeMode="form")
    return client.post(f"/markets/{MARKET}/applications-stopped", json={"stopped": True})


def _publish(client, world):
    world.market(MarketPhase.ASSIGNMENT, intakeMode="form")
    world.patch(ApplicantsApi, "market_serves_applicants", lambda _doc: True)
    world.patch(ApplicantsApi, "publish_results_refusal", lambda _market: None)
    return client.post(f"/markets/{MARKET}/publish-results")


def _note(client, world):
    world.market(MarketPhase.MARKET_DAYS)
    return client.put(f"/markets/{MARKET}/vendor-notes/{VENDOR}", json={"note": "Chair given"})


def _request_handled(client, world):
    world.market(MarketPhase.MARKET_DAYS)
    return client.put(f"/markets/{MARKET}/vendor-notes/{VENDOR}/request-handled",
                      json={"handled": True})


# --- The assignment ---------------------------------------------------------------------------------

def _seats(*emails: str):
    def seat(world):
        world.market(MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT,
                     assignmentObject=_seated(*emails))
        world.patch(PlacementsApi, "has_applied", lambda _market_id, _address: True)
    return seat


def _run(client, world):
    _seats()(world)
    world.patch(PlacementsApi, "solver_vendors_for", lambda _m: [a_solver_vendor()])
    world.patch(PlacementsApi, "assign_market", lambda market, _vendors=None: market)
    return client.post(f"/markets/{MARKET}/assignment")


def _place(client, world):
    _seats()(world)
    return client.put(f"/markets/{MARKET}/placements", json=placement(email=VENDOR))


def _swap(client, world):
    _seats(VENDOR, "ben@example.com")(world)
    return client.post(f"/markets/{MARKET}/placements/swap",
                       json={"date": DATE, "emails": [VENDOR, "ben@example.com"]})


def _free(client, world):
    _seats(VENDOR)(world)
    return client.delete(f"/markets/{MARKET}/placements", json={"email": VENDOR, "date": DATE})


# --- The door ---------------------------------------------------------------------------------------

def _door(organizer: bool, undo: bool):
    def send(client, world):
        world.market(MarketPhase.MARKET_DAYS, assignmentObject=_seated(VENDOR))
        if undo:
            world.attendance.insert_one(
                {"market_id": MARKET, "vendor_email": VENDOR, "date": DATE})
        path = f"/markets/{MARKET}/attendance" if organizer \
            else "/public/markets/test-market/attendance/checkin"
        send = client.delete if undo else client.post
        return send(path, json={"vendorEmail": VENDOR, "date": DATE})
    return send


# --- People -----------------------------------------------------------------------------------------

def _give_role(client, world):
    world.market(MarketPhase.APPLICATIONS)
    return client.post(f"/markets/{MARKET}/roles", json={"user_email": SAM, "role": "editor"})


def _change_role(client, world):
    world.market(MarketPhase.APPLICATIONS, roles={"user-1": "owner", "user-sam": "editor"})
    return client.put(f"/markets/{MARKET}/roles/user-sam", json={"role": "admin"})


def _take_role(client, world):
    world.market(MarketPhase.APPLICATIONS, roles={"user-1": "owner", "user-sam": "editor"})
    return client.delete(f"/markets/{MARKET}/roles/user-sam")


def _set_permission(client, world):
    world.market(MarketPhase.APPLICATIONS)
    return client.put(f"/markets/{MARKET}/permissions/check-in", json={"role": "admin"})


def _reset_permission(client, world):
    world.market(MarketPhase.APPLICATIONS,
                 permissions={"check-in": {"role": "admin", "source": "market"}})
    return client.delete(f"/markets/{MARKET}/permissions/check-in")


def _reset_permissions(client, world):
    world.market(MarketPhase.APPLICATIONS,
                 permissions={"check-in": {"role": "admin", "source": "market"}})
    return client.delete(f"/markets/{MARKET}/permissions")


M = "/markets/<market_id>"
APPLICANT = "/public/markets/<market_slug>/applicant/application"
PUBLIC_DOOR = "/public/markets/<market_slug>/attendance/checkin"
SAM_BY_ID = {"user_id": "user-sam", "email": SAM}

WRITES = [
    Write("rename", "PUT", f"{M}/name", Actions.CHANGE_SETUP, History.RENAMED, _rename),
    Write("a plan card", "PUT", f"{M}/plan", Actions.CHANGE_SETUP, History.PLAN,
          _plan({"marketDates": [{"date": "2099-08-02"}]})),
    Write("the intake mode", "PUT", f"{M}/plan", Actions.CHANGE_SETUP, History.PLAN,
          _plan({}, intake="form")),
    Write("the prices", "PUT", f"{M}/plan", Actions.CHANGE_SETUP, History.PRICING,
          _plan({"pricing": {"currency": "CAD", "halfTablePercent": 50,
                             "everyoneElse": [{"tier": "Gold", "cents": 3500}]}})),
    Write("the assignment rules", "PUT", f"{M}/plan", Actions.ASSIGN, History.RULES,
          _plan({"assignmentOptions": {"maxAssignmentsPerVendor": 1}})),
    Write("a floorplan", "POST", "/floorplans/save-to-market", Actions.CHANGE_SETUP,
          History.FLOORPLAN, _save_floorplan, subject={"floorplan_id": "fp-1"}),
    Write("a floorplan image deleted", "DELETE", "/floorplans/<gridfs_id>", Actions.CHANGE_SETUP,
          History.FLOORPLAN_IMAGE_DELETED, _delete_floorplan_image, subject={"image_id": "img-1"}),
    Write("the form", "PUT", f"{M}/application-form", Actions.CHANGE_FORM, History.FORM,
          _save_form),
    Write("review highlights", "PUT", f"{M}/review-highlights", Actions.CHANGE_FORM,
          History.REVIEW_HIGHLIGHTS, _review_highlights),
    Write("automatic rejections", "PUT", f"{M}/rejection-rules", Actions.CHANGE_FORM,
          History.REJECTION_RULES, _rejection_rules),
    Write("an import", "POST", f"{M}/applications/import", Actions.IMPORT_APPLICATIONS,
          History.IMPORTED, _import, before_after=False),
    Write("the start from a CSV", "POST", f"{M}/csv-proposal/confirm", Actions.IMPORT_APPLICATIONS,
          History.STARTED, _start_from_a_csv, before_after=False),
    Write("an application submitted", "PUT", APPLICANT, History.APPLY, History.SUBMITTED,
          _applicant(first=True), actor=VENDOR, vendors=(VENDOR,),
          subject={"application_id": None}),
    Write("an application edited", "PUT", APPLICANT, History.APPLY, History.EDITED,
          _applicant(first=False), actor=VENDOR, vendors=(VENDOR,),
          subject={"application_id": None}),
    Write("a verdict", "PUT", f"{M}/applications/<application_id>/review", Actions.GIVE_VERDICTS,
          History.VERDICT, _verdict, vendors=(VENDOR,), subject={"application_id": "app-1"}),
    Write("a selection's verdict", "POST", f"{M}/applications/verdicts", Actions.GIVE_VERDICTS,
          History.VERDICTS, _verdicts, vendors=(VENDOR, "ben@example.com"),
          subject={"application_ids": ["app-1", "app-2"]}),
    Write("a follow-up handed on", "PUT", f"{M}/applications/<application_id>/follow-up-owner",
          Actions.GIVE_VERDICTS, History.FOLLOW_UP_OWNER, _follow_up_owner, vendors=(VENDOR,),
          subject={"application_id": "app-1"}),
    Write("a vendor's info updated", "PUT", f"{M}/applications/<application_id>/answers",
          Actions.UPDATE_VENDOR_INFO, None, _update_info, vendors=(VENDOR,),
          subject={"application_id": "app-1"},
          detail_keys=("rejected_by_rules", "returned_by_rules")),
    Write("a phase move", "POST", f"{M}/transition", Actions.MOVE_PHASE, None, _move_phase),
    Write("applications stopped", "POST", f"{M}/applications-stopped", Actions.STOP_APPLICATIONS,
          None, _stop_applications),
    Write("publishing results", "POST", f"{M}/publish-results", Actions.PUBLISH_RESULTS, None,
          _publish),
    Write("a vendor added", "POST", f"{M}/vendors", Actions.ADD_VENDOR, None, _add_vendor,
          vendors=("wren@example.com",), subject={"application_id": None}),
    Write("a vendor note", "PUT", f"{M}/vendor-notes/<path:vendor_email>",
          Actions.WRITE_VENDOR_NOTES, History.NOTE, _note, vendors=(VENDOR,)),
    Write("a request handled", "PUT", f"{M}/vendor-notes/<path:vendor_email>/request-handled",
          Actions.WRITE_VENDOR_NOTES, History.REQUEST_HANDLED, _request_handled,
          vendors=(VENDOR,)),
    Write("an assignment run", "POST", f"{M}/assignment", Actions.ASSIGN, History.ASSIGNED, _run,
          before_after=False),
    Write("a hand placement", "PUT", f"{M}/placements", Actions.ASSIGN, History.PLACED, _place,
          vendors=(VENDOR,), before_after=False,
          detail_keys=("date", "table_code", "table_choice", "before")),
    Write("a swap", "POST", f"{M}/placements/swap", Actions.ASSIGN, History.SWAPPED, _swap,
          vendors=(VENDOR, "ben@example.com"), before_after=False),
    Write("a seat freed", "DELETE", f"{M}/placements", Actions.ASSIGN, History.FREED, _free,
          vendors=(VENDOR,), before_after=False),
    Write("a check-in at the door", "POST", f"{M}/attendance", Actions.CHECK_IN,
          History.CHECKED_IN, _door(organizer=True, undo=False), vendors=(VENDOR,),
          subject={"date": DATE}),
    Write("a check-in undone at the door", "DELETE", f"{M}/attendance", Actions.CHECK_IN,
          History.CHECK_IN_UNDONE, _door(organizer=True, undo=True), vendors=(VENDOR,),
          subject={"date": DATE}),
    Write("a vendor's own check-in", "POST", PUBLIC_DOOR, Actions.CHECK_IN, History.CHECKED_IN,
          _door(organizer=False, undo=False), actor=None, vendors=(VENDOR,),
          subject={"date": DATE}, detail_keys=("via",)),
    Write("a vendor's own check-in undone", "DELETE", PUBLIC_DOOR, Actions.CHECK_IN,
          History.CHECK_IN_UNDONE, _door(organizer=False, undo=True), actor=None,
          vendors=(VENDOR,), subject={"date": DATE}, detail_keys=("via",)),
    Write("a role given", "POST", f"{M}/roles", Actions.MANAGE_EDITORS_AND_VIEWERS,
          History.ROLE_GIVEN, _give_role, subject=SAM_BY_ID),
    Write("a role changed", "PUT", f"{M}/roles/<user_id>", Actions.MANAGE_ADMINS,
          History.ROLE_CHANGED, _change_role, subject=SAM_BY_ID),
    Write("a role taken", "DELETE", f"{M}/roles/<user_id>", Actions.MANAGE_EDITORS_AND_VIEWERS,
          History.ROLE_TAKEN, _take_role, subject=SAM_BY_ID),
    Write("a row of the table set", "PUT", f"{M}/permissions/<action_id>",
          Actions.CHANGE_THE_TABLE, History.PERMISSION_SET, _set_permission,
          subject={"action": "check-in"}),
    Write("a row of the table reset", "DELETE", f"{M}/permissions/<action_id>",
          Actions.CHANGE_THE_TABLE, History.PERMISSION_RESET, _reset_permission,
          subject={"action": "check-in"}),
    Write("the table reset", "DELETE", f"{M}/permissions",
          Actions.CHANGE_THE_TABLE, History.PERMISSION_TABLE_RESET, _reset_permissions),
]

#: The write routes that change nothing on a market's record, and why.
NOT_A_CHANGE = {
    ("POST", "/markets"): "creates the market, whose history starts empty; its owner is its role",
    ("DELETE", M): "deletes the history with the market; the deletion trail records it",
    ("POST", f"{M}/review/next"): "deals a card: a review claim (ADR 0014) is not a change",
    ("PUT", f"{M}/applications/<application_id>/claim"): "a review claim is not a change",
    ("DELETE", f"{M}/applications/<application_id>/claim"): "a review claim is not a change",
    ("POST", f"{M}/csv-proposal"): "reads a file and keeps nothing",
    ("POST", f"{M}/applications/import/inspect"): "reads a file and keeps nothing",
    ("POST", f"{M}/applications/import/preview"): "reads a file and keeps nothing",
    ("POST", f"{M}/vendor-export"): "an export, a read",
    ("POST", f"{M}/vendor-export/preview"): "an export's preview, a read",
    ("POST", "/public/markets/<market_slug>/applicant-login/request-code"):
        "a vendor signing in changes nothing on the market",
    ("POST", "/public/markets/<market_slug>/applicant-login/verify-code"):
        "a vendor signing in changes nothing on the market",
    ("POST", "/floorplans/upload"):
        "stores an image the market uses only once a floorplan is saved, which records",
    ("POST", "/floorplans/calibrate"): "measures an image and keeps nothing",
    ("POST", "/floorplans/analyze"): "reads an image and keeps nothing",
    ("POST", "/floorplans/place-tables"): "proposes table positions and keeps nothing",
    ("POST", "/floorplans/export"): "a read",
}

#: The table's rows no write records, and why.
NOT_RECORDED = {
    Actions.READ.id: "a read changes nothing",
    Actions.READ_HISTORY.id: "a read changes nothing",
    Actions.EXPORT_CSV.id: "a read changes nothing",
    Actions.DELETE_MARKET.id: "the history goes with the market; the deletion trail records it",
    Actions.UPDATE_ASSIGNMENT_OR_PRICE_INFO.id:
        "asked beside Update a vendor's info by the same write, which records it under that row",
}


def _market_write_routes():
    """Every route that writes, on a market or one of its floorplans; an organization's own
    floorplan templates are the organization's history's (E40/F02)."""
    for rule in app_module.app.url_map.iter_rules():
        path = rule.rule
        if not path.startswith(("/markets", "/public/markets/", "/floorplans/")) \
                or path.startswith("/floorplans/templates"):
            continue
        for method in rule.methods - {"GET", "HEAD", "OPTIONS"}:
            yield method, path


def test_every_write_route_records_or_says_why_not():
    sent = {(write.method, write.rule) for write in WRITES}

    assert sent.isdisjoint(NOT_A_CHANGE)
    assert sorted(set(_market_write_routes()) - sent - set(NOT_A_CHANGE)) == []
    assert sorted((sent | set(NOT_A_CHANGE)) - set(_market_write_routes())) == []


def test_every_action_in_the_table_records_or_says_why_not():
    """A row added to the table fails here until a write records it, or this says why none does."""
    recorded = {write.action_id for write in WRITES}

    assert recorded.isdisjoint(NOT_RECORDED)
    assert sorted(set(Actions.ACTIONS) - recorded - set(NOT_RECORDED)) == []


@pytest.mark.parametrize("write", WRITES, ids=lambda write: write.name)
def test_a_write_records_one_entry(write, client, world):
    response = write.send(client, world)

    assert response.status_code < 300, response.get_json()
    entries = world.history.documents
    assert len(entries) == 1, entries
    entry = entries[0]
    assert entry["market_id"] == MARKET
    assert entry["actor"] == write.actor
    assert entry["action"] == write.action_id
    assert entry["kind"] == write.kind
    assert entry["vendors"] == list(write.vendors)
    # A document Mongo can store: a fake takes a ``date`` or a set that the driver refuses, and
    # the store would then swallow every such entry.
    bson.encode(entry)
    for key, value in (write.subject or {}).items():
        assert key in entry["subject"]
        assert value is None or entry["subject"][key] == value
    if write.before_after:
        before, after = entry["detail"]["before"], entry["detail"]["after"]
        assert before != after
        assert set(before) == set(after)
    else:
        assert entry["detail"]
    assert set(write.detail_keys) <= set(entry["detail"])


#: What the entries' details are built from: each raising stands for a detail that cannot be built.
DETAIL_BUILDERS = [
    (History, "changes"), (History, "placement_subject"), (MarketsApi, "form_changes"),
    (CsvImport, "import_counts"), (ApplicantsApi, "_verdict_state"), (UsersApi, "get_user_by_id"),
]


@pytest.mark.parametrize("write", WRITES, ids=lambda write: write.name)
def test_a_detail_that_cannot_be_built_never_fails_the_write(write, client, world):
    """Built inside the store's guard, so it fails as the insert would: losing the entry, never
    answering a change that landed with a 500."""
    def broken(*_args, **_kwargs):
        raise RuntimeError("the detail could not be built")

    for module, name in DETAIL_BUILDERS:
        world.patch(module, name, broken)

    response = write.send(client, world)

    assert response.status_code < 300, response.get_json()


@pytest.mark.parametrize("write", WRITES, ids=lambda write: write.name)
def test_a_store_that_fails_never_fails_the_write(write, client, world):
    def broken(_document):
        raise RuntimeError("the history store is down")

    world.patch(world.history, "insert_one", broken)

    response = write.send(client, world)

    assert response.status_code < 300, response.get_json()


class TestWhatAnEntryHolds:
    def test_an_import_of_many_rows_is_one_entry_with_its_counts(self, client, world):
        _import(client, world)

        [entry] = world.history.documents
        assert entry["detail"]["row_count"] == ROWS
        assert entry["detail"]["created"] == ROWS
        assert entry["detail"]["rejected_by_rules"] == 0
        assert entry["detail"]["returned_by_rules"] == 0

    def test_an_applicants_edit_holds_the_answers_it_changed_as_given(self, client, world):
        _applicant(first=False)(client, world)

        [entry] = world.history.documents
        assert entry["actor"] == VENDOR
        assert entry["detail"] == {
            "before": {"business_name": "Acme"}, "after": {"business_name": "Ember Ceramics"},
            "rejected_by_rules": False, "returned_by_rules": False}

    def test_a_plan_write_holds_only_the_cards_it_changed(self, client, world):
        _plan({"marketDates": [{"date": "2099-08-02"}]})(client, world)

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"market_dates": [{"date": "2099-08-01"}]},
            "after": {"market_dates": [{"date": "2099-08-02"}]},
        }

    def test_a_plan_restated_records_nothing(self, client, world):
        """The plan saves as the organizer types, and restating it changes nothing."""
        _plan({})(client, world)

        assert world.history.documents == []

    def test_a_stop_holds_whether_applications_are_taken(self, client, world):
        _stop_applications(client, world)

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"applications_stopped": False}, "after": {"applications_stopped": True}}

    def test_a_stop_restated_records_nothing(self, client, world):
        world.market(MarketPhase.APPLICATIONS, intakeMode="form", applicationsStopped=True)

        client.post(f"/markets/{MARKET}/applications-stopped", json={"stopped": True})

        assert world.history.documents == []

    def test_a_form_write_holds_the_questions_it_changed(self, client, world):
        world.market(MarketPhase.DRAFT, setupObject=COMPLETE_PLAN,
                     applicationForm=FORM_WITH_A_FIELD)

        client.put(f"/markets/{MARKET}/application-form",
                   json={"fields": [*FORM_WITH_A_FIELD["fields"], QUESTION]})

        [entry] = world.history.documents
        assert entry["detail"]["before"]["questions"] == {"shop": None}
        assert entry["detail"]["after"]["questions"]["shop"]["label"] == "Shop"
        assert "business_name" not in entry["detail"]["after"]["questions"]

    def test_a_verdict_given_again_is_recorded_again(self, client, world):
        """Each verdict is recorded, not only the latest."""
        _verdict(client, world)
        client.put(f"/markets/{MARKET}/applications/app-1/review",
                   json={"status": "reviewer_rejected"})

        assert [entry["detail"]["after"]["status"] for entry in world.history.documents] == [
            "reviewer_approved", "reviewer_rejected"]

    def test_a_selection_marked_follow_up_records_its_owner(self, client, world):
        world.market(MarketPhase.APPLICATIONS)
        world.applications.insert_one(_application("app-1", VENDOR))

        client.post(f"/markets/{MARKET}/applications/verdicts", json={
            "status": "needs_follow_up", "applications": [{"id": "app-1"}]})

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"app-1": {"status": "open"}},
            "after": {"app-1": {"status": "needs_follow_up", "follow_up_owner": OWNER}},
        }

    def test_a_selection_moved_from_follow_up_drops_the_owner(self, client, world):
        world.market(MarketPhase.APPLICATIONS)
        world.applications.insert_one(_application(
            "app-1", VENDOR, status="needs_follow_up",
            follow_up_owner={"user_id": "user-sam", "email": SAM}))

        client.post(f"/markets/{MARKET}/applications/verdicts", json={
            "status": "reviewer_approved", "applications": [{"id": "app-1"}]})

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"app-1": {"status": "needs_follow_up", "follow_up_owner": SAM}},
            "after": {"app-1": {"status": "reviewer_approved"}},
        }

    def test_a_review_claim_records_nothing(self, client, world):
        world.market(MarketPhase.APPLICATIONS)
        world.applications.insert_one(_application("app-1", VENDOR))

        client.post(f"/markets/{MARKET}/review/next", json={})
        client.put(f"/markets/{MARKET}/applications/app-1/claim")
        client.delete(f"/markets/{MARKET}/applications/app-1/claim")

        assert world.history.documents == []

    def test_a_phase_move_names_who_made_it(self, client, world):
        _move_phase(client, world)

        [entry] = world.history.documents
        assert entry["actor"] == OWNER
        assert entry["detail"] == {
            "before": {"phase": "draft"}, "after": {"phase": "applications"}}

    def test_a_failed_entry_logs_its_ids_never_its_values(self, client, world, caplog):
        """A driver's message can quote the document it refused, and an entry holds answers."""
        def refuse(_document):
            raise InvalidDocument("cannot encode object: 'Ember Ceramics'")

        world.patch(world.history, "insert_one", refuse)

        _applicant(first=True)(client, world)

        assert "InvalidDocument" in caplog.text and MARKET in caplog.text
        assert "Ember" not in caplog.text and VENDOR not in caplog.text

    def test_a_hand_placement_moves_a_vendor_who_held_two_rows_that_date(self, client, world):
        """One seat per vendor per date, even on a market that stored two (an old run)."""
        _seats(VENDOR)(world)
        rows = world.markets.doc["assignmentObject"]["vendorAssignments"]
        rows.append({**rows[0], "tableCode": "Hall A 3"})

        client.put(f"/markets/{MARKET}/placements", json=placement(email=VENDOR, table_code="Hall A 2"))

        seats = [row["tableCode"] for row in world.markets.doc["assignmentObject"]["vendorAssignments"]
                 if row["email"] == VENDOR and row["date"] == DATE]
        assert seats == ["Hall A 2"]
        [entry] = world.history.documents
        assert entry["detail"]["before"]["table_code"] == "Hall A 1"

    def test_a_hand_placement_names_the_seat_it_moved_the_vendor_from(self, client, world):
        _seats(VENDOR)(world)

        client.put(f"/markets/{MARKET}/placements", json=placement(email=VENDOR, table_code="Hall A 2"))

        [entry] = world.history.documents
        assert entry["detail"]["table_code"] == "Hall A 2"
        assert entry["detail"]["before"] == {"table_code": "Hall A 1", "table_choice": "Full Table"}

    def test_a_vendor_checked_in_again_records_nothing_new(self, client, world):
        _door(organizer=True, undo=False)(client, world)
        client.post(f"/markets/{MARKET}/attendance", json={"vendorEmail": VENDOR, "date": DATE})

        assert len(world.history.documents) == 1

    def test_the_check_in_page_names_nobody_and_says_it_was_the_page(self, client, world):
        _door(organizer=False, undo=False)(client, world)
        client.post("/public/markets/test-market/attendance/checkin",
                    json={"vendorEmail": VENDOR, "date": DATE})

        [entry] = world.history.documents
        assert entry["actor"] is None
        assert entry["vendors"] == [VENDOR]
        assert entry["detail"]["via"] == AttendanceApi.CHECK_IN_PAGE

    def test_a_move_counts_the_offers_it_turned_to_refusals(self, client, world):
        world.market(MarketPhase.OFFERS, setupObject=COMPLETE_PLAN)
        world.patch(MarketsApi, "evaluate_transition", lambda *_a: [])
        world.applications.insert_one(_application("app-1", VENDOR, status="assignment_sent"))
        world.patch(world.applications, "update_many", lambda query, update: SimpleNamespace(
            modified_count=sum(world.applications.update_one({**query, "id": doc["id"]}, update)
                               .modified_count for doc in list(world.applications.documents)
                               if mongo_matches(doc, query))), raising=False)

        client.post(f"/markets/{MARKET}/transition", json={"toPhase": "market_days"})

        [entry] = world.history.documents
        assert entry["detail"]["swept"] == 1

    def test_an_application_a_rule_rejects_as_it_arrives_says_so(self, client, world):
        world.markets.doc = copy.deepcopy(_applicant_market_doc(
            rejectionRules=[{"key": "student", "answers": ["No"]}]))
        world.markets.doc["applicationForm"]["fields"].append(STUDENT)
        world.patch(ApplicantsApi, "authenticate_request",
                    lambda _header: {"market_id": MARKET, "email": VENDOR})

        response = client.put("/public/markets/test-market/applicant/application", json={
            "formData": {**VALID_ANSWERS, "business_name": "Ember Ceramics", "student": "No"}})

        assert response.status_code == 200, response.get_json()

        [entry] = world.history.documents
        assert entry["detail"]["rejected_by_rules"] is True

    def test_saving_the_rules_counts_what_they_rejected_and_returned(self, client, world):
        _rejection_rules(client, world)

        [entry] = world.history.documents
        assert entry["detail"]["rejected"] == 0 and entry["detail"]["returned"] == 0

    def test_rules_that_no_longer_meet_an_application_count_it_returned(self, client, world):
        world.market(MarketPhase.APPLICATIONS, applicationForm={"fields": [STUDENT]},
                     rejectionRules=[{"key": "student", "answers": ["No"]}])
        world.applications.insert_one(_application(
            "app-1", VENDOR, status="reviewer_rejected", form_data={"student": "No"},
            verdict_by={"kind": "rule", "rule": "student"}, verdict_at="2026-10-02T00:00:00Z"))

        client.put(f"/markets/{MARKET}/rejection-rules", json={"rules": []})

        [entry] = world.history.documents
        assert entry["detail"]["returned"] == 1 and entry["detail"]["rejected"] == 0
        assert world.applications.find_one({"id": "app-1"})["status"] == "open"

    def test_an_edit_no_rule_meets_any_more_says_it_was_returned(self, client, world):
        world.markets.doc = copy.deepcopy(_applicant_market_doc(
            rejectionRules=[{"key": "student", "answers": ["No"]}]))
        world.markets.doc["applicationForm"]["fields"].append(STUDENT)
        world.patch(ApplicantsApi, "authenticate_request",
                    lambda _header: {"market_id": MARKET, "email": VENDOR})

        def apply(student):
            return client.put("/public/markets/test-market/applicant/application", json={
                "formData": {**VALID_ANSWERS, "business_name": "Ember Ceramics",
                             "student": student}})

        assert apply("No").status_code == 200
        world.history.documents.clear()
        assert apply("Yes").status_code == 200

        [entry] = world.history.documents
        assert entry["detail"]["returned_by_rules"] is True
        assert entry["detail"]["rejected_by_rules"] is False

    def test_a_form_save_counts_what_the_rules_decided_against_it(self, client, world):
        _save_form(client, world)

        [entry] = world.history.documents
        assert {"rejected", "returned"} <= set(entry["detail"])

