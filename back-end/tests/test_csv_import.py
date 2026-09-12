"""Importing vendors from a Google Forms CSV export.

The organizer maps each column to the question it answers, and every row goes through the shared
application-write path - so an imported application is the same kind of document as one submitted
through the public form.

This first cut covers the one-to-one case: every target served by exactly one column, and cell
values already naming what the market offers.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import csv_import as CsvImport
import essential_fields as EssentialFields
from datatypes import ApplicationStatus


DATES = ["2026-08-01", "2026-08-08"]
SECTIONS = ["Main Hall", "Garden"]
TIERS = ["Gold", "Silver"]

SETUP_CAMEL = {
    "colNames": [], "colValues": [], "colInclude": [], "enumPriorityOrder": [], "priority": [],
    "marketDates": [{"date": date} for date in DATES],
    "tiers": [{"id": index, "name": name} for index, name in enumerate(TIERS)],
    "locations": [],
    "sections": [{"name": name, "count": 4} for name in SECTIONS],
    "assignmentOptions": {}, "floorplans": [],
}

FORM_FIELDS = [
    {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
     "options": [], "order": 0},
]

# Headers as a Google Form actually writes them: the organizer's own question text.
HEADERS = [
    "Timestamp",
    "Email Address",
    "Business name",
    "Which days can you attend?",
    "How many days do you want?",
    "Which tiers will you accept?",
    "Full or half table?",
    "Partner's email if sharing",
    "Rank the sections",
]

MAPPING = {
    CsvImport.SUBMITTED_AT_TARGET: 0,
    CsvImport.APPLICANT_EMAIL_TARGET: 1,
    "business_name": 2,
    EssentialFields.AVAILABLE_DATES_KEY: 3,
    EssentialFields.MAX_DATES_KEY: 4,
    EssentialFields.TIER_PREFERENCE_KEY: 5,
    EssentialFields.TABLE_CHOICE_KEY: 6,
    EssentialFields.TABLE_SHARE_EMAIL_KEY: 7,
    EssentialFields.SECTION_RANKING_KEY: 8,
}


def _csv(*rows: str) -> str:
    return "\n".join([",".join(HEADERS), *rows])


GOOD_ROW = (
    '2026/05/02 9:14:03,nadia@ember.ca,Ember Ceramics,'
    '"2026-08-01, 2026-08-08",2,Gold,half,buddy@ember.ca,"Garden, Main Hall"'
)


def _market_doc(setup=None, **overrides):
    return stored_market(
        setupObject=setup or SETUP_CAMEL,
        applicationForm={"fields": FORM_FIELDS, "essentialOptions": None},
        **overrides,
    )


@pytest.fixture
def markets():
    return FakeMarketsCollection(_market_doc())


class TestImportTargets:
    def test_identity_and_submission_time_are_targets_beside_the_questions(self, markets):
        keys = [t.key for t in CsvImport.import_targets(markets.doc)]

        assert CsvImport.APPLICANT_EMAIL_TARGET in keys
        assert CsvImport.SUBMITTED_AT_TARGET in keys
        assert "business_name" in keys

    def test_only_the_email_and_the_asked_questions_are_required(self, markets):
        targets = {t.key: t for t in CsvImport.import_targets(markets.doc)}

        assert targets[CsvImport.APPLICANT_EMAIL_TARGET].required
        assert not targets[CsvImport.SUBMITTED_AT_TARGET].required
        assert not targets[EssentialFields.TABLE_SHARE_EMAIL_KEY].required

    def test_a_question_that_is_not_asked_is_not_a_target(self, markets):
        """Table type is stubbed to one type, so mapping a column to it would be discarded."""
        keys = [t.key for t in CsvImport.import_targets(markets.doc)]

        assert EssentialFields.TABLE_TYPE_RANKING_KEY not in keys

    def test_a_market_with_one_section_does_not_offer_section_ranking(self):
        doc = _market_doc({**SETUP_CAMEL, "sections": [{"name": "Main Hall", "count": 4}]})

        keys = [t.key for t in CsvImport.import_targets(doc)]

        assert EssentialFields.SECTION_RANKING_KEY not in keys


class TestInspect:
    def test_it_returns_the_columns_with_sample_values(self, markets):
        body, status = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert status == 200
        assert body["headers"] == HEADERS
        assert body["rowCount"] == 1
        assert body["sampleValues"][1] == ["nadia@ember.ca"]

    def test_the_google_forms_columns_are_offered_without_asking(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["suggestedMapping"][CsvImport.SUBMITTED_AT_TARGET] == 0
        assert body["suggestedMapping"][CsvImport.APPLICANT_EMAIL_TARGET] == 1

    def test_nothing_else_is_guessed(self, markets):
        """Guessing beyond the two known headers makes the organizer audit our guesses."""
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert set(body["suggestedMapping"]) == {
            CsvImport.SUBMITTED_AT_TARGET, CsvImport.APPLICANT_EMAIL_TARGET,
        }

    def test_an_empty_file_is_refused(self, markets):
        body, status = CsvImport.inspect(markets.doc, "")

        assert status == 400 and "empty" in body["error"]

    def test_a_quoted_comma_does_not_split_a_column(self, markets):
        """A Google Forms answer routinely contains a comma."""
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["sampleValues"][3] == ["2026-08-01, 2026-08-08"]


class TestImportApplications:
    def test_a_row_becomes_an_application_awaiting_review(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), MAPPING,
        )

        assert status == 200, body
        assert body["created"] == 1 and body["skipped"] == 0
        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["status"] == ApplicationStatus.OPEN.value

    def test_answers_land_in_their_stored_shapes(self, markets, applications):
        """Through the shared write path, so identical to a form submission."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["business_name"] == "Ember Ceramics"
        assert data["essential_available_dates"] == DATES
        assert data["essential_max_dates"] == 2
        assert data["essential_tier_preference"] == ["Gold"]
        assert data["essential_table_choice"] == "half"
        assert data["essential_table_share_email"] == "buddy@ember.ca"
        assert data["essential_section_ranking"] == ["Garden", "Main Hall"]

    def test_submission_time_comes_from_the_file_not_the_import(self, markets, applications):
        """Otherwise every row shares one timestamp and first-come-first-served does nothing."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        stored = applications.find_one({"applicant_email": "nadia@ember.ca"})
        assert stored["submitted_at"] == "2026/05/02 9:14:03"

    def test_an_unmapped_required_target_imports_nothing(self, markets, applications):
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TIER_PREFERENCE_KEY}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), partial,
        )

        assert status == 422
        assert "Tier preference" in body["error"]
        assert applications.documents == []

    def test_an_unmapped_optional_target_is_fine(self, markets, applications):
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TABLE_SHARE_EMAIL_KEY}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), partial,
        )

        assert status == 200 and body["created"] == 1

    def test_a_column_outside_the_file_is_refused(self, markets, applications):
        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW), {**MAPPING, "business_name": 99},
        )

        assert status == 400 and "not in this file" in body["error"]
        assert applications.documents == []

    def test_a_row_with_no_email_is_skipped_and_named(self, markets, applications):
        blank = GOOD_ROW.replace("nadia@ember.ca,Ember Ceramics", ",Ember Ceramics")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(blank, GOOD_ROW), MAPPING,
        )

        assert body["created"] == 1 and body["skipped"] == 1
        assert body["failures"][0]["row"] == 2
        assert "email" in body["failures"][0]["error"].lower()

    def test_one_bad_row_does_not_stop_the_others(self, markets, applications):
        """Refuse at the mapping level, tolerate at the row level.

        A row-level fault is one only that row has - here a max-dates answer that is not a number.
        A cell value that names nothing the market offers is NOT one of these: it is the same
        decision for every row carrying it, so it is settled before anything is written.
        """
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["created"] == 1
        assert body["skipped"] == 1
        assert body["failures"][0]["email"] == "kai@ember.ca"
        assert "whole number" in body["failures"][0]["error"]

    def test_a_skipped_row_names_its_spreadsheet_line(self, markets, applications):
        """Row 1 is the header, so the organizer can find row 3 in their own file."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert body["failures"][0]["row"] == 3

    def test_email_is_lowercased_so_one_applicant_is_one_applicant(self, markets, applications):
        shouty = GOOD_ROW.replace("nadia@ember.ca", "Nadia@Ember.CA")

        CsvImport.import_applications(markets, markets.doc, _csv(shouty), MAPPING)

        assert applications.find_one({"applicant_email": "nadia@ember.ca"}) is not None


