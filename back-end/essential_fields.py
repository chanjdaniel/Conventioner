"""The essential application-form questions: the answers the assignment solver reads directly.

Every application form asks these, whatever else the organizer builds. If the assignment
algorithm reads it, it is essential - that test is mechanical, and five fields pass it:

  - email                    -- the applicant's identity; captured at sign-in, not asked here
  - essential_available_dates -- which market dates the applicant CAN attend (capability)
  - essential_max_dates       -- at most how many dates they WANT (appetite; not capability)
  - essential_tier_preference -- which tiers they ACCEPT (a hard filter, not a ranking)
  - essential_table_choice    -- a whole table, half a table, or either
  - essential_table_share_email -- who they would like to share a table with (OPTIONAL)
  - essential_section_ranking -- section preference, best first
  - essential_table_type_ranking -- table type preference, best first

Tier and section are answered differently on purpose. A tier determines what the applicant pays
for a table on a given day, so it is a hard filter: a vendor is never placed at a tier they did
not accept, even if that leaves them unassigned - hence a SET of accepted tiers. A section is a
preference: a vendor gets their highest-ranked section still available and is never left
unassigned merely because it filled up - hence a total ranking.

This module is the single owner of that contract: the reserved answer keys, the derivation of
what the questions offer, the validation of an applicant's answers, and the freeze that stops
the offering from moving under recorded answers.

The offering is never an independent list: it is the market plan itself. Dates come from
``SetupObject.market_dates``, sections from ``SetupObject.sections``, tiers from
``SetupObject.tiers``, and table types from the market's floorplan (the latest saved one -
``floorplans_save`` overwrites ``sections`` and ``locations`` from the latest floorplan too, so
its table types are the current plan's).

Freeze semantics (the D9 principle extended to the offering): while no applicant has recorded
an answer, the offering follows the market plan live - an organizer edits their plan and the
form follows. The first accepted answer freezes the offering it was validated against onto
``applicationForm.essentialOptions`` (camelCase, like the whole market document) - written
atomically before the answer itself is stored, so no answer ever lands against an unfrozen
offering - and every later read serves that snapshot, so an applicant can never have answered
a question that moved. There is deliberately no way to refresh it afterwards.
"""
from typing import Any, Dict, List, Optional, Tuple

from assignment.utils import (
    convert_keys_to_camel_case,
    convert_keys_to_snake_case,
    snake_to_camel,
)
from datatypes import EssentialFormOptions, Market
from market_documents import market_doc_field, market_doc_key

# Custom builder fields may never use this prefix: the essential answers live beside the custom
# answers in ``Application.form_data``, and a custom field that shadowed one would corrupt what
# the solver reads.
ESSENTIAL_KEY_PREFIX = "essential_"

# Identity, and the one essential question that is not a solver input. Every market needs to know
# who it is placing, and every organizer's form already asks: the committed Fall 2025 export
# carries "Full Legal Name" and "Preferred Name" as columns 4 and 5, and this product used to drop
# both because it had nowhere to put them.
#
# ONE field, never first + last. Both of those columns hold WHOLE names, so a required first-name
# field would receive "Ana Rivera" for all 232 rows, and splitting on whitespace is a guess the
# product would make 232 times and get wrong on every "van der Berg", "Maria del Carmen" and
# mononym. This is identity; being confidently wrong is worse than being incomplete.
FULL_NAME_KEY = "essential_full_name"

AVAILABLE_DATES_KEY = "essential_available_dates"
MAX_DATES_KEY = "essential_max_dates"
TIER_PREFERENCE_KEY = "essential_tier_preference"
TABLE_CHOICE_KEY = "essential_table_choice"
TABLE_SHARE_EMAIL_KEY = "essential_table_share_email"
SECTION_RANKING_KEY = "essential_section_ranking"
TABLE_TYPE_RANKING_KEY = "essential_table_type_ranking"

# The labels the applicant sees, shared with error messages so a validation failure names the
# question exactly as the form asked it.
FULL_NAME_LABEL = "Full name"
EMAIL_LABEL = "Email address"
AVAILABLE_DATES_LABEL = "Available dates"
MAX_DATES_LABEL = "Number of dates you want"
TIER_PREFERENCE_LABEL = "Tier preference"
TABLE_CHOICE_LABEL = "Table choice"
TABLE_SHARE_EMAIL_LABEL = "Table-share partner"
SECTION_RANKING_LABEL = "Section preference"
TABLE_TYPE_RANKING_LABEL = "Table type preference"

