"""One statement of how a dates-and-tiers answer becomes the stored shape (E19/F01/S01).

An organizer's own form asks ONE question - "for each day, choose all tiers you would be considered
for; choose None if you are not available" - so availability is implicit in the tier answer. A form
that asks once ("which tiers will you accept?") gives a flat list instead.

Both converge on the stored shape before anything downstream reads them. That rule lived inline in
the CSV import path; `E19/F01/S02` makes the applicant form produce the same shapes, and two copies
of this in two languages is the drift that would surface as the solver rejecting answers the form
had just accepted.
"""
from essential_fields import reconciled_dates_and_tiers


class TestAFlatTierAnswer:
    def test_becomes_those_tiers_on_every_date_the_vendor_is_available(self):
        tiers, dates = reconciled_dates_and_tiers(["Gold", "Silver"], ["2026-11-17", "2026-11-21"])

        assert tiers == {
            "2026-11-17": ["Gold", "Silver"],
            "2026-11-21": ["Gold", "Silver"],
        }
        assert dates == ["2026-11-17", "2026-11-21"]

    def test_with_no_dates_names_no_days(self):
        assert reconciled_dates_and_tiers(["Gold"], []) == ({}, [])

    def test_does_not_share_one_list_between_dates(self):
        tiers, _ = reconciled_dates_and_tiers(["Gold"], ["2026-11-17", "2026-11-21"])
        tiers["2026-11-17"].append("Silver")

        assert tiers["2026-11-21"] == ["Gold"]


class TestAPerDateGrid:
    def test_answers_availability_too_when_nothing_else_does(self):
        # The dates you named tiers for are the dates you are available. The two are still stored
        # separately and still have to agree - this is what makes them agree by construction.
        tiers, dates = reconciled_dates_and_tiers(
            {"2026-11-17": ["Gold"], "2026-11-21": [], "2026-11-22": ["Silver"]}, []
        )

        assert tiers == {"2026-11-17": ["Gold"], "2026-11-21": [], "2026-11-22": ["Silver"]}
        assert dates == ["2026-11-17", "2026-11-22"]

    def test_leaves_an_availability_answer_that_was_given_alone(self):
        tiers, dates = reconciled_dates_and_tiers(
            {"2026-11-17": ["Gold"]}, ["2026-11-17", "2026-11-21"]
        )

        assert dates == ["2026-11-17", "2026-11-21"]
        assert tiers == {"2026-11-17": ["Gold"]}


class TestAnythingElse:
    def test_is_carried_through_untouched(self):
        # A missing or unrecognised answer is the validator's to refuse, with the applicant's own
        # words in the message - not this function's to guess at.
        assert reconciled_dates_and_tiers(None, ["2026-11-17"]) == (None, ["2026-11-17"])
        assert reconciled_dates_and_tiers("Gold", []) == ("Gold", [])
