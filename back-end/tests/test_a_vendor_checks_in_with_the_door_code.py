"""A vendor checks themselves in on their vendor page, with the market's door code (ADR 0022).

The check-in was public: anyone with the market's address typed any vendor's email, read their
seats and checked them in or out, so a check-in proved nothing about who was at the door (T202).
Now it is the vendor's own, behind their sign-in, and it takes the door code the organizer shows at
the entrance, which proves they are there. Every way it cannot pass writes nothing, and says why.
The old public check-in endpoints are gone.
"""
import copy
import re
import time
from datetime import date
from types import SimpleNamespace

import jwt
import pytest
from pymongo.errors import DuplicateKeyError

import api.attendance as AttendanceApi
import api.markets as MarketsApi
import api.vendor_check_in as VendorCheckIn
import app as app_module
import db_config
import history as History
import sign_in_limits
from conftest import stored_market
from datatypes import MarketPhase
from test_every_write_records import Attendance, LiveMarkets
from utils.application_token import generate_application_token
from utils.secret_key import signing_secret

SLUG = "test-market"
MARKET = "market-123"
VENDOR = "vendor@example.com"
TODAY = "2099-08-01"
CODE = "K7M4QP"
PATH = f"/public/markets/{SLUG}/vendor/check-in"
SEATS = [
    {"email": VENDOR, "date": "2099-08-01", "tableCode": "A1", "tableChoice": "Full Table",
     "section": "A", "tier": "Gold", "location": "Main Hall"},
    {"email": VENDOR, "date": "2099-08-03", "tableCode": "A2", "tableChoice": "Full Table",
     "section": "A", "tier": "Gold", "location": "Main Hall"},
]
RAN = ["draft", "applications", "assignment", "market_days", "archived"]


@pytest.fixture
def world(monkeypatch, market_records):
    markets = LiveMarkets()
    attendance = Attendance()
    for module in (MarketsApi, AttendanceApi):
        monkeypatch.setattr(module, "markets_collection", markets)
    monkeypatch.setattr(AttendanceApi, "attendance_collection", attendance)
    monkeypatch.setattr(db_config, "get_database", lambda *_a, **_k: {"markets": markets})
    monkeypatch.setattr(VendorCheckIn, "today", lambda: date.fromisoformat(TODAY))

    def market(phase=MarketPhase.MARKET_DAYS, intake_mode="form", reached=None, **overrides):
        record = [{"phase": p, "enteredAt": "2099-05-01T00:00:00+00:00", "by": "o@x"}
                  for p in reached or []]
        fields = {
            "intakeMode": intake_mode, "phaseHistory": record, "resultsPublished": True,
            "assignmentObject": {"vendorAssignments": SEATS},
            "doorCode": {"code": CODE, "madeAt": "2099-08-01T08:00:00+00:00", "madeBy": "o@x"},
            **overrides,
        }
        markets.doc = copy.deepcopy(stored_market(phase, **fields))
        return markets.doc

    market()
    return SimpleNamespace(
        market=market, markets=markets, attendance=attendance, history=market_records.history)


@pytest.fixture
def client(world):
    return app_module.app.test_client()


def signed_in(market_id=MARKET, email=VENDOR):
    return {"Authorization": f"Bearer {generate_application_token(market_id, email)}"}


def check_in(client, body=None, headers=None, slug=SLUG):
    return client.post(
        f"/public/markets/{slug}/vendor/check-in",
        json={"date": TODAY, "doorCode": CODE} if body is None else body,
        headers=signed_in() if headers is None else headers,
    )


def undo(client, body=None, headers=None):
    return client.delete(
        PATH, json={"date": TODAY} if body is None else body,
        headers=signed_in() if headers is None else headers,
    )


