from enum import Enum
from typing import List, Optional, Union, Dict, Any
from pydantic import BaseModel


class DataType(str, Enum):
    DEFAULT = "Select a datatype"
    STRING = "String"
    NUMBER = "Number"
    ENUM = "Enum"
    CONTAINS = "Contains"
    NOT_CONTAINS = "Does not contain"


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


class VendorAssignmentResult(BaseModel):
    email: str
    date: str
    table_code: str
    table_choice: str  # "Full table" or "Half table - Left" or "Half table - Right"
    section: str
    tier: str
    location: str


class AssignmentStatistics(BaseModel):
    total_vendors: int
    total_tables: int
    assignments_per_date: Dict[str, int]
    assignments_per_tier: Dict[str, int]
    assignments_per_section: Dict[str, int]
    assignments_per_table_choice: Optional[Dict[str, int]] = None


class AssignmentObject(BaseModel):
    vendor_assignments: List[VendorAssignmentResult] = []
    assignment_date: str = ""  # When the assignment was performed
    total_vendors_assigned: int = 0
    total_tables_assigned: int = 0
    assignment_statistics: Optional[AssignmentStatistics] = None


class Market(BaseModel):
    name: str
    owner: str
    creation_date: str
    editors: List[str]
    viewers: List[str]
    setup_object: Optional[SetupObject] = None
    modification_list: List[ModificationObject]
    assignment_object: AssignmentObject


class Organization(BaseModel):
    name: str
    users: List[str]
    markets: List[str]


class User(BaseModel):
    email: str
    password: str
    organizations: List[str]
    markets: List[str]
