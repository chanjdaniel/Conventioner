#!/usr/bin/env python3
"""The component library's data, derived from the committed synthetic Google Form exports.

Why this exists: the development-only component library (``front-end/src/dev/library/``) is where
each large-list pattern is judged before any screen takes it, and a pattern only shows what it does
at the size a real market reaches: 359 applications, 150 people with access, a choice question
with 228 different answers (T191's F12 survey). Typing that by hand would be invented data, and
copying a real export would publish applicants, so every value here comes from the synthetic
exports in ``tests/test_data/google_forms/``, which ``synthetic_form_exports.py`` made, read with
the product's own readers:

- the files are read with ``csv_import.parse_csv``, as an import reads them, and each application's
  time from the column the proposal reads as when it arrived, by ``normalized_submitted_at``, as
  the import stores it;
- a choice column's answers are split and counted by ``csv_proposal.proposal``, as starting a
  market from the file splits them;
- the export's columns and filters are ``api.vendor_export``'s ``offered_columns`` and
  ``offered_questions`` for a market started from the four-day grid by ``csv_start``, built in
  memory, so every column label and group is the one the product offers, and each vendor's answers
  to them are read from the file's cells as ``csv_import`` reads them for that market.

What no file holds (each application's status and reviewer, each person's role, who reviews, who
sits where, each vendor's Discord state and what they have paid) is dealt here from a seeded
``random.Random``, in the exact counts stated below, so the output is the same bytes every run.
``tests/test_component_library_fixture.py`` fails when the committed JSON is not exactly what this
makes. Change the data by changing this file, never the JSON.

Usage, from ``back-end/``:
    python tests/fixtures/component_library_fixture.py
"""
import copy
import json
import os
import random
import sys
from typing import Any, Dict, List

BACK_END = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACK_END not in sys.path:
    sys.path.insert(0, BACK_END)

import api.discord_connection as DiscordApi  # noqa: E402
import api.vendor_export as VendorExport  # noqa: E402
import csv_import as CsvImport  # noqa: E402
import csv_proposal as CsvProposal  # noqa: E402
import csv_start as CsvStart  # noqa: E402
import essential_fields as EssentialFields  # noqa: E402
import payments as Payments  # noqa: E402
import pricing as Pricing  # noqa: E402
from market_documents import market_from_document  # noqa: E402

CORPUS = os.path.join(BACK_END, "tests", "test_data", "google_forms")
OUTPUT = os.path.join(os.path.dirname(BACK_END), "front-end", "src", "dev", "library",
                      "fixture.json")

SEED = 200

#: The applications' file, its question and the year its dates fall in.
APPLICATIONS_FILE = "four-day-grid.csv"
APPLICATIONS_YEAR = 2024
QUESTION = "What kinds of work will you sell?"

#: The people's file, and its question whose answers the fixture's question does not offer.
PEOPLE_FILE = "five-day-grid.csv"
PEOPLE_QUESTION = "What do you plan to sell at the fair?"
PEOPLE = 150

#: How the applications stand, in the review's statuses: 359 in all.
STATUSES = [
    ("open", 110),
    ("needs_follow_up", 25),
    ("reviewer_approved", 160),
    ("reviewer_rejected", 64),
]

#: The market roles the 150 people hold.
ROLES = [("owner", 1), ("admin", 4), ("editor", 45), ("viewer", 100)]

#: Who reviews: people who may decide an application, never a viewer.
REVIEWERS = 12
MAY_REVIEW = ("owner", "admin", "editor")

#: The venue's two sections, their tables (the November plan's sizes) and their tiers, filled on
#: every date.
SECTIONS = [("North Wing", 31, "Gold"), ("South Wing", 28, "Silver")]

#: The most dates one vendor holds a seat on.
MOST_DATES = 3

#: The Discord connection the export's market has, so the export offers its Discord columns.
DISCORD_CHECKED_AT = "2024-04-01T12:00:00Z"
DISCORD_INVITE = "https://discord.example.test/invite/makers-fair"

