"""Freeing, moving or swapping a vendor who has checked in that day asks first (T318).

A free, a move or a swap of a vendor already at their table went ahead with no question, so an
organizer could take the table from someone set up at it by mistake, and a second organizer whose
screen had not caught up with the door had nothing to warn them (T277 report section 4.9). Now
each door reads the vendor's check-in for that date, and without ``whileHere: true`` refuses with
a 409 coded ``vendor_is_here`` whose sentence names who checked in, where and for which day,
writing nothing. Asked again with ``whileHere: true`` the change goes ahead, the check-in stays
where it was made, and the market's history says the change was made while they were here.

Each is sent through the Flask client, as the placement dialog sends it.
"""
import copy

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import api.attendance as AttendanceApi  # noqa: E402
import api.market_actions as Actions  # noqa: E402
import essential_fields as EssentialFields  # noqa: E402
import history as History  # noqa: E402
from datatypes import MarketPhase  # noqa: E402
from test_every_write_records import (  # noqa: E402,F401
    DATE, MARKET, VENDOR, _application, _seated, client, world,
)
from test_the_placement_endpoint import SETUP_OBJECT, placement  # noqa: E402

ATTENDANCE = f"/markets/{MARKET}/attendance"
PLACEMENTS = f"/markets/{MARKET}/placements"
SWAP = f"{PLACEMENTS}/swap"
BEN = "ben@example.com"
CARA = "cara@example.com"
HERE_CODE = "vendor_is_here"
#: The placement tests' plan with a second hall, Hall B 1 and 2, to move a vendor to.
SETUP = {**SETUP_OBJECT, "sections": [*SETUP_OBJECT["sections"], {
    "name": "Hall B", "location": {"name": "Main Hall"}, "tier": {"id": 1, "name": "Gold"},
    "count": 2,
}]}
ANA_HERE = ("Ana checked in at table Hall A 1 for Aug 1, 2026. "
            "Their check-in stays recorded there.")


def on_its_days(world, *emails):
    """The market in its days, ``emails`` seated at Hall A 1, Hall A 2, ... on ``DATE``, each with
    an application, and the first one named Ana, the second Ben."""
    world.market(MarketPhase.MARKET_DAYS, setupObject=SETUP,
                 assignmentObject=_seated(*emails))
    names = {VENDOR: "Ana", BEN: "Ben"}
    for index, email in enumerate(emails):
        form_data = {EssentialFields.PREFERRED_NAME_KEY: names[email]} if email in names else {}
        world.applications.insert_one(_application(f"app-{index}", email, form_data=form_data))


def check_in(client, email=VENDOR):
    answer = client.post(ATTENDANCE, json={"vendorEmail": email, "date": DATE})
    assert answer.status_code == 200, answer.get_json()


def free(client, email=VENDOR, **extra):
    return client.delete(PLACEMENTS, json={"email": email, "date": DATE, **extra})


def move(client, email=VENDOR, table_code="Hall B 1", **extra):
    return client.put(PLACEMENTS, json={**placement(email=email, table_code=table_code), **extra})


def swap(client, first=VENDOR, second=BEN, **extra):
    return client.post(SWAP, json={"date": DATE, "emails": [first, second], **extra})


def seats(world):
    return {(row["email"], row["tableCode"])
            for row in world.markets.doc["assignmentObject"]["vendorAssignments"]}


def placement_entries(world):
    return [entry for entry in world.history.documents if entry.get("action") == Actions.ASSIGN.id]


@pytest.fixture
def owed(market_records):
    """What each vendor owes, the free's line among them."""
    return market_records.amounts_owed


class TestOnTheBaseNothingAsked:
    """The reproduction: on the base each answered 200 with no question."""

    @pytest.mark.parametrize("change", [free, move, swap], ids=["free", "move", "swap"])
    def test_a_change_to_a_vendor_who_is_here_asks_first(self, client, world, change):
        on_its_days(world, VENDOR, BEN)
        check_in(client)

        answer = change(client)

        assert answer.status_code == 409, answer.get_json()
        assert answer.get_json()["code"] == HERE_CODE