class TestARightCodeChecksThemIn:
    def test_it_writes_the_check_in_made_with_the_door_code(self, client, world):
        response = check_in(client)

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["checkedInAt"]
        [written] = world.attendance.documents
        assert written["vendor_email"] == VENDOR
        assert written["date"] == TODAY
        assert written["checked_in_by"] is None
        assert written["checked_in_via"] == "door_code"

    @pytest.mark.parametrize("typed", ["k7m4qp", "K7M 4QP", "k7m-4qp", " K7M4QP "])
    def test_a_typed_code_is_read_in_any_case_with_spaces_and_dashes_ignored(
        self, client, world, typed,
    ):
        assert check_in(client, {"date": TODAY, "doorCode": typed}).status_code == 200

    def test_the_history_names_the_vendor_and_the_door_code(self, client, world):
        check_in(client)

        [entry] = world.history.documents
        assert entry["kind"] == History.CHECKED_IN
        assert entry["actor"] is None
        assert entry["vendors"] == [VENDOR]
        assert entry["subject"] == {"date": TODAY}
        assert entry["detail"]["via"] == "door_code"

    @pytest.mark.parametrize("day", ["2099-07-31", "2099-08-02"])
    def test_a_day_either_side_of_the_servers_date_is_today_somewhere(self, client, world, day):
        world.market(assignmentObject={"vendorAssignments": [{**SEATS[0], "date": day}]})

        assert check_in(client, {"date": day, "doorCode": CODE}).status_code == 200

    def test_a_google_form_market_checks_its_vendors_in_too(self, client, world):
        world.market(intake_mode="csv")

        assert check_in(client).status_code == 200

    def test_the_roster_says_how_they_were_checked_in(self, client, world):
        check_in(client)

        roster = AttendanceApi.attendance_roster(world.markets.doc)["roster"]
        assert roster[0]["checkedInVia"] == "door_code"
        assert roster[0]["checkedInBy"] is None


class TestACheckInRacingAnother:
    """The vendor's own check-in landing at the same moment as an organizer's tap (T270).

    Both upserts match nothing and both insert; the unique index on the vendor's day refuses the
    second with a duplicate key error. The check-in that lost runs its upsert again, which lands on
    the winner's record, so the day holds one record and the history one arrival.
    """

    def test_the_one_that_loses_lands_on_the_winners_record(self, client, world, monkeypatch):
        the_upsert = world.attendance.update_one

        def an_organizer_taps_first(*_args, **_kwargs):
            # The organizer's tap inserts between this check-in's read and its insert.
            monkeypatch.setattr(world.attendance, "update_one", the_upsert)
            AttendanceApi.record_attendance(MARKET, VENDOR, TODAY, "door@example.com")
            raise DuplicateKeyError("E11000 duplicate key error")

        monkeypatch.setattr(world.attendance, "update_one", an_organizer_taps_first)

        response = check_in(client)

        assert response.status_code == 200, response.get_json()
        [record] = world.attendance.documents
        # The vendor's own check-in is the last word, as when one follows the other.
        assert record["checked_in_via"] == "door_code"
        assert record["checked_in_by"] is None
        assert [entry["kind"] for entry in world.history.documents] == [History.CHECKED_IN]

    def test_a_second_refusal_is_the_error_it_is(self, client, world, monkeypatch):
        def refused(*_args, **_kwargs):
            raise DuplicateKeyError("E11000 duplicate key error")

        monkeypatch.setattr(world.attendance, "update_one", refused)

        with pytest.raises(DuplicateKeyError):
            AttendanceApi.record_attendance(MARKET, VENDOR, TODAY)
        assert world.history.documents == []


