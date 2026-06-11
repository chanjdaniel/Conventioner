/**
 * AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
 * Regenerate with: python back-end/generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts
 */

export interface MarketSchema {
  assignmentObject: {
    assignmentDate: string;
    vendorAssignments: {
      date: string;
      email: string;
      location: string;
      section: string;
      tableChoice: string;
      tableCode: string;
      tier: string;
    }[];
  };
  creationDate: string;
  discordWebhookUrl?: string;
  id: string;
  isDraft?: boolean;
  modificationList: {
  }[];
  name: string;
  organizationId?: string;
  roles: Record<string, string>;
  setupObject: null | {
    assignmentOptions: {
      emailColNameIdx?: number;
      maxAssignmentsPerVendor?: number;
      maxDaysColNameIdx?: number;
      maxHalfTableProportionPerSection?: number;
      tableChoiceColNameIdx?: number;
      tableShareEmailColNameIdx?: number;
    };
    colInclude: boolean[];
    colNames: string[];
    colValues: string[][];
    enumPriorityOrder: string[][];
    locations: {
      name: string;
    }[];
    marketDates: {
      colName: string;
      colNameIdx: number;
      date: string;
    }[];
    priority: {
      colNameIdx: number;
      dataType: string;
      id: number;
      sortingOrder: string;
    }[];
    sections: {
      count: number;
      location: {
        name: string;
      };
      name: string;
      tier: {
        id: number;
        name: string;
      };
    }[];
    tiers: {
      id: number;
      name: string;
    }[];
  };
  userRole?: string;
}