#: Where the 359 stand on Discord, as the Vendors page shows it. Those with no username have none.
DISCORD_STATES = [
    (DiscordApi.HAS_ROLE, 180),
    (DiscordApi.IN_SERVER, 70),
    (DiscordApi.POSSIBLE_MATCH, 15),
    (DiscordApi.NOT_FOUND, 60),
    (DiscordApi.NO_USERNAME, 24),
    (DiscordApi.CHECK_AGAIN, 10),
]

#: What a table costs for a day, by tier, and in what.
PRICE_CENTS = {"Gold": 5000, "Silver": 3000}
CURRENCY = Pricing.DEFAULT_CURRENCY

#: How the seated vendors stand with what they owe: these two counts, and the rest paid in full.
OWING = 40
PAID_MORE = 5
#: What those owing have paid, as a share of it, and what those paying more paid beyond it.
OWING_PAID_PERCENT = 50
PAID_MORE_BY_CENTS = 1000


def _read(name: str):
    with open(os.path.join(CORPUS, name), encoding="utf-8") as handle:
        text = handle.read()
    error, headers, rows = CsvImport.parse_csv(text)
    if error:
        raise SystemExit(f"{name}: {error}")
    return text, headers, rows


def _proposed(proposal: Dict[str, Any], label: str) -> Dict[str, Any]:
    """The proposal's row for the column whose question reads ``label``."""
    return next(column for column in proposal["columns"]
                if column["field"] and column["field"]["label"] == label)


def _who(proposal: Dict[str, Any]):
    """The columns of the applicant's full name and address, as the proposal reads them: a file
    may have two "Email Address" columns, and the proposal knows which is the applicant's."""
    columns = proposal["columns"]
    name = next(c["index"] for c in columns if c["essential"] == EssentialFields.FULL_NAME_KEY)
    email = next(c["index"] for c in columns if c["fate"] == CsvProposal.FATE_APPLICANT_EMAIL)
    return name, email


def _dealt(rng: random.Random, items: List[Any], counts) -> Dict[Any, str]:
    """Each item dealt one of ``counts``' values, exactly as many as each count says."""
    assert len(items) == sum(count for _value, count in counts), "the counts must cover every item"
    shuffled = list(items)
    rng.shuffle(shuffled)
    dealt, start = {}, 0
    for value, count in counts:
        for item in shuffled[start:start + count]:
            dealt[item] = value
        start += count
    return dealt


def _named(proposal: Dict[str, Any], rows) -> List[List[str]]:
    """The rows of the applications: those with a full name and an address."""
    name, email = _who(proposal)
    return [row for row in rows if row[name].strip() and row[email].strip()]


def _applications(rng: random.Random, proposal: Dict[str, Any], named,
                  reviewers: List[str]) -> List[Dict[str, Any]]:
    name, email = _who(proposal)
    arrived = next(c["index"] for c in proposal["columns"]
                   if c["fate"] == CsvProposal.FATE_SUBMITTED_AT)
    business = _proposed(proposal, "Business Name")["index"]
    sells = _proposed(proposal, QUESTION)["index"]
    ids = [f"a{index:03d}" for index in range(1, len(named) + 1)]
    status = _dealt(rng, ids, STATUSES)
    order = list(ids)
    rng.shuffle(order)
    reviewer = {app_id: reviewers[index % len(reviewers)] for index, app_id in enumerate(order)}
    return [
        {"id": app_id, "name": row[name].strip(), "email": row[email].strip(),
         "business": row[business].strip(), "sells": row[sells].strip(),
         "submittedAt": CsvImport.normalized_submitted_at(row[arrived]),
         "status": status[app_id], "reviewer": reviewer[app_id]}
        for app_id, row in zip(ids, named)
    ]


def _people(rng: random.Random, proposal: Dict[str, Any], rows) -> List[Dict[str, Any]]:
    name, email = _who(proposal)
    seen, people = set(), []
    for row in rows:
        address = row[email].strip()
        if not row[name].strip() or not address or address.lower() in seen:
            continue
        seen.add(address.lower())
        people.append({"id": f"p{len(people) + 1:03d}", "name": row[name].strip(),
                       "email": address})
        if len(people) == PEOPLE:
            break
    role = _dealt(rng, [person["id"] for person in people], ROLES)
    return [{**person, "role": role[person["id"]]} for person in people]


