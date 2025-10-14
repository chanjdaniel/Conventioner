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
    colNameIdx: int
    dataType: DataType
    sortingOrder: str


class MarketDateObject(BaseModel):
    date: str
    colNameIdx: int


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
    maxAssignmentsPerVendor: Optional[int] = None
    maxHalfTableProportionPerSection: Optional[int] = None
    # use_totally_random_assignment: bool
    # use_maximum_capacity_assignment: bool


class SetupObject(BaseModel):
    colNames: List[str]
    colValues: List[List[str]]
    colInclude: List[bool]
    enumPriorityOrder: List[List[str]]
    priority: List[PriorityObject]
    marketDates: List[MarketDateObject]
    tiers: List[TierObject]
    locations: List[LocationObject]
    sections: List[SectionObject]
    assignmentOptions: AssignmentOptionObject


class ModificationObject(BaseModel):
    pass  # Empty for now, can be extended later


class VendorAssignmentResult(BaseModel):
    email: str
    date: str
    tableCode: str
    tableChoice: str  # "Full table" or "Half table - Left" or "Half table - Right"
    section: str
    tier: str
    location: str

class AssignmentStatistics(BaseModel):
    totalVendors: int
    totalTables: int
    assignmentsPerDate: Dict[str, int]
    assignmentsPerTier: Dict[str, int]
    assignmentsPerSection: Dict[str, int]
    assignmentsPerTableChoice: Optional[Dict[str, int]] = None

class AssignmentObject(BaseModel):
    vendorAssignments: List[VendorAssignmentResult] = []
    assignmentDate: str = ""  # When the assignment was performed
    totalVendorsAssigned: int = 0
    totalTablesAssigned: int = 0
    assignmentStatistics: Optional[AssignmentStatistics] = None


class Market(BaseModel):
    name: str
    owner: str
    creationDate: str
    editors: List[str]
    viewers: List[str]
    setupObject: SetupObject | None = None
    modificationList: List[ModificationObject]
    assignmentObject: AssignmentObject

class Organization(BaseModel):
    name: str
    users: List[str]
    markets: List[str]

class User(BaseModel):
    email: str
    password: str
    organizations: List[str]
    markets: List[str]