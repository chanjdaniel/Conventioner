"""Hosted TypeSafe, asked the two questions a CSV proposal's rules leave (E24/F02/S03).

TypeSafe's Jev model reads a short text and picks one of the named choices with a probability. It
earned a place for exactly two judgements, measured in the form-started-from-a-CSV map (ticket 04):
whether a column after the form's questions is one of them or a column the market's staff added,
and what ceiling on days per vendor a header's prose states. The wordings below are the ones that
measured best; the model is pinned to the one they were measured on, since the 0.8 threshold the
proposal applies means nothing on another.

What may be sent is ticket 01's rule, and ``csv_proposal`` builds every state it hands over here;
this module only carries it. The key is optional and never a boot requirement: it is read through
``configured_secret`` when asked for, so a blank or published placeholder is no key, and no key
means the rules alone. A failure of any kind is the caller's to absorb: nothing here retries.

The service is called over plain HTTP rather than through its SDK: the SDK is pre-1.0 and requires
a newer pydantic than this back end runs, and one POST is all that is needed.
"""
import os
from dataclasses import dataclass
from typing import Callable, Dict, Optional

import requests

from utils.configured_secret import configured_secret

API_KEY_ENV = "TYPESAFE_API_KEY"
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
# How long a proposal waits for every answer together; past it, the rules stand.
DEADLINE_SECONDS = 5.0


@dataclass(frozen=True, eq=False)
class Question:
    """One of the two questions TypeSafe is asked, worded as it was measured. Each is one object,
    compared by identity."""
    instructions: str
    criteria: Dict[str, str]


# Wording "C" of ticket 04: neutral choice names, each side described by who writes the answers.
FORM_QUESTION, STAFF_COLUMN = "form_question", "review_column"
TEAM_COLUMN = Question(
    instructions=(
        "This column comes from a spreadsheet of vendor applications to a market. Is it one of "
        "the application form's questions, or a column the market's staff added to record their "
        "review of each application?"),
    criteria={
        FORM_QUESTION: "A question on the application form; each vendor wrote their own answer.",
        STAFF_COLUMN: "A column staff added afterwards; staff wrote the values about each vendor.",
    },
)

NO_CEILING = "none"
CEILING = Question(
    instructions=(
        "This is the text of a question on a multi-day market's vendor application form. What is "
        "the most days any single vendor may be assigned, if the text states such a limit?"),
    criteria={
        NO_CEILING: "The text states no limit on how many days one vendor may be assigned.",
        **{str(n): f"At most {n} day{'s' if n > 1 else ''} per vendor." for n in range(1, 11)},
    },
)

# state, instructions, criteria -> probability of each choice.
Asker = Callable[[str, str, Dict[str, str]], Dict[str, float]]


def configured_key() -> str:
    """The TypeSafe key, or "" when none is configured. Read when asked, never at import."""
    return configured_secret(os.getenv(API_KEY_ENV, ""))


def asker() -> Optional[Asker]:
    """Something that asks TypeSafe one question, or None when no key is configured."""
    key = configured_key()
    if not key:
        return None

    def ask(state: str, instructions: str, criteria: Dict[str, str]) -> Dict[str, float]:
        response = requests.post(
            URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"state": state, "model": MODEL,
                  "questions": {"q": {"type": "choice", "instructions": instructions,
                                      "criteria": criteria}}},
            timeout=DEADLINE_SECONDS,
        )
        response.raise_for_status()
        answer = response.json()["answers"]["q"]
        if answer.get("probabilities"):
            return dict(answer["probabilities"])
        return {answer["choice"]: answer["confidence"]}

    return ask