class TestWithoutWhileHereNothingIsWritten:
    @pytest.mark.parametrize("change", [free, move, swap], ids=["free", "move", "swap"])
    def test_the_refusal_says_who_where_and_when(self, client, world, change):
        on_its_days(world, VENDOR, BEN)
        check_in(client)

        answer = change(client)

        assert answer.status_code == 409
        assert answer.get_json() == {"error": ANA_HERE, "code": HERE_CODE}

    @pytest.mark.parametrize("change", [free, move, swap], ids=["free", "move", "swap"])
    def test_nothing_changes(self, client, world, owed, change):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        market_before = copy.deepcopy(world.markets.doc)
        history_before = copy.deepcopy(world.history.documents)
        owed_before = copy.deepcopy(owed.documents)
        attendance_before = copy.deepcopy(world.attendance.documents)

        assert change(client).status_code == 409

        assert world.markets.doc == market_before
        assert world.history.documents == history_before
        assert owed.documents == owed_before
        assert world.attendance.documents == attendance_before

    def test_a_free_asked_to_take_its_amount_off_still_asks_first(self, client, world, owed):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        owed_before = copy.deepcopy(owed.documents)

        answer = free(client, deductOwed=True)

        assert answer.status_code == 409
        assert answer.get_json()["code"] == HERE_CODE
        assert owed.documents == owed_before
        assert (VENDOR, "Hall A 1") in seats(world)

    def test_a_swap_names_both_when_both_are_here(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        check_in(client, BEN)

        answer = swap(client)

        assert answer.status_code == 409
        assert answer.get_json() == {
            "error": ("Ana checked in at table Hall A 1 and Ben at table Hall A 2 for "
                      "Aug 1, 2026. Their check-ins stay recorded there."),
            "code": HERE_CODE,
        }

    def test_a_swap_names_the_one_who_is_here(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client, BEN)

        answer = swap(client)

        assert answer.get_json() == {
            "error": ("Ben checked in at table Hall A 2 for Aug 1, 2026. "
                      "Their check-in stays recorded there."),
            "code": HERE_CODE,
        }

    def test_a_vendor_with_no_name_is_named_by_their_address(self, client, world):
        on_its_days(world, CARA)
        check_in(client, CARA)

        answer = free(client, CARA)

        assert answer.get_json()["error"] == (
            "cara@example.com checked in at table Hall A 1 for Aug 1, 2026. "
            "Their check-in stays recorded there.")

    def test_the_table_named_is_the_one_they_checked_in_at(self, client, world):
        # Moved while here once already: the record says Hall A 1, the seat Hall B 1.
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        assert move(client, whileHere=True).status_code == 200

        answer = move(client, table_code="Hall B 2")

        assert answer.status_code == 409
        assert answer.get_json()["error"] == ANA_HERE

    def test_a_record_made_before_tables_were_kept_names_the_seat_held_now(self, client, world):
        on_its_days(world, VENDOR)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE,
            "checked_in_at": "2026-08-01T09:00:00+00:00", "checked_in_by": "owner@example.com",
            "checked_in_via": None,
        })

        answer = free(client)

        assert answer.get_json() == {"error": ANA_HERE, "code": HERE_CODE}

    def test_only_true_confirms(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client)

        for not_true in ("true", 1, "yes", None):
            assert free(client, whileHere=not_true).status_code == 409
            assert move(client, whileHere=not_true).status_code == 409
            assert swap(client, whileHere=not_true).status_code == 409


