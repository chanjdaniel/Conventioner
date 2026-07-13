import logging
import uuid
from enum import Enum
from typing import List, Optional, Union, Dict, Any, Tuple
from pydantic import BaseModel, Field, ConfigDict, computed_field, field_validator, model_validator
from datetime import datetime

logger = logging.getLogger(__name__)


class DataType(str, Enum):
    DEFAULT = "Select a datatype"
    STRING = "String"
    NUMBER = "Number"
    ENUM = "Enum"
    CONTAINS = "Contains"
    NOT_CONTAINS = "Does not contain"


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


class OrganizationRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class ThemeObject(BaseModel):
    primary_color: str
    secondary_color: str
    logo_url: Optional[str] = None

class VendorAssignmentResult(BaseModel):
    email: str
    date: str
    table_code: str
    table_choice: str  # "Full Table" or "Half Table (Left)" or "Half Table (Right)"
    section: str
    tier: str
    location: str


class MarketTableRow(BaseModel):
    date: str
    assignment: List[str]
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str

class PriorityObject(BaseModel):
    id: int
    col_name_idx: Optional[int] = None
    data_type: DataType
    sorting_order: str


class MarketDateObject(BaseModel):
    date: str
    col_name_idx: Optional[int] = None
    col_name: Optional[str] = None


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


class AssignmentOptionObject(BaseModel):
    max_assignments_per_vendor: Optional[int] = None
    max_half_table_proportion_per_section: Optional[int] = None
    # For assignment: email / table_choice / table_share must be set (column index). No legacy names.
    email_col_name_idx: Optional[int] = None
    table_choice_col_name_idx: Optional[int] = None
    table_share_email_col_name_idx: Optional[int] = None
    # None = no per-vendor max-days limit from CSV (only global caps). Mapped empty cell = same.
    max_days_col_name_idx: Optional[int] = None
    # use_totally_random_assignment: bool
    # use_maximum_capacity_assignment: bool


class SetupObject(BaseModel):
    col_names: List[str] = []
    col_values: List[List[str]] = []
    col_include: List[bool] = []
    enum_priority_order: List[List[str]] = []
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
    satisfaction_score: float

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
    discord_guild_id: Optional[str] = None  # Per-market Discord guild reference (D4 integration seam)
    discord_webhook_url: Optional[str] = None  # Per-market Discord webhook target for assignment notifications

    @computed_field
    def is_draft(self) -> bool:
        """Derived strictly from phase -- never independently writable.

        True when the market is in its draft (setup) phase, False once published/archived.
        Every read of a stored document goes through ``market_from_document``, which
        overrides the phase to its effective value, so the two can never disagree.
        """
        return self.phase == MarketPhase.DRAFT

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
    key: str                       # machine name (e.g., "business_name")
    label: str                     # human label (e.g., "Business Name")
    type: str                      # "text", "number", "select", "multi_select", "checkbox", "date", "email", "file"
    required: bool = False
    options: List[str] = []        # for select/multi_select
    help_text: Optional[str] = None
    order: int = 0                 # display order


class ApplicationForm(BaseModel):
    fields: List[FormField]
    published_at: Optional[str] = None  # locks form when applications exist (D9)


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
    otp: Optional[str] = None             # for email-key login
    otp_expires: Optional[str] = None
    otp_attempts: int = 0
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
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str


class MarketTableRowContract(ContractModel):
    assignment: List[str]
    date: str
    location: str
    section: str
    table_choice: str
    table_code: str
    tier: str


class PriorityContract(ContractModel):
    col_name_idx: Optional[int] = None
    data_type: DataType
    id: int
    sorting_order: str


class MarketDateContract(ContractModel):
    col_name: Optional[str] = None
    col_name_idx: Optional[int] = None
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
    col_include: List[bool] = []
    col_names: List[str] = []
    col_values: List[List[str]] = []
    enum_priority_order: List[List[str]] = []
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
    satisfaction_score: float
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


class ApplicationFormContract(ContractModel):
    fields: List[FormFieldContract]
    published_at: Optional[str] = None


class MarketSchemaContract(ContractModel):
    application_form: Optional[ApplicationFormContract] = None
    assignment_object: AssignmentObjectContract
    creation_date: str
    discord_guild_id: Optional[str] = None
    discord_webhook_url: Optional[str] = None
    id: str
    is_draft: Optional[bool] = None
    modification_list: List[ModificationObject]
    name: str
    organization_id: Optional[str] = None
    phase: Optional[str] = None
    review_config: Optional[Dict[str, Any]] = None
    roles: Dict[str, str]
    setup_object: Optional[SetupObjectContract]
    user_role: Optional[str] = None