# A Google Forms CHECKBOX GRID exports one column per option, the header carrying the question
# stem and the option in brackets. The same question asked once exports as a single
# comma-separated column. Both mean the same thing, and both must import identically.
GRID_HEADERS = [
    "Timestamp",
    "Email Address",
    "Business name",
    "Which days can you attend? [2026-08-01]",
    "Which days can you attend? [2026-08-08]",
    "How many days do you want?",
    "Which tiers will you accept?",
    "Full or half table?",
    "Partner's email if sharing",
    "Rank the sections [Main Hall]",
    "Rank the sections [Garden]",
]

GRID_MAPPING = {
    CsvImport.SUBMITTED_AT_TARGET: 0,
    CsvImport.APPLICANT_EMAIL_TARGET: 1,
    "business_name": 2,
    EssentialFields.AVAILABLE_DATES_KEY: [3, 4],
    EssentialFields.MAX_DATES_KEY: 5,
    EssentialFields.TIER_PREFERENCE_KEY: 6,
    EssentialFields.TABLE_CHOICE_KEY: 7,
    EssentialFields.TABLE_SHARE_EMAIL_KEY: 8,
    EssentialFields.SECTION_RANKING_KEY: [9, 10],
}


def _grid_csv(*rows: str) -> str:
    return "\n".join([",".join(GRID_HEADERS), *rows])