class TestWithWhileHereItGoesAhead:
    def test_a_free(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        record = copy.deepcopy(world.attendance.documents)

        answer = free(client, whileHere=True)

        assert answer.status_code == 200, answer.get_json()
        assert seats(world) == {(BEN, "Hall A 2")}
        assert world.attendance.documents == record
        [entry] = placement_entries(world)
        assert entry["kind"] == History.FREED
        assert entry["detail"]["while_here"] is True

    def test_a_free_keeps_its_deduction(self, client, world, owed):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        refused = free(client, deductOwed=True)
        assert refused.status_code == 409

        answer = free(client, deductOwed=True, whileHere=True)

        assert answer.status_code == 200, answer.get_json()
        [line] = [doc for doc in owed.documents if doc.get("date") == DATE]
        assert line["set_by_hand"]["cents"] == 0

    def test_a_move(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client)

        answer = move(client, whileHere=True)

        assert answer.status_code == 200, answer.get_json()
        assert seats(world) == {(VENDOR, "Hall B 1"), (BEN, "Hall A 2")}
        [record] = world.attendance.documents
        assert record["table_code"] == "Hall A 1"
        [entry] = placement_entries(world)
        assert entry["kind"] == History.PLACED
        assert entry["detail"]["while_here"] is True

    def test_a_swap(self, client, world):
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        check_in(client, BEN)

        answer = swap(client, whileHere=True)

        assert answer.status_code == 200, answer.get_json()
        assert seats(world) == {(VENDOR, "Hall A 2"), (BEN, "Hall A 1")}
        assert {(doc["vendor_email"], doc["table_code"])
                for doc in world.attendance.documents} == {
            (VENDOR, "Hall A 1"), (BEN, "Hall A 2")}
        [entry] = placement_entries(world)
        assert entry["kind"] == History.SWAPPED
        assert entry["detail"]["while_here"] is True


class TestAVendorNotHereIsNeverAsked:
    def test_a_free_a_move_and_a_swap_go_ahead_and_say_nothing_of_it(self, client, world):
        on_its_days(world, VENDOR, BEN)

        assert free(client, BEN).status_code == 200
        assert move(client).status_code == 200
        assert client.put(PLACEMENTS, json=placement(email=BEN)).status_code == 200
        assert swap(client).status_code == 200

        entries = placement_entries(world)
        assert [entry["kind"] for entry in entries] == [
            History.FREED, History.PLACED, History.PLACED, History.SWAPPED]
        assert not any("while_here" in entry["detail"] for entry in entries)

    def test_while_here_sent_for_a_vendor_not_here_records_nothing_of_it(self, client, world):
        on_its_days(world, VENDOR, BEN)

        assert free(client, whileHere=True).status_code == 200

        [entry] = placement_entries(world)
        assert "while_here" not in entry["detail"]

    def test_a_check_in_on_another_day_asks_nothing(self, client, world):
        on_its_days(world, VENDOR, BEN)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": "2026-08-02",
            "checked_in_at": "2026-08-02T09:00:00+00:00", "checked_in_by": "owner@example.com",
            "checked_in_via": None, "table_code": "Hall A 1",
        })

        assert free(client).status_code == 200

    def test_seating_a_vendor_here_with_no_table_asks_nothing(self, client, world):
        # Freed while here, they are "here, with no table": giving them a table again moves
        # nobody, and is what the roster asks for.
        on_its_days(world, VENDOR, BEN)
        check_in(client)
        assert free(client, whileHere=True).status_code == 200

        answer = client.put(PLACEMENTS, json=placement(email=VENDOR, table_code="Hall B 1"))

        assert answer.status_code == 200, answer.get_json()
        assert "while_here" not in placement_entries(world)[-1]["detail"]


class TestCheckedInOn:
    def test_reads_one_record_by_the_normalised_address(self, world):
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE,
            "checked_in_at": "2026-08-01T09:00:00+00:00", "table_code": "Hall A 1",
        })

        record = AttendanceApi.checked_in_on(MARKET, "  Vendor@Example.COM ", DATE)

        assert record is not None and record["table_code"] == "Hall A 1"
        assert AttendanceApi.checked_in_on(MARKET, VENDOR, "2026-08-02") is None
        assert AttendanceApi.checked_in_on("another-market", VENDOR, DATE) is None
