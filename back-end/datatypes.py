import logging
import re
import unicodedata
import uuid
from enum import Enum
from typing import List, Literal, Optional, Union, Dict, Any, Tuple
from pydantic import (
    BaseModel, ConfigDict, Field, PrivateAttr, computed_field, field_validator, model_validator,
)
from datetime import datetime

logger = logging.getLogger(__name__)


def market_name_slug(name: str) -> str:
    """The URL path segment a market name is reachable under.

    The front end builds every public link from the same rule
    (``marketNameToKebabSlug`` in ``front-end/src/utils/marketSlug.ts``): decompose to NFKD and
    drop combining marks, so an accented name and its ASCII fold produce the same segment. A
    second copy of this rule that skips the fold does not merely differ in style - it computes
    ``caf-market`` where the link says ``cafe-market``, and every lookup behind that link 404s.
    So there is one copy, and every public slug lookup goes through it.

    It lives here, beside the model, because ``Market.slug`` is derived from it: the slug is
    persisted so that a public lookup is one indexed query rather than a decode of every market,
    and a stored value derived by anything other than the rule the links are built from would be
    a market nobody can reach.
    """
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name.strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


class MarketRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class MarketPhase(str, Enum):
    DRAFT = "draft"
    # The one stage in which applications arrive and are reviewed at once (E38/F04/S01): shown
    # "Review" on a Google Form market and "Applications" on one whose vendors apply on its page
    # (``phase_label``). It replaced ``applications_open``, ``applications_closed`` and ``review``;
    # ``migrations/migrate_to_one_stage.py`` moves the markets stored in them.
    APPLICATIONS = "applications"
    ASSIGNMENT = "assignment"
    OFFERS = "offers"
    MARKET_DAYS = "market_days"
    ARCHIVED = "archived"


def phase_label(phase: MarketPhase, intake_mode: Optional["IntakeMode"] = None) -> str:
    """A phase as a person reads it: ``market_days`` -> ``Market Days``.

    Derived from the stored value rather than kept as a second table beside
    ``front-end/src/utils/phase.ts``'s ``PHASE_LABELS``. Two hand-maintained maps of the phase
    spine is exactly the drift ``_validate_registry`` exists to refuse elsewhere, and this
    transform reproduces every one of the front end's labels exactly - which ``test_phase_label``
    pins, so a phase whose label does not survive the derivation fails here rather than reaching an
    organizer as ``market_days``.

    The stage is the one phase each path names its own way (E38/F04/S01): a Google Form market's
    applications are all imported when it begins, so on that path it is "Review", as
    ``CSV_PHASE_LABELS`` in ``front-end/src/utils/marketGuide.ts`` says.
    """
    if phase is MarketPhase.APPLICATIONS and intake_mode is IntakeMode.CSV:
        return "Review"
    return phase.value.replace("_", " ").title()


#: The phases E38/F04/S01 folded into ``applications``, read as it for one release so the deploy can
#: come before ``migrations/migrate_to_one_stage.py`` (Daniel's choice, review of T94): read, never
#: written back. A later release drops them once the migration has run on every database.
LEGACY_STAGE_PHASES = ("applications_open", "applications_closed", "review")
#: The old phases an own-form market's form was closed in: ``review`` was reached only through
#: ``applications_closed``.
LEGACY_CLOSED_PHASES = ("applications_closed", "review")


def _legacy_stage_phase(document: Dict[str, Any]) -> MarketPhase:
    """An old stage phase as the migration would leave it: the stage, or, for a Google Form market
    that imported nothing, draft, since the stage is entered by a first import."""
    if intake_mode_from_market_document(document) is IntakeMode.CSV:
        import api.applications as ApplicationsApi

        if ApplicationsApi.count_applications_for_market(document.get("id", "")) == 0:
            return MarketPhase.DRAFT
    return MarketPhase.APPLICATIONS


def applications_stopped_from_market_document(document: Dict[str, Any]) -> bool:
    """Whether a stored market has stopped taking applications (E38/F04/S02).

    The stored fact when there is one; else, for a form market still stored in an old closed phase,
    true, as the migration would set it, since its form was closed.
    """
    if "applicationsStopped" in document:
        return bool(document["applicationsStopped"])
    return (
        document.get("phase") in LEGACY_CLOSED_PHASES
        and intake_mode_from_market_document(document) is IntakeMode.FORM
    )


def phase_from_market_document(document: Dict[str, Any]) -> MarketPhase:
    """Effective phase of a stored market document.

    Documents written before the phase field existed carry only ``isDraft``
    (older ones ``is_draft``). This is the single source of truth for the
    draft/archived mapping applied to them; ``migrations/migrate_phase.py``
    backfills the field with the very same mapping, so a market behaves
    identically before and after the migration runs.

    Callers pass raw stored documents, which no write path validates on the way
    out of Mongo, so a phase value this build does not recognize degrades to the
    same mapping rather than raising and taking down whatever list is being served.
    """
    stored_phase = document.get("phase")
    if stored_phase in LEGACY_STAGE_PHASES:
        return _legacy_stage_phase(document)
    if stored_phase:
        try:
            return MarketPhase(stored_phase)
        except ValueError:
            logger.warning(
                "Market %s stores unrecognized phase %r; falling back to the isDraft mapping",
                document.get("id"),
                stored_phase,
            )

    is_draft = document.get("isDraft", document.get("is_draft", True))
    return MarketPhase.DRAFT if is_draft else MarketPhase.ARCHIVED


class IntakeMode(str, Enum):
    """How vendors reach a market: imported by the organizer, or applying themselves.

    Exactly one, never both. Hybrid intake is plausible eventually, but nothing needs it yet and
    a third value can be added later without disturbing either of these two.

    This is not the same question as the phase. Application submission is already gated to
    ``applications``, but a CSV market is in that phase too -- it is where its imported responses
    are reviewed -- so its public application form would be live and taking applications from
    strangers the organizer never meant to hear from. The phase cannot tell the two intakes apart;
    this is what does.
    """

    CSV = "csv"
    FORM = "form"


def intake_mode_from_market_document(document: Dict[str, Any]) -> IntakeMode:
    """Effective intake mode of a stored market document.

    Absence means CSV, so the public applicant surface is off unless a market says otherwise.
    Of the two possible mistakes, wrongly exposing a public application surface is worse than
    wrongly hiding one: hiding is visible and gets complained about, exposing is silent until a
    stranger applies. The same reasoning that made ``phase_from_market_document`` refuse to guess
    from a Mongo condition applies here, so this is the one place the question is answered.

    Callers pass raw stored documents, which no write path validates on the way out of Mongo, so
    a value this build does not recognize degrades to CSV rather than raising and taking down
    whatever list is being served.

    Reading degrades; it does not write. This function touches no document, so a market nobody
    edits keeps whatever it stores. The next write to that market is a different matter: every
    writer persists the effective value, so an unrecognized one is normalized to ``csv`` then --
    which is the repair, not a loss, since ``csv`` is already the only answer every reader gives it.

    ``intakeMode`` is the only spelling read, because it is the only spelling written. There is no
    snake_case fallback here and there must never be one: every write camel-cases the whole
    document, so a legacy key would hold a value that is stale for ever. This field is newer than
    that convention, so no stored document can carry the other spelling in the first place.
    """
    stored = document.get("intakeMode")
    if not stored:
        return IntakeMode.CSV
    try:
        return IntakeMode(stored)
    except ValueError:
        logger.warning(
            "Market %s stores unrecognized intake mode %r; falling back to csv",
            document.get("id"),
            stored,
        )
        return IntakeMode.CSV


class OrganizationRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class ThemeObject(BaseModel):
    primary_color: str
    secondary_color: str
    logo_url: Optional[str] = None

