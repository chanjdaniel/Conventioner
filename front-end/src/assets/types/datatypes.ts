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

export interface SectionObject {
    name: string,
    count: number,
}

export interface SetupObject {
    colNames: string[],
    colValues: string[][],
    colInclude: boolean[],
    enumPriorityOrder: string[][],
    priority: PriorityObject[],
    marketDates: MarketDateObject[],
    sections: SectionObject[],
}