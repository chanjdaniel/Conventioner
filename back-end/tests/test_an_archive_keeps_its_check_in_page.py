"""An archived market that ran keeps its check-in page, as a record (bug 9, E26/F06/S02).

Archiving took the page off the air: `GET /public/markets/<slug>/check-in` answered 404, against
AGENTS.md and the organization-deletion preview, which both said an archived market is still
served. A vendor could no longer look up where they had sat. The page now serves a market that ran,
marked as ended, and takes no check-in there.
"""
import pytest

from conftest import FakeSlugMarketsCollection, stored_market
import app as app_module
import api.attendance as AttendanceApi
from datatypes import MarketPhase

SLUG = "test-market"
RAN = ["draft", "assignment", "market_days", "archived"]
NEVER_RAN = ["draft", "assignment", "archived"]


def market(phase, reached=None):
    record = [{"phase": p, "enteredAt": "2026-05-01T00:00:00+00:00", "by": "o@x"} for p in reached or []]
    return stored_market(
        phase,
        phaseHistory=record,
        setupObject={"marketDates": [{"date": "2026-05-01"}]},
        assignmentObject={"vendorAssignments": [{
            "email": "vendor@example.com", "date": "2026-05-01", "tableCode": "A1",
            "tableChoice": "Full Table", "section": "A", "tier": "Gold", "location": "Main Hall",
        }]},
    )


@pytest.fixture
def serve(monkeypatch):
    def install(doc):
        monkeypatch.setattr(AttendanceApi, "markets_collection", FakeSlugMarketsCollection([doc]))
    return install


class TestWhichMarketsTheCheckInPageServes:
    def test_a_running_market(self, serve):
        serve(market(MarketPhase.MARKET_DAYS, RAN[:3]))

        assert AttendanceApi.get_check_in_market(SLUG) is not None

    def test_an_archived_market_that_ran(self, serve):
        serve(market(MarketPhase.ARCHIVED, RAN))

        assert AttendanceApi.get_check_in_market(SLUG) is not None

    def test_not_an_archived_market_that_never_ran(self, serve):
        """It had no check-in page, so archiving it has none to keep."""
        serve(market(MarketPhase.ARCHIVED, NEVER_RAN))

        assert AttendanceApi.get_check_in_market(SLUG) is None

    def test_an_older_archived_market_that_someone_checked_in_at(self, serve, market_records):
        market_records.attendance.insert_one({"market_id": "market-123", "vendor_email": "v@x"})
        serve(market(MarketPhase.ARCHIVED))

        assert AttendanceApi.get_check_in_market(SLUG) is not None

    def test_not_a_draft(self, serve):
        serve(market(MarketPhase.DRAFT, ["draft"]))

        assert AttendanceApi.get_check_in_market(SLUG) is None


class TestWhatItSays:
    def test_the_page_says_an_archived_market_has_ended(self, serve):
        serve(market(MarketPhase.ARCHIVED, RAN))

        page, status = AttendanceApi.get_checkin_page(SLUG)

        assert status == 200
        assert page["ended"] is True

    def test_a_running_market_has_not(self, serve):
        serve(market(MarketPhase.MARKET_DAYS, RAN[:3]))

        page, _ = AttendanceApi.get_checkin_page(SLUG)

        assert page["ended"] is False

    def test_a_vendor_can_still_look_up_where_they_sat(self, serve, market_records):
        market_records.attendance.insert_one({
            "market_id": "market-123", "vendor_email": "vendor@example.com",
            "date": "2026-05-01", "checked_in_at": "2026-05-01T09:00:00",
        })
        serve(market(MarketPhase.ARCHIVED, RAN))

        lookup, status = AttendanceApi.get_vendor_assignment_summary(SLUG, "vendor@example.com")

        assert status == 200
        assert lookup["ended"] is True
        [seat] = lookup["assignments"]
        assert seat["tableCode"] == "A1"
        assert seat["checkedInAt"] == "2026-05-01T09:00:00"


class TestNobodyChecksInAtAnEndedMarket:
    @pytest.fixture
    def client(self):
        return app_module.app.test_client()

    @pytest.mark.parametrize("method", ["post", "delete"])
    def test_it_says_the_market_has_ended(self, client, serve, market_records, method):
        serve(market(MarketPhase.ARCHIVED, RAN))

        response = getattr(client, method)(
            f"/public/markets/{SLUG}/attendance/checkin",
            json={"vendorEmail": "vendor@example.com", "date": "2026-05-01"},
        )

        assert response.status_code == 409
        assert response.get_json()["error"] == AttendanceApi.ENDED_REFUSAL
        assert market_records.attendance.documents == []

    def test_an_address_with_no_market_is_still_not_found(self, client, serve):
        serve(market(MarketPhase.ARCHIVED, NEVER_RAN))

        response = client.post(
            f"/public/markets/{SLUG}/attendance/checkin",
            json={"vendorEmail": "vendor@example.com", "date": "2026-05-01"},
        )

        assert response.status_code == 404