# Ticked on both days; ranks Garden first by saying so in the grid's own cells.
GRID_ROW = (
    "2026/05/02 9:14:03,nadia@ember.ca,Ember Ceramics,Yes,Yes,2,Gold,half,,2nd choice,1st choice"
)


class TestColumnGroups:
    def test_a_grid_is_detected_as_one_question(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _grid_csv(GRID_ROW))

        stems = {group["stem"]: group for group in body["groups"]}
        assert "Which days can you attend?" in stems
        assert stems["Which days can you attend?"]["columns"] == [3, 4]
        assert stems["Which days can you attend?"]["options"] == ["2026-08-01", "2026-08-08"]

    def test_a_lone_bracketed_column_is_not_a_group(self, markets):
        """One column is not a grid; grouping it would invent structure that is not there."""
        headers = ["Email Address", "Which days can you attend? [2026-08-01]"]
        body, _ = CsvImport.inspect(markets.doc, ",".join(headers) + "\nx@y.z,Yes")

        assert body["groups"] == []

    def test_plain_headers_produce_no_groups(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["groups"] == []


class TestImportingAGrid:
    def test_both_export_shapes_produce_the_same_answers(self, markets, applications):
        """The point of the story: one question, two spellings, one stored document."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)
        from_grid = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]

        applications.documents.clear()
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        from_single = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]

        assert from_grid["essential_available_dates"] == from_single["essential_available_dates"]
        assert from_grid["essential_section_ranking"] == from_single["essential_section_ranking"]

    def test_an_unticked_option_is_not_selected(self, markets, applications):
        one_day = GRID_ROW.replace("Ember Ceramics,Yes,Yes,2", "Ember Ceramics,Yes,,1")

        CsvImport.import_applications(markets, markets.doc, _grid_csv(one_day), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == ["2026-08-01"]

    def test_a_ranking_grid_is_ordered_by_what_the_cells_say(self, markets, applications):
        """A multiple-choice grid records the rank in the cell; column order is only the tiebreak."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_section_ranking"] == ["Garden", "Main Hall"]

    def test_a_ranking_grid_with_no_ranks_falls_back_to_column_order(self, markets, applications):
        """The only ordering information left is the order the organizer wrote the options in."""
        ticked = GRID_ROW.replace(",2nd choice,1st choice", ",Yes,Yes")

        CsvImport.import_applications(markets, markets.doc, _grid_csv(ticked), GRID_MAPPING)

        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_section_ranking"] == ["Main Hall", "Garden"]

    def test_a_grid_column_outside_the_file_is_refused(self, markets, applications):
        broken = {**GRID_MAPPING, EssentialFields.AVAILABLE_DATES_KEY: [3, 99]}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _grid_csv(GRID_ROW), broken,
        )

        assert status == 400 and "not in this file" in body["error"]
        assert applications.documents == []


