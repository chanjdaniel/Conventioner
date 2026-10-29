"""Confirming a draft started from a Google Form's responses (E24/F03/S03).

What one confirm writes - the plan facts, the form, the ceiling and the import mapping - and the seam
it closes: the import of the same file afterwards restores every column and matches every value.
Run on the Google Form exports in ``tests/test_data/google_forms/``.
"""
import copy
import os

import pytest

import csv_import as CsvImport
import csv_start as CsvStart
import essential_fields as EssentialFields

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")
YEARS = {"fall-2023": 2023, "spring-2024": 2024, "no-timestamp": 2025, "five-day-grid": 2025,
         "team-status-column": 2026}


def _confirmed_update(*args):
    """The ``$set`` a confirm would write; its counts are the history's, asserted elsewhere."""
    return CsvStart.confirmed_update(*args).update


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
    after = _written(doc, _confirmed_update(doc, csv_text, {"year": YEARS[name]}))

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
# (bug 4). Three of these never reached a single row while "how many days" was required (bug 24),
# and splitting "Woven (crochet, knitting, etc)" at its commas cost dozens more (bug 27). Another
# 15 to 41 per export were skipped for a blank answer to a question the proposal guessed required
# from how many answered it, until it stopped guessing (E33/F02/S01).
IMPORTED = {"fall-2023": 277, "spring-2024": 355, "no-timestamp": 235, "five-day-grid": 236,
            "team-status-column": 245}


@pytest.mark.parametrize("name", YEARS)
def test_the_seam_keeps_ticked_boxes_and_table_choices(name):
    """Past the mapping, where the seam test above stops: every export imported nothing, because
    a ticked certification read as unticked (bug 2) and "Full table"/"Half table" were saved as
    ignored (bug 3). Neither may cost an applicant their application now."""
    doc = _draft()
    csv_text = _csv(name)
    after = _written(doc, _confirmed_update(doc, csv_text, {"year": YEARS[name]}))
    saved = CsvImport.stored_mapping(after)
    ignored = saved["resolutions"].get(EssentialFields.TABLE_CHOICE_KEY, {})
    # A TEST row's "TEST" is rightly ignored; a table size never is.
    assert not {"Full table", "Half table", "Either"} & set(ignored)

    _error, headers, rows = CsvImport.parse_csv(csv_text)
    restored, _missing, _new = CsvImport.restore_mapping(
        headers, saved, CsvImport.import_targets(after))
    preview, _ = CsvImport.preview_values(after, csv_text, restored, saved["resolutions"])

    # A row is refused on a question only when it left that question blank. Each refusal names
    # every problem (bug 40), so a row that answered nothing names these too - rightly.
    # A value the proposal rightly ignored (a TEST row's "TEST") is no answer either.
    def answered(line, columns):
        row = rows[line - 2]
        return any(index < len(row) and row[index].strip()
                   and ignored.get(row[index].strip(), "kept") is not None for index in columns)

    choice_columns = restored.get(EssentialFields.TABLE_CHOICE_KEY, [])
    box_columns = {f["label"]: restored.get(f["key"], [])
                   for f in after["applicationForm"]["fields"] if f["type"] == "checkbox"}
    for failure in preview["failures"]:
        if answered(failure["row"], choice_columns):
            assert "'Table choice' is required" not in failure["error"], failure
        for label, columns in box_columns.items():
            if answered(failure["row"], columns):
                assert f"'{label}' is required" not in failure["error"], failure
    assert preview["validRows"] == IMPORTED[name]


def test_the_plan_facts_form_and_ceiling_are_written():
    doc = _draft()
    update = _confirmed_update(doc, _csv("spring-2024"), {"year": 2024})
    setup = update["setupObject"]
    assert [d["date"] for d in setup["marketDates"]] == [
        "2024-03-25", "2024-03-26", "2024-03-27", "2024-03-28"]
    assert [t["name"] for t in setup["tiers"]] == ["Gold", "Silver", "Bronze"]
    assert setup["assignmentOptions"]["maxAssignmentsPerVendor"] is None  # none was sent

    update = _confirmed_update(doc, _csv("spring-2024"), {"year": 2024, "ceiling": 3})
    assert update["setupObject"]["assignmentOptions"]["maxAssignmentsPerVendor"] == 3


