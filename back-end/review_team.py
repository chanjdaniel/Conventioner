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

**Every deal holds the market** (``reviewTeam.dealing``, a short lease, ``_hold``): a change of
reviewers from writing its team to writing its turn, and a deal of arrivals from reading the turn
to writing it. So the turn is only ever read and written by the one deal holding the market, and no
interleaving of a change and an arrival can deal an application twice or skip a reviewer. An
arrival never waits for the market: it marks its application as arriving
(``ApplicationsApi.mark_arriving``) and deals every application so marked if it can hold the
market; if it cannot, the deal holding it deals them when it lets go (``_settle``), since an
application is marked before its arrival tries to hold, and every holder looks for marked ones
after letting go. A holder the host ended never lets go: its lease runs out, and the next deal
deals what it left, which a reviewer's next card starts (``deal_waiting``), so a quiet spell after
it leaves no reviewer's share short. Every write a deal makes to the market names its lease and
reads whether it matched: one that did not finds another deal holding the market, its own lease
lapsed, so a change of reviewers is refused (``DEALING_BUSY``) and a deal of arrivals says so in
the log.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, NamedTuple, Optional, Tuple, Union

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.organizations as OrgsApi
import history as History
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from client_errors import ConflictError
from datatypes import (
    ApplicationStatus, Market, MarketPerson, MarketPhase, Organization, ReviewTeam,
)
from db_config import get_database
from market_documents import market_doc_field, market_doc_key, market_from_document
from tombstone import live
from utils.email_address import normalized_email

logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

#: Why a deal moved what it moved, in its history entry: a change of reviewers, or arrivals.
REVIEWERS_CHANGED = "reviewers_changed"
ARRIVED = "arrived"

_TURN = f"{market_doc_key('review_team')}.turn"
_REVIEWERS = f"{market_doc_key('review_team')}.reviewers"
_DEALING = f"{market_doc_key('review_team')}.dealing"
_DEALING_BY = f"{_DEALING}.by"
_DEALING_UNTIL = f"{_DEALING}.until"
#: A change of reviewers is unfinished from its team write to its last write: beside the team on
#: the stored document, never on the model, as ``dealing`` is. It holds the addresses of the
#: reviewers the change removed, so the change that finishes it hands on their follow-ups too.
_UNFINISHED = f"{market_doc_key('review_team')}.unfinishedChoice"
_UNFINISHED_FIELD = "unfinishedChoice"

#: How long a deal holds the market at most: far longer than any deal takes, so a deal that stopped
#: half way (a crashed worker) lets the next one in.
DEALING_LEASE = timedelta(seconds=30)
#: A change of reviewers waits this many short pauses for another deal to let go of the market.
CHOICE_WAITS = 100
HOLD_PAUSE_SECONDS = 0.05