# Every table holds one full-table vendor or two halves, so these three are the whole space.
# Unlike the other offerings this one is not plan-derived: the organizer does not choose it.
TABLE_CHOICE_FULL = "full"
TABLE_CHOICE_HALF = "half"
TABLE_CHOICE_EITHER = "either"
TABLE_CHOICES = (TABLE_CHOICE_FULL, TABLE_CHOICE_HALF, TABLE_CHOICE_EITHER)

# The sentence the applicant read beside each choice, mirrored by ``TABLE_CHOICES`` in
# ``front-end/src/utils/essentialFields.ts``. Storage keeps the code; this is the one name the
# answer has wherever a human reads it back.
#
# The CSV importer needs it most. It used to match an imported cell against the code, so a column
# exported from the very form this product publishes - full of "A whole table to myself" - was
# reported as not matching the market, and the only correction on offer was ``full``: a word the
# applicant never saw and the organizer had no reason to connect to the sentence in front of them.
TABLE_CHOICE_LABELS = {
    TABLE_CHOICE_FULL: "A whole table to myself",
    TABLE_CHOICE_HALF: "Half a table, shared",
    TABLE_CHOICE_EITHER: "Either is fine",
}


def table_choice_labels() -> List[str]:
    """Every table choice as the applicant saw it, in the order the form offers them."""
    return [TABLE_CHOICE_LABELS[choice] for choice in TABLE_CHOICES]


def table_choice_for_label(text: Any) -> Optional[str]:
    """The stored code for a choice named as the applicant saw it, or None for anything else.

    The code is accepted too, so a file that already holds ``full`` is not sent round the
    reconciliation screen to be told it means ``full``.
    """
    normalized = str(text or "").strip().casefold()
    for code, label in TABLE_CHOICE_LABELS.items():
        if normalized in (code, label.casefold()):
            return code
    return None

# STUB until the floorplan ships. Table type is a property of an individual TABLE, not of its
# section - any table in any section may be any type - so only a floorplan can truly describe it,
# and the floorplan GUI is out of MVP scope. Until then every market offers exactly one type, so
# the ranking is suppressed by the fewer-than-two rule and the question is never asked. The field
# and its validation stay in place; only a real offering is missing.
STUB_TABLE_TYPE = "Standard"


# The answers a change to which invalidates a review. An organizer approved a vendor on the
# strength of what they saw; if their availability or tier moves afterwards, the approval is stale
# and the solver would place someone against constraints nobody accepted. Kept here, beside the
# contract itself, so there is one list rather than one per caller.
#
# Custom answers are deliberately absent: a corrected business name or Instagram handle changes
# nothing the solver reads. That stops being true when priority rules can name a custom field
# (E02), at which point a market's priority targets join this set.
SOLVER_RELEVANT_KEYS = (
    AVAILABLE_DATES_KEY,
    MAX_DATES_KEY,
    TIER_PREFERENCE_KEY,
    TABLE_CHOICE_KEY,
    TABLE_SHARE_EMAIL_KEY,
    SECTION_RANKING_KEY,
    TABLE_TYPE_RANKING_KEY,
)


# Every essential question except the table-share partner, which is optional by design: most
# applicants have nobody in mind, and one who names nobody is paired with whoever else wants a
# half table.
#
# Stated in full rather than derived from ``SOLVER_RELEVANT_KEYS``. It used to be
# ``tuple(key for key in SOLVER_RELEVANT_KEYS if key != TABLE_SHARE_EMAIL_KEY)`` - required-ness
# DEFINED AS solver-relevance-minus-one - and the name broke that: it is required because identity
# is, and it is not solver-read, so correcting a spelling must not invalidate a review.
REQUIRED_ESSENTIAL_KEYS = (
    FULL_NAME_KEY,
    AVAILABLE_DATES_KEY,
    MAX_DATES_KEY,
    TIER_PREFERENCE_KEY,
    TABLE_CHOICE_KEY,
    SECTION_RANKING_KEY,
    TABLE_TYPE_RANKING_KEY,
)


