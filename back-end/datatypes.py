import uuid
from enum import Enum
from typing import List, Optional, Union, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator


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
    table_choice: str  # "Full table" or "Half table - Left" or "Half table - Right"
    section: str
    tier: str
    location: str

class PriorityObject(BaseModel):
    id: int
    col_name_idx: int
    data_type: DataType
    sorting_order: str


class MarketDateObject(BaseModel):
    date: str
    col_name_idx: int
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
    # use_totally_random_assignment: bool
    # use_maximum_capacity_assignment: bool


class SetupObject(BaseModel):
    col_names: List[str]
    col_values: List[List[str]]
    col_include: List[bool]
    enum_priority_order: List[List[str]]
    priority: List[PriorityObject]
    market_dates: List[MarketDateObject]
    tiers: List[TierObject]
    locations: List[LocationObject]
    sections: List[SectionObject]
    assignment_options: AssignmentOptionObject


class ModificationObject(BaseModel):
    pass  # Empty for now, can be extended later


class AssignmentStatistics(BaseModel):
    total_vendors: int
    total_tables: int
    total_assignments: int
    total_assigned_vendors: int
    total_assigned_tables: int
    unassigned_vendors: List[str]
    unassigned_tables: Dict[str, List[str]]
    assignments_per_date: Dict[str, int]
    assignments_per_tier: Dict[str, int]
    assignments_per_section: Dict[str, int]
    assignments_per_table_choice: Optional[Dict[str, int]] = None
    satisfaction_score: float


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
