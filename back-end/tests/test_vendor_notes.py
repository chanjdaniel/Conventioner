"""Vendor notes (E31/F04): what the organizer knows and did about a vendor.

Two kinds are kept apart (map ticket 03). The vendor's own request is an answer on their
application; this is the organizer's side: one shared note per vendor, a "From your sheet" line an
import replaces, and the mark that a vendor's request has been handled. The collection is the
organizer's alone - no applicant endpoint reads it - and goes with the market.
"""
import pytest

import vendor_notes as VendorNotes


@pytest.fixture(autouse=True)
def notes(monkeypatch):
    from conftest import FakeApplicationsCollection

    fake = FakeApplicationsCollection()
    monkeypatch.setattr(VendorNotes, "vendor_notes_collection", fake)
    return fake


def test_a_note_is_written_with_who_and_when_and_read_back_by_vendor():
    VendorNotes.write_note("m1", "Ana@Example.com", "Promised an extra chair", "org@example.com")

    note = VendorNotes.notes_for_market("m1")["ana@example.com"]
    assert note["note"] == "Promised an extra chair"
    assert note["noteEditedBy"] == "org@example.com"
    assert note["noteEditedAt"]


def test_writing_again_replaces_the_one_note():
    VendorNotes.write_note("m1", "ana@example.com", "Chair needed", "a@example.com")
    VendorNotes.write_note("m1", "ana@example.com", "Chair arranged", "b@example.com")

    note = VendorNotes.notes_for_market("m1")["ana@example.com"]
    assert (note["note"], note["noteEditedBy"]) == ("Chair arranged", "b@example.com")


def test_a_request_is_marked_handled_and_unmarked():
    VendorNotes.mark_request_handled("m1", "ana@example.com", True, "org@example.com")
    assert VendorNotes.notes_for_market("m1")["ana@example.com"]["requestHandledBy"] == \
        "org@example.com"

    VendorNotes.mark_request_handled("m1", "ana@example.com", False, "org@example.com")
    assert VendorNotes.notes_for_market("m1")["ana@example.com"]["requestHandledAt"] is None


def test_an_import_replaces_the_sheet_line_and_never_the_note():
    VendorNotes.write_note("m1", "ana@example.com", "Our own words", "org@example.com")
    VendorNotes.replace_sheet_notes("m1", {"ana@example.com": "Paid", "ben@example.com": "Late"})
    VendorNotes.replace_sheet_notes("m1", {"ana@example.com": "Paid in full"})

    notes = VendorNotes.notes_for_market("m1")
    assert notes["ana@example.com"]["fromSheet"] == "Paid in full"
    assert notes["ana@example.com"]["note"] == "Our own words"
    assert notes["ben@example.com"]["fromSheet"] is None


def test_notes_are_kept_per_market_and_go_with_it():
    VendorNotes.write_note("m1", "ana@example.com", "One", "org@example.com")
    VendorNotes.write_note("m2", "ana@example.com", "Two", "org@example.com")

    VendorNotes.delete_for_market("m1")

    assert VendorNotes.notes_for_market("m1") == {}
    assert VendorNotes.notes_for_market("m2")["ana@example.com"]["note"] == "Two"


def test_a_blank_note_is_no_note():
    VendorNotes.write_note("m1", "ana@example.com", "   ", "org@example.com")
    assert VendorNotes.notes_for_market("m1")["ana@example.com"]["note"] == ""


class TestWhoMayReadAndWrite:
    """Every role reads; EDITOR and up write; an archived market is a record (E31/F04/S02)."""

    @pytest.fixture
    def market(self, monkeypatch):
        from conftest import FakeMarketsCollection, stored_market
        import api.markets as MarketsApi
        import api.permissions as PermissionsApi
        from datatypes import MarketPhase

        granted = {}

        def install(phase=MarketPhase.MARKET_DAYS, role=None):
            from datatypes import MarketRole

            role = role or MarketRole.EDITOR
            monkeypatch.setattr(MarketsApi, "markets_collection",
                                FakeMarketsCollection(stored_market(phase=phase)))
            monkeypatch.setattr(
                PermissionsApi, "user_has_permission",
                lambda _u, _m, wanted, *_a, **_k: role.value in _at_least(wanted))
            return MarketsApi

        return install

    def test_a_viewer_reads_and_cannot_write(self, market):
        from client_errors import ForbiddenError
        from datatypes import MarketRole

        api = market(role=MarketRole.VIEWER)
        VendorNotes.write_note("market-123", "ana@example.com", "Chair", "org@example.com")

        assert api.get_vendor_notes("market-123", "viewer@example.com")["ana@example.com"]["note"] \
            == "Chair"
        with pytest.raises(ForbiddenError):
            api.save_vendor_note("market-123", "ana@example.com", "Mine", "viewer@example.com")
        with pytest.raises(ForbiddenError):
            api.mark_vendor_request_handled("market-123", "ana@example.com", True, "v@example.com")

    def test_an_editor_writes(self, market):
        api = market()
        api.save_vendor_note("market-123", "ana@example.com", "Chair given", "door@example.com")
        api.mark_vendor_request_handled("market-123", "ana@example.com", True, "door@example.com")

        note = VendorNotes.notes_for_market("market-123")["ana@example.com"]
        assert (note["note"], note["requestHandledBy"]) == ("Chair given", "door@example.com")

    def test_an_archived_market_refuses_a_write(self, market):
        from client_errors import ForbiddenError
        from datatypes import MarketPhase

        api = market(phase=MarketPhase.ARCHIVED)
        with pytest.raises(ForbiddenError):
            api.save_vendor_note("market-123", "ana@example.com", "Late", "org@example.com")


def _at_least(wanted):
    order = ["viewer", "editor", "admin", "owner"]
    return order[order.index(wanted.value):]


def test_deleting_a_market_deletes_its_notes():
    from types import SimpleNamespace

    import market_deletion

    VendorNotes.write_note("m1", "ana@example.com", "Chair", "org@example.com")
    market_deletion.delete_market_and_records(
        SimpleNamespace(delete_one=lambda _q: SimpleNamespace(deleted_count=1)), "m1")

    assert VendorNotes.notes_for_market("m1") == {}


def test_no_applicant_endpoint_reads_the_notes():
    """The vendor never sees them: nothing that serves an applicant imports this module."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    for path in ("api/applicant_auth.py", "api/applicants.py", "api/applications.py"):
        assert "vendor_notes" not in (root / path).read_text(), path


def test_the_read_carries_each_vendors_own_request_beside_the_organizers_note(monkeypatch,
                                                                              applications):
    """Both kinds from one read, each under its own key (E31/F04/S04)."""
    from conftest import FakeMarketsCollection, stored_market
    import api.markets as MarketsApi
    import api.permissions as PermissionsApi

    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market()))
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    applications.insert_one({"id": "a1", "market_id": "market-123",
                             "applicant_email": "Ana@Example.com", "submitted_at": "1",
                             "form_data": {"essential_request": " An extra chair "}})
    applications.insert_one({"id": "a2", "market_id": "market-123",
                             "applicant_email": "ben@example.com", "submitted_at": "2",
                             "form_data": {"essential_request": ""}})
    VendorNotes.write_note("market-123", "ben@example.com", "Late setup", "org@example.com")

    notes = MarketsApi.get_vendor_notes("market-123", "org@example.com")

    assert notes["ana@example.com"]["request"] == "An extra chair"
    assert notes["ana@example.com"]["note"] == ""
    assert notes["ben@example.com"] == {**notes["ben@example.com"], "request": "",
                                        "note": "Late setup"}