class TestMatchingCellValues:
    """The organizer's own words against the market's configuration.

    A form that said "Gold Tier" has to reach a tier called "Gold". Trivial differences are matched
    silently; everything left over is one decision per distinct value, not one per row.
    """

    def test_trivial_differences_are_matched_without_asking(self, markets, applications):
        for spelling in ("  Gold  ", "gold", "GOLD"):
            applications.documents.clear()
            row = GOOD_ROW.replace(",Gold,", f",{spelling},")

            body, status = CsvImport.import_applications(
                markets, markets.doc, _csv(row), MAPPING,
            )

            assert status == 200, f"{spelling!r} should have matched: {body}"
            data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
            assert data["essential_tier_preference"] == ["Gold"]

    def test_an_unmatched_value_is_reported_once_with_its_row_count(self, markets):
        rows = [GOOD_ROW.replace(",Gold,", ",Gold Tier,")] * 3

        body, status = CsvImport.preview_values(markets.doc, _csv(*rows), MAPPING)

        assert status == 200
        assert len(body["unmatched"]) == 1
        entry = body["unmatched"][0]
        assert entry["value"] == "Gold Tier"
        assert entry["rows"] == 3
        assert entry["targetLabel"] == EssentialFields.TIER_PREFERENCE_LABEL
        assert entry["offered"] == TIERS

    def test_a_matching_file_has_nothing_to_resolve(self, markets):
        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert body["unmatched"] == []

    def test_an_unresolved_value_imports_nothing(self, markets, applications):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")

        body, status = CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING)

        assert status == 422
        assert "Gold Tier" in body["error"]
        assert applications.documents == []

    def test_a_resolution_is_applied_to_every_row_carrying_the_value(self, markets, applications):
        rows = [
            GOOD_ROW.replace(",Gold,", ",Gold Tier,"),
            GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",Gold,", ",Gold Tier,"),
        ]
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(*rows), MAPPING, resolutions,
        )

        assert status == 200, body
        assert body["created"] == 2
        for email in ("nadia@ember.ca", "kai@ember.ca"):
            data = applications.find_one({"applicant_email": email})["form_data"]
            assert data["essential_tier_preference"] == ["Gold"]

    def test_a_value_can_be_explicitly_ignored(self, markets, applications):
        """Not every stray answer means something; dropping one is a decision the organizer makes."""
        row = GOOD_ROW.replace('"2026-08-01, 2026-08-08"', '"2026-08-01, Maybe Sunday"')
        resolutions = {EssentialFields.AVAILABLE_DATES_KEY: {"Maybe Sunday": None}}

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_available_dates"] == ["2026-08-01"]

    def test_free_text_answers_are_never_matched(self, markets):
        """A business name is the applicant's own words and has nothing to match against."""
        row = GOOD_ROW.replace("Ember Ceramics", "Somewhere Entirely New")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        assert body["unmatched"] == []

    def test_table_choice_is_matched_against_its_fixed_options(self, markets, applications):
        resolutions = {EssentialFields.TABLE_CHOICE_KEY: {"Half table please": "half"}}
        row = GOOD_ROW.replace(",half,", ",Half table please,")

        body, status = CsvImport.import_applications(
            markets, markets.doc, _csv(row), MAPPING, resolutions,
        )

        assert status == 200, body
        data = applications.find_one({"applicant_email": "nadia@ember.ca"})["form_data"]
        assert data["essential_table_choice"] == "half"


class TestPreviewingRowValidity:
    """What will and will not import, said before anything is written.

    Silently skipping a row is the worst outcome available: the import looks complete and a vendor
    is simply missing. So everything that would be skipped is shown first, with the line the
    organizer can find it on.
    """

    def test_a_clean_file_previews_every_row_as_valid(self, markets):
        body, status = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, GOOD_ROW), MAPPING)

        assert status == 200
        assert body["validRows"] == 2
        assert body["failures"] == []

    def test_a_mixed_file_counts_both_and_names_the_bad_lines(self, markets):
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, bad), MAPPING)

        assert body["rowCount"] == 2
        assert body["validRows"] == 1
        assert len(body["failures"]) == 1
        assert body["failures"][0]["row"] == 3
        assert body["failures"][0]["email"] == "kai@ember.ca"
        assert "whole number" in body["failures"][0]["error"]

    def test_an_all_invalid_file_previews_nothing_as_valid(self, markets):
        bad = GOOD_ROW.replace(",2,Gold,", ",lots,Gold,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(bad, bad), MAPPING)

        assert body["validRows"] == 0
        assert len(body["failures"]) == 2

    def test_previewing_writes_nothing(self, markets, applications):
        CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert applications.documents == []

    def test_previewing_does_not_freeze_the_offering(self, markets, applications):
        """A dry run that froze would let merely LOOKING at an import decide the form for ever."""
        CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), MAPPING)

        assert markets.last_update is None

    def test_row_validity_waits_until_the_mapping_is_complete(self, markets):
        """Before that every row fails for the same reason, which the rail already says."""
        partial = {k: v for k, v in MAPPING.items() if k != EssentialFields.TIER_PREFERENCE_KEY}

        body, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW), partial)

        assert body["failures"] == []
        assert body["validRows"] == 0

    def test_row_validity_waits_until_values_are_resolved(self, markets):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")

        body, _ = CsvImport.preview_values(markets.doc, _csv(row), MAPPING)

        assert body["unmatched"] != []
        assert body["failures"] == []

    def test_the_preview_agrees_with_what_the_import_then_does(self, markets, applications):
        """Both run the same assembly, so a row cannot pass the preview and fail the import."""
        bad = GOOD_ROW.replace("nadia@ember.ca", "kai@ember.ca").replace(",2,Gold,", ",lots,Gold,")

        preview, _ = CsvImport.preview_values(markets.doc, _csv(GOOD_ROW, bad), MAPPING)
        imported, _ = CsvImport.import_applications(
            markets, markets.doc, _csv(GOOD_ROW, bad), MAPPING,
        )

        assert imported["created"] == preview["validRows"]
        assert [f["row"] for f in imported["failures"]] == [f["row"] for f in preview["failures"]]