def _seats(rng: random.Random, applications, dates: List[str]) -> List[Dict[str, Any]]:
    approved = [a["id"] for a in applications if a["status"] == "reviewer_approved"]
    held = {app_id: 0 for app_id in approved}
    seats = []
    for date in dates:
        free = [app_id for app_id in approved if held[app_id] < MOST_DATES]
        rng.shuffle(free)
        for section, tables, tier in SECTIONS:
            for table in range(1, tables + 1):
                app_id = free.pop()
                held[app_id] += 1
                seats.append({"date": date, "section": section, "table": table, "tier": tier,
                              "application": app_id})
    return seats


def _market_document(text: str, question_column: Dict[str, Any]) -> Dict[str, Any]:
    """A market started from the file, with every answer to the fixture's question kept and Discord
    connected and checked."""
    draft = {"id": "market-library", "name": "Example Makers Fair", "creationDate": "2024-01-01",
             "roles": {"user-library": "owner"}, "modificationList": [], "assignmentObject": {},
             "phase": "draft", "isDraft": True, "applicationForm": {"fields": []}}
    every_answer = [option["value"] for option in question_column["field"]["options"]]
    body = {"year": APPLICATIONS_YEAR,
            "rows": [{"column": question_column["index"], "kept": every_answer}]}
    market_doc = copy.deepcopy(draft)
    market_doc.update(CsvStart.confirmed_update(draft, text, body).update)
    username = next(field["key"] for field in market_doc["applicationForm"]["fields"]
                    if field["type"] == "text" and "discord" in field["label"].lower())
    market_doc["discord"] = {"usernameQuestion": username, "checkedAt": DISCORD_CHECKED_AT,
                             "inviteLink": DISCORD_INVITE}
    return market_doc


def _export(market_doc: Dict[str, Any]) -> Dict[str, Any]:
    """What the product's preview offers the dialog for this market (``preview``'s ``offered``),
    but for its sections, tiers and payment states, which the started market has not set yet and
    the fixture's seats and payments hold, and the Discord invite link every row exports."""
    market = market_from_document(market_doc)
    return {
        "groups": [{"id": group, "label": label} for group, label in VendorExport.GROUPS],
        "columns": [{"id": column.id, "label": column.label, "group": column.group}
                    for column in VendorExport.offered_columns(market)],
        "defaultColumns": VendorExport.DEFAULT_COLUMNS,
        "statuses": [{"id": status, "label": label} for status, label in VendorExport.STATUSES],
        "dates": [d["date"] for d in market_doc["setupObject"]["marketDates"]],
        "sections": [section for section, _tables, _tier in SECTIONS],
        "tiers": [tier for _section, _tables, tier in SECTIONS],
        "questions": [{"key": q["key"], "label": q["label"], "options": q["options"]}
                      for q in VendorExport.offered_questions(market)],
        "discordStates": VendorExport.offered_discord_states(market),
        "paymentStates": [{"id": state, "label": label}
                          for state, label in Payments.BALANCE_STATES.items()],
        "discordInvite": DISCORD_INVITE,
    }


def _answer_readers(proposal: Dict[str, Any], market_doc: Dict[str, Any]):
    """How to read each of the form's own questions out of a row, as the import reads its cell."""
    market = market_from_document(market_doc)
    targets = {target.key: target for target in CsvImport.import_targets(market_doc)}
    fields = {field["key"]: field for field in market_doc["applicationForm"]["fields"]}
    return [(question.key, _proposed(proposal, question.label)["index"], targets[question.key],
             fields[question.key], list(question.options or []))
            for question in VendorExport._organizers_questions(market)]


def _answers(readers, row: List[str]) -> Dict[str, Any]:
    """A row's answers as the export reads them: a multi-select's options, any other as its cell
    (``answer_text``), and a question the row leaves empty left out."""
    answers = {}
    for key, index, target, field, known in readers:
        value = CsvImport._coerce(target, row[index], field, known)
        kept = value if isinstance(value, list) else VendorExport.answer_text(value)
        if kept:
            answers[key] = kept
    return answers