# The only essential questions a market may declare it does not ask (E01/F06).
#
# Both are RANKINGS, and that is the whole of the rule. The solver gives a vendor their best-ranked
# option still open and never excludes anyone for a ranking, so declaring one unasked and storing a
# uniform default changes nothing but the tie-break. Available dates, tier preference and table
# choice are constraints: a default there invents a commitment the applicant never made, and the
# solver acts on it - placing someone on a day they cannot attend, or at a price they refused.
#
# Adding a key here means asserting that same property of it. Do not add one without it.
UNASKABLE_ESSENTIAL_KEYS = (SECTION_RANKING_KEY, TABLE_TYPE_RANKING_KEY)


def unaskable_essential_error(keys: Optional[List[str]]) -> Optional[str]:
    """Why this market may not declare these questions unasked, or None.

    The refusal names the key, because the caller is an organizer mapping a spreadsheet and the
    key is what they chose.
    """
    for key in keys or []:
        if key not in UNASKABLE_ESSENTIAL_KEYS:
            return (
                f"'{key}' cannot be left unasked. Only a preference ordering may be "
                f"({', '.join(UNASKABLE_ESSENTIAL_KEYS)}); every other essential question decides "
                "where or whether a vendor is placed, so a default would answer for them."
            )
    return None


def asks_ranking(offered: Any) -> bool:
    """Is a ranking over this offering actually a question?

    Fewer than two options is not: there is exactly one order, so asking for it gains nothing
    and asking someone to rank a list of one reads as a bug. This is the offering-empty rule
    generalised, and it applies to rankings only - a single offered date or tier is still a real
    question, because the applicant may be unable or unwilling to take it.
    """
    return len(offered or []) >= 2


def asked_essential_keys(options: EssentialFormOptions) -> frozenset:
    """Which essential questions an offering actually asks.

    A question with nothing to offer is not asked, so it is not required and stores its empty
    value. This is the one statement of that rule: ``validated_essential_answers`` applies it
    when accepting an applicant's answers, and the solver's input translation applies it when
    deciding whether an approved application is complete enough to place. Two copies of it would
    drift, and the drift would show up as the solver rejecting answers the form had accepted.

    Note what ``dates`` gates. A market with no dates has nothing to be assigned to, so the
    questions about how many dates the applicant wants and how they want to occupy a table are
    not questions either.
    """
    # The name is the one question with NO condition, and that is deliberate rather than an
    # oversight: every other essential question is gated on the plan offering something to answer
    # about, and identity does not depend on the plan. A market with no dates, no tiers and no
    # sections still needs to know who is applying.
    asked = {FULL_NAME_KEY}
    if options.dates:
        asked.update({
            AVAILABLE_DATES_KEY,
            MAX_DATES_KEY,
            TABLE_CHOICE_KEY,
            TABLE_SHARE_EMAIL_KEY,
        })
    if options.tiers:
        asked.add(TIER_PREFERENCE_KEY)
    if asks_ranking(options.sections):
        asked.add(SECTION_RANKING_KEY)
    if asks_ranking(options.table_types):
        asked.add(TABLE_TYPE_RANKING_KEY)
    # A question the market has declared it does not ask is not asked - the last word, and the
    # reason this lives here rather than in each caller. Only rankings can reach this list
    # (``unaskable_essential_error`` is what enforces that on the way in), so removing one can
    # never drop a constraint the solver relies on.
    return frozenset(asked - set(options.unasked or []))


def plan_derived_asked_keys(options: EssentialFormOptions) -> frozenset:
    """The asked questions that depend on the market plan offering something.

    Identity does not, which is why the name is excluded here and only here.

    Two readers, and they must stay the same two: ``FormHasFieldsGuard``, which blocks a market
    from opening applications when its form asks nothing, and ``application_write._asks_nothing``,
    which refuses an application to such a market. What both are really asking is whether the
    market plan offers anything to apply *for*. A name asked unconditionally means the essential
    count is never zero, so reading ``asked_essential_keys`` here would make both of them unable
    to say no - silently, with their docstrings still claiming otherwise.
    """
    return asked_essential_keys(options) - {FULL_NAME_KEY}


def offering_for_key(key: str, options: EssentialFormOptions) -> List[str]:
    """What a given essential question offered, so an answer can be checked against it.

    Returns an empty list for the questions whose answer is not drawn from the market plan
    (how many dates, how to occupy a table, who to share with); those are validated by shape,
    not by membership.
    """
    if key == AVAILABLE_DATES_KEY:
        return list(options.dates)
    if key == TIER_PREFERENCE_KEY:
        return list(options.tiers)
    if key == SECTION_RANKING_KEY:
        return list(options.sections)
    if key == TABLE_TYPE_RANKING_KEY:
        return list(options.table_types)
    return []


