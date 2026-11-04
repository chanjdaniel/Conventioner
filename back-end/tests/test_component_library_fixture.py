"""The component library's fixture is exactly what its deriver makes, at a real market's sizes.

``tests/fixtures/component_library_fixture.py`` reads the committed synthetic Google Form exports
with the product's own readers and writes ``front-end/src/dev/library/fixture.json``, which the
development-only component library draws every entry from. The JSON is never edited by hand: one
that differs from the deriver's output by a byte fails here, and the fix is to change the deriver
and run it again.

The counts are pinned because they are the point: the library exists to judge each large-list
pattern at the size Daniel's markets reach (T191's F12 survey), so a fixture that shrank would let
a pattern look fine where it would not be.
"""
import collections
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "fixtures", "component_library_fixture.py")

_spec = importlib.util.spec_from_file_location("component_library_fixture", SCRIPT)
deriver = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deriver)

FIXTURE = deriver.fixture()


def test_the_committed_json_is_the_derivers_output():
    with open(deriver.OUTPUT, "rb") as handle:
        committed = handle.read()
    assert committed == deriver.fixture_bytes(), (
        "front-end/src/dev/library/fixture.json is not what "
        "tests/fixtures/component_library_fixture.py makes: change the deriver and run it, never "
        "the file")


def test_it_is_the_same_bytes_every_run():
    assert deriver.fixture_bytes() == deriver.fixture_bytes()


def test_the_applications_are_every_named_applicant_of_the_four_day_grid():
    applications = FIXTURE["applications"]
    assert len(applications) == 359
    assert len({a["id"] for a in applications}) == 359
    assert all(a["name"] and "@" in a["email"] for a in applications)
    assert collections.Counter(a["status"] for a in applications) == {
        "open": 110, "needs_follow_up": 25, "reviewer_approved": 160, "reviewer_rejected": 64}


def test_the_people_are_150_applicants_of_the_five_day_grid_dealt_the_market_roles():
    people = FIXTURE["people"]
    assert len(people) == 150
    assert len({p["email"].lower() for p in people}) == 150
    assert collections.Counter(p["role"] for p in people) == {
        "owner": 1, "admin": 4, "editor": 45, "viewer": 100}


def test_12_reviewers_among_those_who_may_review_deal_every_application():
    reviewers = FIXTURE["reviewers"]
    roles = {p["id"]: p["role"] for p in FIXTURE["people"]}
    assert len(reviewers) == len(set(reviewers)) == 12
    assert all(roles[r] in ("owner", "admin", "editor") for r in reviewers)
    dealt = collections.Counter(a["reviewer"] for a in FIXTURE["applications"])
    assert set(dealt) == set(reviewers)
    assert max(dealt.values()) - min(dealt.values()) <= 1


def test_the_question_keeps_every_answer_with_its_count():
    question = FIXTURE["question"]
    assert question["label"] == "What kinds of work will you sell?"
    options = question["options"]
    assert len(options) == 228
    assert len({o["label"] for o in options}) == 228
    counts = [o["count"] for o in options]
    assert counts == sorted(counts, reverse=True) and counts[-1] >= 1


def test_the_values_to_fix_are_answers_the_question_does_not_offer():
    offered = {o["label"] for o in FIXTURE["question"]["options"]}
    values = FIXTURE["valuesToFix"]
    assert len(values) == len(set(values)) == 43
    assert not offered & set(values)


def test_approved_applications_fill_both_sections_on_each_of_the_four_dates():
    seats = FIXTURE["seats"]
    approved = {a["id"] for a in FIXTURE["applications"] if a["status"] == "reviewer_approved"}
    dates = sorted({s["date"] for s in seats})
    assert dates == ["2024-04-22", "2024-04-23", "2024-04-24", "2024-04-25"]
    for date in dates:
        by_section = collections.defaultdict(list)
        for seat in seats:
            if seat["date"] == date:
                by_section[seat["section"]].append(seat["table"])
        assert {s: sorted(t) for s, t in by_section.items()} == {
            "North Wing": list(range(1, 32)), "South Wing": list(range(1, 29))}
        on_the_day = [s["application"] for s in seats if s["date"] == date]
        assert len(on_the_day) == len(set(on_the_day)) == 59
    assert all(s["application"] in approved for s in seats)
    held = collections.Counter(s["application"] for s in seats)
    assert max(held.values()) <= 3


def test_the_export_offers_the_products_columns_in_its_groups():
    export = FIXTURE["export"]
    assert export["groups"] == [
        {"id": "vendor", "label": "Vendor"}, {"id": "answers", "label": "Answers"},
        {"id": "assignment", "label": "Assignment"}, {"id": "payment", "label": "Payment"},
        {"id": "discord", "label": "Discord"}]
    columns = export["columns"]
    assert len(columns) == 43
    assert collections.Counter(c["group"] for c in columns) == {
        "vendor": 4, "answers": 15, "assignment": 17, "payment": 4, "discord": 3}
    assert [c["id"] for c in columns[:4]] == ["name", "preferredName", "email", "status"]