def _payments(rng: random.Random, applications, seats) -> Dict[str, Dict[str, Any]]:
    """What each application owes for its seats and has paid, written as the export writes it."""
    owed: Dict[str, int] = {a["id"]: 0 for a in applications}
    tiers: Dict[str, Dict[str, None]] = {a["id"]: {} for a in applications}
    for seat in seats:
        owed[seat["application"]] += PRICE_CENTS[seat["tier"]]
        tiers[seat["application"]][seat["tier"]] = None
    seated = [a["id"] for a in applications if owed[a["id"]]]
    stands = _dealt(rng, seated, [("owes", OWING), ("over", PAID_MORE),
                                  ("paid", len(seated) - OWING - PAID_MORE)])

    def paid_cents(app_id: str) -> int:
        stand = stands.get(app_id)
        if stand == "owes":
            return owed[app_id] * OWING_PAID_PERCENT // 100
        if stand == "over":
            return owed[app_id] + PAID_MORE_BY_CENTS
        return owed[app_id]

    def payment(app_id: str) -> Dict[str, Any]:
        paid = paid_cents(app_id)
        account = {"currency": CURRENCY, "owedCents": owed[app_id], "paidCents": paid}
        return {"group": ", ".join(tiers[app_id]),
                "owed": VendorExport.money_cell(owed[app_id], CURRENCY),
                "paid": VendorExport.money_cell(paid, CURRENCY),
                "stillOwed": VendorExport.money_cell(owed[app_id] - paid, CURRENCY),
                "state": Payments.balance_state(account)}

    return {app_id: payment(app_id) for app_id in owed}


def _with_export(rng: random.Random, applications, named, proposal: Dict[str, Any],
                 market_doc: Dict[str, Any], seats) -> None:
    """Gives each application what the export's other columns and filters read of a vendor."""
    columns = proposal["columns"]
    preferred = next(c["index"] for c in columns
                     if c["essential"] == EssentialFields.PREFERRED_NAME_KEY)
    username = next(field["label"] for field in market_doc["applicationForm"]["fields"]
                    if field["key"] == market_doc["discord"]["usernameQuestion"])
    username_at = _proposed(proposal, username)["index"]
    readers = _answer_readers(proposal, market_doc)
    states = _dealt(rng, [a["id"] for a in applications], DISCORD_STATES)
    payments = _payments(rng, applications, seats)
    for application, row in zip(applications, named):
        state = states[application["id"]]
        application["export"] = {
            "preferredName": row[preferred].strip(),
            "answers": _answers(readers, row),
            "discordUsername": ("" if state == DiscordApi.NO_USERNAME
                                else DiscordApi.tidied_username(row[username_at])),
            "discordState": state,
            "payment": payments[application["id"]],
        }


def fixture() -> Dict[str, Any]:
    rng = random.Random(SEED)
    text, headers, rows = _read(APPLICATIONS_FILE)
    _people_text, people_headers, people_rows = _read(PEOPLE_FILE)

    proposal = CsvProposal.proposal(headers, rows)
    people_proposal = CsvProposal.proposal(people_headers, people_rows)

    people = _people(rng, people_proposal, people_rows)
    may_review = [person["id"] for person in people if person["role"] in MAY_REVIEW]
    reviewers = sorted(rng.sample(may_review, REVIEWERS))
    named = _named(proposal, rows)
    applications = _applications(rng, proposal, named, reviewers)

    question_column = _proposed(proposal, QUESTION)
    options = question_column["field"]["options"]
    offered = {option["value"] for option in options}
    their_answers = _proposed(people_proposal, PEOPLE_QUESTION)["field"]["options"]

    market_doc = _market_document(text, question_column)
    export = _export(market_doc)
    seats = _seats(rng, applications, export["dates"])
    _with_export(rng, applications, named, proposal, market_doc, seats)
    return {
        "applications": applications,
        "people": people,
        "reviewers": reviewers,
        "question": {"label": QUESTION,
                     "options": [{"label": o["value"], "count": o["count"]} for o in options]},
        "valuesToFix": [o["value"] for o in their_answers if o["value"] not in offered],
        "seats": seats,
        "export": export,
    }


def fixture_bytes() -> bytes:
    return (json.dumps(fixture(), indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def main() -> None:
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "wb") as handle:
        handle.write(fixture_bytes())
    print(f"wrote {os.path.relpath(OUTPUT, os.path.dirname(BACK_END))}")


if __name__ == "__main__":
    main()
