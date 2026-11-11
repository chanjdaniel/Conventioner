"""The Stats tab's figures, counted on the server (E45/F01/S01, S02, S03), so the page reads one
small answer however many applied and never downloads the applications to count them.

The headlines: the market's placements and money, each figure the one the page it links to shows,
counted by that page's own code - the table-days used and the vendors unassigned by the Assignments
page's strip (``counted_assignment``), the table-days free as its grid's "Empty" count, and the
amounts owed, paid and still owed by the Payments page (``market_money``). Placements are ``None``
until an assignment is stored, money where the market sets no prices or the Payments page has
nobody to count.

Who applied: every application by its stored status, how many were added by hand, and the time
each of the others applied. Statuses go out as stored, and the page counts them into the
Applications tab's All view filters, which are decided by status alone, so the two agree; times go
out rather than days because the server keeps no time zone for a market, and a day is the
reader's. Beside them, when applications opened and closed, from the phase record
(``intake_window``), which bound the page's chart of applications over time (T201).

What they answered, as the organizer reads it, each organizer's update of an answer in its place
(``effective_answers``): each select, multi-select and checkbox question of the form gets a row per
option it offers, in the form's order, with how many applicants gave it; a multi-select counts
every option ticked, so its rows add up to more than its applicants. An answer the form does not
offer - written in under "Other" on a Google Form, or an option since taken off - counts once per
applicant as ``other``, and an applicant who gave none counts as ``none``; both rows are left out
at zero. A free-text question is not counted: its answers are words, not choices. Every count
comes three times, for each group the page can narrow to: every application, the approved ones
(the All view's "Approved", those added by hand among them) and the assigned ones (anyone with an
assignment, a table on any date, verdict or not, as their outcome reads: ``result_outcome.py``).
"""
from typing import Any, Dict, Iterable, List, Optional, Set

import api.applications as ApplicationsApi
import api.markets as MarketsApi
import api.payments as PaymentsApi
import result_outcome as ResultOutcome
from datatypes import (
    LEGACY_STAGE_PHASES, ApplicationStatus, FormField, Market, MarketPhase, PhaseEntry,
)
from utils.email_address import normalized_email

CHOICE_TYPES = ("select", "multi_select", "checkbox")
GROUPS = ("all", "approved", "assigned")

# A checkbox's two answers, as its rows read.
_TICKED = "Yes"
_UNTICKED = "No"


def stats_for_market(market: Market) -> Dict[str, Any]:
    """The figures for a market, from its stored form, applications and assignment."""
    form = market.application_form
    applications = ApplicationsApi.list_applications_for_market(market.id)
    figures = {
        "applicants": {**count_applicants(applications), **intake_window(market.phase_history)},
        "answers": count_answers(
            form.fields if form else [], applications, ResultOutcome.seated_addresses(market),
        ),
    }
    # Last: counting the assignment describes it on the market in hand.
    figures["headlines"] = {"placements": count_placements(market), "money": count_money(market)}
    return figures


def count_placements(market: Market) -> Optional[Dict[str, int]]:
    """The Assignments page's figures: its strip's table-days used of all and vendors unassigned,
    and its grid's "Empty" count; ``None`` until an assignment is stored, as the strip is."""
    if not market.assignment_object.vendor_assignments:
        return None
    counted = MarketsApi.counted_assignment(market)
    if counted is None:
        return None
    statistics = counted.statistics
    return {
        "tableDaysUsed": statistics.total_assigned_tables,
        "tableDays": statistics.total_tables,
        "tableDaysFree": MarketsApi.table_days_free(counted.rows),
        "unassigned": len(statistics.unassigned_vendors),
    }


def count_money(market: Market) -> Optional[Dict[str, Any]]:
    """The Payments page's figures owed, paid and still owed; ``None`` where the market sets no
    prices, or the page has nobody to count and so shows no figures."""
    money = PaymentsApi.market_money(market)
    if money["currency"] is None or not money["vendors"]:
        return None
    totals = money["totals"]
    return {
        "currency": money["currency"],
        **{key: totals[key] for key in ("owedCents", "paidCents", "stillOwedCents")},
    }


