"""The vendor's name, wherever the product names a vendor.

The rule, from readable-journey ticket 02: **name primary, email secondary, never name instead of
email.** Two vendors can share a name; the address is guaranteed unique and guaranteed present, it
is what check-in matches on, and it is what ties a vendor back to their application. A vendor with
no stored name falls back to the address and looks exactly like the product did before, which is
what lets this ship without making any existing market look worse.
"""
import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import essential_fields as EF
from assignment.csv_output import build_market_csv_rows


class FakeApplicationsCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query, projection=None):
        return iter(self.docs)


ASSIGNED_MARKET = {
    "setup_object": {"market_dates": [{"date": "2026-08-01"}, {"date": "2026-08-08"}]},
    "assignment_object": {
        "vendor_assignments": [
            {
                "email": "nadia@ember.test", "date": "2026-08-01",
                "table_code": "Front Row 1", "table_choice": "Full Table",
            },
            {
                "email": "theo@thistle.test", "date": "2026-08-01",
                "table_code": "Front Row 2", "table_choice": "Full Table",
            },
        ],
    },
}


class TestReadingNamesOffTheApplications:
    def _names(self, monkeypatch, docs):
        monkeypatch.setattr(
            ApplicationsApi, "applications_collection", FakeApplicationsCollection(docs),
        )
        monkeypatch.setattr(ApplicationsApi, "ensure_application_indexes", lambda: None)
        return ApplicationsApi.vendor_names_for_market("market-1")

    def test_a_name_is_keyed_by_the_address_that_identifies_it(self, monkeypatch):
        names = self._names(monkeypatch, [
            {"applicant_email": "nadia@ember.test", "form_data": {EF.FULL_NAME_KEY: "Nadia O"}},
        ])

        assert names == {"nadia@ember.test": "Nadia O"}

    def test_the_key_is_lowercased_the_way_every_other_reader_matches(self, monkeypatch):
        """``record_attendance`` normalizes and the importer lowercases on the way in, so a map
        whose keys did not would miss the one vendor whose form capitalized their address."""
        names = self._names(monkeypatch, [
            {"applicant_email": "Nadia@Ember.Test", "form_data": {EF.FULL_NAME_KEY: "Nadia O"}},
        ])

        assert names == {"nadia@ember.test": "Nadia O"}

    def test_an_application_with_no_name_simply_has_no_entry(self, monkeypatch):
        """Which is what lets every surface fall back to the address and render as it did before."""
        names = self._names(monkeypatch, [
            {"applicant_email": "legacy@ember.test", "form_data": {}},
            {"applicant_email": "blank@ember.test", "form_data": {EF.FULL_NAME_KEY: "  "}},
        ])

        assert names == {}


class TestTheAssignmentCsv:
    def test_carries_the_name_beside_the_address_never_instead_of_it(self):
        fieldnames, rows = build_market_csv_rows(
            ASSIGNED_MARKET, {"nadia@ember.test": "Nadia Okonkwo"},
        )

        assert fieldnames[:2] == ["Name", "Email"]
        assert rows[0]["Name"] == "Nadia Okonkwo"
        assert rows[0]["Email"] == "nadia@ember.test"

    def test_leaves_the_name_blank_rather_than_inventing_a_placeholder(self):
        _fieldnames, rows = build_market_csv_rows(ASSIGNED_MARKET, {})

        assert rows[0]["Name"] == ""
        assert rows[0]["Email"] == "nadia@ember.test"

    def test_still_writes_a_file_when_nobody_has_a_name(self):
        """The export predates names and must not start depending on them."""
        fieldnames, rows = build_market_csv_rows(ASSIGNED_MARKET)

        assert fieldnames[:2] == ["Name", "Email"]
        assert [row["Email"] for row in rows] == ["nadia@ember.test", "theo@thistle.test"]

    def test_two_vendors_sharing_a_name_stay_apart(self):
        _fieldnames, rows = build_market_csv_rows(
            ASSIGNED_MARKET,
            {"nadia@ember.test": "Sam Lee", "theo@thistle.test": "Sam Lee"},
        )

        assert [row["Email"] for row in rows] == ["nadia@ember.test", "theo@thistle.test"]
        assert {row["Name"] for row in rows} == {"Sam Lee"}


class TestTheCheckInLookup:
    def _summary(self, monkeypatch, names):
        monkeypatch.setattr(
            AttendanceApi, "get_published_market_by_slug",
            lambda _slug: {
                "id": "market-1", "name": "Winter Market", "isDraft": False, "phase": "market_days",
                "setupObject": {
                    "priority": [], "marketDates": [{"date": "2026-08-01"}], "tiers": [],
                    "locations": [], "sections": [], "assignmentOptions": {},
                },
                "creationDate": "2026-01-01T00:00:00Z", "roles": {"o@t.com": "owner"},
                "modificationList": [],
            },
        )
        monkeypatch.setattr(
            AttendanceApi, "assign_market",
            lambda _market: type("M", (), {"assignment_object": type("A", (), {
                "vendor_assignments": [type("R", (), {
                    "email": "nadia@ember.test", "date": "2026-08-01",
                    "table_code": "Front Row 1", "table_choice": "Full Table",
                    "section": "Front Row", "tier": "Gold", "location": "Main Hall",
                })()],
            })()})(),
        )
        monkeypatch.setattr(
            AttendanceApi.attendance_collection, "find", lambda _q: iter([]),
        )
        monkeypatch.setattr(
            ApplicationsApi, "vendor_names_for_market", lambda _id: names,
        )
        return AttendanceApi.get_vendor_assignment_summary("winter-market", "nadia@ember.test")

    def test_the_vendor_is_greeted_by_name(self, monkeypatch):
        result, status = self._summary(monkeypatch, {"nadia@ember.test": "Nadia Okonkwo"})

        assert status == 200
        assert result["vendorName"] == "Nadia Okonkwo"
        assert result["vendorEmail"] == "nadia@ember.test"

    def test_a_vendor_with_no_name_is_still_served_their_assignment(self, monkeypatch):
        result, status = self._summary(monkeypatch, {})

        assert status == 200
        assert result["vendorName"] == ""
        assert result["vendorEmail"] == "nadia@ember.test"
