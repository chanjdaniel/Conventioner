"""Single owner of dealing a market's review among the reviewers chosen for it (E38/F07, ADR 0020).

An Admin or the owner chooses reviewers, and the open applications (the undecided:
``UNDECIDED_STATUSES``) are dealt among them round robin, in the order the applications arrived and
the order the reviewers' addresses sort, so the deal is the same whoever chose them and a test can
predict it. A deal never counts what each reviewer has left open: being quick earns nobody more.

The team is stored on the market (``Market.review_team``, ``reviewTeam``), and each application's
share on it (``Application.reviewer``). Nothing else writes either: the routes call this module.
The reviewer is whose share it is; who is looking at it now is the claim of ADR 0014, which a deal
never moves.

With no reviewers chosen, everything is first come, first served, as before this existed.
"""
from typing import Any, Dict, List, NamedTuple, Optional

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.permissions as PermissionsApi
import history as History
from assignment.utils import convert_keys_to_camel_case
from datatypes import Market, MarketPerson, Organization, ReviewTeam
from db_config import get_database
from market_documents import market_doc_key, market_doc_set
from utils.email_address import normalized_email

db = get_database()
markets_collection = db["markets"]

#: Why a deal moved what it moved, in its history entry.
REVIEWERS_CHANGED = "reviewers_changed"


class Chosen(NamedTuple):
    """What a choice left: the team as it now stands, and how many applications it moved."""
    team: ReviewTeam
    dealt: int


def team_of(market: Market) -> ReviewTeam:
    """The market's reviewers; none when none were ever chosen."""
    return market.review_team or ReviewTeam()


def in_deal_order(people: List[MarketPerson]) -> List[MarketPerson]:
    """The people in the order a deal hands out to them: by address, each once."""
    by_address = {normalized_email(person.email): person for person in people}
    return [by_address[address] for address in sorted(by_address)]


def _addresses(people: List[MarketPerson]) -> List[str]:
    return [normalized_email(person.email) for person in people]


def eligible(market: Market, organization: Optional[Organization]) -> List[MarketPerson]:
    """The chosen reviewers who may still review here: those who still hold a role on the market."""
    holding = set(PermissionsApi.people_with_market_role(market, organization))
    return [person for person in team_of(market).reviewers if person.user_id in holding]


def served(
    team: ReviewTeam, market: Market, organization: Optional[Organization],
) -> Dict[str, Any]:
    """The reviewers as every reader of the market is served them, each with whether they may still
    review here; the turn is the deal's own and is never served."""
    able = {person.user_id for person in eligible(market.model_copy(update={"review_team": team}),
                                                   organization)}
    return {"reviewers": [
        {"email": person.email, "able": person.user_id in able} for person in team.reviewers
    ]}


def choose(market: Market, reviewers: List[MarketPerson], by: str) -> Chosen:
    """Make ``reviewers`` the market's review team and deal every open application among them.

    The team is written first, with its turn reset, then the open applications are read and dealt
    round robin from the first reviewer in arrival order, and the turn moves on by as many as were
    dealt, so the next arrival goes to the reviewer after the last one dealt. Each application's
    write is conditioned on it still being open and still dealt as it was read, so a verdict landing
    mid-deal is never touched. A decided application and a follow-up are never written.

    An unchanged set writes and records nothing. With none chosen, every open application goes
    back to first come, first served.
    """
    before = team_of(market)
    chosen = in_deal_order(reviewers)
    if _addresses(chosen) == _addresses(before.reviewers):
        return Chosen(before, 0)

    team = ReviewTeam(reviewers=chosen, turn=0)
    markets_collection.update_one(
        {"id": market.id},
        market_doc_set("review_team", convert_keys_to_camel_case(team.model_dump())))
    History.record(
        market.id, by, Actions.CHOOSE_REVIEWERS, kind=History.REVIEWERS,
        detail=lambda: History.changes(
            {"reviewers": _addresses(before.reviewers)}, {"reviewers": _addresses(chosen)}))

    pool = ApplicationsApi.undecided_in_arrival_order(market.id)
    moved = []
    for index, doc in enumerate(pool):
        to = chosen[index % len(chosen)] if chosen else None
        was = doc.get("reviewer") or None
        if was == (to.model_dump() if to else None):
            continue
        if ApplicationsApi.deal(doc["id"], to, was):
            moved.append((doc, was, to))
    if chosen and pool:
        markets_collection.update_one(
            {"id": market.id}, {"$inc": {f"{market_doc_key('review_team')}.turn": len(pool)}})
        team = team.model_copy(update={"turn": len(pool)})

    if moved:
        History.record(
            market.id, by, Actions.CHOOSE_REVIEWERS, kind=History.DEALT,
            vendors=[doc.get("applicant_email") for doc, _was, _to in moved],
            subject={"application_ids": [doc["id"] for doc, _was, _to in moved]},
            detail=lambda: {
                "cause": REVIEWERS_CHANGED,
                "before": {doc["id"]: {"reviewer": _address(was)} for doc, was, _to in moved},
                "after": {doc["id"]: {"reviewer": to.email if to else None}
                          for doc, _was, to in moved},
            })
    return Chosen(team, len(moved))


def _address(person: Optional[Dict[str, Any]]) -> Optional[str]:
    return (person or {}).get("email") or None
