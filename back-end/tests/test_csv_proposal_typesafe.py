"""Hosted TypeSafe settles the two questions the rules leave (E24/F02/S03).

Nothing here reaches TypeSafe: every test hands the proposal a stub that records what it was asked
and answers as told. What may be sent is ticket 01's rule, and it is asserted on what the stub
received: one column per call, never a row, no answer fewer than 3 applicants gave, no email or
link, and only the two questions.
"""
import csv
import os
import re
import time

import pytest

import csv_proposal as CsvProposal
import typesafe_client as TypeSafe

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")

TEAM_NOTES = "Comments (internal)"
LIMIT = "Max days\nYou will be limited to 2 days in total."


class Stub:
    """Answers every call with ``answers[question]``: a probabilities dict, an exception to raise,
    or a number of seconds to sleep past the deadline."""

    def __init__(self, **answers):
        self.answers = answers
        self.calls = []

    def __call__(self, state, instructions, criteria):
        question = "team" if instructions == TypeSafe.TEAM_COLUMN_INSTRUCTIONS else "ceiling"
        self.calls.append({"state": state, "instructions": instructions, "criteria": criteria,
                           "question": question})
        answer = self.answers[question]
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, (int, float)):
            time.sleep(answer)
            return {}
        return answer


def _file():
    """A small export whose last column is a team's notes, headed like a question, with one
    note naming an applicant's email, and a header stating a ceiling the rules cannot read."""
    headers = ["Timestamp", "Email Address", "Full Name", "Business name", LIMIT, TEAM_NOTES]
    rows = []
    for i in range(12):
        note = ["", "", "", "chase payment", "chase payment", "chase payment", "",
                f"emailed p{i}@mail.test about the booth", "", "", "late form", ""][i]
        rows.append([f"1/{i + 1}/2026 9:00:00", f"p{i}@mail.test", f"Wren Okafor{i}",
                     f"Shop {i}", "2 days" if i % 2 else "1 day", note])
    return headers, rows


def _propose(asker):
    headers, rows = _file()
    return CsvProposal.proposal(headers, rows, None, asker=asker)


TEAM = {"form_question": 0.05, "review_column": 0.95}
FORM = {"form_question": 0.97, "review_column": 0.03}
TWO = {"none": 0.02, "2": 0.93}


class TestWithoutAKey:
    def test_the_proposal_is_the_rules_alone(self):
        headers, rows = _file()
        assert CsvProposal.proposal(headers, rows) == _propose(None)

    def test_no_key_and_a_placeholder_key_mean_no_asker(self, monkeypatch):
        monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
        assert TypeSafe.asker() is None
        monkeypatch.setenv("TYPESAFE_API_KEY", "your-typesafe-key")
        assert TypeSafe.asker() is None
        monkeypatch.setenv("TYPESAFE_API_KEY", "   ")
        assert TypeSafe.asker() is None

    def test_nothing_is_sent_when_there_is_no_key(self, monkeypatch):
        monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

        def refuse(*args, **kwargs):
            raise AssertionError("nothing may be sent without a key")

        monkeypatch.setattr(TypeSafe.requests, "post", refuse)
        headers, rows = _file()
        market = {"id": "m", "phase": "draft", "applicationForm": {"fields": []}}
        csv_text = "\n".join(",".join(f'"{cell}"' for cell in row) for row in [headers] + rows)
        result, status = CsvProposal.propose(market, csv_text)
        assert status == 200 and result["typesafe"] == {"asked": False}