def count_applicants(applications: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Every application by its stored status, and when each that was not added by hand applied.

    Only the times are sent, never who: the page needs nothing more to count them by day.
    """
    statuses: Dict[str, int] = {}
    submitted: List[str] = []
    added = 0
    for application in applications:
        status = str(application.get("status") or "")
        statuses[status] = statuses.get(status, 0) + 1
        if application.get("added_by"):
            added += 1
        elif application.get("submitted_at"):
            submitted.append(str(application["submitted_at"]))
    return {
        "total": len(applications),
        "addedByHand": added,
        "statuses": statuses,
        "submittedAt": submitted,
    }


def intake_window(record: Iterable[PhaseEntry]) -> Dict[str, Optional[str]]:
    """When applications opened, the time of the record's first entry into them, and when they
    closed, the time of the first entry into assignment after that; each ``None`` where the record
    holds no such entry, or holds it undated (the first entry of a record begun partway through).

    The first of each, so a market reopened or sent back to review keeps its first window: the
    chart shows when its applications came in, and a reopening does not move that.
    """
    opened: Optional[PhaseEntry] = None
    closed: Optional[PhaseEntry] = None
    for entry in record:
        # An entry still naming a phase E38/F04 folded into the stage reads as the stage.
        phase = entry.phase
        if phase in LEGACY_STAGE_PHASES:
            phase = MarketPhase.APPLICATIONS.value
        if opened is None:
            if phase == MarketPhase.APPLICATIONS.value:
                opened = entry
        elif phase == MarketPhase.ASSIGNMENT.value:
            closed = entry
            break
    return {
        "openedAt": opened.entered_at if opened else None,
        "closedAt": closed.entered_at if closed else None,
    }


def count_answers(
    fields: Iterable[FormField], applications: List[Dict[str, Any]], seated: Set[str],
) -> Dict[str, Any]:
    """Every choice question's counts in each group.

    ``applications`` are stored documents; ``seated`` holds the normalised addresses the
    assignment seats.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {
        "all": applications,
        "approved": [
            a for a in applications if a.get("status") == ApplicationStatus.REVIEWER_APPROVED.value
        ],
        "assigned": [
            a for a in applications
            if normalized_email(a.get("applicant_email") or "") in seated
        ],
    }
    charted = sorted(
        (field for field in fields if field.type in CHOICE_TYPES), key=lambda field: field.order)
    return {
        "groups": {group: len(members) for group, members in groups.items()},
        "questions": [
            {
                "key": field.key,
                "label": field.label,
                "type": field.type,
                "answers": {group: _rows(field, members) for group, members in groups.items()},
            }
            for field in charted
        ],
    }


def _rows(field: FormField, applications: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    offered = _offered(field)
    counts = {option: 0 for option in offered}
    other = none = 0
    for application in applications:
        # As the organizer reads it, an update of the answer in its place (E41/F01/S01).
        given = _given(field, ApplicationsApi.effective_answers(application).get(field.key))
        if not given:
            none += 1
            continue
        for option in offered:
            if option in given:
                counts[option] += 1
        if given - set(offered):
            other += 1
    rows = [{"kind": "option", "answer": option, "count": counts[option]} for option in offered]
    if other:
        rows.append({"kind": "other", "count": other})
    if none:
        rows.append({"kind": "none", "count": none})
    return rows


def _offered(field: FormField) -> List[str]:
    if field.type == "checkbox":
        return [_TICKED, _UNTICKED]
    return list(dict.fromkeys(str(option).strip() for option in field.options))


def _given(field: FormField, value: Any) -> Set[str]:
    """The answers one applicant gave, as the rows name them; empty when they gave none."""
    if field.type == "checkbox" and isinstance(value, bool):
        return {_TICKED if value else _UNTICKED}
    values = value if isinstance(value, list) else [value]
    return {str(item).strip() for item in values if item is not None and str(item).strip()}
