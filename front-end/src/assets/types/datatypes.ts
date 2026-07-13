export enum DataType {
    Default = "Select a datatype",
    String = "String",
    Number = "Number",
    Enum = "Enum",
    Contains = "Contains",
    NotContains = "Does not contain",
}

export enum MarketRole {
    Owner = "owner",
    Admin = "admin",
    Editor = "editor",
    Viewer = "viewer",
}

export enum MarketPhase {
    Draft = "draft",
    ApplicationsOpen = "applications_open",
    ApplicationsClosed = "applications_closed",
    Review = "review",
    Assignment = "assignment",
    Offers = "offers",
    MarketDays = "market_days",
    Archived = "archived",
}

export enum OrganizationRole {
    Owner = "owner",
    Admin = "admin",
    Member = "member",
}

export interface ThemeObject {
    primaryColor: string,
    secondaryColor: string,
    logoUrl?: string,
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
    /** Required: index into colNames (blank/null invalid for assignment). */
    emailColNameIdx: number | null,
    tableChoiceColNameIdx: number | null,
    tableShareEmailColNameIdx: number | null,
    /** Optional: null = no per-vendor max-days cap from CSV (only global limits apply). */
    maxDaysColNameIdx: number | null,
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
    floorplans?: FloorplanObject[],
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModificationObject {}

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
    totalAssignments: number,
    totalAssignedVendors: number,
    totalAssignedTables: number,
    assignmentsPerDate: Record<string, number>,
    assignmentsPerTier: Record<string, number>,
    assignmentsPerSection: Record<string, number>,
    assignmentsPerTableChoice?: Record<string, number>,
    unassignedVendors: Record<string, unknown>[],
    unassignedTables: Record<string, UnassignedTableEntry[]>,
    satisfactionScore: number,
}

export interface UnassignedTableEntry {
    table_code: string,
    table_choice: string,
}

export interface AssignmentObject {
    vendorAssignments: VendorAssignmentResult[],
    assignmentDate: string, // When the assignment was performed
    totalVendorsAssigned: number,
    totalTablesAssigned: number,
    assignmentStatistics: AssignmentStatistics | null,
}

export interface Market {
    id: string,
    name: string,
    creationDate: string,
    /** Derived server-side from phase: true when phase is ``draft``, false otherwise. The
     * server overwrites whatever a PUT body carries; the field is never independently writable. */
    isDraft?: boolean,
    /** Market lifecycle phase - the single source of truth. Always derived server-side: markets
     * stored before the phase field existed report `draft` when isDraft, otherwise `archived`. */
    phase?: MarketPhase,
    roles: Record<string, MarketRole>,  // Map of user_id -> role
    roleEmails?: Record<string, string>,  // Map of user_id -> email (for display)
    organizationId?: string | null,
    organizationName?: string | null,  // Resolved display name from API
    theme?: ThemeObject,  // Market-specific theme
    setupObject: SetupObject | null,
    modificationList: ModificationObject[],
    assignmentObject: AssignmentObject,
    applicationForm?: ApplicationForm,
    reviewConfig?: Record<string, unknown>,
    discordGuildId?: string,
    userRole?: MarketRole,  // User's effective role (added by API)
    /** Per-market Discord webhook URL; omitted/blank disables Discord notifications. */
    discordWebhookUrl?: string | null,
}

export type OrganizationRoleType = 'owner' | 'admin' | 'member';

export interface Organization {
    id: string,
    name: string,
    owner: string,  // User id (uuid)
    admins: string[],  // 0+ admin user ids
    members: string[],  // 0+ member user ids
    markets: string[],  // List of market ids
    ownerEmail?: string,  // Resolved display (from API)
    adminEmails?: string[],  // Resolved display (from API)
    memberEmails?: string[],  // Resolved display (from API)
    theme?: ThemeObject,  // Organization theming
    userRole?: OrganizationRoleType,  // Current user's role (from API, for Manage button)
}

export interface VendorAttendance {
    marketId: string,
    vendorEmail: string,
    date: string,
    checkedInAt: string,
}

export enum ApplicationStatus {
    Open = "open",
    UnderReview = "under_review",
    ReviewerApproved = "reviewer_approved",
    ReviewerRejected = "reviewer_rejected",
    Unassigned = "unassigned",
    Assigned = "assigned",
    AssignmentSent = "assignment_sent",
    VendorAccepted = "vendor_accepted",
    VendorRefused = "vendor_refused",
    Cancelled = "cancelled",
}

export enum ApplicationType {
    Main = "main",
    Waitlist = "waitlist",
}

export interface FormField {
    key: string,
    label: string,
    type: string,
    required: boolean,
    options: string[],
    helpText?: string,
    order: number,
}

export interface ApplicationForm {
    fields: FormField[],
    publishedAt?: string,
}

export interface Application {
    id: string,
    marketId: string,
    applicantEmail: string,
    formData: Record<string, unknown>,
    status: ApplicationStatus,
    applicationType: ApplicationType,
    mainApplicationId?: string,
    submittedAt?: string,
    updatedAt: string,
    assignedReviewerId?: string,
}

export interface PreconditionResult {
    id: string,
    passed: boolean,
    message: string,
    resolutionLink?: string,
}

export interface TransitionRequest {
    toPhase: string,
}

export interface TransitionResponse {
    phase: string,
}

export interface TransitionBlockedResponse {
    error: string,
    currentPhase: string,
    targetPhase: string,
    blockers: PreconditionResult[],
}

export interface User {
    id: string,
    email: string,
    organizations?: string[],  // Organization ids
}

export interface TableTypeObject {
    id: string,
    name: string,
    widthMm: number,
    heightMm: number,
    maxCapacity: number,
    color?: string,
}

export interface WallSegment {
    id: string,
    start: [number, number],
    end: [number, number],
    thicknessMm: number,
    isExterior: boolean,
}

export interface ObstacleZone {
    id: string,
    polygon: Array<[number, number]>,
    type: 'pillar' | 'stage' | 'no_table_zone' | 'custom',
}

export interface PlacedTableObject {
    id: string,
    tableTypeId: string,
    x: number,
    y: number,
    rotation: number,
    widthMm: number,
    heightMm: number,
    tableCode?: string,
}

export interface FloorplanSectionObject {
    id: string,
    name: string,
    locationName: string,
    tableIds: string[],
    tierId?: string,
}

export interface AisleConfigObject {
    wallBufferMm: number,
    tableSpacingMm: number,
    walkwayWidthMm: number,
}

export interface FloorplanObject {
    id: string,
    imageGridfsId?: string,
    scalePxPerUnit?: number,
    scaleUnit: string,
    referenceLineStart?: [number, number],
    referenceLineEnd?: [number, number],
    referenceLineLengthMm?: number,
    tableTypes: TableTypeObject[],
    walls: WallSegment[],
    obstacles: ObstacleZone[],
    placedTables: PlacedTableObject[],
    sections: FloorplanSectionObject[],
    imageWidth?: number,
    imageHeight?: number,
}

export interface FloorplanTemplate {
    id: string,
    name: string,
    ownerUserId?: string,
    organizationId?: string,
    tableTypes: TableTypeObject[],
    aisles: AisleConfigObject,
    createdAt: string,
    updatedAt: string,
}
