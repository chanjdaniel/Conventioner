export enum DataType {
    Default = "Select a datatype",
    String = "String",
    Number = "Number",
    Enum = "Enum",
    Contains = "Contains",
    NotContains = "Does not contain",
}

export interface PriorityObject {
    id: number,
    colNameIdx: number,
    dataType: DataType,
    sortingOrder: string,
}

export interface MarketDateObject {
    date: string,
    colNameIdx: number,
}

export interface TierObject {
    id: number,
    name: string,
}

export interface LocationObject {
    name: string,
}

export interface SectionObject {
    name: string,
    location: LocationObject | null,
    tier: TierObject | null,
    count: number,
}

export interface AssignmentOptionObject {
    maxAssignmentsPerVendor: number | null,
    maxHalfTableProportionPerSection: number | null,
    // USE_TOTALLY_RANDOM_ASSIGNMENT: boolean,
    // USE_MAXIMUM_CAPACITY_ASSIGNMENT: boolean,
}

export interface SetupObject {
    colNames: string[],
    colValues: string[][],
    colInclude: boolean[],
    enumPriorityOrder: string[][],
    priority: PriorityObject[],
    marketDates: MarketDateObject[],
    tiers: TierObject[],
    locations: LocationObject[],
    sections: SectionObject[],
    assignmentOptions: AssignmentOptionObject,
}

export interface ModificationObject {

}

export interface VendorAssignmentResult {
    email: string,
    date: string,
    tableCode: string,
    tableChoice: string, // "Full table" or "Half table - Left" or "Half table - Right"
    section: string,
    tier: string,
    location: string,
}

export interface AssignmentStatistics {
    totalVendors: number,
    totalTables: number,
    assignmentsPerDate: Record<string, number>,
    assignmentsPerTier: Record<string, number>,
    assignmentsPerSection: Record<string, number>,
    assignmentsPerTableChoice?: Record<string, number>,
}

export interface AssignmentObject {
    vendorAssignments: VendorAssignmentResult[],
    assignmentDate: string, // When the assignment was performed
    totalVendorsAssigned: number,
    totalTablesAssigned: number,
    assignmentStatistics: AssignmentStatistics | null,
}

export interface Market {
    name: string,
    owner: string,
    creationDate: string,
    editors: string[],
    viewers: string[],
    setupObject: SetupObject | null,
    modificationList: ModificationObject[],
    assignmentObject: AssignmentObject,
}