def test_the_form_asks_the_organizers_own_questions_in_file_order():
    doc = _draft()
    update = _confirmed_update(doc, _csv("fall-2023"), {"year": 2023})
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
    update = _confirmed_update(doc, csv_text, {"year": 2024, "rows": [
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
    update = _confirmed_update(doc, _csv("five-day-grid"), {
        "year": 2025, "settled": {"tier": {"Bronze": "Silver"}}})
    assert [t["name"] for t in update["setupObject"]["tiers"]] == ["Gold", "Silver"]
    resolutions = update["importMapping"]["resolutions"][EssentialFields.TIER_PREFERENCE_KEY]
    assert resolutions["Bronze"] == "Silver"
    # A grid column's bracket text names a plan date the import reads for itself (bug 26), so
    # there is no decision to save for it.
    assert "Monday, October 20" not in resolutions


def test_two_columns_cannot_answer_the_same_essential_question():
    with pytest.raises(CsvStart.ConfirmRefused):
        _confirmed_update(_draft(), _csv("fall-2023"), {"year": 2023, "rows": [
            {"column": 10, "fate": "essential", "essential": EssentialFields.FULL_NAME_KEY}]})


def test_a_market_that_left_draft_or_gained_questions_is_refused():
    for doc in (_draft(phase="applications_open", isDraft=False),
                _draft(applicationForm={"fields": [{"key": "shop", "label": "Shop",
                                                    "type": "text"}]})):
        with pytest.raises(CsvStart.ConfirmRefused):
            _confirmed_update(doc, _csv("fall-2023"), {"year": 2023})


def test_the_import_skips_a_saved_target_whose_question_was_deleted():
    """A question deleted in the builder after confirm leaves its column needing a mapping."""
    doc = _draft()
    csv_text = _csv("fall-2023")
    after = _written(doc, _confirmed_update(doc, csv_text, {"year": 2023}))
    deleted = after["applicationForm"]["fields"].pop()
    _error, headers, _rows = CsvImport.parse_csv(csv_text)
    restored, missing, _new = CsvImport.restore_mapping(
        headers, CsvImport.stored_mapping(after), CsvImport.import_targets(after))
    assert deleted["key"] not in restored and missing == []


def test_a_plan_that_already_has_a_ceiling_keeps_it():
    doc = _draft(setupObject={"priority": [], "locations": [], "sections": [], "marketDates": [],
                              "tiers": [], "assignmentOptions": {"maxAssignmentsPerVendor": 4}})
    update = _confirmed_update(doc, _csv("spring-2024"), {"year": 2024, "ceiling": 3})
    assert update["setupObject"]["assignmentOptions"]["maxAssignmentsPerVendor"] == 4


def test_a_choice_with_no_option_kept_becomes_a_question_answered_in_words():
    update = _confirmed_update(_draft(), _csv("spring-2024"), {"year": 2024, "rows": [
        {"column": 16, "type": "select", "kept": []}]})
    club = next(f for f in update["applicationForm"]["fields"] if f["key"].startswith("which_clubs"))
    assert club["type"] == "text" and club["options"] == []


def test_an_unsettled_day_the_plan_lacks_is_left_for_the_import_to_ask():
    doc = _draft(setupObject={"priority": [], "locations": [], "sections": [], "tiers": [],
                              "assignmentOptions": {},
                              "marketDates": [{"date": "2025-10-20"}, {"date": "2025-10-21"}]})
    update = _confirmed_update(doc, _csv("five-day-grid"), {"year": 2025})
    tiers = update["importMapping"]["resolutions"].get(EssentialFields.TIER_PREFERENCE_KEY, {})
    assert "Wednesday, October 22" not in tiers

    # The import reads the days the plan has, and asks about the one it lacks - offering the
    # plan's days to match it to, not its tiers (bug 26).
    after = _written(doc, update)
    csv_text = _csv("five-day-grid")
    _error, headers, _rows = CsvImport.parse_csv(csv_text)
    saved = CsvImport.stored_mapping(after)
    restored, *_ = CsvImport.restore_mapping(headers, saved, CsvImport.import_targets(after))
    preview, _ = CsvImport.preview_values(after, csv_text, restored, saved["resolutions"])
    days = {u["value"]: u["offered"] for u in preview["unmatched"]
            if u["target"] == EssentialFields.TIER_PREFERENCE_KEY and "October" in u["value"]}
    assert "Monday, October 20" not in days
    assert days["Wednesday, October 22"] == ["2025-10-20", "2025-10-21"]


def test_a_legacy_draft_with_no_phase_is_written_under_its_own_shape():
    doc = _draft()
    del doc["phase"]
    condition = CsvStart.still_startable(doc)
    assert condition["phase"] == {"$exists": False} and condition["id"] == "market-1"


SELLING = "What do you plan to sell at the fair?"


def _started(name="five-day-grid"):
    doc = _draft()
    csv_text = _csv(name)
    return _written(doc, _confirmed_update(doc, csv_text, {"year": YEARS[name]})), csv_text


def test_the_first_import_after_a_start_names_the_start_not_a_last_import():
    """E30/F02/S01: the first import ever said "Restored from your last import", when the mapping
    came from the start of the form."""
    after, csv_text = _started()
    inspected, _ = CsvImport.inspect(after, csv_text)
    assert inspected["hasSavedMapping"] is True
    assert inspected["savedMappingFrom"] == "start"


def test_a_mapping_an_import_saved_is_the_last_imports():
    after, csv_text = _started()
    error, headers, _rows = CsvImport.parse_csv(csv_text)
    saved = CsvImport.stored_mapping(after)
    restored, _missing, _new = CsvImport.restore_mapping(
        headers, saved, CsvImport.import_targets(after))
    imported = {**after, "importMapping": CsvImport.mapping_payload(
        headers, restored, saved["resolutions"])}
    inspected, _ = CsvImport.inspect(imported, csv_text)
    assert inspected["savedMappingFrom"] == "import"


def test_a_mapping_saved_before_its_maker_was_recorded_reads_as_an_imports():
    after, csv_text = _started()
    legacy = {key: value for key, value in after["importMapping"].items() if key != "madeBy"}
    inspected, _ = CsvImport.inspect({**after, "importMapping": legacy}, csv_text)
    assert inspected["savedMappingFrom"] == "import"


def _selling_required(doc):
    """The market with the selling question marked required, as its organizer would have to: the
    proposal marks nothing required (E33/F02/S01)."""
    marked = copy.deepcopy(doc)
    for field in marked["applicationForm"]["fields"]:
        if field["label"] == SELLING:
            field["required"] = True
    return marked


def _selling_refusals(doc, csv_text, resolutions):
    error, headers, _rows = CsvImport.parse_csv(csv_text)
    restored, _missing, _new = CsvImport.restore_mapping(
        headers, CsvImport.stored_mapping(doc), CsvImport.import_targets(doc))
    preview, _ = CsvImport.preview_values(doc, csv_text, restored, resolutions)
    return [f["error"] for f in preview["failures"] if SELLING in f["error"]]


def test_an_answer_the_start_left_out_is_said_to_be_the_starts():
    """The walk: 15 rows skipped as "one you chose to ignore", which the organizer never chose."""
    after, csv_text = _started()
    after = _selling_required(after)
    refusals = _selling_refusals(after, csv_text, CsvImport.stored_mapping(after)["resolutions"])
    assert refusals
    for refusal in refusals:
        assert (f"Every answer to '{SELLING}' was left out when your form was started from this "
                "file, and it is required.") in refusal
        assert "chose to ignore" not in refusal


def test_an_answer_the_organizer_left_out_since_is_theirs():
    after, csv_text = _started()
    after = _selling_required(after)
    saved = CsvImport.stored_mapping(after)
    field = next(f for f in after["applicationForm"]["fields"] if f["label"] == SELLING)
    options = [o if isinstance(o, str) else o.get("label") or o.get("value")
               for o in field["options"]]
    resolutions = copy.deepcopy(saved["resolutions"])
    resolutions[field["key"]] = {**resolutions.get(field["key"], {}),
                                 **{option: None for option in options}}
    refusals = _selling_refusals(after, csv_text, resolutions)
    assert refusals
    assert all(f"Every answer to '{SELLING}' is one you chose to ignore" in r for r in refusals)


@pytest.mark.parametrize("name", YEARS)
def test_no_row_is_skipped_for_a_blank_answer_to_a_question_of_the_organizers_own(name):
    """No question is required unless the organizer said so (E33/F02/S01). The proposal marked one
    required when 97% of the file answered it, and a required question a row left blank skips that
    row at import, so the guess silently dropped real applicants from the market it was started on."""
    doc = _draft()
    csv_text = _csv(name)
    after = _written(doc, _confirmed_update(doc, csv_text, {"year": YEARS[name]}))
    saved = CsvImport.stored_mapping(after)
    _error, headers, _rows = CsvImport.parse_csv(csv_text)
    restored, _missing, _new = CsvImport.restore_mapping(
        headers, saved, CsvImport.import_targets(after))
    preview, _ = CsvImport.preview_values(after, csv_text, restored, saved["resolutions"])

    custom = [field["label"] for field in after["applicationForm"]["fields"]]
    assert custom and not any(field["required"] for field in after["applicationForm"]["fields"])
    refused = [failure for failure in preview["failures"]
               if any(f"'{label}' is required" in failure["error"] for label in custom)]
    assert refused == []