# The three seats a row may be assigned as, in one spelling for the solver, its check and the
# placement routes. A table holds two seats, and a placement therefore always names a side:
# "the vendor at Front Row 1" is not an address anyone can stand at.
FULL_TABLE = "Full Table"
HALF_TABLE_LEFT = "Half Table (Left)"
HALF_TABLE_RIGHT = "Half Table (Right)"
TABLE_CHOICES = (FULL_TABLE, HALF_TABLE_LEFT, HALF_TABLE_RIGHT)

class VendorAssignmentResult(BaseModel):
    """One vendor in one seat on one date - the whole of what a placement is.

    ``hand_placed`` is the pin. A pin is not a separate constraint object alongside the
    assignment: it IS this row, flagged, which is why pinning before any solver run works with
    no extra machinery - it writes a row early, and the solver places everyone else around it.
    Two records could disagree, and the failure mode of disagreement is a vendor pinned to one
    table and placed at another, which is the exact bug pins exist to prevent.
    """

    email: str
    date: str
    table_code: str
    table_choice: str  # "Full Table" or "Half Table (Left)" or "Half Table (Right)"
    section: str
    tier: str
    location: str
    hand_placed: bool = False


class MarketTableRow(BaseModel):
    """One table on one date, and who is at it.

    ``assignment`` is the occupants and nothing else, so its length is how many seats are taken.
    ``assignment_slots`` is the same table seat by seat - ``[left, right]``, ``None`` for vacant -
    because which side is free is a fact the occupant list cannot carry: one email in a list of
    one says somebody is here, not which half of the table they are sitting at. Nothing could put
    a vendor on the right with the left empty until pins could (E11), and then the grid drew them
    on the left.
    """

    date: str
    assignment: List[str]
    assignment_slots: List[Optional[str]] = [None, None]
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str

# An organizer need not enumerate every answer: whatever they leave out sorts where this token
# sits, and last when they did not place it at all.
ALL_OTHERS = "<All others>"

# A priority rule may target an attribute of the application itself rather than a question the
# organizer asked. First come, first served is probably the most common tiebreaker there is, and
# no form question can supply it - a field-only design would force organizers to fake it with a
# "what time is it" question.
#
# The namespace keeps the two kinds of target apart for good: form field keys are held to
# ``^[a-z0-9_]+$`` by the form builder, so a key can never contain a dot and can never collide
# with one of these.
# Named ...RULE_TARGET, not ...TARGET: ``csv_import`` has its own SUBMITTED_AT_TARGET meaning the
# import-mapping target, which is a different thing entirely.
BUILT_IN_TARGET_PREFIX = "application."
SUBMITTED_AT_RULE_TARGET = "application.submitted_at"
APPLICATION_TYPE_RULE_TARGET = "application.application_type"


class PriorityDirection(str, Enum):
    """Which end of an ordered target sorts first. Derived from the target's type, never declared."""

    ASCENDING = "ascending"
    DESCENDING = "descending"


class PriorityObject(BaseModel):
    """One rule in the ordered list that decides who is placed first when demand exceeds tables.

    A rule names a ``target`` and carries its own ``ordering``. It used to name a column by index
    into ``col_names`` and keep its ordering in ``SetupObject.enum_priority_order``, a parallel
    array with one entry required per column - the index arithmetic behind a well-known
    ``IndexError`` trap, and an addressing scheme that dies with the columns.

    It also used to carry a ``data_type`` the solver read nothing from, so a rule an organizer
    configured as a number in ascending order scored every vendor identically and did nothing,
    silently. How to order a target follows from that target's type, so declaring it separately
    only ever made an invalid state representable.
    """

    id: int
    target: Optional[str] = None
    ordering: List[str] = []
    # Only meaningful for a target ordered by magnitude rather than by an arrangement of named
    # answers: a number, a date, a yes/no. Which of the two a rule uses follows from its target.
    direction: Optional[PriorityDirection] = None


class MarketDateObject(BaseModel):
    """One day of a market. A date is a date.

    It used to also carry the spreadsheet column heading that asked about that day, and the
    index of that column, because the solver looked a vendor's answer up by heading and dated
    every placement by it. Both are gone with the spreadsheet.
    """

    date: str


class TierObject(BaseModel):
    id: int
    name: str


def new_id() -> str:
    """A new random id, as every stored row's ``id`` default is minted."""
    return str(uuid.uuid4())


class LocationObject(BaseModel):
    #: Stable across renames, since a layout names its location by it (T257); a stored location
    #: written before ids is given one by ``fill_plan_ids`` as its plan is read.
    id: str = Field(default_factory=new_id)
    name: str


class SectionObject(BaseModel):
    #: Stable across renames, since a layout's table names its section by it (T257). Every other
    #: reader, the solver and the form's offering among them, still matches sections by name.
    id: str = Field(default_factory=new_id)
    name: str
    location: Optional[LocationObject] = None
    tier: Optional[TierObject] = None
    count: int


#: The namespace ``fill_plan_ids`` derives a missing id in: fixed, so a stored row written before
#: ids reads with the same id on every read until a write stores it (T257).
PLAN_ID_NAMESPACE = uuid.UUID("6f1c2e0a-5b7d-4c39-9a8e-2d4b1f3c7e65")


def _derived_id(*parts: str) -> str:
    return str(uuid.uuid5(PLAN_ID_NAMESPACE, "\x1f".join(parts)))


def _has_id(row: Dict[str, Any]) -> bool:
    return isinstance(row.get("id"), str) and bool(row["id"].strip())


def fill_plan_ids(setup: Dict[str, Any]) -> Dict[str, Any]:
    """The plan with an id on every location and section that has none, and each section's copy of
    its location carrying that location's id (T257).

    A missing id is derived from the row's names and its place among rows of the same names, never
    drawn at random: a market stored before ids is parsed on every read, and a random id would
    differ from one read to the next, so the plan a Market Setup tab read and writes back would
    never equal the stored one and a settled setup would refuse every autosave. A stored id is
    kept. ``migrations/migrate_layouts.py`` stores what this gives, so a tab open across the
    migration keeps writing the same ids.

    Works on the plan's dict, snake or camel-cased alike (its keys here are single words), and
    returns a copy; anything that is not the expected shape is left for the model to refuse.
    """
    if not isinstance(setup, dict):
        return setup
    filled = dict(setup)
    seen: Dict[Tuple[str, ...], int] = {}

    def _with_id(row: Any, *names: str) -> Any:
        if not isinstance(row, dict) or not all(isinstance(name, str) for name in names):
            return row
        place = seen.get(names, 0)
        seen[names] = place + 1
        if _has_id(row):
            return row
        return {**row, "id": _derived_id(*names, str(place))}

    location_ids: Dict[str, str] = {}
    known_ids: set = set()
    if isinstance(setup.get("locations"), list):
        filled["locations"] = [
            _with_id(location, "location", location.get("name") if isinstance(location, dict) else None)
            for location in setup["locations"]
        ]
        for location in filled["locations"]:
            if isinstance(location, dict) and isinstance(location.get("name"), str):
                location_ids.setdefault(location["name"], location.get("id"))
            if isinstance(location, dict) and _has_id(location):
                known_ids.add(location["id"])
    if isinstance(setup.get("sections"), list):
        sections = []
        for section in setup["sections"]:
            if not isinstance(section, dict):
                sections.append(section)
                continue
            location = section.get("location")
            location_name = location.get("name") if isinstance(location, dict) else None
            section = _with_id(
                section, "section", location_name if isinstance(location_name, str) else "",
                section.get("name"))
            if isinstance(location_name, str):
                # A copy naming a location by its id keeps it, whatever name it still carries (two
                # locations' names swapped); one of no such id is matched by its name.
                if _has_id(location) and location["id"] in known_ids:
                    location_id = location["id"]
                else:
                    location_id = location_ids.get(location_name) or (
                        location.get("id") if _has_id(location) else _derived_id(
                            "location", location_name, "0"))
                section = {**section, "location": {**location, "id": location_id}}
            sections.append(section)
        filled["sections"] = sections
    return filled


