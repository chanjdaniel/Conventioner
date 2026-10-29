"""The Stats tab's figures, counted on the server (E45/F01/S01, S02), so the page reads one small
answer however many applied and never downloads the applications to count them.

Who applied: every application by its stored status, how many were added by hand, and the time
each of the others applied. Statuses go out as stored, and the page counts them into the
Applications tab's All view filters, which are decided by status alone, so the two agree; times go
out rather than days because the server keeps no time zone for a market, and a day is the
reader's.

What they answered: each select, multi-select and checkbox question of the form gets a row per
option it offers, in the form's order, with how many applicants gave it; a multi-select counts
every option ticked, so its rows add up to more than its applicants. An answer the form does not
offer - written in under "Other" on a Google Form, or an option since taken off - counts once per
applicant as ``other``, and an applicant who gave none counts as ``none``; both rows are left out
at zero. A free-text question is not counted: its answers are words, not choices. Every count
comes three times, for each group the page can narrow to: every application, the approved ones
(the All view's "Approved", those added by hand among them) and the assigned ones (anyone with an
assignment, a table on any date, verdict or not, as their outcome reads: ``result_outcome.py``).
"""
from typing import Any, Dict, Iterable, List, Set

import api.applications as ApplicationsApi
import result_outcome as ResultOutcome
from datatypes import ApplicationStatus, FormField, Market
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
    return {
        "applicants": count_applicants(applications),
        "answers": count_answers(
            form.fields if form else [], applications, ResultOutcome.seated_addresses(market),
        ),
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
        given = _given(field, (application.get("form_data") or {}).get(field.key))
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
