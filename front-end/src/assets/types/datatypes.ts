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
    MAX_ASSIGNMENTS_PER_VENDOR: number | null,
    MAX_HALF_TABLE_PROPORTION_PER_SECTION: number | null,
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

export interface AssignmentObject {

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