def normalized_names(values: Any) -> List[str]:
    """Trimmed, non-blank, order-preserving unique strings from a stored list answer."""
    return _unique_names(values)


def solver_relevant_change(before: Dict[str, Any], after: Dict[str, Any]) -> bool:
    """Did an answer the solver reads actually change?

    Both sides are compared AFTER normalisation, so a re-export that merely reformats a value -
    reordering a multi-select, changing whitespace - is not a change. Treating it as one would
    un-approve a market's worth of vendors for nothing.
    """
    for key in SOLVER_RELEVANT_KEYS:
        if before.get(key) != after.get(key):
            return True
    return False


def _unique_names(values: Any) -> List[str]:
    """Trimmed, non-blank, order-preserving unique strings."""
    seen: List[str] = []
    if not isinstance(values, list):
        return seen
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.append(text)
    return seen


def essential_options_from_setup(setup: Optional[Dict[str, Any]]) -> EssentialFormOptions:
    """The essential questions' offering, read from the market plan.

    ``setup`` is a snake_case dict of ``SetupObject`` (a ``model_dump()``, or a stored
    ``setupObject`` converted through ``convert_keys_to_snake_case``). A market with no plan
    yet offers nothing - the applicant form omits questions whose offering is empty.
    """
    if not isinstance(setup, dict):
        return EssentialFormOptions()

    dates = _unique_names([
        md.get("date")
        for md in setup.get("market_dates") or []
        if isinstance(md, dict)
    ])
    sections = _unique_names([
        section.get("name")
        for section in setup.get("sections") or []
        if isinstance(section, dict)
    ])
    tiers = _unique_names([
        tier.get("name")
        for tier in setup.get("tiers") or []
        if isinstance(tier, dict)
    ])

    # STUB: one type for every market, whatever floorplans it carries. See STUB_TABLE_TYPE.
    table_types = [STUB_TABLE_TYPE]

    return EssentialFormOptions(
        dates=dates, sections=sections, table_types=table_types, tiers=tiers,
    )


def _with_unasked(options: EssentialFormOptions, unasked: List[str]) -> EssentialFormOptions:
    """Carry the form's declaration onto the offering, whether frozen or live.

    The declaration lives on the form because it is the organizer's, and durable. It is carried on
    the OPTIONS because ``asked_essential_keys`` takes only an offering - so every caller of that
    one rule sees it without knowing it exists.
    """
    if not unasked:
        return options
    return options.model_copy(update={"unasked": unasked})


def effective_essential_options(market_doc: Dict[str, Any]) -> EssentialFormOptions:
    """What the essential questions offer for this market, frozen or live.

    A stored snapshot (``applicationForm.essentialOptions``) wins: it is what an applicant's
    recorded answers were validated against, and it never moves. Absent one, the offering is
    the market plan as it stands.

    Callers hand in the raw stored (camelCase) market document; the projection must include
    ``applicationForm`` and ``setupObject``.
    """
    form_doc = market_doc_field(market_doc, "application_form")
    unasked = []
    if isinstance(form_doc, dict):
        stored = form_doc.get(snake_to_camel("unasked_essentials"))
        if isinstance(stored, list):
            unasked = [str(key) for key in stored]

        snapshot = form_doc.get(snake_to_camel("essential_options"))
        if isinstance(snapshot, dict):
            return _with_unasked(essential_options_from_snapshot(snapshot), unasked)

    setup_doc = market_doc_field(market_doc, "setup_object")
    setup = convert_keys_to_snake_case(setup_doc) if isinstance(setup_doc, dict) else None
    return _with_unasked(essential_options_from_setup(setup), unasked)


def effective_essential_options_for_market(market: Market) -> EssentialFormOptions:
    """``effective_essential_options`` over a parsed ``Market``: same rule, other representation.

    A frozen snapshot on the form wins; absent one, the offering is the market plan as it
    stands.
    """
    form = market.application_form
    unasked = list(form.unasked_essentials) if form is not None else []
    if form is not None and form.essential_options is not None:
        return _with_unasked(form.essential_options, unasked)
    setup = market.setup_object.model_dump() if market.setup_object else None
    return _with_unasked(essential_options_from_setup(setup), unasked)


