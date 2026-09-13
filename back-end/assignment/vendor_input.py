"""The solver's own input contract: an ``Application`` seen as a vendor the solver can place.

This module is the one place where application shape meets solver shape. It lives inside the
solver package on purpose: the solver owns what it needs from an application, while
``api/applications.py`` owns application *storage* and should carry no solver knowledge. The
practical payoff is that the translation is provable without constructing a ``MarketAssignment``
and without reaching a database - which is what the accompanying tests do.

Why a typed record at all
-------------------------
The vendor this replaces was a bag of attributes named after spreadsheet headings
(``setattr(self, toAttrString(key), value)``), read back with a defaulting ``getattr``. That
shape has no failure signal: a renamed, mistyped or simply absent field returns ``''``, which
reads as "the vendor answered nothing", and the market then assigns oddly with nothing logged
and nothing raised. Both defects this feature fixes are that one failure mode, and a frozen
dataclass removes it by construction - a wrong name is an ``AttributeError``, not a blank.

Typing also settles two values the CSV era got wrong for free: the number of dates wanted is an
``int`` rather than a string whose first character was read, and availability is a set rather
than a comma-separated string re-split at each use.

How a date is identified
------------------------
``available_dates`` holds the market plan's own spelling of each date, not a parsed
``datetime.date``. A market date is a calendar day identified by the string on
``MarketDateObject.date``, and the solver keys its per-date state by that same string. Parsing
here would introduce a second representation of one identity - the exact two-spellings problem
this codebase already fights between camelCase and snake_case market keys - and buy nothing,
since every use is a membership test against dates that came from the same plan.

What "required" means
---------------------
Requiredness is defined by what the market actually asked, mirroring
``essential_fields.validated_essential_answers`` question for question. A market offering one
table type does not ask for a table-type ranking, so an empty ranking is a complete answer, not
a missing one - and in MVP that is *every* market, since table type is stubbed to a single type.
Requiring it unconditionally would reject every application in the product.

These two must stay in step. If the validator's rule for a question changes, the rule here
changes with it, or the solver starts rejecting answers the form accepted.
"""
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import api.applications as ApplicationsApi
import essential_fields as EF
from datatypes import (
    Application,
    ApplicationStatus,
    ApplicationType,
    EssentialFormOptions,
)

EMAIL_LABEL = "Email address"


@dataclass(frozen=True)
class SolverVendor:
    """One vendor, as the solver sees them. Immutable: this is input, not working state.

    Placement state (how many dates a vendor has been given, and which) belongs to the solver's
    own run, not to the description of what the vendor asked for.
    """

    application_id: str
    email: str
    available_dates: frozenset
    max_dates: Optional[int]
    accepted_tiers: frozenset
    table_choice: Optional[str]
    table_share_email: Optional[str]
    section_ranking: Tuple[str, ...]
    table_type_ranking: Tuple[str, ...]


@dataclass(frozen=True)
class IncompleteApplication:
    """An approved application the solver cannot place, and the questions it left unanswered.

    Carried rather than swallowed so a caller can name the applicants. Skipping them instead
    would produce an assignment that looks complete with someone silently missing, which is the
    failure this whole rewrite exists to remove.
    """

    application_id: str
    applicant_email: str
    missing: Tuple[str, ...]


def solver_vendors_from_applications(
    applications: Iterable[Application], options: EssentialFormOptions,
) -> Tuple[List[SolverVendor], List[IncompleteApplication]]:
    """Translate applications into solver vendors, reporting those that cannot be translated.

    Returns ``(vendors, incomplete)``. Input order is preserved in both lists.
    """
    vendors: List[SolverVendor] = []
    incomplete: List[IncompleteApplication] = []

    for application in applications:
        vendor, missing = _solver_vendor(application, options)
        if vendor is None:
            incomplete.append(
                IncompleteApplication(
                    application_id=application.id,
                    applicant_email=(application.applicant_email or "").strip(),
                    missing=tuple(missing),
                )
            )
        else:
            vendors.append(vendor)

    return vendors, incomplete