class TestEveryOtherWayWritesNothing:
    def _refused(self, response, world, status, message):
        assert response.status_code == status, response.get_json()
        assert response.get_json()["error"] == message
        assert world.attendance.documents == []
        assert world.history.documents == []

    def test_no_sign_in(self, client, world):
        response = check_in(client, headers={})

        assert response.status_code == 401
        assert world.attendance.documents == []

    def test_a_forged_sign_in(self, client, world):
        response = check_in(client, headers={"Authorization": "Bearer not-a-token"})

        assert response.status_code == 401
        assert world.attendance.documents == []

    def test_another_markets_sign_in(self, client, world):
        self._refused(check_in(client, headers=signed_in("market-999")), world, 403,
                      "Your sign-in is for a different market. Please sign in again.")

    @pytest.mark.parametrize("typed", ["WRONG1", "", "K7M4Q", "K7M4QPX"])
    def test_a_wrong_door_code(self, client, world, typed):
        self._refused(check_in(client, {"date": TODAY, "doorCode": typed}), world, 403,
                      "That isn't this market's door code. Check it, or ask at the door.")

    def test_no_door_code_sent(self, client, world):
        self._refused(check_in(client, {"date": TODAY}), world, 403,
                      "That isn't this market's door code. Check it, or ask at the door.")

    def test_a_market_with_no_door_code_yet(self, client, world):
        world.market(doorCode=None)

        self._refused(check_in(client), world, 403,
                      "That isn't this market's door code. Check it, or ask at the door.")

    def test_an_old_code_after_a_new_one(self, client, world):
        world.market(doorCode={"code": "ZZZZZZ", "madeAt": "x", "madeBy": "o@x"})

        self._refused(check_in(client), world, 403,
                      "That isn't this market's door code. Check it, or ask at the door.")

    def test_a_date_with_no_seat(self, client, world):
        self._refused(check_in(client, {"date": "2099-08-02", "doorCode": CODE}), world, 404,
                      "You have no table on this date.")

    def test_another_vendors_date(self, client, world):
        world.market(assignmentObject={"vendorAssignments": [
            {**SEATS[0], "email": "someone-else@example.com"}]})

        self._refused(check_in(client), world, 404, "You have no table on this date.")

    def test_a_date_outside_a_day_of_the_servers(self, client, world):
        self._refused(check_in(client, {"date": "2099-08-03", "doorCode": CODE}), world, 409,
                      "Check-in is open on the day itself.")

    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT])
    def test_before_market_days(self, client, world, phase):
        world.market(phase)

        self._refused(check_in(client), world, 409, "Check-in opens when the market's days begin.")

    def test_an_ended_market(self, client, world):
        world.market(MarketPhase.ARCHIVED, reached=RAN)

        self._refused(check_in(client), world, 409, AttendanceApi.ENDED_REFUSAL)

    def test_a_market_with_no_vendor_page_answers_as_none(self, client, world):
        world.market(MarketPhase.ASSIGNMENT, intake_mode="csv", resultsPublished=False)
        gated = check_in(client)
        unknown = check_in(client, slug="no-such-market")

        assert gated.status_code == unknown.status_code == 404
        assert gated.get_data() == unknown.get_data()
        assert world.attendance.documents == []

    def test_a_code_never_reaches_a_wrong_answer(self, client, world):
        body = check_in(client, {"date": TODAY, "doorCode": "WRONG1"}).get_data(as_text=True)

        assert CODE not in body


class TestAttemptsAreBounded:
    def test_an_address_gets_ten_tries_in_a_quarter_hour(self, client, world):
        for _ in range(10):
            assert check_in(client, {"date": TODAY, "doorCode": "WRONG1"}).status_code == 403

        refused = check_in(client)

        assert refused.status_code == 429
        assert refused.headers["Retry-After"]
        assert re.fullmatch(
            r"Too many check-in attempts\. Please try again in (1 minute|\d+ minutes)\.",
            refused.get_json()["error"])
        assert world.attendance.documents == []

    def test_one_network_checks_in_more_than_sixty_vendors(self, client, world):
        emails = [f"v{n}@example.com" for n in range(65)]
        world.market(assignmentObject={"vendorAssignments": [
            {**SEATS[0], "email": email} for email in emails]})

        statuses = [check_in(client, headers=signed_in(email=email)).status_code for email in emails]

        assert set(statuses) == {200}
        assert len(world.attendance.documents) == 65

    def test_a_venues_wrong_codes_never_refuse_another_vendors_right_one(self, client, world):
        """A venue's wifi is one network address: a stale poster, or many vendors' typos, from it
        must not stop a vendor on the same network whose code is right (T318)."""
        emails = [f"v{n}@example.com" for n in range(61)]
        world.market(assignmentObject={"vendorAssignments": [
            {**SEATS[0], "email": email} for email in emails]})
        wrong = {"date": TODAY, "doorCode": "WRONG1"}

        first = [check_in(client, wrong, signed_in(email=e)).status_code for e in emails[:60]]
        right = check_in(client, headers=signed_in(email=emails[60]))

        assert set(first) == {403}
        assert right.status_code == 200, right.get_json()
        roster = AttendanceApi.attendance_roster(world.markets.doc)["roster"]
        [arrived] = [row for row in roster if row["checkedInAt"]]
        assert arrived["vendorEmail"] == emails[60]
        assert arrived["checkedInVia"] == "door_code"

    @pytest.mark.parametrize("code", [CODE, "WRONG1"])
    def test_only_the_signed_in_address_bounds_a_check_in(self, client, world, monkeypatch, code):
        touched = []
        real = sign_in_limits.count_attempt
        monkeypatch.setattr(
            sign_in_limits, "count_attempt",
            lambda limit, subject, *a, **k: (
                touched.append((limit.name, subject)) or real(limit, subject, *a, **k)))

        check_in(client, {"date": TODAY, "doorCode": code})

        assert touched == [("check-in:address", VENDOR)]
        assert sign_in_limits.CHECK_IN_PER_ADDRESS.attempts == 10
        assert sign_in_limits.CHECK_IN_PER_ADDRESS.window.total_seconds() == 15 * 60
        assert [limit.name for limit in sign_in_limits.LIMITS
                if limit.name.startswith("check-in:")] == ["check-in:address"]