def essential_options_from_snapshot(snapshot: Dict[str, Any]) -> EssentialFormOptions:
    """Parse a stored (camelCase) ``essentialOptions`` snapshot."""
    data = convert_keys_to_snake_case(snapshot)
    return EssentialFormOptions(
        dates=_unique_names(data.get("dates")),
        sections=_unique_names(data.get("sections")),
        table_types=_unique_names(data.get("table_types")),
        tiers=_unique_names(data.get("tiers")),
    )


def essential_options_payload(options: EssentialFormOptions) -> Dict[str, Any]:
    """The camelCase wire/persisted shape of an offering."""
    return convert_keys_to_camel_case(options.model_dump())


def freeze_essential_options(
    markets_collection: Any, market_id: str, options: EssentialFormOptions,
) -> None:
    """Persist the offering the first recorded answer was validated against.

    Written once: the filter matches only while no snapshot is stored - ``None`` in a Mongo
    filter matches both a missing key and the explicit ``null`` the form save writes - so the
    first applicant save is the freeze point and concurrent saves cannot fight over it. The
    form must already be an object on the document - a dot-path ``$set`` onto a market with no
    form would conjure a fieldless one.
    """
    form_key = market_doc_key("application_form")
    snapshot_key = f"{form_key}.{snake_to_camel('essential_options')}"
    markets_collection.update_one(
        {
            "id": market_id,
            form_key: {"$type": "object"},
            snapshot_key: None,
        },
        {"$set": {snapshot_key: essential_options_payload(options)}},
    )


def freeze_and_effective_essential_options(
    markets_collection: Any, market_id: str, options: EssentialFormOptions,
) -> EssentialFormOptions:
    """Freeze the offering and return the one that actually governs the save.

    Called before an applicant's answers are persisted, so no answer can ever be recorded
    against an unfrozen offering. The freeze attempt is atomic and first-writer-wins; the
    re-read serves whichever snapshot won (ours, or a concurrent save's). A caller must
    re-validate its answers when the returned offering differs from the one it validated
    against, because that means another save froze a different offering first.
    """
    freeze_essential_options(markets_collection, market_id, options)
    form_key = market_doc_key("application_form")
    setup_key = market_doc_key("setup_object")
    market_doc = markets_collection.find_one(
        {"id": market_id}, {form_key: 1, setup_key: 1},
    )
    return effective_essential_options(market_doc or {})


# -- Applicant answer validation ---------------------------------------------------------------


