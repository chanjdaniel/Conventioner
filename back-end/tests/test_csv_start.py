"""Confirming a draft started from a Google Form's responses (E24/F03/S03).

What one confirm writes - the plan facts, the form, the ceiling and the import mapping - and the seam
it closes: the import of the same file afterwards restores every column and matches every value.
Run on the anonymised exports in ``tests/test_data/google_forms/``.
"""
import copy
import os

import pytest

import csv_import as CsvImport
import csv_start as CsvStart
import essential_fields as EssentialFields

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")
YEARS = {"fall-2023": 2023, "spring-2024": 2024, "spring-2025": 2025, "fall-2025": 2025,
         "spring-2026": 2026}


def _csv(name):
    with open(os.path.join(CORPUS, f"{name}.csv"), encoding="utf-8") as handle:
        return handle.read()


def _draft(**overrides):
    doc = {"id": "market-1", "name": "Test Market", "creationDate": "2026-01-01",
           "roles": {"user-1": "owner"}, "modificationList": [], "assignmentObject": {},
           "phase": "draft", "isDraft": True, "applicationForm": {"fields": []}}
    doc.update(overrides)
    return doc


def _written(doc, update):
    """The market as it reads back after the update."""
    after = copy.deepcopy(doc)
    after.update(update)
    return after


@pytest.mark.parametrize("name", YEARS)
def test_the_seam_the_import_of_the_same_file_has_nothing_to_ask(name):
    doc = _draft()
    csv_text = _csv(name)
    after = _written(doc, CsvStart.confirmed_update(doc, csv_text, {"year": YEARS[name]}))

    error, headers, _rows = CsvImport.parse_csv(csv_text)
    targets = CsvImport.import_targets(after)
    saved = CsvImport.stored_mapping(after)
    restored, missing, new = CsvImport.restore_mapping(headers, saved, targets)
    assert missing == [] and new == []
    assert CsvImport.APPLICANT_EMAIL_TARGET in restored

    preview, _ = CsvImport.preview_values(after, csv_text, restored, saved["resolutions"])
    assert preview["unmatched"] == []


# How many rows of each export import. Every other row is refused for a reason of its own: no email,
# an address that is not one, or an applicant whose every answer was an option too rare to keep
# (bug 4). Three of these never reached a single row while "how many days" was required (bug 24).
IMPORTED = {"fall-2023": 246, "spring-2024": 290, "spring-2025": 195, "fall-2025": 207,
            "spring-2026": 211}


@pytest.mark.parametrize("name", YEARS)
def test_the_seam_keeps_ticked_boxes_and_table_choices(name):
    """Past the mapping, where the seam test above stops: every export imported nothing, because
    a ticked certification read as unticked (bug 2) and "Full table"/"Half table" were saved as
    ignored (bug 3). Neither may cost an applicant their application now."""
    doc = _draft()
    csv_text = _csv(name)
    after = _written(doc, CsvStart.confirmed_update(doc, csv_text, {"year": YEARS[name]}))
    saved = CsvImport.stored_mapping(after)
    ignored = saved["resolutions"].get(EssentialFields.TABLE_CHOICE_KEY, {})
    # A TEST row's "TEST" is rightly ignored; a table size never is.
    assert not {"Full table", "Half table", "Either"} & set(ignored)

    _error, headers, _rows = CsvImport.parse_csv(csv_text)
    restored, _missing, _new = CsvImport.restore_mapping(
        headers, saved, CsvImport.import_targets(after))
    preview, _ = CsvImport.preview_values(after, csv_text, restored, saved["resolutions"])

    boxes = [f["label"] for f in after["applicationForm"]["fields"] if f["type"] == "checkbox"]
    refusals = [f["error"] for f in preview["failures"]]
    assert [r for r in refusals if "'Table choice' is required" in r] == []
    assert [r for r in refusals if any(f"'{label}' is required" in r for label in boxes)] == []
    assert preview["validRows"] == IMPORTED[name]


def test_the_plan_facts_form_and_ceiling_are_written():
    doc = _draft()
    update = CsvStart.confirmed_update(doc, _csv("spring-2024"), {"year": 2024})
    setup = update["setupObject"]
    assert [d["date"] for d in setup["marketDates"]] == [
        "2024-03-25", "2024-03-26", "2024-03-27", "2024-03-28"]
    assert [t["name"] for t in setup["tiers"]] == ["Gold", "Silver", "Bronze"]
    assert setup["assignmentOptions"]["maxAssignmentsPerVendor"] is None  # none was sent

    update = CsvStart.confirmed_update(doc, _csv("spring-2024"), {"year": 2024, "ceiling": 3})
    assert update["setupObject"]["assignmentOptions"]["maxAssignmentsPerVendor"] == 3


def test_the_form_asks_the_organizers_own_questions_in_file_order():
    doc = _draft()
    update = CsvStart.confirmed_update(doc, _csv("fall-2023"), {"year": 2023})
    fields = update["applicationForm"]["fields"]
    assert [f["label"] for f in fields] == [
        "Are you a UBC Student?", "If applicable, which clubs are you a member of?",
        "Do you have any tabling experience as a vendor?",
        "What will you be selling at the event?",
        "Please provide a link to your portfolio, art account, or any samples of your work!",
        "Additional comments",
    ][:len(fields)]
    assert [f["order"] for f in fields] == list(range(len(fields)))
    selling = next(f for f in fields if f["key"].startswith("what_will_you_be_selling"))
    assert selling["type"] == "multi_select" and "Stickers" in selling["options"]