def table_code_for(section_name: str, index: int) -> str:
    """The organizer-facing name of one table: its section and its number within that section.

    One function because there were two, spelled the same way and both wrong: the solver and the
    tables endpoint each built ``section.name + str(n)``, which reads "Front Row1" wherever a
    table is named. The code is also the key the two sides match on, so a separator added in one
    place and not the other would silently unassign every table.
    """
    return f"{section_name} {index}"


def table_code_sort_key(table_code: str) -> Tuple[str, int, str]:
    """Order table codes the way a person counts, not the way a string sorts.

    Lexicographic order put "Front Row 10", "Front Row 11" and "Front Row 12" between 1 and 2, so
    table 2 was fifth in the list. Splitting the trailing number out and sorting it as a number
    fixes the order without needing to know how the code was built.

    A code with no trailing number sorts by its text alone, after the numbered ones in its group,
    rather than raising: anything that reaches a list of tables has to be listed somewhere.
    """
    text = str(table_code or "")
    digits = len(text)
    while digits > 0 and text[digits - 1].isdigit():
        digits -= 1
    if digits == len(text):
        return (text, 0, text)
    return (text[:digits], int(text[digits:]), text)


class AssignmentOptionObject(BaseModel):
    # None = the organizer named no ceiling, so each vendor is bounded by their own answer and by
    # how many dates they can attend. There is no hidden default standing in for the four-day
    # constant this replaced.
    max_assignments_per_vendor: Optional[int] = None
    max_half_table_proportion_per_section: Optional[int] = None


#: The currencies the Pricing card offers, as ISO 4217 codes; ``front-end/src/utils/pricing.ts``
#: lists the same. One per market, Canadian dollars unless the organizer picks another.
PRICING_CURRENCIES = ("CAD", "USD", "EUR", "GBP", "AUD", "NZD")


class TierPrice(BaseModel):
    """One tier's price for a full table on one market day, in the currency's minor unit (cents).

    A list of these rather than a map keyed by tier name: every market write camel-cases its keys,
    and a tier's name is the organizer's text, not a key to rewrite.
    """

    tier: str
    cents: int = Field(ge=0, le=10_000_000, strict=True)


#: Field keys become document keys inside ``Application.form_data``, where a dot or a leading
#: ``$`` cannot be addressed by Mongo update operators. Keys are held to the slug charset the
#: builder produces so no key can ever be unaddressable; the form write holds a field to it, and the
#: plan write a price group's condition, whose key reaches a projection (``pricing.pricing_refusal``).
FORM_FIELD_KEY_PATTERN = re.compile(r"^[a-z0-9_]+$")


class AnswerCondition(BaseModel):
    """A choice question and the answers to it that meet the condition: an automatic rejection's
    rule, and a price group's condition (``rejection_rules.Rulebook`` judges both)."""
    key: str
    answers: List[str] = []


class PriceGroup(BaseModel):
    """A row of the Pricing card above "Everyone else" (E43/F01/S02): a group the organizer names,
    the conditions on a vendor's answers that must all hold for them to be in it, and its price per
    tier, as ``everyone_else`` holds them. A tier it does not price is priced for its members by
    another group they are in, or by "Everyone else" (``pricing.Groups``)."""

    name: str
    conditions: List[AnswerCondition] = Field(default_factory=list)
    prices: List[TierPrice] = Field(default_factory=list)


class PricingObject(BaseModel):
    """The Pricing card on Market Setup (E43/F01/S01): what one table costs for one market day.

    ``groups`` are the rows the organizer names, each priced per tier, and ``everyone_else`` is the
    fixed last row, for a vendor in no group; a tier the row does not name has no price, and a
    market with no prices shows none anywhere. A half table costs ``half_table_percent`` of the full
    price, rounded half up to the cent (``pricing.half_price``).
    """

    currency: str = "CAD"
    half_table_percent: int = Field(default=50, ge=0, le=100, strict=True)
    groups: List[PriceGroup] = Field(default_factory=list)
    everyone_else: List[TierPrice] = Field(default_factory=list)

    @field_validator("currency")
    @classmethod
    def _offered_currency(cls, value: str) -> str:
        if value not in PRICING_CURRENCIES:
            raise ValueError(f"must be one of {', '.join(PRICING_CURRENCIES)}")
        return value


class PaymentEntry(BaseModel):
    """One payment a vendor made, as an organizer records it (E44/F01/S01): the amount in whole
    cents of the market's currency, how it was paid, the day it was paid, and an optional note.

    Strict, so an amount sent as text or with a fraction of a cent is refused rather than read; a
    payment is never zero or negative: money given back is a refund, recorded as its own entry.
    """

    model_config = ConfigDict(extra="forbid")

    cents: int = Field(ge=1, le=10_000_000, strict=True)
    #: How the organizers take a payment (Daniel, T92 Q7).
    method: Literal["e-transfer", "cash"]
    paid_on: str
    note: str = Field(default="", max_length=500, strict=True)

    @field_validator("paid_on")
    @classmethod
    def _a_day(cls, value: str) -> str:
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except (TypeError, ValueError):
            raise ValueError("must be a date, YYYY-MM-DD") from None

    @field_validator("note")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        return value.strip()


class SetupObject(BaseModel):
    priority: List[PriorityObject]
    market_dates: List[MarketDateObject]
    tiers: List[TierObject]
    locations: List[LocationObject]
    sections: List[SectionObject]
    assignment_options: AssignmentOptionObject
    #: One per location that has a layout (T257), written only by ``POST /floorplans/save-to-market``;
    #: the plan write keeps the stored ones whatever its body carries.
    floorplans: Optional[List["FloorplanObject"]] = None
    #: Null on a market that was never priced, which shows no price anywhere.
    pricing: Optional[PricingObject] = None
    #: The market's table types, which a layout's tables are sized by (T257); never written by the
    #: plan write, which keeps the stored ones like ``floorplans``.
    table_types: List["TableTypeObject"] = []

    @model_validator(mode="before")
    @classmethod
    def _every_row_has_an_id(cls, data: Any) -> Any:
        return fill_plan_ids(data)


class ModificationObject(BaseModel):
    pass  # Empty for now, can be extended later


class UnassignedTableEntry(BaseModel):
    table_code: str
    table_choice: str


class AssignmentStatistics(BaseModel):
    total_vendors: int
    total_tables: int
    total_assignments: int
    total_assigned_vendors: int
    total_assigned_tables: int
    unassigned_vendors: List[str]
    unassigned_tables: Dict[str, List[UnassignedTableEntry]]
    assignments_per_date: Dict[str, int]
    assignments_per_tier: Dict[str, int]
    assignments_per_section: Dict[str, int]
    assignments_per_table_choice: Optional[Dict[str, int]] = None
    # None when nobody could be scored - no vendors, or none with a date they could attend. A
    # float there would read as "satisfied nobody" rather than "nothing to satisfy", which is what
    # made an empty run report 0.0% as though it were a bad result.
    satisfaction_score: Optional[float] = None

    @field_validator("unassigned_tables", mode="before")
    @classmethod
    def normalize_unassigned_tables(cls, value):
        """Back-compat: allow old shape Dict[str, List[str]] from persisted markets."""
        if not isinstance(value, dict):
            return value

        normalized: Dict[str, List[Dict[str, str]]] = {}
        for date, entries in value.items():
            if not isinstance(entries, list):
                normalized[date] = []
                continue

            normalized_entries: List[Dict[str, str]] = []
            for entry in entries:
                if isinstance(entry, str):
                    normalized_entries.append({
                        "table_code": entry,
                        "table_choice": "Unknown",
                    })
                    continue
                if isinstance(entry, dict):
                    table_code = str(
                        entry.get("table_code")
                        or entry.get("tableCode")
                        or entry.get("code")
                        or ""
                    ).strip() or "(unknown table)"
                    table_choice = str(
                        entry.get("table_choice")
                        or entry.get("tableChoice")
                        or "Unknown"
                    ).strip() or "Unknown"
                    normalized_entries.append({
                        "table_code": table_code,
                        "table_choice": table_choice,
                    })
            normalized[date] = normalized_entries

        return normalized