def approved_solver_vendors(
    market_id: str, options: EssentialFormOptions,
) -> Tuple[List[SolverVendor], List[IncompleteApplication]]:
    """Every vendor a market's approved applications describe.

    Only ``reviewer_approved`` applications feed the solver, which is what
    ``NoApprovedApplicationsGuard`` already implies. Only *main* applications do: an applicant's
    waitlist application is a second document for the same address, so counting both would place
    one person twice.
    """
    documents = ApplicationsApi.list_applications_with_status(
        market_id,
        ApplicationStatus.REVIEWER_APPROVED.value,
        application_type=ApplicationType.MAIN.value,
    )
    return solver_vendors_from_applications(
        [Application(**document) for document in documents], options
    )


def _solver_vendor(
    application: Application, options: EssentialFormOptions,
) -> Tuple[Optional[SolverVendor], List[str]]:
    answers: Dict[str, Any] = application.form_data or {}
    missing: List[str] = []

    email = (application.applicant_email or "").strip()
    if not email:
        missing.append(EMAIL_LABEL)

    asks_about_dates = bool(options.dates)

    available_dates = _names(answers.get(EF.AVAILABLE_DATES_KEY))
    if asks_about_dates and not available_dates:
        missing.append(EF.AVAILABLE_DATES_LABEL)

    max_dates = _whole_number(answers.get(EF.MAX_DATES_KEY))
    if asks_about_dates and max_dates is None:
        missing.append(EF.MAX_DATES_LABEL)

    accepted_tiers = _names(answers.get(EF.TIER_PREFERENCE_KEY))
    if options.tiers and not accepted_tiers:
        missing.append(EF.TIER_PREFERENCE_LABEL)

    table_choice = _text(answers.get(EF.TABLE_CHOICE_KEY))
    if asks_about_dates and table_choice not in EF.TABLE_CHOICES:
        missing.append(EF.TABLE_CHOICE_LABEL)

    section_ranking = _names(answers.get(EF.SECTION_RANKING_KEY))
    if _is_asked_as_a_ranking(options.sections) and not section_ranking:
        missing.append(EF.SECTION_RANKING_LABEL)

    table_type_ranking = _names(answers.get(EF.TABLE_TYPE_RANKING_KEY))
    if _is_asked_as_a_ranking(options.table_types) and not table_type_ranking:
        missing.append(EF.TABLE_TYPE_RANKING_LABEL)

    if missing:
        return None, missing

    return (
        SolverVendor(
            application_id=application.id,
            email=email,
            available_dates=frozenset(available_dates),
            max_dates=max_dates,
            accepted_tiers=frozenset(accepted_tiers),
            table_choice=table_choice or None,
            # Naming nobody is the normal case, and absent says that more honestly than an
            # empty string a caller has to remember to test for.
            table_share_email=_text(answers.get(EF.TABLE_SHARE_EMAIL_KEY)) or None,
            section_ranking=tuple(section_ranking),
            table_type_ranking=tuple(table_type_ranking),
        ),
        [],
    )


def _is_asked_as_a_ranking(offered: Sequence[str]) -> bool:
    """Fewer than two options is not a question: there is exactly one order.

    The same rule ``essential_fields._validate_ranking`` applies when accepting the answer.
    """
    return len(offered or []) >= 2


def _names(value: Any) -> List[str]:
    """Trimmed, non-blank strings from a stored list answer, order preserved."""
    if not isinstance(value, list):
        return []
    return [text for text in (_text(item) for item in value) if text]


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _whole_number(value: Any) -> Optional[int]:
    """A stored count as an ``int``, or None when there is no usable answer.

    Deliberately not ``int(value[0])``: that read one character, so twelve dates became one.
    The contract stores this as an ``int`` already, so the string branch is only tolerance for
    an older document.
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None