def test_the_organizers_corrections_are_what_is_written():
    doc = _draft()
    csv_text = _csv("spring-2024")
    # The clubs question: one choice turned into several, a rare club kept; and the first,
    # left-out column brought back as a question.
    clubs = 16
    update = CsvStart.confirmed_update(doc, csv_text, {"year": 2024, "rows": [
        {"column": clubs, "type": "multi_select", "kept": ["AMS Artelier at UBC",
                                                           "UBC PRINT Arts and Crafts"]},
        {"column": 0, "fate": "custom"},
    ]})
    fields = {f["key"]: f for f in update["applicationForm"]["fields"]}
    club = next(f for k, f in fields.items() if k.startswith("which_clubs"))
    assert club["type"] == "multi_select"
    assert club["options"] == ["AMS Artelier at UBC", "UBC PRINT Arts and Crafts"]
    assert update["applicationForm"]["fields"][0]["label"] == "Fq"


def test_a_plan_that_already_has_tiers_keeps_them_and_settles_the_rest_as_value_fixes():
    doc = _draft(setupObject={"priority": [], "locations": [], "sections": [],
                              "assignmentOptions": {}, "marketDates": [],
                              "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}]})
    update = CsvStart.confirmed_update(doc, _csv("fall-2025"), {
        "year": 2025, "settled": {"tier": {"Bronze": "Silver"}}})
    assert [t["name"] for t in update["setupObject"]["tiers"]] == ["Gold", "Silver"]
    resolutions = update["importMapping"]["resolutions"][EssentialFields.TIER_PREFERENCE_KEY]
    assert resolutions["Bronze"] == "Silver"
    # Each grid column's bracket text is the date the year made of it.
    assert resolutions["Monday, November 17"] == "2025-11-17"


def test_two_columns_cannot_answer_the_same_essential_question():
    with pytest.raises(CsvStart.ConfirmRefused):
        CsvStart.confirmed_update(_draft(), _csv("fall-2023"), {"year": 2023, "rows": [
            {"column": 10, "fate": "essential", "essential": EssentialFields.FULL_NAME_KEY}]})


def test_a_market_that_left_draft_or_gained_questions_is_refused():
    for doc in (_draft(phase="applications_open", isDraft=False),
                _draft(applicationForm={"fields": [{"key": "shop", "label": "Shop",
                                                    "type": "text"}]})):
        with pytest.raises(CsvStart.ConfirmRefused):
            CsvStart.confirmed_update(doc, _csv("fall-2023"), {"year": 2023})


def test_the_import_skips_a_saved_target_whose_question_was_deleted():
    """A question deleted in the builder after confirm leaves its column needing a mapping."""
    doc = _draft()
    csv_text = _csv("fall-2023")
    after = _written(doc, CsvStart.confirmed_update(doc, csv_text, {"year": 2023}))
    deleted = after["applicationForm"]["fields"].pop()
    _error, headers, _rows = CsvImport.parse_csv(csv_text)
    restored, missing, _new = CsvImport.restore_mapping(
        headers, CsvImport.stored_mapping(after), CsvImport.import_targets(after))
    assert deleted["key"] not in restored and missing == []


def test_a_plan_that_already_has_a_ceiling_keeps_it():
    doc = _draft(setupObject={"priority": [], "locations": [], "sections": [], "marketDates": [],
                              "tiers": [], "assignmentOptions": {"maxAssignmentsPerVendor": 4}})
    update = CsvStart.confirmed_update(doc, _csv("spring-2024"), {"year": 2024, "ceiling": 3})
    assert update["setupObject"]["assignmentOptions"]["maxAssignmentsPerVendor"] == 4


def test_a_choice_with_no_option_kept_becomes_a_question_answered_in_words():
    update = CsvStart.confirmed_update(_draft(), _csv("spring-2024"), {"year": 2024, "rows": [
        {"column": 16, "type": "select", "kept": []}]})
    club = next(f for f in update["applicationForm"]["fields"] if f["key"].startswith("which_clubs"))
    assert club["type"] == "text" and club["options"] == []


def test_an_unsettled_day_the_plan_lacks_is_left_for_the_import_to_ask():
    doc = _draft(setupObject={"priority": [], "locations": [], "sections": [], "tiers": [],
                              "assignmentOptions": {},
                              "marketDates": [{"date": "2025-11-17"}, {"date": "2025-11-18"}]})
    update = CsvStart.confirmed_update(doc, _csv("fall-2025"), {"year": 2025})
    tiers = update["importMapping"]["resolutions"][EssentialFields.TIER_PREFERENCE_KEY]
    assert tiers["Monday, November 17"] == "2025-11-17"
    assert "Wednesday, November 19" not in tiers


def test_a_legacy_draft_with_no_phase_is_written_under_its_own_shape():
    doc = _draft()
    del doc["phase"]
    condition = CsvStart.still_startable(doc)
    assert condition["phase"] == {"$exists": False} and condition["id"] == "market-1"
