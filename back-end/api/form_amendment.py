"""Fixing the application form without leaving the import (E20/F03/S01).

When the column mapping reveals the form asked the wrong thing, the organizer fixed it by
following four printed instructions - reopen the market for editing, turn the question off in the
form builder, open applications, import again - across two phase transitions, losing their upload
on the way. This runs that chain for them.

**No new transition edge.** Editing a form is legal only in ``draft``, and the way back from
``applications_closed`` is through ``applications_open``, because the transition table deliberately
allows only the open phase to return: a market that has closed applications has moved past the
point where its form is a draft of anything. So the chain is two hops from one phase and four from
the other, and it is built by walking the EXISTING table rather than by adding a shortcut.

**Pre-flight, not rollback.** Nothing moves until the whole path is known to succeed. Every guard
on every hop is evaluated against the PROPOSED form first; only then does the market leave its
phase. The alternative - move, write, discover the return is refused - trades the printed dead end
for a worse one: a form edited empty, a refused return, and a market stranded in ``draft``
mid-import with nothing saying a phase had moved. There is nothing to roll back because nothing
moved.

The one failure pre-flight cannot prevent is a transport failure or a concurrent change BETWEEN two
hops. ``Market.form_amendment`` records where the chain was going before it takes the first step,
so that market can be told where it stopped and offered the rest of the walk, rather than leaving
the organizer to infer it from the phase rail.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import api.applications as ApplicationsApi
import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import ApplicationForm, Market, MarketPhase, MarketRole, phase_label
from guards import TRANSITION_GUARDS, PreconditionResult, route_between
from market_documents import market_doc_key, market_doc_set
from assignment.utils import convert_keys_to_camel_case

# The only two phases the import wizard runs in, and therefore the only two an amendment can
# return a market to. Derived from the wizard's own rule rather than restated: importing is
# refused everywhere else, so there is nowhere else to come back to.
AMENDABLE_FROM: tuple[str, ...] = (
    MarketPhase.APPLICATIONS_OPEN.value,
    MarketPhase.APPLICATIONS_CLOSED.value,
)


class AmendmentUnavailable(Exception):
    """The chain cannot be offered at all, and the organizer is told why rather than shown it fail."""


class AmendmentRefused(Exception):
    """Pre-flight refused the proposed form. Carries the blockers, so the dialog can say which."""

    def __init__(self, message: str, blockers: List[PreconditionResult]):
        self.blockers = blockers
        super().__init__(message)


class AmendmentStalled(Exception):
    """The walk stopped between hops. Says where it stopped and what is left to do."""

    def __init__(self, message: str, at_phase: str, remaining: List[str], return_phase: str):
        self.at_phase = at_phase
        self.remaining = remaining
        self.return_phase = return_phase
        super().__init__(message)


@dataclass(frozen=True)
class AmendmentPlan:
    """The whole walk, decided before any of it runs."""

    return_phase: str
    down: List[str]
    up: List[str]

    @property
    def hops(self) -> List[tuple[str, str]]:
        """Every edge this plan traverses, in order, as (from, to)."""
        walked: List[tuple[str, str]] = []
        at = self.return_phase
        for nxt in self.down + self.up:
            walked.append((at, nxt))
            at = nxt
        return walked


def _route_to_draft(from_phase: str) -> Optional[List[str]]:
    """The shortest existing route from ``from_phase`` down to ``draft``.

    Walked by ``guards.route_between``, so this file states no route of its own: an edge added or
    removed in ``guards.py`` changes the chain here with no edit, and an edge that does not exist
    cannot be taken by a chain that believed it did.
    """
    return route_between(from_phase, MarketPhase.DRAFT.value)


def plan_for(market: Market) -> AmendmentPlan:
    """The walk that would amend this market's form, or a refusal saying why there is none."""
    phase = market.phase.value
    if phase not in AMENDABLE_FROM:
        raise AmendmentUnavailable(
            f"The form can only be amended from an import, and this market is in "
            f"'{phase_label(market.phase)}'."
        )

    down = _route_to_draft(phase)
    if down is None:
        raise AmendmentUnavailable(
            f"There is no way back to draft from '{phase_label(market.phase)}', "
            "so the form cannot be amended from here."
        )
    return AmendmentPlan(return_phase=phase, down=down, up=list(reversed(down[:-1])) + [phase])


def _candidate_market(market: Market, proposed: ApplicationForm) -> Market:
    """The market as it would be with the proposed form, for the guards to judge.

    The guards read ``market.application_form``, so handing them the STORED one would pre-flight
    the form the organizer is replacing - it would pass on a market whose current form is fine and
    whose proposed form asks nothing, which is the exact refusal this is here to catch.
    """
    return market.model_copy(update={"application_form": proposed})


def preflight(market: Market, proposed: ApplicationForm, plan: AmendmentPlan) -> List[PreconditionResult]:
    """Every guard on every hop of the walk, judged against the proposed form. Failures only.

    Judged in ``draft``, not in the phase each hop starts from: each guard reads market state
    rather than the phase it is invoked on, and constructing four phase-shifted copies would
    assert that they do not - which they might not, later, quietly.
    """
    candidate = _candidate_market(market, proposed)
    blockers: List[PreconditionResult] = []
    seen: set[str] = set()
    for hop in plan.hops:
        for guard in TRANSITION_GUARDS.get(hop, []):
            result = guard.evaluate(candidate, MarketsApi.db)
            if result.passed or result.id in seen:
                continue
            seen.add(result.id)
            blockers.append(result)
    return blockers


