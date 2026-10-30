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
import uuid
from typing import Any, Dict, List, NamedTuple, Optional, Union

from pymongo import ReturnDocument

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import history as History
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import ApplicationStatus, Market, MarketPerson, Organization, ReviewTeam
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


def choose(
    market: Market, organization: Optional[Organization], reviewers: List[MarketPerson], by: str,
) -> Chosen:
    """Make ``reviewers`` the market's review team and deal every open application among them.

    The team is written first, with its turn reset, then the pool is read and dealt round robin
    from the first able reviewer (``eligible``) in arrival order, and the turn moves on by the
    pool's size, so the next arrival goes to the reviewer after the last one dealt. The pool is
    every open application, and each follow-up whose owner was a reviewer and is not one now: it
    keeps its status and is handed to the reviewer it is dealt to, as its owner and its reviewer, so
    someone still reaches out. A follow-up owned by a reviewer still chosen, or by someone who
    never was one, and every decided application, are never written.

    Each write is conditioned on the application still being as the pool read it (open and dealt
    as it was, or the follow-up still owned by the removed reviewer), so a verdict or a hand-on
    landing mid-deal is never written over. An unchanged set writes and records nothing. With none
    chosen, every open application goes back to first come, first served, and every follow-up stays
    with its owner.
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

    able = eligible(market.model_copy(update={"review_team": team}), organization)
    removed = set(_addresses(before.reviewers)) - set(_addresses(chosen)) if chosen else set()
    pool = ApplicationsApi.undecided_in_arrival_order(market.id, follow_ups_of=removed)
    if chosen and not able:
        # Nobody chosen may review here: nothing is dealt until someone who can is chosen.
        return Chosen(team, 0)

    moved = []
    for index, doc in enumerate(pool):
        to = able[index % len(able)] if able else None
        was = doc.get("reviewer") or None
        if doc.get("status") == ApplicationStatus.NEEDS_FOLLOW_UP.value:
            owner = doc.get("follow_up_owner")
            if ApplicationsApi.deal_follow_up(doc["id"], to, owner):
                moved.append((doc, was, to, owner))
            continue
        if was == (to.model_dump() if to else None):
            continue
        if ApplicationsApi.deal(doc["id"], to, was):
            moved.append((doc, was, to, None))
    if able and pool:
        markets_collection.update_one({"id": market.id}, {"$inc": {_TURN: len(pool)}})
        team = team.model_copy(update={"turn": len(pool)})

    if moved:
        History.record(
            market.id, by, Actions.CHOOSE_REVIEWERS, kind=History.DEALT,
            vendors=[doc.get("applicant_email") for doc, *_rest in moved],
            subject={"application_ids": [doc["id"] for doc, *_rest in moved]},
            detail=lambda: {
                "cause": REVIEWERS_CHANGED,
                "before": {doc["id"]: _share(was, owner) for doc, was, _to, owner in moved},
                "after": {doc["id"]: _share(to.model_dump() if to else None,
                                            to.model_dump() if owner else None)
                          for doc, _was, to, owner in moved},
            })
    return Chosen(team, len(moved))


def _share(reviewer: Optional[Dict[str, Any]], owner: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """An application's place in a deal's entry: its reviewer, and a follow-up's owner beside it."""
    return {"reviewer": _address(reviewer),
            **({"follow_up_owner": _address(owner)} if owner else {})}


def _address(person: Optional[Dict[str, Any]]) -> Optional[str]:
    return (person or {}).get("email") or None


def deal_arrivals(
    market: Market, actor: Optional[str], action: Union[Actions.Action, str],
    only: Optional[str] = None,
) -> int:
    """Deal every open application that has no reviewer to the next reviewer in turn, in the
    order they arrived (E38/F07/S03), and record one ``dealt`` entry under ``action`` and ``actor``
    when it dealt any. ``only`` narrows it to one application: an applicant's save deals theirs and
    no one else's, so the record never names a vendor as dealing another's. Answers how many it
    dealt.

    Called after every write that can leave an application open and undealt - an applicant's save,
    an import, and the writes whose automatic rejections can return one to open - once that
    write's rules have judged, so an application a rule rejected on arrival is not dealt. With no
    reviewers chosen it reads and writes nothing.

    Each application is first won for this deal (``begin_dealing``: still open, with no reviewer,
    and no other deal holding it), and only then takes its turn, in one atomic update of the market
    (``$inc`` on the turn, answering the market after), from the team as it stands at that instant.
    So a turn is taken only for an application this deal will write, and two deals at once take
    consecutive turns and skip no reviewer. The reviewer is written unless a change of reviewers
    dealt the application meanwhile, when the turn goes back; it is written whatever verdict was
    given since the deal won it, since a reviewer is whose share it was, beside any verdict.
    """
    if not team_of(market).reviewers:
        return 0
    pool = [doc for doc in ApplicationsApi.undecided_in_arrival_order(market.id)
            if not doc.get("reviewer") and (only is None or doc["id"] == only)]
    if not pool:
        return 0
    holding = set(PermissionsApi.people_with_market_role(market, _organization(market)))
    deal = str(uuid.uuid4())
    dealt = []
    for doc in pool:
        if not ApplicationsApi.begin_dealing(doc["id"], deal):
            continue
        stored = markets_collection.find_one_and_update(
            {"id": market.id}, {"$inc": {_TURN: 1}}, return_document=ReturnDocument.AFTER)
        team = ReviewTeam(**convert_keys_to_snake_case(
            market_doc_field(stored or {}, "review_team") or {}))
        able = [person for person in team.reviewers if person.user_id in holding]
        if not able:
            # Nobody may review here: the turn is not one anybody had, so it goes back.
            markets_collection.update_one(
                {"id": market.id, _TURN: team.turn}, {"$inc": {_TURN: -1}})
            ApplicationsApi.finish_dealing(doc["id"], deal, None)
            break
        to = able[(team.turn - 1) % len(able)]
        if ApplicationsApi.finish_dealing(doc["id"], deal, to):
            dealt.append((doc, to))
        else:
            # A change of reviewers dealt it meanwhile: the turn this took is nobody's, so it goes
            # back unless another deal has taken one since.
            markets_collection.update_one(
                {"id": market.id, _TURN: team.turn}, {"$inc": {_TURN: -1}})
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