def test_the_export_filters_by_the_markets_choice_questions_every_answer_kept():
    questions = {q["label"]: q for q in FIXTURE["export"]["questions"]}
    assert len(questions) == 6
    selling = questions["What kinds of work will you sell?"]
    assert selling["options"] == [o["label"] for o in FIXTURE["question"]["options"]]


def test_the_export_offers_what_the_products_preview_offers():
    export = FIXTURE["export"]
    assert export["defaultColumns"] == ["name", "email", "status"]
    assert [s["label"] for s in export["statuses"]] == [
        "Open", "Needs follow-up", "Approved", "Rejected", "Added by hand"]
    assert export["dates"] == ["2024-04-22", "2024-04-23", "2024-04-24", "2024-04-25"]
    assert export["sections"] == ["North Wing", "South Wing"]
    assert export["tiers"] == ["Gold", "Silver"]
    assert [s["label"] for s in export["paymentStates"]] == [
        "Owes", "Paid in full", "Paid more than owed"]
    assert [s["label"] for s in export["discordStates"]] == [
        "Has the role", "In the server", "Possible match", "Not found", "No username",
        "Check again"]
    assert export["discordInvite"].startswith("https://")


def test_a_seats_tier_is_its_sections():
    tiers = {(s["section"], s["tier"]) for s in FIXTURE["seats"]}
    assert tiers == {("North Wing", "Gold"), ("South Wing", "Silver")}


def test_each_vendor_answers_the_markets_questions_as_the_import_reads_them():
    questions = FIXTURE["export"]["questions"]
    answer_columns = [c["id"].removeprefix("answer:") for c in FIXTURE["export"]["columns"]
                      if c["group"] == "answers"]
    vendors = [a["export"] for a in FIXTURE["applications"]]
    assert all(set(v["answers"]) <= set(answer_columns) for v in vendors)
    assert all(v["answers"] for v in vendors)
    for question in questions:
        held = collections.Counter()
        for vendor in vendors:
            answer = vendor["answers"].get(question["key"], [])
            held.update(answer if isinstance(answer, list) else [answer])
        # A file's cell the form does not offer is kept, as an import may keep it, and is found by
        # no filter; an option nobody chose, a box nobody left unticked, finds nobody.
        assert set(question["options"]) & set(held), question["label"]
    # Every answer kept is someone's, so C11's filter finds a vendor by any of the 228.
    selling = {option for v in vendors for option in v["answers"]["what_kinds_of_work_will_you_sell"]}
    assert {o["label"] for o in FIXTURE["question"]["options"]} <= selling


def test_each_vendor_has_a_discord_state_in_the_exact_counts_dealt():
    vendors = [a["export"] for a in FIXTURE["applications"]]
    assert collections.Counter(v["discordState"] for v in vendors) == {
        "has_role": 180, "in_server": 70, "possible_match": 15, "not_found": 60,
        "no_username": 24, "check_again": 10}
    assert all(not v["discordUsername"] for v in vendors if v["discordState"] == "no_username")
    assert all(v["discordUsername"] for v in vendors if v["discordState"] != "no_username")


def test_a_seated_vendor_owes_for_each_seat_and_stands_in_the_exact_counts_dealt():
    seats = collections.defaultdict(list)
    for seat in FIXTURE["seats"]:
        seats[seat["application"]].append(seat)
    states = collections.Counter()
    for application in FIXTURE["applications"]:
        payment = application["export"]["payment"]
        states[payment["state"]] += 1
        if application["id"] not in seats:
            assert payment == {"group": "", "owed": "$0.00", "paid": "$0.00",
                               "stillOwed": "$0.00", "state": None}
            continue
        assert set(payment["group"].split(", ")) == {
            s["tier"] for s in seats[application["id"]]}
        assert payment["owed"] != "$0.00"
    assert states["owes"] == 40 and states["over"] == 5
    assert states["paid"] == len(seats) - 45
    assert states[None] == 359 - len(seats)


def test_it_holds_only_strings_numbers_and_the_shape_the_library_reads():
    assert sorted(FIXTURE) == [
        "applications", "export", "people", "question", "reviewers", "seats", "valuesToFix"]
    assert sorted(FIXTURE["applications"][0]) == [
        "business", "email", "export", "id", "name", "reviewer", "sells", "status"]
    assert sorted(FIXTURE["people"][0]) == ["email", "id", "name", "role"]
    assert sorted(FIXTURE["seats"][0]) == ["application", "date", "section", "table", "tier"]
    json.dumps(FIXTURE)