class TestRememberingTheMapping:
    """Re-import is the expected case, not the exception - a form keeps collecting after the
    first import. Re-specifying a dozen decisions every time is what makes an organizer keep a
    spreadsheet instead."""

    def test_a_successful_import_saves_how_the_file_was_read(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)

        saved = markets.last_update["$set"]["importMapping"]
        assert saved["targets"]["essential_tier_preference"] == ["Which tiers will you accept?"]
        assert saved["headers"] == HEADERS
        assert saved["savedAt"]

    def test_columns_are_remembered_by_header_text_not_position(self, markets, applications):
        """A reordered form exports the same headers in a different order; a mapping keyed on
        position would then map every answer to the wrong question without a word."""
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        # The same questions, business name moved to the end.
        moved = [h for h in HEADERS if h != "Business name"] + ["Business name"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(moved, saved, targets)

        assert unresolved == []
        assert restored["business_name"] == [len(moved) - 1]
        assert restored[EssentialFields.TIER_PREFERENCE_KEY] == [moved.index("Which tiers will you accept?")]

    def test_a_vanished_header_is_reported_not_guessed_at(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        without = [h for h in HEADERS if h != "Which tiers will you accept?"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(without, saved, targets)

        assert EssentialFields.TIER_PREFERENCE_KEY not in restored
        assert unresolved == [{
            "target": EssentialFields.TIER_PREFERENCE_KEY,
            "missingHeaders": ["Which tiers will you accept?"],
        }]

    def test_a_grid_is_never_half_restored(self, markets, applications):
        """A partly-mapped grid is worse than an unmapped one: it looks answered."""
        CsvImport.import_applications(markets, markets.doc, _grid_csv(GRID_ROW), GRID_MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        without = [h for h in GRID_HEADERS if h != "Which days can you attend? [2026-08-08]"]
        targets = CsvImport.import_targets(markets.doc)
        restored, unresolved, _new = CsvImport.restore_mapping(without, saved, targets)

        assert EssentialFields.AVAILABLE_DATES_KEY not in restored
        assert unresolved[0]["target"] == EssentialFields.AVAILABLE_DATES_KEY

    def test_a_header_that_has_appeared_since_is_called_new(self, markets, applications):
        CsvImport.import_applications(markets, markets.doc, _csv(GOOD_ROW), MAPPING)
        saved = CsvImport.stored_mapping({"importMapping": markets.last_update["$set"]["importMapping"]})

        targets = CsvImport.import_targets(markets.doc)
        _restored, _unresolved, new = CsvImport.restore_mapping(
            HEADERS + ["Anything else?"], saved, targets,
        )

        assert new == ["Anything else?"]

    def test_value_resolutions_are_remembered_too(self, markets, applications):
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}

        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING, resolutions)

        saved = markets.last_update["$set"]["importMapping"]
        assert saved["resolutions"]["essential_tier_preference"]["Gold Tier"] == "Gold"

    def test_data_keys_survive_the_round_trip_unmangled(self, markets, applications):
        """The mapping's own field names are camelCase like the rest of the market document, but
        its CONTENTS are data: target keys, and raw cell values the organizer's form produced. A
        blanket key conversion would rewrite "Gold Tier" and silently lose what it stood for."""
        row = GOOD_ROW.replace(",Gold,", ",Gold Tier,")
        resolutions = {EssentialFields.TIER_PREFERENCE_KEY: {"Gold Tier": "Gold"}}
        CsvImport.import_applications(markets, markets.doc, _csv(row), MAPPING, resolutions)

        stored = markets.last_update["$set"]["importMapping"]
        read_back = CsvImport.stored_mapping({"importMapping": stored})

        assert EssentialFields.TIER_PREFERENCE_KEY in read_back["targets"]
        assert read_back["resolutions"][EssentialFields.TIER_PREFERENCE_KEY]["Gold Tier"] == "Gold"

    def test_a_first_import_has_nothing_to_restore(self, markets):
        body, _ = CsvImport.inspect(markets.doc, _csv(GOOD_ROW))

        assert body["hasSavedMapping"] is False
        assert body["restoredMapping"] == {}