class AssignmentObject(BaseModel):
    vendor_assignments: List[VendorAssignmentResult] = []
    assignment_date: str = ""  # When the assignment was performed
    assignment_statistics: Optional[AssignmentStatistics] = None
    # What the run read, one fingerprint per group (E22/F03/S01, ``assignment/made_from.py``).
    # Written only by a run; None on an assignment made before it existed.
    made_from: Optional[Dict[str, str]] = None
    # How many times the rows have been written; each write is conditional on the count it read,
    # so two changes at once never store one over the other (``api/placements.py``). 0 on an
    # assignment written before it existed.
    revision: int = 0


class MappingAuthor(str, Enum):
    """Who wrote a market's saved import mapping (E30/F02/S01)."""

    #: The form started from the Google Form's responses (E24): its decisions are not the organizer's.
    START = "start"
    #: An import of the file, by the organizer.
    IMPORT = "import"


class ImportMapping(BaseModel):
    """How the organizer's CSV columns were mapped, kept so a re-import opens ready to confirm.

    Columns are recorded by HEADER TEXT, never by position. A form whose questions are reordered
    exports the same headers in a different order, and a mapping keyed on position would then map
    every answer to the wrong question without a word. Text also makes "this column is gone" and
    "this column is new" answerable, which is what the re-import screen has to say.
    """
    # target key -> the header text of each column serving it (several when a grid spells one
    # question across many columns).
    targets: Dict[str, List[str]] = {}
    # The whole header row as it stood, so a header that has since appeared can be called new.
    headers: List[str] = []
    # target key -> raw cell value -> the market's own name for it, or None meaning "ignore".
    resolutions: Dict[str, Dict[str, Optional[str]]] = {}
    saved_at: Optional[str] = None
    # Who wrote it. The import says which, because a first import that called the start's choices
    # "your last import" and "one you chose to ignore" described decisions the organizer never made
    # (E30/F02). A mapping saved before this was recorded was an import's: the start came later.
    made_by: MappingAuthor = MappingAuthor.IMPORT


class ExampleOptions(BaseModel):
    """A column's answers read both ways as choices: whole answers, or the options inside them."""
    select: List[str] = []
    multi_select: List[str] = []


class ExampleColumn(BaseModel):
    """What a market started from a Google Form's responses keeps of one column (E38/F02/S01).

    Only what the Review step showed and the privacy view lets through: the organizer's own
    heading, and the options at least 3 applicants chose that name nobody (``csv_proposal``); and,
    for an option to offer, every answer that no pattern finds naming someone (ADR 0023).
    """
    # The column's heading, or a grid's, as the import mapping names them.
    headers: List[str] = []
    # The key a question made from it has, or would have: the link to the form and the mapping.
    key: str
    label: str
    help_text: Optional[str] = None
    # What the start read it as, or wrote it as, if it became a question.
    type: str
    # Whether the start made it a question of the organizer's own, rather than left it out.
    question: bool = False
    options: ExampleOptions = Field(default_factory=ExampleOptions)
    # Every answer, served only to someone who may change the form while it can still change
    # (``leave_out_every_answer``). None on a column of mostly different answers, on a market
    # started before they were kept, and to every other reader: the options are all there is.
    answers: Optional[ExampleOptions] = None


class RejectionRule(AnswerCondition):
    """A choice question and the answers to it that reject an application (E33/F03/S01)."""