DEALING_BUSY = (
    "The reviewers are being dealt applications right now. Try again in a moment."
)


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
    """The chosen reviewers who may still review here: those who still hold a role on the market
    that the table's ``review-when-chosen`` row lets be chosen (``Actions.may_be_chosen``)."""
    return [person for person in team_of(market).reviewers
            if Actions.may_be_chosen(person.user_id, market, organization)]


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

    Holding the market, the team is written with its turn reset, then the pool is read and dealt
    round robin from the first able reviewer (``eligible``) in arrival order, and the turn is
    written as the pool's size, so the next arrival goes to the reviewer after the last one dealt.
    The pool is every open application, those waiting as they arrived included, and each
    follow-up whose owner was a reviewer and is not one now: it keeps its status and is handed to
    the reviewer it is dealt to, as its owner and its reviewer, so someone still reaches out. A
    follow-up owned by a reviewer still chosen, or by someone who never was one, and every decided
    application, are never written. Once it lets go of the market, it deals the arrivals that came
    in while it held it.

    Each write is conditioned on the application still being as the pool read it (open and dealt
    as it was, or the follow-up still owned by the removed reviewer), so a verdict or a hand-on
    landing mid-deal is never written over. With none chosen, every open application goes back to
    first come, first served, and every follow-up stays with its owner.

    The team write marks the change unfinished (``reviewTeam.unfinishedChoice``) and its last write,
    the turn's, takes the mark away, so a change that stopped between them is finished by the same
    choice again: an unchanged set writes and records nothing only when no change is unfinished;
    otherwise it deals the pool as the change would have, with no second "reviewers changed" entry.

    Refused with ``ConflictError`` when another deal holds the market for longer than a choice
    waits, and when the change finds another deal holding it at its team write (it then deals
    nothing) or at its last write (it then stays unfinished, for the same choice to finish).
    """
    # A market never given a team has had no team write, so no change of it can be unfinished.
    if (_addresses(in_deal_order(reviewers)) == _addresses(team_of(market).reviewers)
            and (market.review_team is None
                 or _unfinished_choice(markets_collection.find_one(live({"id": market.id}))) is None)):
        return Chosen(team_of(market), 0)
    deal = str(uuid.uuid4())
    if not _hold(market.id, deal, waits=CHOICE_WAITS):
        raise ConflictError(DEALING_BUSY)
    try:
        return _choose_holding(market, organization, reviewers, by, deal)
    finally:
        # Every let-go looks again, a failed change's too: an arrival that found the market held
        # left its application to whoever held it.
        _let_go(market.id, deal)
        _settle(market, organization)


def _choose_holding(
    market: Market, organization: Optional[Organization], reviewers: List[MarketPerson], by: str,
    deal: str,
) -> Chosen:
    """``choose``'s writes, made while it holds the market: the team as it stands now is read
    again, since another choice may have landed between the request's read and the hold.

    A change writes the team, marked unfinished, and records it; finishing one (the same set over
    a marked team) writes neither. Both then deal the pool from turn 0, record the deal, and end in
    the last write, the turn with the mark taken away."""
    stored = markets_collection.find_one(live({"id": market.id})) or {}
    before = _team_of_document(stored)
    unfinished = _unfinished_choice(stored)
    chosen = in_deal_order(reviewers)
    kept = set(_addresses(chosen))
    # Whom a change removed, and whom an unfinished change before it removed and is not chosen now:
    # their follow-ups are handed on. With none chosen, every follow-up stays with its owner.
    removed = ((set(_addresses(before.reviewers)) | set(unfinished or ())) - kept
               if chosen else set())
    if _addresses(chosen) == _addresses(before.reviewers):
        if unfinished is None:
            return Chosen(before, 0)
    else:
        _write_holding(market.id, deal, {"$set": {
            _REVIEWERS: [convert_keys_to_camel_case(person.model_dump()) for person in chosen],
            _TURN: 0,
            _UNFINISHED: {"removed": sorted(removed)},
        }})
        History.record(
            market.id, by, Actions.CHOOSE_REVIEWERS, kind=History.REVIEWERS,
            detail=lambda: History.changes(
                {"reviewers": _addresses(before.reviewers)}, {"reviewers": _addresses(chosen)}))

    team = ReviewTeam(reviewers=chosen, turn=0)
    able = eligible(market.model_copy(update={"review_team": team}), organization)
    pool = ApplicationsApi.undecided_in_arrival_order(market.id, follow_ups_of=removed)
    if chosen and not able:
        # Nobody chosen may review here: nothing is dealt until someone who can is chosen.
        _finish(market.id, deal, 0)
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
    turn = len(pool) if able else 0

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
    _finish(market.id, deal, turn)
    return Chosen(team.model_copy(update={"turn": turn}), len(moved))


def _finish(market_id: str, deal: str, turn: int) -> None:
    """A change's last write: the turn, so the next arrival goes to the reviewer after the last one
    dealt, with the change's mark taken away."""
    _write_holding(market_id, deal, {"$set": {_TURN: turn}, "$unset": {_UNFINISHED: ""}})


def _write_holding(market_id: str, deal: str, update: Dict[str, Any]) -> None:
    """A change's write to the market under its lease; refused with ``ConflictError`` when another
    deal holds the market now, as one does once this one's lease lapsed."""
    written = markets_collection.update_one(live({"id": market_id, _DEALING_BY: deal}), update)
    if written.matched_count == 0:
        raise ConflictError(DEALING_BUSY)


