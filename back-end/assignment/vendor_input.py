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

An answer the market does not offer
-----------------------------------
Values that are not in the offering are **dropped**, not carried and not treated as an error.

Carrying them would be the silent failure the typed record exists to remove: a date the market
does not run matches no market date, so it can only ever be dead weight. But refusing the run
over them would be worse, because the ordinary way one appears is an organizer editing their
plan after applications are in - dropping a tier, removing a day. An applicant who chose that
tier did nothing wrong, and stopping the whole market until someone edits their answers is a
disproportionate response to a decision the organizer just made.

So a value the market no longer offers simply cannot be honoured. If that leaves a vendor with
no acceptable tier or no available date, they are unplaceable, and they appear in the
assignment's ``unassigned_vendors`` - which is the channel that already exists for exactly this
and is what an organizer reads afterwards.

What still refuses the run is an answer that is **absent**: a question the market asks and this
application never answered at all. That is an incomplete record rather than a stale one, and no
plan edit can produce it.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Iterable, List, Mapping, Optional, Tuple

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
    # Which tiers this vendor accepts ON EACH DATE. Tier is a hard filter and it sets the price,
    # so it is per-date: a single set for the whole application would let a vendor be placed at a
    # tier they offered on one day, and charged for it, on another (E01/F05).
    accepted_tiers_by_date: Mapping[str, FrozenSet[str]]
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
    application_type: Optional[str] = None

    def accepts_tier_on(self, date: str, tier_name: Optional[str]) -> bool:
        """Does this vendor accept that tier ON THAT DATE?

        Per-date because tier is a hard filter and it sets the price: a vendor who offered Gold on
        Monday and Bronze on Friday must not be placed at Gold on Friday and charged for it
        (E01/F05). One set for the whole application could not express the difference.

        Set membership, not a substring test. The CSV-era check was
        ``table.tier.name in <the vendor's answer string>``, in which a tier named 'A' matched an
        answer of 'AB'.

        A table with no tier constrains nothing, which is what a market offering no tiers produces.
        That is deliberately not the same as a vendor who accepts no tier on that date: they belong
        at no table that day, which is how "the organizer dropped that tier after applications were
        in" should read - the applicant goes unassigned rather than the market going unassignable.
        """
        if tier_name is None:
            return True
        return tier_name in self.accepted_tiers_by_date.get(date, frozenset())


@dataclass(frozen=True)
class IncompleteApplication:
    """An approved application the solver cannot place, and why.

    Carried rather than swallowed so a caller can name the applicants. Skipping them instead
    would produce an assignment that looks complete with someone silently missing, which is the
    failure this whole rewrite exists to remove.

    ``missing`` names the questions this application never answered. An answer that names
    something the market no longer offers is NOT here: see the module docstring - that is a stale
    answer rather than an incomplete one, and it makes the vendor unplaceable rather than the
    market unassignable.
    """

    application_id: str
    applicant_email: str
    missing: Tuple[str, ...]

    @property
    def reasons(self) -> Tuple[str, ...]:
        """Every reason this application cannot be placed, for a caller building one message."""
        return self.missing


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


def _tiers_by_date(
    raw: Any,
    options: EssentialFormOptions,
    asked: FrozenSet[str],
    missing: List[str],
) -> Mapping[str, FrozenSet[str]]:
    """A stored per-date tier answer as the solver reads it.

    Values the market no longer offers are dropped rather than refused, for the same reason the
    other translations drop them: an organizer may edit the plan after applications are in, and the
    applicant did nothing wrong. A vendor left accepting nothing on a date is simply unplaceable
    there, which is how "the organizer dropped that tier" should read.
    """
    if EF.TIER_PREFERENCE_KEY not in asked:
        return {}
    if not isinstance(raw, dict) or not raw:
        missing.append(EF.TIER_PREFERENCE_LABEL)
        return {}

    answered = {str(date): EF.normalized_names(names) for date, names in raw.items()}
    if not any(answered.values()):
        # The applicant answered nothing. That is incomplete, and the run refuses rather than
        # placing them somewhere they never agreed to.
        missing.append(EF.TIER_PREFERENCE_LABEL)
        return {}

    # Names the market no longer offers are DROPPED, not refused - the same rule the other
    # translations follow. An organizer may edit the plan after applications are in, and the
    # applicant did nothing wrong; a vendor left accepting nothing on a date is unplaceable there,
    # which is how "the organizer dropped that tier" should read. Unplaceable, not unassignable.
    offered = set(options.tiers or [])
    return {
        date: frozenset(name for name in names if not offered or name in offered)
        for date, names in answered.items()
    }


def _solver_vendor(
    application: Application, options: EssentialFormOptions,
) -> Tuple[Optional[SolverVendor], Optional[IncompleteApplication]]:
    answers: Dict[str, Any] = application.form_data or {}
    asked = EF.asked_essential_keys(options)
    missing: List[str] = []

    email = _text(application.applicant_email)
    if not email:
        missing.append(EF.EMAIL_LABEL)

    def answer(key: str, label: str) -> List[str]:
        """A list answer: required when asked, and narrowed to what the market still offers.

        Answering nothing is missing. Answering only things the market no longer offers is not:
        it leaves an empty answer that makes this vendor unplaceable, which the assignment
        reports as an unassigned vendor.
        """
        names = EF.normalized_names(answers.get(key))
        if key not in asked:
            return names
        if not names:
            missing.append(label)
            return names
        offered = EF.offering_for_key(key, options)
        return [name for name in names if name in offered] if offered else names

    available_dates = answer(EF.AVAILABLE_DATES_KEY, EF.AVAILABLE_DATES_LABEL)
    accepted_tiers_by_date = _tiers_by_date(
        answers.get(EF.TIER_PREFERENCE_KEY), options, asked, missing,
    )
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

    if missing:
        return None, IncompleteApplication(
            application_id=application.id,
            applicant_email=email,
            missing=tuple(missing),
        )

    return (
        SolverVendor(
            application_id=application.id,
            email=email,
            available_dates=frozenset(available_dates),
            max_dates=max_dates,
            accepted_tiers_by_date=accepted_tiers_by_date,
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
            application_type=(
                application.application_type.value
                if application.application_type is not None else None
            ),
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
