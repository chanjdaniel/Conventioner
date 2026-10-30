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
import logging
from typing import Any, Dict, List, NamedTuple, Optional, Union

from pymongo import ReturnDocument

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import history as History
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import Market, MarketPerson, Organization, ReviewTeam
from db_config import get_database
from market_documents import market_doc_field, market_doc_key, market_doc_set
from utils.email_address import normalized_email

logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

#: Why a deal moved what it moved, in its history entry: a change of reviewers, or arrivals.
REVIEWERS_CHANGED = "reviewers_changed"
ARRIVED = "arrived"

_TURN = f"{market_doc_key('review_team')}.turn"


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


def deal_arrivals(market: Market, actor: Optional[str], action: Union[Actions.Action, str]) -> int:
    """Deal every open application that has no reviewer to the next reviewer in turn, in the
    order they arrived (E38/F07/S03), and record one ``dealt`` entry under ``action`` and ``actor``
    when it dealt any. Answers how many it dealt.

    Called after every write that can leave an application open and undealt - an applicant's save,
    an import, and the writes whose automatic rejections can return one to open - once that
    write's rules have judged, so an application a rule rejected on arrival is not dealt. With no
    reviewers chosen it reads and writes nothing.

    Each application takes its turn in one atomic update of the market (``$inc`` on the turn,
    answering the market after), so two applications arriving at once are dealt different turns,
    from the team as it stands at that instant. Its write is conditioned on it still being open
    with no reviewer: one a concurrent deal or a verdict reached first is left as it is, and the
    turn it took is given back unless another deal has taken one since.
    """
    if not team_of(market).reviewers:
        return 0
    pool = [doc for doc in ApplicationsApi.undecided_in_arrival_order(market.id)
            if not doc.get("reviewer")]
    if not pool:
        return 0
    holding = set(PermissionsApi.people_with_market_role(market, _organization(market)))
    dealt = []
    for doc in pool:
        stored = markets_collection.find_one_and_update(
            {"id": market.id}, {"$inc": {_TURN: 1}}, return_document=ReturnDocument.AFTER)
        team = ReviewTeam(**convert_keys_to_snake_case(
            market_doc_field(stored or {}, "review_team") or {}))
        able = [person for person in team.reviewers if person.user_id in holding]
        to = able[(team.turn - 1) % len(able)] if able else None
        if to is not None and ApplicationsApi.deal(doc["id"], to, None):
            dealt.append((doc, to))
            continue
        markets_collection.update_one(
            {"id": market.id, _TURN: team.turn}, {"$inc": {_TURN: -1}})
        if to is None:
            break
    if dealt:
        History.record(
            market.id, actor, action, kind=History.DEALT,
            vendors=[doc.get("applicant_email") for doc, _to in dealt],
            subject={"application_ids": [doc["id"] for doc, _to in dealt]},
            detail=lambda: {
                "cause": ARRIVED,
                "before": {doc["id"]: {"reviewer": None} for doc, _to in dealt},
                "after": {doc["id"]: {"reviewer": to.email} for doc, to in dealt},
            })
    return len(dealt)


def _organization(market: Market) -> Optional[Organization]:
    """The market's organization, whose people hold roles on it too; None when it has none."""
    if not market.organization_id:
        return None
    found = OrgsApi.get_organization(market.organization_id)
    if not found:
        return None
    try:
        return Organization(**{key: value for key, value in found.items() if key != "_id"})
    except Exception:
        logger.warning("Stored organization %s failed validation", market.organization_id)
        return None
