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
Requiredness is defined by what the market actually asked, and the rule for that lives where
``CLAUDE.md`` says it lives: ``essential_fields`` is the single owner of the essential-questions
contract, so ``asked_essential_keys`` is read from there rather than restated here. A market
offering one table type does not ask for a table-type ranking, so an empty ranking is a complete
answer, not a missing one - and in MVP that is *every* market, since table type is stubbed to a
single type. Requiring it unconditionally would reject every application in the product.

Why an answer is checked against the offering
---------------------------------------------
A required answer being *present* is not enough. An availability list holding a date the market
does not offer - a different spelling, or a date dropped from the plan - matches no market date,
so the vendor is placed nowhere and nobody is told why. That is the same silent failure the
typed record exists to remove, merely moved from the attribute's name to its value, so an answer
naming something the market never offered is reported rather than carried.

The applicant-facing form cannot produce one: ``_validate_accepted_subset`` and
``_validate_ranking`` refuse it at submission, and the offering is frozen against the answers
recorded under it. Reaching this check therefore means a document that did not come through that
path, which is exactly when a loud failure is worth more than a quiet placement.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Tuple

import api.applications as ApplicationsApi
import essential_fields as EF
from datatypes import (
    Application,
    ApplicationStatus,
    ApplicationType,
    EssentialFormOptions,
)


@dataclass(frozen=True)
class SolverVendor:
    """One vendor, as the solver sees them. Immutable: this is input, not working state.

    Placement state (how many dates a vendor has been given, and which) belongs to the solver's
    own run, not to the description of what the vendor asked for.
    """

    application_id: str
    email: str
    available_dates: FrozenSet[str]
    max_dates: Optional[int]
    accepted_tiers: FrozenSet[str]
    table_choice: Optional[str]
    table_share_email: Optional[str]
    section_ranking: Tuple[str, ...]
    table_type_ranking: Tuple[str, ...]
    # The organizer's own form questions and this applicant's answers to them. The solver reads
    # these only through a priority rule that names one by key, so it is addressed deliberately
    # rather than groped at: an unknown key is a rule the organizer has to fix, not a blank.
    custom_answers: Dict[str, Any] = field(default_factory=dict)
    # Real submission time, used by a first-come-first-served priority rule.
    submitted_at: Optional[str] = None


@dataclass(frozen=True)
class IncompleteApplication:
    """An approved application the solver cannot place, and why.

    Carried rather than swallowed so a caller can name the applicants. Skipping them instead
    would produce an assignment that looks complete with someone silently missing, which is the
    failure this whole rewrite exists to remove.

    The two reasons are kept apart because they read differently to whoever has to fix them:
    ``missing`` names questions left unanswered, while ``unrecognised`` names answers given to
    questions this market never asked that way.
    """

    application_id: str
    applicant_email: str
    missing: Tuple[str, ...]
    unrecognised: Tuple[str, ...] = ()

    @property
    def reasons(self) -> Tuple[str, ...]:
        """Every reason this application cannot be placed, for a caller building one message."""
        return self.missing + self.unrecognised


def solver_vendors_from_applications(
    applications: Iterable[Application], options: EssentialFormOptions,
) -> Tuple[List[SolverVendor], List[IncompleteApplication]]:
    """Translate applications into solver vendors, reporting those that cannot be translated.

    Returns ``(vendors, incomplete)``. Input order is preserved in both lists.
    """
    vendors: List[SolverVendor] = []
    incomplete: List[IncompleteApplication] = []

    for application in applications:
        vendor, problem = _solver_vendor(application, options)
        if vendor is None:
            incomplete.append(problem)
        else:
            vendors.append(vendor)

    return vendors, incomplete


def approved_solver_vendors(
    market_id: str, options: EssentialFormOptions,
) -> Tuple[List[SolverVendor], List[IncompleteApplication]]:
    """Every vendor a market's approved applications describe.

    Only ``reviewer_approved`` applications feed the solver, which is what
    ``NoApprovedApplicationsGuard`` already implies.

    Only *main* applications do, which is a narrower claim and a deliberately conservative one:
    the identity index is ``(market_id, applicant_email, application_type)``, so an applicant's
    waitlist application is a second document for the same address, and reading both would place
    one person twice. Nothing creates a waitlist application today, so neither behaviour is
    reachable; what a waitlisted applicant's approval should mean to the solver is an open
    question recorded on the v0.1.0 map, not something settled here.
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
) -> Tuple[Optional[SolverVendor], Optional[IncompleteApplication]]:
    answers: Dict[str, Any] = application.form_data or {}
    asked = EF.asked_essential_keys(options)
    missing: List[str] = []
    unrecognised: List[str] = []

    email = _text(application.applicant_email)
    if not email:
        missing.append(EF.EMAIL_LABEL)

    def answer(key: str, label: str) -> List[str]:
        """A list answer, required when asked and checked against what the question offered."""
        names = EF.normalized_names(answers.get(key))
        if key not in asked:
            return names
        if not names:
            missing.append(label)
            return names
        offered = EF.offering_for_key(key, options)
        strangers = [name for name in names if name not in offered]
        if strangers:
            unrecognised.append(f"{label}: {', '.join(strangers)}")
        return names

    available_dates = answer(EF.AVAILABLE_DATES_KEY, EF.AVAILABLE_DATES_LABEL)
    accepted_tiers = answer(EF.TIER_PREFERENCE_KEY, EF.TIER_PREFERENCE_LABEL)
    section_ranking = answer(EF.SECTION_RANKING_KEY, EF.SECTION_RANKING_LABEL)
    table_type_ranking = answer(EF.TABLE_TYPE_RANKING_KEY, EF.TABLE_TYPE_RANKING_LABEL)

    max_dates = _whole_number(answers.get(EF.MAX_DATES_KEY))
    if EF.MAX_DATES_KEY in asked and max_dates is None:
        missing.append(EF.MAX_DATES_LABEL)

    # Lower-cased for the same reason the form stores it lower-cased: the choices are a fixed
    # vocabulary, and an imported row spelling one 'Half' should not read as no answer at all.
    table_choice = _text(answers.get(EF.TABLE_CHOICE_KEY)).lower()
    if EF.TABLE_CHOICE_KEY in asked and table_choice not in EF.TABLE_CHOICES:
        missing.append(EF.TABLE_CHOICE_LABEL)

    if missing or unrecognised:
        return None, IncompleteApplication(
            application_id=application.id,
            applicant_email=email,
            missing=tuple(missing),
            unrecognised=tuple(unrecognised),
        )

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
            custom_answers={
                key: value for key, value in answers.items()
                if not key.startswith(EF.ESSENTIAL_KEY_PREFIX)
            },
            submitted_at=application.submitted_at,
        ),
        None,
    )


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