def amendment_availability(market: Market) -> Dict[str, Any]:
    """Whether this market's form can be amended from here, and what it would cost.

    The dialog reads this to open, so it can refuse with an explanation rather than by failing -
    which is the difference between a control that is unavailable and one that is broken.
    """
    try:
        plan = plan_for(market)
    except AmendmentUnavailable as refusal:
        return {"available": False, "reason": str(refusal), "hops": 0, "return_phase": None}

    applications = ApplicationsApi.count_applications_for_market(market.id)
    if applications:
        word = "application has" if applications == 1 else "applications have"
        return {
            "available": False,
            "reason": (
                f"{applications} {word} already been submitted, so this form is frozen for good "
                "and the way back to draft is closed."
            ),
            "hops": 0,
            "return_phase": plan.return_phase,
        }

    return {
        "available": True,
        "reason": None,
        "hops": len(plan.hops),
        "return_phase": plan.return_phase,
    }


def _record_intent(market_id: str, plan: AmendmentPlan) -> None:
    markets = MarketsApi.markets_collection
    markets.update_one(
        {"id": market_id},
        market_doc_set(
            "form_amendment",
            {
                market_doc_key("return_phase"): plan.return_phase,
                market_doc_key("started_at"): datetime.now(timezone.utc).isoformat(),
            },
        ),
    )


def _clear_intent(market_id: str) -> None:
    MarketsApi.markets_collection.update_one(
        {"id": market_id}, market_doc_set("form_amendment", None)
    )


def _walk(market_id: str, steps: List[str], plan: AmendmentPlan) -> None:
    """Take the given hops in order, re-reading the document before each.

    Re-read rather than carried: each write is conditional on the stored phase, so a stale
    document would fail the second hop of every chain.
    """
    for index, target in enumerate(steps):
        document = MarketsApi.markets_collection.find_one({"id": market_id})
        if document is None:
            raise MarketsApi.MarketNotFoundError("Market not found")
        try:
            MarketsApi.apply_phase_transition(market_id, document, target)
        except MarketsApi.PhaseChangedUnderRequest as conflict:
            raise AmendmentStalled(
                (
                    f"This market moved to '{conflict.actual_phase}' while the amendment was "
                    "running, so the rest of the chain was not taken. Nothing else was changed."
                ),
                at_phase=conflict.actual_phase,
                remaining=steps[index:],
                return_phase=plan.return_phase,
            ) from conflict


def amend_application_form(
    market_id: str, application_form_data: dict, requesting_user: str
) -> Dict[str, Any]:
    """Write the form and return the market to the phase it started in.

    ADMIN, not EDITOR: this moves the market's phase, and the phase endpoint's own bar is ADMIN.
    An amendment that let an EDITOR walk a market through draft would be a way around that bar.
    """
    market = MarketsApi._load_market_for(market_id, requesting_user, MarketRole.ADMIN, "amend")
    plan = plan_for(market)

    availability = amendment_availability(market)
    if not availability["available"]:
        raise AmendmentUnavailable(availability["reason"])

    try:
        proposed = ApplicationForm(**application_form_data)
    except Exception as e:
        raise ValueError(f"Invalid application form data: {e}")

    blockers = preflight(market, proposed, plan)
    if blockers:
        raise AmendmentRefused(
            "The form as edited would not let this market reopen applications.", blockers
        )

    # Only now does anything move.
    _record_intent(market_id, plan)
    _walk(market_id, plan.down, plan)

    # In draft, which is the one phase the form is writable in - so this goes through the ordinary
    # writer and meets the ordinary lock, rather than around it.
    saved = MarketsApi.save_application_form(market_id, application_form_data, requesting_user)

    _walk(market_id, plan.up, plan)
    _clear_intent(market_id)

    return {
        "application_form": saved,
        "phase": plan.return_phase,
        "hops": len(plan.hops),
    }


def resume_amendment(market_id: str, requesting_user: str) -> Dict[str, Any]:
    """Finish a chain that stopped partway, from wherever the market actually is now.

    The offer the stall message makes. It re-plans from the market's CURRENT phase rather than
    replaying what was left of the old walk, because the reason a chain stalls is that the market
    is no longer where the walk believed.
    """
    market = MarketsApi._load_market_for(market_id, requesting_user, MarketRole.ADMIN, "amend")
    pending = market.form_amendment
    if pending is None:
        raise AmendmentUnavailable("This market has no unfinished form amendment.")

    target = pending.return_phase
    if market.phase.value == target:
        _clear_intent(market_id)
        return {"phase": target, "hops": 0}

    steps = route_between(market.phase.value, target)
    if steps is None:
        raise AmendmentUnavailable(
            f"There is no route from '{phase_label(market.phase)}' back to "
            f"'{target}', so this market cannot be returned automatically."
        )

    plan = AmendmentPlan(return_phase=target, down=[], up=steps)
    _walk(market_id, steps, plan)
    _clear_intent(market_id)
    return {"phase": target, "hops": len(steps)}


def stall_payload(error: AmendmentStalled) -> Dict[str, Any]:
    """What a stalled chain tells the organizer: where it stopped, and that it can be finished."""
    return convert_keys_to_camel_case({
        "error": "amendment_stalled",
        "message": str(error),
        "current_phase": error.at_phase,
        "return_phase": error.return_phase,
        "remaining": error.remaining,
        "can_resume": True,
    })