class TestWhatIsSent:
    def test_only_the_two_questions_are_asked(self):
        stub = Stub(team=FORM, ceiling=TWO)
        _propose(stub)
        assert {call["instructions"] for call in stub.calls} <= {
            TypeSafe.TEAM_COLUMN_INSTRUCTIONS, TypeSafe.CEILING_INSTRUCTIONS}
        assert {call["question"] for call in stub.calls} == {"team", "ceiling"}

    def test_each_call_is_one_column_and_no_row(self):
        stub = Stub(team=FORM, ceiling=TWO)
        _propose(stub)
        headers, rows = _file()
        for call in stub.calls:
            # What is quoted is one header, or one sentence of one.
            quoted = re.search(r'"(.+?)"\n?', call["state"]).group(1)
            assert sum(1 for h in headers if quoted in " ".join(h.split())) == 1
            for row in rows:
                # No two of one applicant's answers ever travel together.
                assert sum(1 for cell in row if cell and cell in call["state"]) <= 1

    def test_no_answer_fewer_than_three_applicants_gave_and_no_email_or_link(self):
        stub = Stub(team=FORM, ceiling=TWO)
        _propose(stub)
        team = next(call for call in stub.calls if call["question"] == "team")
        assert "chase payment" in team["state"]
        assert "late form" not in team["state"]
        for call in stub.calls:
            assert "@" not in call["state"]
            assert not re.search(r"https?://|www\.", call["state"])

    def test_the_team_question_is_asked_only_where_the_rules_have_nothing_to_say(self):
        stub = Stub(team=FORM, ceiling=TWO)
        _propose(stub)
        asked = [call["state"] for call in stub.calls if call["question"] == "team"]
        assert len(asked) == 1 and TEAM_NOTES in asked[0]

    def test_the_ceiling_is_not_asked_when_the_rules_read_it(self):
        headers, rows = _file()
        headers[4] = "Max days\nYou may book up to 2 days."
        stub = Stub(team=FORM, ceiling=TWO)
        CsvProposal.proposal(headers, rows, None, asker=stub)
        assert all(call["question"] != "ceiling" for call in stub.calls)


class TestWhatTheAnswersDo:
    def test_a_confident_team_column_is_left_out_and_marked(self):
        column = _propose(Stub(team=TEAM, ceiling=TWO))["columns"][5]
        assert column["fate"] == "left_out" and column["leftOut"] == "organizer"
        assert CsvProposal.CHECK_ORGANIZER in column["check"]

    def test_a_confident_form_question_stays_as_the_rules_had_it(self):
        column = _propose(Stub(team=FORM, ceiling=TWO))["columns"][5]
        assert column["fate"] == "custom" and column["check"] == []

    def test_a_confident_ceiling_is_proposed_with_its_sentence(self):
        ceiling = _propose(Stub(team=FORM, ceiling=TWO))["plan"]["ceiling"]
        assert ceiling["days"] == 2
        assert ceiling["sentence"] == "You will be limited to 2 days in total."
        assert ceiling["from"] == "typesafe"

    @pytest.mark.parametrize("answer, reason", [
        ({"form_question": 0.6, "review_column": 0.4}, CsvProposal.CHECK_MAYBE_TEAM),
        (RuntimeError("503"), CsvProposal.CHECK_UNREACHABLE),
        (TypeSafe.DEADLINE_SECONDS + 1, CsvProposal.CHECK_UNREACHABLE),
    ])
    def test_an_unsure_answer_an_error_or_a_timeout_leaves_the_rules_answer(self, answer, reason):
        started = time.monotonic()
        proposal = _propose(Stub(team=answer, ceiling=answer))
        assert time.monotonic() - started < TypeSafe.DEADLINE_SECONDS + 1
        column = proposal["columns"][5]
        assert column["fate"] == "custom" and reason in column["check"]
        assert proposal["plan"]["ceiling"] is None
        ceiling_reason = CsvProposal.CHECK_CEILING_UNSURE \
            if reason == CsvProposal.CHECK_MAYBE_TEAM else CsvProposal.CHECK_UNREACHABLE
        assert ceiling_reason in proposal["plan"]["check"]


def test_the_corpus_asks_only_where_the_rules_leave_something():
    """On the five exports every ceiling the rules can read is read, and the team question is
    asked of a handful of trailing optional text columns at most."""
    for name in ("fall-2023", "spring-2024", "spring-2025", "fall-2025", "spring-2026"):
        with open(os.path.join(CORPUS, f"{name}.csv"), newline="", encoding="utf-8") as handle:
            rows = list(csv.reader(handle))
        stub = Stub(team=FORM, ceiling={"none": 0.99})
        proposal = CsvProposal.proposal([h.strip() for h in rows[0]], rows[1:], None, asker=stub)
        assert sum(1 for call in stub.calls if call["question"] == "team") <= 3, name
        assert proposal["typesafe"] == {"asked": bool(stub.calls)}


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.mark.parametrize("template", [".env.example", "back-end/.env.example"])
def test_both_env_templates_ship_the_key_blank(template):
    with open(os.path.join(ROOT, template), encoding="utf-8") as handle:
        lines = [line.strip() for line in handle if line.startswith("TYPESAFE_API_KEY")]
    assert lines == ["TYPESAFE_API_KEY="]
