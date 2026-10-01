"""Where a market has been (E26/F06/S03; settles claims-and-room 06).

The archived rail read evidence rather than history, so a market that ran was told it "was
assigned but never published, so no check-in page went on the air" (bug 8). A market now records
every phase it enters, and a market that predates the record says only what it can prove.
"""
from conftest import FakeMarketsCollection, client_market, stored_market
import api.attendance as AttendanceApi
import api.markets as MarketsApi
import phase_record as PhaseRecord
from datatypes import MarketPhase


def dated(phase, by="owner@example.com"):
    return {"phase": phase, "enteredAt": "2026-09-01T00:00:00+00:00", "by": by}


def reached(doc):
    return PhaseRecord.phases_reached(doc)


class TestWritingIt:
    def test_a_new_market_starts_its_record_in_draft(self, monkeypatch):
        fake = FakeMarketsCollection(None)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        MarketsApi.create_market(client_market(), "user-1")

        [entry] = fake.inserted["phaseHistory"]
        assert entry["phase"] == "draft"
        assert entry["by"] == "user-1"
        assert entry["enteredAt"]

    def test_a_create_body_cannot_write_it(self, monkeypatch):
        fake = FakeMarketsCollection(None)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        MarketsApi.create_market(
            client_market(phase_history=[{"phase": "market_days", "entered_at": "x"}]), "user-1"
        )

        assert [entry["phase"] for entry in fake.inserted["phaseHistory"]] == ["draft"]

    def test_a_transition_records_the_phase_and_who_moved_it_in_the_same_update(self, monkeypatch):
        doc = stored_market(MarketPhase.ASSIGNMENT, phaseHistory=[dated("draft")])
        fake = FakeMarketsCollection(doc)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        MarketsApi.apply_phase_transition("market-123", doc, "market_days", by="ana@example.com")

        assert fake.last_update["$set"]["phase"] == "market_days"
        [entry] = fake.last_update["$push"]["phaseHistory"]["$each"]
        assert entry["phase"] == "market_days"
        assert entry["by"] == "ana@example.com"
        assert entry["enteredAt"]

    def test_a_record_begun_partway_starts_with_the_phase_it_was_in_undated(self, monkeypatch):
        doc = stored_market(MarketPhase.MARKET_DAYS)
        fake = FakeMarketsCollection(doc)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        MarketsApi.apply_phase_transition("market-123", doc, "archived", by="ana@example.com")

        first, second = fake.last_update["$push"]["phaseHistory"]["$each"]
        assert first == {"phase": "market_days", "enteredAt": None, "by": None}
        assert second["phase"] == "archived"


class TestAWholeRecord:
    def test_it_is_taken_at_its_word(self):
        doc = stored_market(
            MarketPhase.ARCHIVED,
            phaseHistory=[dated("draft"), dated("applications_open"), dated("archived")],
        )

        result = reached(doc)

        assert result.complete
        assert result.phases == {"draft", "applications_open", "archived"}
        assert not result.ran

    def test_a_market_that_ran_ran_though_nobody_checked_in(self):
        doc = stored_market(
            MarketPhase.ARCHIVED,
            phaseHistory=[dated(p) for p in ("draft", "assignment", "market_days", "archived")],
        )

        assert reached(doc).ran

    def test_a_back_edge_does_not_unmake_where_it_has_been(self):
        """Reopening for editing clears the form's published stamp - the evidence the rail read."""
        doc = stored_market(
            MarketPhase.ARCHIVED,
            phaseHistory=[dated("draft"), dated("applications_open"), dated("draft"),
                          dated("archived")],
        )

        assert "applications_open" in reached(doc).phases


class TestAMarketThatPredatesIt:
    def test_with_no_record_it_says_only_what_it_can_prove(self):
        doc = stored_market(MarketPhase.ARCHIVED)

        result = reached(doc)

        assert not result.complete
        assert result.phases == {"draft", "archived"}

    def test_a_stored_assignment_proves_it_was_assigned(self):
        doc = stored_market(
            MarketPhase.ARCHIVED,
            assignmentObject={"vendorAssignments": [{"email": "a@example.com"}]},
        )

        assert "assignment" in reached(doc).phases

    def test_a_published_form_proves_it_opened_applications(self):
        doc = stored_market(
            MarketPhase.ARCHIVED,
            applicationForm={"fields": [], "publishedAt": "2026-09-01T00:00:00+00:00"},
        )

        assert "applications_open" in reached(doc).phases

    def test_a_check_in_proves_it_ran(self, market_records):
        market_records.attendance.insert_one({"market_id": "market-123", "vendor_email": "a@x"})

        assert reached(stored_market(MarketPhase.ARCHIVED)).ran

    def test_a_record_begun_partway_is_still_partial_and_still_proven(self, market_records):
        market_records.attendance.insert_one({"market_id": "market-123", "vendor_email": "a@x"})
        doc = stored_market(
            MarketPhase.ARCHIVED,
            phaseHistory=[{"phase": "market_days", "enteredAt": None, "by": None},
                          dated("archived")],
        )

        result = reached(doc)

        assert not result.complete
        assert result.ran

    def test_a_record_that_opens_in_draft_but_undated_is_partial(self):
        """A pre-record market reopened for editing: its first entry is a draft it was already in."""
        doc = stored_market(
            MarketPhase.ARCHIVED,
            phaseHistory=[{"phase": "draft", "enteredAt": None, "by": None}, dated("archived")],
        )

        assert not reached(doc).complete


def test_attendance_is_not_read_for_a_whole_record(monkeypatch):
    def refuse(_market_id):
        raise AssertionError("a market with a whole record needs no proof")

    monkeypatch.setattr(AttendanceApi, "market_has_attendance", refuse)
    doc = stored_market(MarketPhase.ARCHIVED, phaseHistory=[dated("draft"), dated("archived")])

    assert reached(doc).complete
