export enum DataType {
    Default = "Select a datatype",
    String = "String",
    Number = "Number",
    Enum = "Enum"
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
    count: string,
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
}