class TestUndo:
    def test_a_vendor_undoes_their_own_check_in_with_no_code(self, client, world):
        check_in(client)

        response = undo(client)

        assert response.status_code == 200, response.get_json()
        assert world.attendance.documents == []
        entry = world.history.documents[-1]
        assert entry["kind"] == History.CHECK_IN_UNDONE
        assert entry["actor"] is None
        assert entry["vendors"] == [VENDOR]
        assert entry["detail"]["via"] == "vendor_page"

    def test_only_their_own(self, client, world):
        world.attendance.insert_one({"market_id": MARKET, "vendor_email": "other@example.com",
                                     "date": TODAY, "checked_in_at": "x"})

        response = undo(client)

        assert response.status_code == 404
        assert len(world.attendance.documents) == 1

    def test_no_sign_in(self, client, world):
        check_in(client)

        assert undo(client, headers={}).status_code == 401
        assert len(world.attendance.documents) == 1

    def test_another_markets_sign_in(self, client, world):
        check_in(client)

        assert undo(client, headers=signed_in("market-999")).status_code == 403
        assert len(world.attendance.documents) == 1

    def test_not_once_the_market_has_ended(self, client, world):
        check_in(client)
        world.market(MarketPhase.ARCHIVED, reached=RAN)

        response = undo(client)

        assert response.status_code == 409
        assert response.get_json()["error"] == AttendanceApi.ENDED_REFUSAL
        assert len(world.attendance.documents) == 1


class TestUndoIsBoundedAsCheckInIs:
    """The undo takes back a check-in on a day within one of the server's, as a check-in is made
    (ADR 0022): a vendor never erases a past day's attendance, theirs or an organizer's."""

    def test_not_a_past_days(self, client, world, monkeypatch):
        check_in(client)
        monkeypatch.setattr(VendorCheckIn, "today", lambda: date.fromisoformat("2099-08-03"))

        response = undo(client)

        assert response.status_code == 409
        assert response.get_json()["error"] == "Check-in is open on the day itself."
        assert len(world.attendance.documents) == 1

    def test_an_organizers_check_in_today_may_be_undone(self, client, world):
        world.attendance.insert_one({"market_id": MARKET, "vendor_email": VENDOR, "date": TODAY,
                                     "checked_in_at": "x", "checked_in_by": "o@x"})

        assert undo(client).status_code == 200
        assert world.attendance.documents == []

    def test_it_is_never_refused_for_how_often_a_caller_undoes(self, client, world):
        statuses = {undo(client, headers=signed_in(email=f"v{n}@example.com")).status_code
                    for n in range(70)}

        assert 429 not in statuses


def ended_sign_in(market_id=MARKET, email=VENDOR):
    """A sign-in that ended: signed as the server signs one, its 30 minutes long past."""
    now = int(time.time())
    claims = {"market_id": market_id, "email": email, "iat": now - 3600, "exp": now - 1800}
    return {"Authorization": f"Bearer {jwt.encode(claims, signing_secret(), algorithm='HS256')}"}


class TestAnEndedSignIn:
    def test_checks_nobody_in(self, client, world):
        response = check_in(client, headers=ended_sign_in())

        assert response.status_code == 401
        assert world.attendance.documents == []
        assert world.history.documents == []

    def test_undoes_nothing(self, client, world):
        check_in(client)

        assert undo(client, headers=ended_sign_in()).status_code == 401
        assert len(world.attendance.documents) == 1

    def test_reads_nothing(self, client, world):
        response = client.get(
            f"/public/markets/{SLUG}/applicant/application", headers=ended_sign_in())

        assert response.status_code == 401
        assert "application" not in (response.get_json() or {})


class TestTheOpenCheckInIsGone:
    @pytest.mark.parametrize("method, path", [
        ("get", f"/public/markets/{SLUG}/check-in"),
        ("get", f"/public/markets/{SLUG}/vendors/{VENDOR}/assignments"),
        ("post", f"/public/markets/{SLUG}/attendance/checkin"),
        ("delete", f"/public/markets/{SLUG}/attendance/checkin"),
    ])
    def test_the_old_endpoints_answer_404(self, client, world, method, path):
        response = getattr(client, method)(path, json={"vendorEmail": VENDOR, "date": TODAY})

        assert response.status_code == 404
        assert world.attendance.documents == []
