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
from conftest import FakeApplicationsCollection


def _collection(docs):
    """The shared fake, holding these applications in market-1: it applies the query and the
    projection as Mongo does, so a read that fetches too little fails here too."""
    fake = FakeApplicationsCollection()
    fake.documents = [{"market_id": "market-1", **doc} for doc in docs]
    return fake


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
            ApplicationsApi, "applications_collection", _collection(docs),
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

        assert fieldnames[:3] == ["Name", "Full name", "Email"]
        assert rows[0]["Name"] == "Nadia Okonkwo"
        assert rows[0]["Email"] == "nadia@ember.test"

    def test_says_who_holds_a_seat_though_not_approved(self):
        """A seat given by hand to someone the review left out is marked in the download too
        (E36/F02/S03), and every other row is said to be approved."""
        fieldnames, rows = build_market_csv_rows(
            ASSIGNED_MARKET, {}, not_approved={"theo@thistle.test"},
        )

        assert fieldnames[3] == "Approval"
        assert {row["Email"]: row["Approval"] for row in rows} == {
            "nadia@ember.test": "Approved",
            "theo@thistle.test": "Not approved",
        }

    def test_leaves_the_name_blank_rather_than_inventing_a_placeholder(self):
        _fieldnames, rows = build_market_csv_rows(ASSIGNED_MARKET, {})

        assert rows[0]["Name"] == ""
        assert rows[0]["Email"] == "nadia@ember.test"

    def test_still_writes_a_file_when_nobody_has_a_name(self):
        """The export predates names and must not start depending on them."""
        fieldnames, rows = build_market_csv_rows(ASSIGNED_MARKET)

        assert fieldnames[:3] == ["Name", "Full name", "Email"]
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
            AttendanceApi, "get_check_in_market",
            lambda _slug: {
                "id": "market-1", "name": "Winter Market", "isDraft": False, "phase": "market_days",
                "setupObject": {
                    "priority": [], "marketDates": [{"date": "2026-08-01"}], "tiers": [],
                    "locations": [], "sections": [], "assignmentOptions": {},
                },
                "creationDate": "2026-01-01T00:00:00Z", "roles": {"o@t.com": "owner"},
                "modificationList": [],
                "assignmentObject": {"vendorAssignments": [{
                    "email": "nadia@ember.test", "date": "2026-08-01",
                    "tableCode": "Front Row 1", "tableChoice": "Full Table",
                    "section": "Front Row", "tier": "Gold", "location": "Main Hall",
                }]},
            },
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


class TestTheFullNameInTheDownload:
    """The download carries the full name (E35/F03/S02): the organizers asked for it beside the name
    each vendor chose, which is what Name holds."""

    def test_both_names_in_that_order(self):
        fieldnames, rows = build_market_csv_rows(
            ASSIGNED_MARKET, {"nadia@ember.test": "Nadia O"},
            full_names={"nadia@ember.test": "Nadia Okonkwo"})

        assert fieldnames[:2] == ["Name", "Full name"]
        assert (rows[0]["Name"], rows[0]["Full name"]) == ("Nadia O", "Nadia Okonkwo")

    def test_a_vendor_with_no_full_name_leaves_it_blank(self):
        _fieldnames, rows = build_market_csv_rows(ASSIGNED_MARKET, {"nadia@ember.test": "Nadia O"})

        assert rows[0]["Full name"] == ""

    def test_the_full_names_are_read_from_the_applications(self, monkeypatch):
        names = self._full_names(monkeypatch, [
            {"applicant_email": "Nadia@Ember.test",
             "form_data": {EF.FULL_NAME_KEY: "Nadia Okonkwo", EF.PREFERRED_NAME_KEY: "Nadia O"}},
            {"applicant_email": "theo@thistle.test", "form_data": {EF.FULL_NAME_KEY: "Theo M"}},
            {"applicant_email": "legacy@x.test", "form_data": {}},
        ])

        assert names == {"nadia@ember.test": "Nadia Okonkwo", "theo@thistle.test": "Theo M"}

    def _full_names(self, monkeypatch, docs):
        import api.applications as ApplicationsApi

        monkeypatch.setattr(
            ApplicationsApi, "applications_collection", _collection(docs),
        )
        monkeypatch.setattr(ApplicationsApi, "ensure_application_indexes", lambda: None)
        return ApplicationsApi.vendor_full_names_for_market("market-1")