def validated_essential_answers(
    incoming: Dict[str, Any], options: EssentialFormOptions,
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Validate an applicant's essential answers against what the form offered.

    Returns ``(error_message, stored_answers)``; when ``error_message`` is not None the save
    must be refused. Questions whose offering is empty are not asked, so they are not required
    and store their empty value.

    STUBBED PRODUCT DECISIONS (deliberately minimal until the product owner rules):
      - Rankings are TOTAL: an applicant ranks every offered section / table type, and the
        stored list must be a permutation of the offering. A partial ranking ("only the ones I
        want") is not accepted yet.
      - ``max_dates`` is bounded by the number of OFFERED dates only. Its relation to the
        applicant's own available dates is not validated here; a consumer should treat the
        effective cap as ``min(max_dates, len(available_dates))``.
    """
    stored: Dict[str, Any] = {}

    error = _validate_full_name(incoming, stored)
    if error:
        return error, {}

    error = _validate_accepted_subset(
        incoming, AVAILABLE_DATES_KEY, AVAILABLE_DATES_LABEL, "date", options.dates, stored,
    )
    if error:
        return error, {}

    error = _validate_max_dates(incoming, options, stored)
    if error:
        return error, {}

    error = _validate_tiers_per_date(incoming, options, stored)
    if error:
        return error, {}

    error = _validate_table_choice(incoming, options, stored)
    if error:
        return error, {}

    _store_table_share_email(incoming, options, stored)

    # A question the market declared it does not ask offers nothing, which is the path
    # ``_validate_ranking`` already takes for a question with nothing to offer: it stores the empty
    # value and requires no answer. Routing "unasked" through the SAME path rather than adding a
    # second one is what keeps ``asked_essential_keys`` the one statement of requiredness.
    asked = asked_essential_keys(options)

    error = _validate_ranking(
        incoming, SECTION_RANKING_KEY, SECTION_RANKING_LABEL,
        options.sections if SECTION_RANKING_KEY in asked else [], stored,
    )
    if error:
        return error, {}

    error = _validate_ranking(
        incoming, TABLE_TYPE_RANKING_KEY, TABLE_TYPE_RANKING_LABEL,
        options.table_types if TABLE_TYPE_RANKING_KEY in asked else [], stored,
    )
    if error:
        return error, {}

    return None, stored


def _validate_full_name(incoming: Dict[str, Any], stored: Dict[str, Any]) -> Optional[str]:
    """The applicant's name, required on every save because identity does not depend on the plan.

    Stored stripped and otherwise exactly as written: a name is not a value drawn from an offering
    and there is nothing to match it against, so there is nothing here to normalize beyond the
    whitespace a form adds.

    Only NEW saves are held to this. Stored applications are not re-validated, and the solver names
    the keys it reads explicitly rather than looping over everything the form asks - so an
    application written before the name existed still assigns, which is what makes this need no
    migration.
    """
    raw = incoming.get(FULL_NAME_KEY)
    value = str(raw).strip() if raw is not None else ""
    if not value:
        return f"'{FULL_NAME_LABEL}' is required."
    stored[FULL_NAME_KEY] = value
    return None


def _validate_tiers_per_date(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> Optional[str]:
    """Which tiers the applicant accepts, ON EACH DATE they can attend.

    Tier is a hard filter and it sets the price, so this is answered per date rather than once for
    the whole application. A single set for the market would let the solver place someone at a tier
    they offered on one day and charge them for it on another - and a real form promises the
    opposite, in writing, to the applicant.

    Availability is still its own answer, so the two have to agree: every available date needs
    tiers, and no other date may carry any. Disagreement is refused rather than reconciled, because
    either reconciliation invents an answer - dropping a date the applicant ticked, or adding one
    they did not.
    """
    if not options.tiers:
        stored[TIER_PREFERENCE_KEY] = {}
        return None

    available = list(stored.get(AVAILABLE_DATES_KEY) or [])
    raw = incoming.get(TIER_PREFERENCE_KEY)

    if not isinstance(raw, dict):
        return (
            f"'{TIER_PREFERENCE_LABEL}' is required. Choose the tiers you would accept on each "
            "date you are available."
        )

    per_date: Dict[str, List[str]] = {}
    for date in available:
        given = raw.get(date)
        if not isinstance(given, list) or not given:
            return (
                f"'{TIER_PREFERENCE_LABEL}' is missing for {date}. Choose at least one tier for "
                "every date you are available, or remove that date."
            )
        names = [str(name).strip() for name in given if str(name).strip()]
        if not names:
            return (
                f"'{TIER_PREFERENCE_LABEL}' is missing for {date}. Choose at least one tier for "
                "every date you are available, or remove that date."
            )
        invalid = [name for name in names if name not in options.tiers]
        if invalid:
            return (
                f"'{TIER_PREFERENCE_LABEL}' for {date} contains a tier this market does not "
                f"offer: {invalid[0]}"
            )
        if len(set(names)) != len(names):
            return f"'{TIER_PREFERENCE_LABEL}' repeats a tier for {date}."
        # Stored in the market plan's order, so every consumer reads one canonical ordering - the
        # same rule the flat answer followed before it became per-date.
        per_date[date] = [tier for tier in options.tiers if tier in set(names)]

    extra = [date for date in raw if date not in available and _unique_names(raw.get(date))]
    if extra:
        return (
            f"'{TIER_PREFERENCE_LABEL}' names tiers for {', '.join(sorted(extra))}, which is not "
            "among the dates you said you are available."
        )

    stored[TIER_PREFERENCE_KEY] = per_date
    return None


def _validate_accepted_subset(
    incoming: Dict[str, Any],
    key: str,
    label: str,
    noun: str,
    offered: List[str],
    stored: Dict[str, Any],
) -> Optional[str]:
    """An answer that ACCEPTS some of what is offered: at least one, nothing invented, no repeats.

    Unlike a ranking this is deliberately not total - accepting a subset is a complete answer.
    That is what separates the hard filters (dates, tiers) from the preferences (sections, table
    types): what an applicant leaves out here, they are refusing.

    Because the accepted values are an explicit list of offered names, membership is exact. The
    tier check the solver used to make was ``table.tier.name in <the applicant's answer string>``,
    a substring test in which a tier named 'A' matched an answer of 'AB'; that confusion is not
    expressible in this shape.
    """
    if not offered:
        stored[key] = []
        return None

    raw = incoming.get(key)
    if raw is None or raw == []:
        return f"'{label}' is required. Select at least one {noun}."
    if not isinstance(raw, list):
        return f"'{label}' requires one or more of the offered {noun}s."

    chosen = [str(value).strip() for value in raw]
    for value in chosen:
        if value not in offered:
            return f"'{label}' contains a {noun} this market does not offer: {value}"
    if len(set(chosen)) != len(chosen):
        return f"'{label}' repeats a {noun}."

    # Stored in the market plan's order, so every consumer reads one canonical ordering.
    stored[key] = [value for value in offered if value in chosen]
    return None


def _validate_max_dates(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> Optional[str]:
    if not options.dates:
        stored[MAX_DATES_KEY] = None
        return None

    raw = incoming.get(MAX_DATES_KEY)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return f"'{MAX_DATES_LABEL}' is required."

    if isinstance(raw, bool):
        return f"'{MAX_DATES_LABEL}' must be a whole number."
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        try:
            value = int(raw.strip())
        except ValueError:
            return f"'{MAX_DATES_LABEL}' must be a whole number."
    elif isinstance(raw, float) and raw.is_integer():
        value = int(raw)
    else:
        return f"'{MAX_DATES_LABEL}' must be a whole number."

    if value < 1:
        return f"'{MAX_DATES_LABEL}' must be at least 1."
    if value > len(options.dates):
        return (
            f"'{MAX_DATES_LABEL}' cannot exceed the {len(options.dates)} date(s) "
            f"this market offers."
        )

    stored[MAX_DATES_KEY] = value
    return None


def _validate_table_choice(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> Optional[str]:
    """Whole table, half a table, or either.

    Gated on the dates offering for the same reason ``max_dates`` is: a market with no dates has
    nothing to be assigned to, so there is no question to ask. The choices themselves are fixed -
    they describe how a table can be occupied, which is not the organizer's to configure.

    Required when asked, because the half-table machinery has no default that is safe to guess:
    seating someone at half a table they did not ask for, or holding a whole one for someone who
    would have shared, are both worse than making them answer.
    """
    if not options.dates:
        stored[TABLE_CHOICE_KEY] = None
        return None

    raw = incoming.get(TABLE_CHOICE_KEY)
    value = str(raw).strip().lower() if raw is not None else ""
    if not value:
        return f"'{TABLE_CHOICE_LABEL}' is required."
    if value not in TABLE_CHOICES:
        return (
            f"'{TABLE_CHOICE_LABEL}' must be one of: {', '.join(TABLE_CHOICES)}."
        )

    stored[TABLE_CHOICE_KEY] = value
    return None


def _store_table_share_email(
    incoming: Dict[str, Any], options: EssentialFormOptions, stored: Dict[str, Any],
) -> None:
    """Who the applicant would like to share a table with. Optional, and usually empty.

    Never a validation failure: most applicants have nobody in mind, and one who names nobody is
    paired with whoever else wants a half table - possibly a stranger. An address that matches no
    other applicant falls back to that same behaviour, so a typo costs the pairing, not the
    application.
    """
    if not options.dates:
        stored[TABLE_SHARE_EMAIL_KEY] = ""
        return

    raw = incoming.get(TABLE_SHARE_EMAIL_KEY)
    stored[TABLE_SHARE_EMAIL_KEY] = str(raw).strip() if raw is not None else ""


def _validate_ranking(
    incoming: Dict[str, Any],
    key: str,
    label: str,
    offered: List[str],
    stored: Dict[str, Any],
) -> Optional[str]:
    # See ``asks_ranking``: fewer than two options is not a question.
    if not asks_ranking(offered):
        stored[key] = []
        return None

    raw = incoming.get(key)
    if raw is None or raw == []:
        return f"'{label}' is required. Rank every option, best first."
    if not isinstance(raw, list):
        return f"'{label}' must be an ordered list of the offered options."

    ranked = [str(value).strip() for value in raw]
    for value in ranked:
        if value not in offered:
            return f"'{label}' contains an option this market does not offer: {value}"
    if len(set(ranked)) != len(ranked):
        return f"'{label}' repeats an option."
    if len(ranked) != len(offered):
        # Stub: total ranking required (see the module docstring).
        missing = [value for value in offered if value not in ranked]
        return f"'{label}' must rank every option. Missing: {', '.join(missing)}"

    stored[key] = ranked
    return None