def _unfinished_choice(stored: Optional[Dict[str, Any]]) -> Optional[List[str]]:
    """The reviewers an unfinished change of reviewers removed; None when no change is
    unfinished."""
    team = market_doc_field(stored or {}, "review_team") or {}
    if _UNFINISHED_FIELD not in team:
        return None
    return list((team[_UNFINISHED_FIELD] or {}).get("removed") or [])


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
    order they arrived (E38/F07/S03), and record the deal under ``action`` and ``actor``. ``only``
    narrows it to one application: an applicant's save deals theirs and no one else's, so the
    record never names a vendor as dealing another's. Answers how many it dealt.

    Called after every write that can leave an application open and undealt - an applicant's save,
    an import, and the writes whose automatic rejections can return one to open - once that
    write's rules have judged, so an application a rule rejected on arrival is not dealt. With no
    reviewers chosen it reads and writes nothing.

    Each application is marked as arriving, by this write, and then dealt by whichever deal next
    holds the market: this one, or the one holding it now, once it lets go (``_settle``).
    """
    if not team_of(market).reviewers:
        return 0
    action_id = action if isinstance(action, str) else action.id
    if only is not None:
        ApplicationsApi.mark_arriving(only, actor, action_id)
    else:
        ApplicationsApi.mark_all_arriving(market.id, actor, action_id)
    return _settle(market, _organization(market))


def deal_waiting(market: Market, organization: Optional[Organization]) -> int:
    """Deal every application left waiting as it arrived, holding the market, as the next card a
    reviewer asks for does: a deal the host ended while it held the market never let go, so the
    arrivals that found it holding wait for whichever deal comes next, and a quiet spell brings
    none. Each is recorded under the write it arrived by, never the one asking. While a live deal
    holds the market it answers at once, and that deal deals them as it lets go. With no reviewers
    chosen, or on an archived market, it reads and writes nothing. Answers how many it dealt.

    Only a write calls it: ``utils/request_origin.py`` lets a ``GET`` through on the promise that
    it changes nothing, so no read deals."""
    if not team_of(market).reviewers or market.phase is MarketPhase.ARCHIVED:
        return 0
    return _settle(market, organization)


def _settle(market: Market, organization: Optional[Organization], again: bool = True) -> int:
    """Deal every application waiting as it arrived, holding the market, and look again each time
    it lets go, for as long as any waits and it can hold the market: an arrival that found the
    market held marked its application before it tried, so the holder that looks after letting go
    finds it, however long a burst of arrivals runs. Stops only when none waits, or another deal
    holds the market, which looks again itself when it lets go. A round that fails lets go and
    looks again once before its error goes on, so an arrival that came in meanwhile is not left.
    Answers how many it dealt."""
    dealt = 0
    while ApplicationsApi.any_arriving(market.id):
        deal = str(uuid.uuid4())
        if not _hold(market.id, deal):
            return dealt
        try:
            dealt += _deal_arriving(market, organization, deal)
        except Exception:
            _let_go(market.id, deal)
            if again:
                _settle(market, organization, again=False)
            raise
        _let_go(market.id, deal)
    return dealt


def _deal_arriving(market: Market, organization: Optional[Organization], deal: str) -> int:
    """Deal the applications waiting as they arrived, holding the market: each to the able
    reviewer the turn names, the turn moving on by one for each dealt, written once at the end.
    One decided meanwhile is let go with its verdict; with nobody able, every one is let go
    undealt. Records one entry per write they arrived by, under its action and actor."""
    stored = markets_collection.find_one(live({"id": market.id})) or {}
    team = _team_of_document(stored)
    # The roles and the table as they stand now, read with the turn: someone whose role was taken,
    # or whose role the table no longer lets be chosen, is skipped.
    now = (market_from_document(stored) if stored else market).model_copy(
        update={"review_team": team})
    able = eligible(now, organization)
    turn = team.turn
    dealt: List[Tuple[Dict[str, Any], MarketPerson]] = []
    for doc in ApplicationsApi.arriving_in_arrival_order(market.id):
        to = able[turn % len(able)] if able else None
        if ApplicationsApi.deal_arrival(doc["id"], to):
            dealt.append((doc, to))
            turn += 1
    if dealt and markets_collection.update_one(
            live({"id": market.id, _DEALING_BY: deal}), {"$set": {_TURN: turn}}).matched_count == 0:
        # Its lease lapsed and another deal holds the market: the applications are dealt, and the
        # next deal reads a turn that has not moved on, so one turn of fairness is lost.
        logger.warning(
            "A deal of arrivals on market %s lost its hold before writing the turn; it dealt "
            "%d application(s), and the turn did not move on.", market.id, len(dealt))
    by_write: Dict[Tuple[Optional[str], str], List[Tuple[Dict[str, Any], MarketPerson]]] = {}
    for doc, to in dealt:
        arrived = doc.get(ApplicationsApi.ARRIVING_FIELD) or {}
        by_write.setdefault((arrived.get("actor"), arrived.get("action")), []).append((doc, to))
    for (actor, action), deals in by_write.items():
        History.record(
            market.id, actor, action or History.APPLY, kind=History.DEALT,
            vendors=[doc.get("applicant_email") for doc, _to in deals],
            subject={"application_ids": [doc["id"] for doc, _to in deals]},
            detail=lambda deals=deals: {
                "cause": ARRIVED,
                "before": {doc["id"]: {"reviewer": None} for doc, _to in deals},
                "after": {doc["id"]: {"reviewer": to.email} for doc, to in deals},
            })
    return len(dealt)


def _team_of_document(stored: Dict[str, Any]) -> ReviewTeam:
    return ReviewTeam(**convert_keys_to_snake_case(market_doc_field(stored, "review_team") or {}))


def _hold(market_id: str, deal: str, waits: int = 0) -> bool:
    """Hold the market for one deal: a lease on ``reviewTeam.dealing``, taken only while no other
    deal's stands, trying again ``waits`` times a short pause apart. A market that never had a team
    is given an empty one first, so the lease has somewhere to stand."""
    markets_collection.update_one(
        live({"id": market_id, market_doc_key("review_team"): {"$in": [None]}}),
        {"$set": {market_doc_key("review_team"): {"reviewers": [], "turn": 0}}})
    for attempt in range(waits + 1):
        now = datetime.now(timezone.utc)
        held = markets_collection.update_one(
            live({"id": market_id, "$nor": [{_DEALING_UNTIL: {"$gt": now.isoformat()}}]}),
            {"$set": {_DEALING: {"by": deal, "until": (now + DEALING_LEASE).isoformat()}}})
        if held.matched_count > 0:
            return True
        if attempt < waits:
            time.sleep(HOLD_PAUSE_SECONDS)
    return False


def _let_go(market_id: str, deal: str) -> None:
    markets_collection.update_one({"id": market_id, _DEALING_BY: deal}, {"$unset": {_DEALING: ""}})


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
