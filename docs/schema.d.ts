/**
 * AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
 * Regenerate with: python back-end/generate_market_schema.py --input ../docs/market-schema-input.example.json --output ../docs/schema.d.ts
 */

export interface MarketSchema {
  applicationForm?: {
    essentialOptions?: {
      dates?: string[];
      sections?: string[];
      tableTypes?: string[];
      tiers?: string[];
    };
    fields: {
      helpText?: string;
      key: string;
      label: string;
      options?: string[];
      order?: number;
      required?: boolean;
      type: string;
    }[];
    publishedAt?: string;
  };
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
  discordGuildId?: string;
  discordWebhookUrl?: string;
  id: string;
  importMapping?: {
    headers?: string[];
    resolutions?: Record<string, Record<string, null | string>>;
    savedAt?: string;
    targets?: Record<string, string[]>;
  };
  isDraft?: boolean;
  modificationList: {
  }[];
  name: string;
  organizationId?: string;
  phase?: string;
  reviewConfig?: {
  };
  roles: Record<string, string>;
  setupObject: null | {
    assignmentOptions: {
      maxAssignmentsPerVendor?: number;
      maxHalfTableProportionPerSection?: number;
    };
    floorplans?: {
      id?: string;
      imageGridfsId?: string;
      imageHeight?: number;
      imageWidth?: number;
      obstacles?: {
        id?: string;
        polygon: unknown[][];
        type: string;
      }[];
      placedTables?: {
        height_mm: number;
        id?: string;
        rotation?: number;
        table_code?: string;
        table_type_id: string;
        width_mm: number;
        x: number;
        y: number;
      }[];
      referenceLineEnd?: unknown[];
      referenceLineLengthMm?: number;
      referenceLineStart?: unknown[];
      scalePxPerUnit?: number;
      scaleUnit?: string;
      sections?: {
        id?: string;
        location_name: string;
        name: string;
        table_ids?: string[];
        tier_id?: string;
      }[];
      tableTypes?: {
        color?: string;
        height_mm: number;
        id?: string;
        max_capacity: number;
        name: string;
        width_mm: number;
      }[];
      walls?: {
        end: unknown[];
        id?: string;
        is_exterior?: boolean;
        start: unknown[];
        thickness_mm: number;
      }[];
    }[];
    locations: {
      name: string;
    }[];
    marketDates: {
      colName?: string;
      colNameIdx?: number;
      date: string;
    }[];
    priority: {
      direction?: string;
      id: number;
      ordering?: string[];
      target?: string;
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
