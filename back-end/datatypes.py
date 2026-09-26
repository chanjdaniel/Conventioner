import logging
import re
import unicodedata
import uuid
from enum import Enum
from typing import List, Optional, Union, Dict, Any, Tuple
from pydantic import BaseModel, Field, ConfigDict, computed_field, field_validator, model_validator
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
    APPLICATIONS_OPEN = "applications_open"
    APPLICATIONS_CLOSED = "applications_closed"
    REVIEW = "review"
    ASSIGNMENT = "assignment"
    OFFERS = "offers"
    MARKET_DAYS = "market_days"
    ARCHIVED = "archived"


def phase_label(phase: MarketPhase) -> str:
    """A phase as a person reads it: ``market_days`` -> ``Market Days``.

    Derived from the stored value rather than kept as a second table beside
    ``front-end/src/utils/phase.ts``'s ``PHASE_LABELS``. Two hand-maintained maps of the phase
    spine is exactly the drift ``_validate_registry`` exists to refuse elsewhere, and this
    transform reproduces all eight of the front end's labels exactly - which
    ``test_phase_label`` pins, so a phase whose label does not survive the derivation fails here
    rather than reaching an organizer as ``market_days``.
    """
    return phase.value.replace("_", " ").title()


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
    ``applications_open``, but a CSV market passes through that phase too -- that is where the
    import happens -- so during that window its public application form would be live and taking
    applications from strangers the organizer never meant to hear from. The phase cannot tell the
    two intakes apart; this is what does.
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


class LocationObject(BaseModel):
    name: str


class SectionObject(BaseModel):
    name: str
    location: Optional[LocationObject] = None
    tier: Optional[TierObject] = None
    count: int


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


class SetupObject(BaseModel):
    priority: List[PriorityObject]
    market_dates: List[MarketDateObject]
    tiers: List[TierObject]
    locations: List[LocationObject]
    sections: List[SectionObject]
    assignment_options: AssignmentOptionObject
    floorplans: Optional[List["FloorplanObject"]] = None


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
    review_config: Optional[Dict[str, Any]] = None  # Review configuration (reviewer pool, etc.)
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
    # A form amendment in flight (E20/F03/S01): the phase the market must be returned to once the
    # form has been written. Present ONLY while the chain is walking, so its presence is exactly
    # the question "did a chain stop partway, and where was it going?".
    #
    # Without it a stalled chain is unrecoverable: the organizer would discover from the phase rail
    # that their market is sitting in `draft` mid-import, with nothing saying why or how to finish.
    # Server-owned - only the amendment endpoint writes it.
    form_amendment: Optional["FormAmendment"] = None
    results_published: bool = False  # Organizer-controlled gate: verdicts hidden from applicants until flipped
    # Server-owned: written only by the CSV import endpoint, never by a market update body.
    import_mapping: Optional["ImportMapping"] = None
    # Organizer-settable while the market is a draft, through the plan write; fixed once it is not.
    intake_mode: IntakeMode = IntakeMode.CSV

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
        cached derivation, never an authority - ``published_market_by_slug`` re-checks the name.
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


class Organization(BaseModel):
    id: str  # UUID, immutable primary key
    name: str
    owner: str  # User id (uuid)
    admins: List[str] = []  # 0+ admin user ids
    members: List[str] = []  # 0+ member user ids
    markets: List[str]  # List of market ids
    theme: Optional[ThemeObject] = None  # Organization theming
    
    @model_validator(mode='after')
    def validate_owner_not_in_other_roles(self):
        """Ensure owner is not in admins or members lists."""
        if self.owner in self.admins:
            raise ValueError("Owner cannot be in admins list")
        if self.owner in self.members:
            raise ValueError("Owner cannot be in members list")
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


class ApplicationStatus(str, Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    REVIEWER_APPROVED = "reviewer_approved"
    REVIEWER_REJECTED = "reviewer_rejected"
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


class FormAmendment(BaseModel):
    """Where a form amendment was going, recorded before it moves anything (E20/F03/S01).

    The chain is pre-flight, not rollback: nothing moves until the whole path is known to
    succeed. This exists for the failure pre-flight cannot prevent - a transport failure or a
    concurrent change BETWEEN two hops - so the market can be told where it was headed rather
    than leaving the organizer to work it out from the rail.
    """

    return_phase: str
    started_at: str


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
    assigned_reviewer_id: Optional[str] = None


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
    name: str


class SectionContract(ContractModel):
    count: int
    location: LocationContract
    name: str
    tier: TierContract


class UnassignedTableEntryContract(ContractModel):
    table_choice: str
    table_code: str


class SetupObjectContract(ContractModel):
    assignment_options: AssignmentOptionContract
    locations: List[LocationContract]
    market_dates: List[MarketDateContract]
    priority: List[PriorityContract]
    sections: List[SectionContract]
    tiers: List[TierContract]
    floorplans: Optional[List["FloorplanObjectContract"]] = None


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
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    width_mm: float
    height_mm: float
    max_capacity: int  # 1 or 2
    color: Optional[str] = None


class WallSegment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    start: Tuple[float, float]
    end: Tuple[float, float]
    thickness_mm: float
    is_exterior: bool = True


class ObstacleZone(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    polygon: List[Tuple[float, float]]
    type: str  # "pillar", "stage", "no_table_zone", "custom"


class PlacedTableObject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    table_type_id: str
    x: float
    y: float
    rotation: float = 0.0  # 0 or 90
    width_mm: float
    height_mm: float
    table_code: Optional[str] = None


class FloorplanSectionObject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    location_name: str
    table_ids: List[str] = []
    tier_id: Optional[str] = None


class AisleConfigObject(BaseModel):
    wall_buffer_mm: float = 1500.0
    table_spacing_mm: float = 1200.0
    walkway_width_mm: float = 2000.0


class FloorplanObject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_gridfs_id: Optional[str] = None
    scale_px_per_unit: Optional[float] = None
    scale_unit: str = "mm"
    reference_line_start: Optional[Tuple[float, float]] = None
    reference_line_end: Optional[Tuple[float, float]] = None
    reference_line_length_mm: Optional[float] = None
    table_types: List[TableTypeObject] = []
    walls: List[WallSegment] = []
    obstacles: List[ObstacleZone] = []
    placed_tables: List[PlacedTableObject] = []
    sections: List[FloorplanSectionObject] = []
    image_width: Optional[int] = None
    image_height: Optional[int] = None


class FloorplanTemplate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    owner_user_id: Optional[str] = None
    organization_id: Optional[str] = None
    table_types: List[TableTypeObject] = []
    aisles: AisleConfigObject = Field(default_factory=AisleConfigObject)
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class TableTypeContract(TableTypeObject, ContractModel):
    pass


class WallSegmentContract(WallSegment, ContractModel):
    pass


class ObstacleZoneContract(ObstacleZone, ContractModel):
    pass


class PlacedTableContract(PlacedTableObject, ContractModel):
    pass


class FloorplanSectionContract(FloorplanSectionObject, ContractModel):
    pass


class AisleConfigContract(AisleConfigObject, ContractModel):
    pass


class FloorplanObjectContract(FloorplanObject, ContractModel):
    pass


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


class MarketSchemaContract(ContractModel):
    application_form: Optional[ApplicationFormContract] = None
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
    review_config: Optional[Dict[str, Any]] = None
    review_highlights: Optional[List[str]] = None
    roles: Dict[str, str]
    setup_object: Optional[SetupObjectContract]
    user_role: Optional[str] = None