class Market(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # UUID, immutable primary key
    name: str
    creation_date: str
    roles: Dict[str, MarketRole]  # Map of user_id -> role (must have exactly one OWNER)
    organization_id: Optional[str] = None  # Organization id (uuid)
    theme: Optional[ThemeObject] = None  # Market-specific theme
    setup_object: Optional[SetupObject] = None
    modification_list: List[ModificationObject]
    assignment_object: AssignmentObject
    phase: MarketPhase = MarketPhase.DRAFT  # Market lifecycle phase (single source of truth)
    application_form: Optional["ApplicationForm"] = None  # Application form definition
    # How many times the form's questions were written (T274): a form save carries the revision its
    # copy was read at and is refused when the stored one moved, so two people saving the form never
    # replace each other's questions (``write_application_form``). Server-owned: counted by the form
    # write and the CSV start, never taken from a body. Absent reads as 0.
    form_revision: int = 0
    # How many times the plan was written (T274): a plan save carries the revision its copy was read
    # at and is refused when the stored one moved, so two people planning one market never erase
    # each other's edits (``save_plan``). Server-owned: counted by every writer of ``setup_object``
    # (the plan write, the CSV start, the floorplan save), never taken from a body. Absent reads as 0.
    plan_revision: int = 0
    # Who reviews this market's applications, and whose turn the next arrival is (E38/F07/S02,
    # ADR 0020). Server-owned: only ``review_team.py`` writes it, never a market update body. Absent
    # is no reviewers chosen: first come, first served, as before it existed.
    review_team: Optional["ReviewTeam"] = None
    # Which answers a reviewer reads first (E19/F03/S01).
    #
    # ON THE MARKET, never on the form. The form freezes at the first application, and an organizer
    # learns which answers they actually needed WHILE REVIEWING - after that moment. A flag on a
    # `FormField` would freeze exactly when it becomes knowable, and could never mark the ESSENTIAL
    # answers, which are derived from the plan rather than being form fields at all.
    #
    # A list of answer keys, so it names both kinds uniformly. Absent means nothing is marked,
    # which renders the card exactly as it did before this existed - so no migration.
    review_highlights: Optional[List[str]] = None
    # Whether the organizer chose that nothing leads the card (T206): an absent and an empty list
    # both mean "nothing is marked", so neither can say anyone decided it. Server-owned: only
    # ``save_review_highlights`` writes it, true only while the list holds nothing. Absent is false.
    nothing_leads_the_card: bool = False
    # Which answers reject an application automatically (E33/F03), ON THE MARKET beside the
    # highlights and for the same reason: they stay editable after the form locks, while the review
    # is open (`review_is_open`). `rejection_rules.py` owns what a rule may say. Absent is none.
    rejection_rules: Optional[List[RejectionRule]] = None
    # Whether the organizer chose no automatic rejections (T206), as ``nothing_leads_the_card`` is
    # for the highlights: only ``save_rejection_rules`` writes it, true only while there is no rule.
    no_automatic_rejections: bool = False
    results_published: bool = False  # Organizer-controlled gate: verdicts hidden from applicants until flipped
    # Whether the organizer has stopped taking applications, inside the stage (E38/F04/S02): a fact
    # about the applicant form, not a phase (ADR 0005), so reviewing goes on. Server-owned: only
    # ``set_applications_stopped`` writes it. Entering assignment closes the form whatever it says.
    applications_stopped: bool = False
    # Server-owned: written only by the CSV import endpoint, never by a market update body.
    import_mapping: Optional["ImportMapping"] = None
    # Server-owned: written only by the start from a Google Form's responses (``csv_start``), so the
    # Questions tab can offer what the example file said without the file. Absent on any other.
    example_columns: Optional[List[ExampleColumn]] = None
    # Organizer-settable while the market is a draft, through the plan write; fixed once it is not.
    intake_mode: IntakeMode = IntakeMode.CSV
    # Every phase this market entered, in order (E26/F06/S03). Server-owned: `create_market` writes
    # the first entry and `apply_phase_transition` the rest, in the update that moves the phase;
    # no request body can write it. `phase_record` reads it. Empty on a market that predates it.
    phase_history: List["PhaseEntry"] = Field(default_factory=list)
    # The rows of the table this market differs on (E39/F01/S03), by action id; a row it does not
    # hold reads its built-in default, so absent is the built-in table and needs no migration.
    # Server-owned: written only by its owner's one write (`set_permission`, `reset_permission`).
    permissions: Dict[str, "MarketPermission"] = Field(default_factory=dict)
    # The Discord server it is connected to (E46/F01/S02). Server-owned: only the Discord card's
    # routes write it. Absent is not connected.
    discord: Optional["DiscordConnection"] = None
    # The stored document this market was parsed from, as it was read: what a write judged on this
    # market holds (``market_write.write_market``). Set only by ``market_from_document``, carried by
    # ``model_copy``, never served or dumped; None on a market built in code rather than read.
    _stored_document: Optional[Dict[str, Any]] = PrivateAttr(default=None)

    @field_validator("permissions", mode="before")
    @classmethod
    def drop_unreadable_permissions(cls, value: Any) -> Dict[str, Any]:
        """Keep only the stored rows this build can read, so a row of the wrong shape reads as no
        row held - its built-in default - rather than failing the whole market's parse. A role or
        source it does not know is kept here and read as the default by ``api.market_actions``."""
        if not isinstance(value, dict):
            return {}
        return {
            action_id: row for action_id, row in value.items()
            if isinstance(row, MarketPermission) or (
                isinstance(row, dict)
                and isinstance(row.get("role"), str) and isinstance(row.get("source"), str))
        }

    @computed_field
    def is_draft(self) -> bool:
        """Derived strictly from phase -- never independently writable.

        True when the market is in its draft (setup) phase, False once published/archived.
        Every read of a stored document goes through ``market_from_document``, which
        overrides the phase to its effective value, so the two can never disagree.
        """
        return self.phase == MarketPhase.DRAFT

    @computed_field
    def slug(self) -> str:
        """Derived strictly from the name -- never independently writable.

        The slug is the market's public identifier: it is what every public URL names, and what
        the unauthenticated slug lookup resolves. It is persisted, and indexed, because the
        alternative is deriving it per document on every one of those requests - which makes an
        unauthenticated read of one market a decode of every market in the database.

        Deriving it here, rather than stamping it at each write site, is what keeps a stored slug
        from ever contradicting the name it belongs to: a rename dumps the model, and the model
        has only one answer. See ``market_name_slug`` for the rule, ``normalize_market_document``
        for the documents written before this field existed, and note that a stored slug is a
        cached derivation, never an authority - ``market_by_slug`` re-checks the name.
        """
        return market_name_slug(self.name)

    @model_validator(mode='after')
    def validate_single_owner(self):
        """Ensure exactly one owner in roles dict."""
        owner_count = sum(1 for role in self.roles.values() if role == MarketRole.OWNER)
        if owner_count == 0:
            raise ValueError("Market must have exactly one owner")
        elif owner_count > 1:
            raise ValueError("Market must have exactly one owner")
        return self


def _id_list(value: Any) -> List[Any]:
    """A stored list of ids as a list, anything else read as an empty one."""
    return list(value) if isinstance(value, list) else []


def people_from_lists(owner: Any, admins: Any, members: Any) -> Dict[str, str]:
    """An organization's three old lists folded into one map of people (T283, ADR 0025).

    The owner gets ``owner``, then each id in ``admins`` not yet placed gets ``admin``, then each
    id in ``members`` not yet placed gets ``member``, in list order, so a person has one place and
    the owner wins over any list they also stand in. A value that is not a list reads as an empty
    list; a missing or empty ``owner`` gives a map with no owner, which the model refuses.
    """
    people: Dict[str, str] = {}
    if owner:
        people[owner] = OrganizationRole.OWNER.value
    for ids, place in ((admins, OrganizationRole.ADMIN), (members, OrganizationRole.MEMBER)):
        for user_id in _id_list(ids):
            people.setdefault(user_id, place.value)
    return people


def organization_people_of(document: Dict[str, Any]) -> Dict[str, Any]:
    """A stored organization's people: its ``people`` map when it holds one, else its three old
    lists folded by ``people_from_lists``. Every reader of a raw document reads its people here.

    A ``people`` that is not a map reads as nobody, so a malformed document grants no place; the
    model refuses it, as it refuses any malformed document."""
    if "people" in document:
        people = document["people"]
        return people if isinstance(people, dict) else {}
    return people_from_lists(
        document.get("owner"), document.get("admins"), document.get("members"))


class Organization(BaseModel):
    id: str  # UUID, immutable primary key
    name: str
    # Its people, user id (uuid) to place, exactly one ``owner`` (T283, ADR 0025): the one source
    # of who is in it. ``owner``, ``admins`` and ``members`` are derived from it, in its order.
    people: Dict[str, OrganizationRole]
    owner: str  # User id (uuid), derived from ``people``
    admins: List[str] = []  # 0+ admin user ids, derived from ``people``
    members: List[str] = []  # 0+ member user ids, derived from ``people``
    markets: List[str]  # List of market ids
    theme: Optional[ThemeObject] = None  # Organization theming

    @model_validator(mode='before')
    @classmethod
    def derive_lists_from_people(cls, data: Any) -> Any:
        """Fill ``people`` from the old lists when the input holds none, then set the lists from
        ``people`` whatever the input's lists held: a stored organization whose owner is also an
        admin or a member parses, the owner winning, and the lists can never overlap."""
        if not isinstance(data, dict):
            return data
        data = dict(data)
        if "people" not in data:
            data["people"] = people_from_lists(
                data.get("owner"), data.get("admins"), data.get("members"))
        people = data["people"]
        if isinstance(people, dict):
            placed = {
                place: [user_id for user_id, held in people.items() if held == place]
                for place in OrganizationRole
            }
            owners = placed[OrganizationRole.OWNER]
            # No owner reads as an empty one, so the single-owner check below is what refuses it.
            data["owner"] = owners[0] if owners else ""
            data["admins"] = placed[OrganizationRole.ADMIN]
            data["members"] = placed[OrganizationRole.MEMBER]
        return data

    @model_validator(mode='after')
    def validate_single_owner(self):
        """Ensure exactly one owner in the people map."""
        owners = sum(1 for place in self.people.values() if place == OrganizationRole.OWNER)
        if owners != 1:
            raise ValueError("An organization has exactly one owner")
        return self


class User(BaseModel):
    id: str  # UUID, immutable primary key
    email: str
    password: str
    organizations: List[str]  # Organization ids (uuids)
    email_verified: bool = False
    verification_token: Optional[str] = None
    verification_token_expires: Optional[str] = None
    password_reset_token: Optional[str] = None
    password_reset_token_expires: Optional[str] = None
    otp: Optional[str] = None
    otp_expires: Optional[str] = None
    otp_attempts: int = 0
    # What the session and the remember-me cookie name the account by; a password reset replaces it.
    login_id: Optional[str] = None


class ApplicationStatus(str, Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    REVIEWER_APPROVED = "reviewer_approved"
    REVIEWER_REJECTED = "reviewer_rejected"
    # Not complete: someone must reach out to the applicant first (E34/F02/S01). Undecided, and
    # owned by a person on the market.
    NEEDS_FOLLOW_UP = "needs_follow_up"
    UNASSIGNED = "unassigned"
    ASSIGNED = "assigned"
    ASSIGNMENT_SENT = "assignment_sent"
    VENDOR_ACCEPTED = "vendor_accepted"
    VENDOR_REFUSED = "vendor_refused"
    CANCELLED = "cancelled"


class ApplicationType(str, Enum):
    MAIN = "main"
    WAITLIST = "waitlist"


class FormField(BaseModel):
    key: str                       # machine name (e.g., "business_name"); must not use the reserved "essential_" prefix
    label: str                     # human label (e.g., "Business Name")
    type: str                      # "text", "number", "select", "multi_select", "checkbox", "date", "email", "file"
    required: bool = False
    options: List[str] = []        # for select/multi_select
    help_text: Optional[str] = None
    order: int = 0                 # display order


class EssentialFormOptions(BaseModel):
    """What the essential form questions offer, derived from the market plan.

    The essential questions (available dates, max dates, tier preference, section preference,
    table type preference) are present in every application form; the only thing an organizer
    customises is what they offer, and that offering is the market plan itself: ``dates`` come
    from ``SetupObject.market_dates``, ``sections`` from ``SetupObject.sections``, ``tiers``
    from ``SetupObject.tiers``, and ``table_types`` from the market's floorplan table types.
    See ``essential_fields.py``, the single owner of that derivation.

    A value of this type stored on ``ApplicationForm.essential_options`` is a *frozen*
    offering: it is written by the server the first time an applicant's answers are recorded
    against it (the same principle as the D9 lock - an applicant can never have answered a
    question that moved), and never refreshed afterwards.
    """
    dates: List[str] = []
    sections: List[str] = []
    table_types: List[str] = []
    tiers: List[str] = []

    # Questions this market has declared it does not ask, because its intake cannot answer them
    # (E01/F06). Only RANKINGS may appear here - see essential_fields.UNASKABLE_ESSENTIAL_KEYS.
    # A ranking is a soft preference the solver never filters on, so a uniform default changes
    # nothing but the tie-break; a default for dates, tiers or table choice would invent a
    # commitment the applicant never made.
    unasked: List[str] = []


class DiscordConnection(BaseModel):
    """The Discord server a market is connected to, and what its card chose (E46/F01/S02).

    Written only by ``api.discord_connection``, on its own routes, so it stays editable after the
    rest of Market Setup settles: Discord is a manual tool the organizer runs whenever they choose
    (Daniel, T92 Q10, Q19). Discord's ids are strings, as its API sends them. Every field may be
    None: a market disconnected keeps only the username question, which is about its form. Who
    connected it, and when, is the history's (``discord_connected``), not a field here.
    """

    guild_id: Optional[str] = None
    guild_name: Optional[str] = None
    role_id: Optional[str] = None
    role_name: Optional[str] = None
    #: The key of the form's text question that holds each vendor's Discord username.
    username_question: Optional[str] = None
    invite_link: Optional[str] = None
    #: When "Check Discord" last read the server's members (E46/F01/S03), and what it found of each
    #: vendor then. About this server, so connecting to another one or disconnecting forgets them.
    checked_at: Optional[str] = None
    vendor_states: Optional[List["DiscordVendorState"]] = None
    #: The last "Give roles" run (E46/F01/S04), so its report stays readable. About this server,
    #: and forgotten with it, as the check is.
    role_run: Optional["DiscordRoleRun"] = None
    #: The members an organizer said are not a vendor (E46/F01/S05), by the vendor's application
    #: id: their usernames, never offered to that vendor again as a possible match. Written by
    #: declining an offer, never by a check, and about this server, as the check's fields are.
    declined_matches: Optional[Dict[str, List[str]]] = None


class DiscordVendorState(BaseModel):
    """One vendor as "Check Discord" found them (E46/F01/S03), by their application.

    ``state`` is ``has_role`` (in the server, holding the market's role), ``in_server``,
    ``not_found`` (no member has the username: not joined yet, or the username is wrong, which
    Discord cannot tell apart) or ``no_username`` (the form's question has no answer). A plain
    string, so a state a later build adds never fails an older one's parse.
    """

    application_id: str
    state: str
    #: The username answer as the check read it, the organizer's update in its place, untidied;
    #: None when there was none. A page tells an answer updated since the check by it.
    answer: Optional[str] = None
    #: For a vendor ``not_found``, the members whose username, display name or nickname looks like
    #: the answer (E46/F01/S05): offered for the organizer to confirm, never applied by the check.
    possible_matches: Optional[List["DiscordPossibleMatch"]] = None
    #: How many more members looked alike than ``possible_matches`` holds, past the cap of five;
    #: None for none, so the page can say the list is partial.
    more_matches: Optional[int] = None


class DiscordPossibleMatch(BaseModel):
    """A member of the server who may be the vendor (E46/F01/S05): their username, which confirming
    saves as the vendor's answer, and the names that looked like it, to show the organizer."""

    username: str
    display_name: Optional[str] = None
    nick: Optional[str] = None


class DiscordRoleOutcome(BaseModel):
    """One assigned vendor as a "Give roles" run left them (E46/F01/S04), by their application.

    ``outcome`` is ``given``, ``already_had``, ``not_found`` (no member has the username),
    ``no_username``, ``not_yet`` (the run's time ended before it was asked) or ``failed``, with
    ``reason`` in Conventioner's words for a vendor not given it yet and for a failure. A plain
    string, as a state is, so an outcome a later build adds never fails an older one's parse.
    """

    application_id: str
    outcome: str
    reason: Optional[str] = None


class DiscordRoleRun(BaseModel):
    """The last "Give roles" run: when, the role it gave by the name it had, and each assigned
    vendor's outcome, which the report counts. Who ran it, and its counts, are its history
    entry's too."""

    ran_at: str
    role_name: Optional[str] = None
    outcomes: List[DiscordRoleOutcome] = []


class MarketPermission(BaseModel):
    """One row a market holds of the table (E39/F01/S03): the role it asks, and where it came from.

    Plain strings, not ``MarketRole``, for ``PhaseEntry``'s reason: a stored value this build does
    not know must not fail the whole market's parse, and ``Market`` drops a stored row of the wrong
    shape for the same reason (``drop_unreadable_permissions``). ``api.market_actions`` reads a row
    it cannot understand as the built-in default, as it reads a row the market does not hold.
    ``source`` is ``market`` (changed on this market by its owner) or ``organization`` (copied from
    the organization's default, E39/F02).
    """

    role: str
    source: str


class PhaseEntry(BaseModel):
    """One phase a market entered: which, when, and who moved it there (E26/F06/S03).

    ``phase`` is a plain string, not ``MarketPhase``: Pydantic validates an enum on construction, so
    a stored phase this build does not recognize would fail the whole market's parse - the reason
    ``market_from_document`` withholds ``phase`` itself.

    ``entered_at`` is None on exactly one kind of entry: the first of a record begun partway
    through a market's life, naming the phase it was already in (``phase_record.push_entries``).
    """

    phase: str
    entered_at: Optional[str] = None
    by: Optional[str] = None


class ApplicationForm(BaseModel):
    fields: List[FormField]
    published_at: Optional[str] = None  # locks form when applications exist (D9)
    # Server-owned frozen offering of the essential questions; None until the first
    # applicant answer freezes it. Never writable by a client (see _normalized_application_form).
    essential_options: Optional[EssentialFormOptions] = None
    # Essential questions this market has declared it does not ask, because its intake cannot
    # answer them (E01/F06). Organizer-settable, unlike essential_options above, and durable:
    # the offering is derived or frozen, so a declaration stored there would be lost. Only
    # RANKINGS may appear - essential_fields.unaskable_essential_error enforces that on write.
    unasked_essentials: List[str] = []


class VerdictGiver(BaseModel):
    """Who gave an application its verdict (E34/F01/S01): a person, or an automatic rule (E33/F03).

    A person is named by id, and by the address they signed in with, which the review shows; a rule
    by the question it judges. Stored on the application beside the status, in the same update.
    """
    kind: Literal["person", "rule"]
    user_id: Optional[str] = None
    email: Optional[str] = None
    rule: Optional[str] = None


class MarketPerson(BaseModel):
    """Someone with a role on a market, named by id and the address they sign in with."""
    user_id: Optional[str] = None
    email: str

    def as_giver(self) -> "VerdictGiver":
        """This person as the giver of a verdict."""
        return VerdictGiver(kind="person", user_id=self.user_id, email=self.email)

    def as_wire(self) -> Dict[str, Any]:
        """As the organizer's views read a person: ``{userId, email}``."""
        return {"userId": self.user_id, "email": self.email}


class ReviewTeam(BaseModel):
    """The reviewers chosen for a market's review, and how far the deal has gone (E38/F07/S02).

    ``reviewers`` in the order they are dealt to, by address, so the deal is the same whoever chose
    them; ``turn`` counts the applications dealt since they last changed, so the next arrival goes
    to ``reviewers[turn % len(reviewers)]``. Stored camelCase on the market as ``reviewTeam``.
    """
    reviewers: List[MarketPerson] = Field(default_factory=list)
    turn: int = 0


class AnswerUpdate(BaseModel):
    """An organizer's update of one of a vendor's answers (E41/F01/S01), kept beside the answer the
    vendor gave, which is never written over: the value, who made it, when, and the vendor's answer
    it was made over, so a reader can tell when what they wrote has changed since."""
    value: Any = None
    by: MarketPerson
    at: str
    over: Any = None


class Application(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    market_id: str                        # FK to Market
    applicant_email: str                  # the applicant's email
    form_data: Dict[str, Any]             # { field_key: value }
    status: ApplicationStatus
    application_type: ApplicationType = ApplicationType.MAIN
    main_application_id: Optional[str] = None  # FK for waitlist prefill (D11)
    submitted_at: Optional[str] = None
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    # Whose share it was dealt to (E38/F07/S02, ADR 0020): written only by ``review_team.py``, and
    # never cleared by a verdict, so it stays the record of whose share it was. Absent when it was
    # never dealt. Not who is looking at it now: that is ``held_by``.
    reviewer: Optional[MarketPerson] = None
    # Who gave the verdict, and when (E34/F01/S01). Absent on an application stored before verdicts
    # recorded it, and on one with no verdict: a status that is none clears them.
    verdict_by: Optional[VerdictGiver] = None
    verdict_at: Optional[str] = None
    # Why a rule rejected it, in the organizer's words (E33/F03/S02); never the applicant's to see.
    verdict_reason: Optional[str] = None
    # Who is reaching out, while it needs a follow-up (E34/F02/S01); cleared with that status.
    follow_up_owner: Optional[MarketPerson] = None
    # What its giver's undo returns it to (E38/F10/S01): its status, giver, time and follow-up owner
    # as a person's verdict found them while it awaited one; any other status written clears it,
    # while a follow-up handed on or an answer updated keeps it. The server's own, never served.
    undo_to: Optional[Dict[str, Any]] = None
    # The reviewer looking at it, until ``held_until`` (E34/F03/S02): a lease, renewed while the card
    # stays open and released on a verdict or on moving on. A lapsed one holds nothing.
    held_by: Optional[MarketPerson] = None
    held_until: Optional[str] = None
    # Who recorded a vendor who never applied, and when (E36/F03/S01): approved by the adding, and
    # never an input to the run.
    added_by: Optional[MarketPerson] = None
    added_at: Optional[str] = None
    # The organizer's updates of the vendor's answers, by question (E41/F01/S01): read in the place
    # of the answer in ``form_data``, which stays as the vendor gave it.
    answer_updates: Dict[str, AnswerUpdate] = Field(default_factory=dict)


def to_camel(string: str) -> str:
    parts = string.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class ContractModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AssignmentOptionContract(AssignmentOptionObject, ContractModel):
    """Camel-cased contract view of assignment options from backend datatypes."""


class VendorAssignmentResultContract(ContractModel):
    date: str
    email: str
    hand_placed: bool
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str


class MarketTableRowContract(ContractModel):
    assignment: List[str]
    assignment_slots: List[Optional[str]]
    date: str
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str


class PriorityContract(ContractModel):
    direction: Optional[PriorityDirection] = None
    id: int
    ordering: List[str] = []
    target: Optional[str] = None


class MarketDateContract(ContractModel):
    date: str


class TierContract(ContractModel):
    id: int
    name: str


class LocationContract(ContractModel):
    id: str
    name: str


class SectionContract(ContractModel):
    count: int
    id: str
    location: LocationContract
    name: str
    tier: TierContract


class UnassignedTableEntryContract(ContractModel):
    table_choice: str
    table_code: str


class TierPriceContract(TierPrice, ContractModel):
    pass


class AnswerConditionContract(ContractModel):
    key: str
    answers: List[str]


class PriceGroupContract(ContractModel):
    name: str
    conditions: List[AnswerConditionContract]
    prices: List[TierPriceContract]


class PricingContract(ContractModel):
    currency: str
    half_table_percent: int
    groups: List[PriceGroupContract]
    everyone_else: List[TierPriceContract]


class SetupObjectContract(ContractModel):
    assignment_options: AssignmentOptionContract
    locations: List[LocationContract]
    market_dates: List[MarketDateContract]
    priority: List[PriorityContract]
    sections: List[SectionContract]
    tiers: List[TierContract]
    floorplans: Optional[List["FloorplanObjectContract"]] = None
    pricing: Optional[PricingContract] = None
    table_types: List["TableTypeContract"] = []


class AssignmentStatisticsContract(ContractModel):
    assignments_per_date: Dict[str, int]
    assignments_per_section: Dict[str, int]
    assignments_per_tier: Dict[str, int]
    satisfaction_score: Optional[float]
    total_assigned_tables: int
    total_assigned_vendors: int
    total_assignments: int
    total_tables: int
    total_vendors: int
    unassigned_tables: Dict[str, List[UnassignedTableEntryContract]]
    unassigned_vendors: List[str]


class AssignmentObjectContract(ContractModel):
    assignment_date: str
    vendor_assignments: List[VendorAssignmentResultContract]


class VendorAttendance(BaseModel):
    market_id: str
    vendor_email: str
    date: str
    checked_in_at: str


class VendorAttendanceContract(ContractModel):
    market_id: str
    vendor_email: str
    date: str
    checked_in_at: str


class TableTypeObject(BaseModel):
    """One of the market's table types (``setupObject.tableTypes``, T257): what sizes a layout's
    tables. A type has no colour, since the section colours a table.

    The application form and the solver do not read these yet: they keep the one stubbed type
    (``essential_fields.STUB_TABLE_TYPE``) until a follow-up makes types real. Stored keys this
    model no longer reads (the beta's ``height_mm``, ``max_capacity`` and ``color``) are dropped as
    it parses.
    """

    id: str = Field(default_factory=new_id)
    name: str
    width_mm: float
    depth_mm: float


class BetaTableType(BaseModel):
    """The floorplan beta's table type, which an Auto-Place request and a floorplan template still
    carry, in the shape the beta's wizard sends: a width, a height and a capacity.

    Never the market's types (``TableTypeObject``); it goes with the beta.
    """

    id: str = Field(default_factory=new_id)
    name: str
    width_mm: float
    height_mm: float
    max_capacity: int  # 1 or 2
    color: Optional[str] = None


class WallSegment(BaseModel):
    """A wall of an Auto-Place request; a floorplan stores none (T257)."""

    id: str = Field(default_factory=new_id)
    start: Tuple[float, float]
    end: Tuple[float, float]
    thickness_mm: float
    is_exterior: bool = True


class ObstacleZone(BaseModel):
    """An obstacle of an Auto-Place request; a floorplan stores its zones as ``FloorplanZone``."""

    id: str = Field(default_factory=new_id)
    polygon: List[Tuple[float, float]]
    type: str  # "pillar", "stage", "no_table_zone", "custom"


class AisleConfigObject(BaseModel):
    wall_buffer_mm: float = 1500.0
    table_spacing_mm: float = 1200.0
    walkway_width_mm: float = 2000.0


class FloorplanTable(BaseModel):
    """One table of a layout (T257): a real table of the plan, of a section and a type, numbered.

    ``x_mm`` and ``y_mm`` are its centre, from the floorplan image's top-left corner at the
    floorplan's scale; ``rotation`` is in degrees clockwise. ``section_id`` and ``number`` are null
    on a table in no section. Its name is ``table_code_for(section.name, number)``.
    """

    id: str = Field(default_factory=new_id)
    section_id: Optional[str] = None
    number: Optional[int] = None
    table_type_id: str
    x_mm: float
    y_mm: float
    rotation: float = 0.0


class FloorplanZone(BaseModel):
    """A no-table zone of a layout: a rectangle from its top-left corner, in millimetres."""

    id: str = Field(default_factory=new_id)
    label: str = ""
    x_mm: float
    y_mm: float
    width_mm: float
    depth_mm: float


class LabelPoint(BaseModel):
    x_mm: float
    y_mm: float


class SectionStyle(BaseModel):
    """How a section is drawn on a layout: its colour, an index 1 to 8 of the section palette, and
    where its label stands (null: the drawing places it)."""

    section_id: str
    color: int
    label_at: Optional[LabelPoint] = None


class StartingCount(BaseModel):
    """What Section Setup had typed for a section when its location's layout began."""

    section_id: str
    count: int


class FloorplanObject(BaseModel):
    """A location's layout (T257): the venue's floorplan image, its scale, and the tables over it.

    Reshaped additively and leniently, as stored models are (T272): every field has a default, and
    the beta's fields this model no longer reads (``walls``, ``obstacles``, ``placed_tables``,
    ``sections``, ``table_types``, ``scale_unit``) are dropped as a stored one parses, so a floorplan
    the beta saved reads as one of no location (``location_id`` None), shown nowhere and counted by
    no section, until ``migrations/migrate_layouts.py`` removes it.
    """

    id: str = Field(default_factory=new_id)
    location_id: Optional[str] = None
    #: One more on every write; a write names the one it read.
    revision: int = 0
    image_gridfs_id: Optional[str] = None
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    pdf_page: Optional[int] = None
    #: Image pixels per millimetre.
    scale_px_per_unit: Optional[float] = None
    reference_line_start: Optional[Tuple[float, float]] = None
    reference_line_end: Optional[Tuple[float, float]] = None
    reference_line_length_mm: Optional[float] = None
    tables: List[FloorplanTable] = []
    zones: List[FloorplanZone] = []
    section_styles: List[SectionStyle] = []
    starting_counts: List[StartingCount] = []


class FloorplanTemplate(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    owner_user_id: Optional[str] = None
    organization_id: Optional[str] = None
    table_types: List[BetaTableType] = []
    aisles: AisleConfigObject = Field(default_factory=AisleConfigObject)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class TableTypeContract(TableTypeObject, ContractModel):
    pass


class FloorplanTableContract(FloorplanTable, ContractModel):
    pass


class FloorplanZoneContract(FloorplanZone, ContractModel):
    pass


class LabelPointContract(LabelPoint, ContractModel):
    pass


class SectionStyleContract(SectionStyle, ContractModel):
    label_at: Optional[LabelPointContract] = None


class StartingCountContract(StartingCount, ContractModel):
    pass


class AisleConfigContract(AisleConfigObject, ContractModel):
    pass


class FloorplanObjectContract(FloorplanObject, ContractModel):
    tables: List[FloorplanTableContract] = []
    zones: List[FloorplanZoneContract] = []
    section_styles: List[SectionStyleContract] = []
    starting_counts: List[StartingCountContract] = []


class FloorplanTemplateContract(FloorplanTemplate, ContractModel):
    pass


class FormFieldContract(FormField, ContractModel):
    """Camel-cased contract view of an application form field."""


class EssentialFormOptionsContract(EssentialFormOptions, ContractModel):
    """Camel-cased contract view of the essential questions' offering."""


class ApplicationFormContract(ContractModel):
    fields: List[FormFieldContract]
    published_at: Optional[str] = None
    essential_options: Optional[EssentialFormOptionsContract] = None
    unasked_essentials: List[str] = []


class ImportMappingContract(ImportMapping, ContractModel):
    """Camel-cased contract view of a saved CSV import mapping."""


class ExampleOptionsContract(ExampleOptions, ContractModel):
    """Camel-cased contract view of a kept column's two readings."""


class ExampleColumnContract(ExampleColumn, ContractModel):
    """Camel-cased contract view of a column the CSV start kept."""
    options: ExampleOptionsContract = Field(default_factory=ExampleOptionsContract)
    answers: Optional[ExampleOptionsContract] = None


class ServedReviewerContract(ContractModel):
    """A chosen reviewer as the market read serves one: whether they may still review here."""
    email: str
    able: bool


class ServedReviewTeamContract(ContractModel):
    """The market's reviewers as every reader is served them; the turn is never served."""
    reviewers: List[ServedReviewerContract]


class DiscordPossibleMatchContract(DiscordPossibleMatch, ContractModel):
    """Camel-cased contract view of a member offered as a possible match."""


class DiscordRoleOutcomeContract(DiscordRoleOutcome, ContractModel):
    """Camel-cased contract view of one vendor as "Give roles" left them."""


class DiscordRoleRunContract(DiscordRoleRun, ContractModel):
    """Camel-cased contract view of the last "Give roles" run."""

    outcomes: List[DiscordRoleOutcomeContract] = []


class ServedDiscordVendorContract(ContractModel):
    """One vendor as the market read serves them in ``discordVendors`` (E46/F01/S05): the check's
    state, what the pages show, the members still offered and how many more looked alike."""

    application_id: str
    state: str
    shown: str
    possible_matches: List[DiscordPossibleMatchContract]
    more_matches: int


class DiscordConnectionContract(ContractModel):
    """Camel-cased contract view of a market's Discord connection as the market read serves it:
    never the check's stored ``vendor_states`` or the ``declined_matches``, which it leaves out
    (``leave_out_what_is_not_served``), the vendors being served in ``discordVendors``."""

    guild_id: Optional[str] = None
    guild_name: Optional[str] = None
    role_id: Optional[str] = None
    role_name: Optional[str] = None
    username_question: Optional[str] = None
    invite_link: Optional[str] = None
    checked_at: Optional[str] = None
    role_run: Optional[DiscordRoleRunContract] = None


class MarketSchemaContract(ContractModel):
    application_form: Optional[ApplicationFormContract] = None
    form_revision: Optional[int] = None
    plan_revision: Optional[int] = None
    discord: Optional[DiscordConnectionContract] = None
    discord_vendors: Optional[List[ServedDiscordVendorContract]] = None
    example_columns: Optional[List[ExampleColumnContract]] = None
    import_mapping: Optional[ImportMappingContract] = None
    assignment_object: AssignmentObjectContract
    creation_date: str
    id: str
    intake_mode: Optional[str] = None
    is_draft: Optional[bool] = None
    modification_list: List[ModificationObject]
    name: str
    organization_id: Optional[str] = None
    phase: Optional[str] = None
    review_highlights: Optional[List[str]] = None
    nothing_leads_the_card: Optional[bool] = None
    review_team: Optional[ServedReviewTeamContract] = None
    rejection_rules: Optional[List[RejectionRule]] = None
    no_automatic_rejections: Optional[bool] = None
    roles: Dict[str, str]
    permissions: Optional[Dict[str, MarketPermission]] = None
    setup_object: Optional[SetupObjectContract]
