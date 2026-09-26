"""What an assignment was made from, and whether that has changed since (E22/F03/S01).

Editing the rules, the plan or the approved applications never changes a stored assignment - only
running it again does (``CONTEXT.md``, **Assignment**). With the rules and the result on separate
pages, an organizer could change a rule and read an assignment made under the old one without
being told. So each run records a fingerprint of each of the three things the solver read, and
the market says which of them has changed since.

This is the ONE place each group's fingerprint is computed: the run and the read both call
``fingerprint``, so they can never disagree about what "the same" means.

Hand placements are not an input. They are edits to the result, so placing, freeing or swapping
never makes an assignment out of date.
"""
import hashlib
import json
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from assignment.vendor_input import SolverVendor, approved_solver_vendors
from datatypes import Market, SetupObject
from essential_fields import effective_essential_options_for_market

GROUPS = ("rules", "plan", "applications")


def assignment_rules(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The part of a plan that is the assignment rules, in one comparable shape.

    Also what the plan write compares to decide whether a settled market's rules were changed or
    merely restated (``api.markets.save_plan``).
    """
    if plan is None:
        return {"priority": [], "assignment_options": None}
    return {
        "priority": [rule.model_dump() for rule in plan.priority],
        "assignment_options": plan.assignment_options.model_dump(),
    }


def _plan(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The market plan the solver builds its tables from: dates, tiers, locations, sections.

    Dates are a set of days, so their order - which is the order they were clicked - is not a
    change. Floorplans are left out: the solver reads table types from them, which are stubbed to
    one type until the floorplan ships.
    """
    if plan is None:
        return {}
    return {
        "market_dates": sorted(date.date for date in plan.market_dates),
        "tiers": [tier.model_dump() for tier in plan.tiers],
        "locations": [location.model_dump() for location in plan.locations],
        "sections": [section.model_dump() for section in plan.sections],
    }


def _plain(value: Any) -> Any:
    """A vendor's fields in a shape JSON can hold in one order: sets become sorted lists."""
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(item) for item in value)
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _applications(vendors: List[SolverVendor]) -> List[Dict[str, Any]]:
    """The approved applications as the solver reads them, in one order: by application."""
    return sorted(
        (_plain(asdict(vendor)) for vendor in vendors), key=lambda vendor: vendor["application_id"]
    )


def _digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def fingerprint(plan: Optional[SetupObject], vendors: List[SolverVendor]) -> Dict[str, str]:
    """One fingerprint per group the solver reads: the rules, the plan, the approved applications."""
    return {
        "rules": _digest(assignment_rules(plan)),
        "plan": _digest(_plan(plan)),
        "applications": _digest(_applications(vendors)),
    }


def changed_since_run(market: Market) -> List[str]:
    """Which groups differ from what the stored assignment was made from, in ``GROUPS`` order.

    Empty when nothing has changed, and also when the market holds no fingerprints - an
    assignment made before this shipped is not known to be out of date, and is never served as out
    of date, because a notice on every existing market would teach organizers to ignore it.

    An approved application missing an answer the solver needs is still read, so adding one counts
    as a change to the applications rather than hiding behind the run's refusal.
    """
    recorded = market.assignment_object.made_from
    if not recorded or not market.assignment_object.vendor_assignments:
        return []
    vendors, incomplete = approved_solver_vendors(
        market.id, effective_essential_options_for_market(market)
    )
    now = fingerprint(market.setup_object, vendors)
    if incomplete:
        now["applications"] = _digest([now["applications"], sorted(map(str, incomplete))])
    return [group for group in GROUPS if recorded.get(group) != now[group]]
