export enum MarketRole {
  Owner = 'owner',
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

export enum MarketPhase {
  Draft = 'draft',
  ApplicationsOpen = 'applications_open',
  ApplicationsClosed = 'applications_closed',
  Review = 'review',
  Assignment = 'assignment',
  Offers = 'offers',
  MarketDays = 'market_days',
  Archived = 'archived',
}

export enum OrganizationRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export interface ThemeObject {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
}

/**
 * One rule in the ordered list that decides who is placed first when demand exceeds tables.
 *
 * A rule names a `target` - the key of one of the organizer's own form questions - and carries
 * its own `ordering`, a arrangement of that question's answers, best first. How to order a
 * target follows from that target's type, so there is no separate data type to declare: the
 * dropdown that used to ask for one let an organizer mark a text field as a number and get
 * silence.
 */
export interface PriorityObject {
  id: number;
  target: string | null;
  ordering: string[];
  direction: PriorityDirection | null;
}

/** Which end of an ordered target sorts first. Derived from the target's type, never declared. */
export enum PriorityDirection {
  Ascending = 'ascending',
  Descending = 'descending',
}

/** An organizer need not list every answer: whatever they leave out sorts where this sits. */
export const ALL_OTHERS = '<All others>';

/**
 * Targets that are attributes of the application rather than questions the organizer asked.
 *
 * First come, first served is probably the most common tiebreaker there is, and no form question
 * can supply it - offering only fields would force organizers to fake it with a "what time is
 * it" question. The `application.` namespace can never collide with a field key, which the form
 * builder holds to `^[a-z0-9_]+$`.
 */
export const BUILT_IN_PRIORITY_TARGETS = [
  {
    key: 'application.submitted_at',
    label: 'When the application arrived',
    kind: 'magnitude' as const,
    ascendingLabel: 'Earliest first',
    descendingLabel: 'Latest first',
  },
  {
    key: 'application.application_type',
    label: 'Application type',
    kind: 'arranged' as const,
    options: ['main', 'waitlist'],
  },
];

export interface MarketDateObject {
  date: string;
}

export interface TierObject {
  id: number;
  name: string;
}

export interface LocationObject {
  name: string;
}

export interface SectionObject {
  name: string;
  location: LocationObject | null;
  tier: TierObject | null;
  count: number;
}

export interface AssignmentOptionObject {
  /** null = the organizer set no ceiling; each vendor is bounded by their own answer. */
  maxAssignmentsPerVendor: number | null;
  maxHalfTableProportionPerSection: number | null;
}

export interface SetupObject {
  priority: PriorityObject[];
  marketDates: MarketDateObject[];
  tiers: TierObject[];
  locations: LocationObject[];
  sections: SectionObject[];
  assignmentOptions: AssignmentOptionObject;
  floorplans?: FloorplanObject[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModificationObject {}

export interface VendorAssignmentResult {
  email: string;
  date: string;
  tableCode: string;
  tableChoice: string; // "Full table" or "Half table - Left" or "Half table - Right"
  section: string;
  tier: string;
  location: string;
  // A pin: this seat was chosen by hand, and the solver places everyone else around it rather
  // than recomputing it. There is no separate constraint object - the pin IS this row, flagged.
  handPlaced?: boolean;
}

export interface AssignmentStatistics {
  totalVendors: number;
  totalTables: number;
  totalAssignments: number;
  totalAssignedVendors: number;
  totalAssignedTables: number;
  assignmentsPerDate: Record<string, number>;
  assignmentsPerTier: Record<string, number>;
  assignmentsPerSection: Record<string, number>;
  assignmentsPerTableChoice?: Record<string, number>;
  unassignedVendors: Record<string, unknown>[];
  unassignedTables: Record<string, UnassignedTableEntry[]>;
  /** null when nobody could be scored: no vendors, or none with a date they could attend. */
  satisfactionScore: number | null;
}

export interface UnassignedTableEntry {
  table_code: string;
  table_choice: string;
}

export interface AssignmentObject {
  vendorAssignments: VendorAssignmentResult[];
  assignmentDate: string; // When the assignment was performed
  totalVendorsAssigned: number;
  totalTablesAssigned: number;
  assignmentStatistics: AssignmentStatistics | null;
}

/**
 * How vendors reach a market: imported by the organizer, or applying themselves.
 *
 * Mirrors the back end's `IntakeMode`. A market that names none is CSV, so the public applicant
 * surface is off unless the market says otherwise.
 */
export enum IntakeMode {
  Csv = 'csv',
  Form = 'form',
}

export interface Market {
  id: string;
  name: string;
  /** The market's public identifier, computed and persisted server-side from the name. Every
   *  public URL names it - `/<slug>/check-in` is the page publishing puts on the air. */
  slug?: string;
  creationDate: string;
  /** Derived server-side from phase: true when phase is ``draft``, false otherwise. The
   * server overwrites whatever a PUT body carries; the field is never independently writable. */
  isDraft?: boolean;
  /** Market lifecycle phase - the single source of truth. Always derived server-side: markets
   * stored before the phase field existed report `draft` when isDraft, otherwise `archived`. */
  phase?: MarketPhase;
  roles: Record<string, MarketRole>; // Map of user_id -> role
  roleEmails?: Record<string, string>; // Map of user_id -> email (for display)
  organizationId?: string | null;
  organizationName?: string | null; // Resolved display name from API
  theme?: ThemeObject; // Market-specific theme
  setupObject: SetupObject | null;
  modificationList: ModificationObject[];
  assignmentObject: AssignmentObject;
  applicationForm?: ApplicationForm;
  reviewConfig?: Record<string, unknown>;
  resultsPublished?: boolean;
  /** How vendors reach this market. Organizer-settable while draft, frozen by the server after.
   * Absent means `csv`, which is what the server reads too. */
  intakeMode?: IntakeMode;
  /**
   * Which answers a reviewer reads first (E19/F03/S01). On the MARKET, never on the form: the form
   * freezes at the first application and an organizer learns what they needed while reviewing.
   */
  reviewHighlights?: string[];
  /**
   * Why the application form cannot be edited, or null when it can (E21/F02/S03). Computed by the
   * server on every read of ONE market from the D9 rule - the phase, and whether an application
   * exists - and never writable. Undefined on a read that does not carry it, such as the list.
   */
  applicationFormLockReason?: string | null;
  /** Why the assignment rules can no longer change, or null while they can (E22/F02/S02). */
  assignmentRulesLockReason?: string | null;
  /** Which of `rules`, `plan`, `applications` changed since the assignment ran (E22/F03/S01). */
  assignmentOutOfDate?: string[];
  userRole?: MarketRole; // User's effective role (added by API)
}

export type OrganizationRoleType = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  owner: string; // User id (uuid)
  admins: string[]; // 0+ admin user ids
  members: string[]; // 0+ member user ids
  markets: string[]; // List of market ids
  ownerEmail?: string; // Resolved display (from API)
  adminEmails?: string[]; // Resolved display (from API)
  memberEmails?: string[]; // Resolved display (from API)
  theme?: ThemeObject; // Organization theming
  userRole?: OrganizationRoleType; // Current user's role (from API, for Manage button)
}

export interface VendorAttendance {
  marketId: string;
  vendorEmail: string;
  date: string;
  checkedInAt: string;
}

export enum ApplicationStatus {
  Open = 'open',
  UnderReview = 'under_review',
  ReviewerApproved = 'reviewer_approved',
  ReviewerRejected = 'reviewer_rejected',
  Unassigned = 'unassigned',
  Assigned = 'assigned',
  AssignmentSent = 'assignment_sent',
  VendorAccepted = 'vendor_accepted',
  VendorRefused = 'vendor_refused',
  Cancelled = 'cancelled',
}

export enum ApplicationType {
  Main = 'main',
  Waitlist = 'waitlist',
}

/**
 * A single editable field in an application form. Keys with the reserved `essential_`
 * prefix are rejected by both front-end validation and the back-end API; see
 * `essential_fields.py` and `front-end/src/utils/applicationForm.ts`.
 */
export interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  helpText?: string;
  order: number;
}

/**
 * What the essential form questions offer. Derived from the market plan (dates, sections,
 * floorplan table types); once an applicant records an answer, the back end freezes it onto
 * the stored form so the questions can never move under recorded answers.
 */
export interface EssentialFormOptions {
  dates: string[];
  sections: string[];
  tableTypes: string[];
  tiers: string[];
  /**
   * Essential questions this market has declared it does not ask (E01/F06). Only rankings may
   * appear; see `UNASKABLE_ESSENTIAL_KEYS` in `essentialFields.ts`.
   */
  unasked?: string[];
}

export interface ApplicationForm {
  fields: FormField[];
  publishedAt?: string;
  /** Server-owned frozen offering; null/undefined until the first applicant answer. */
  essentialOptions?: EssentialFormOptions | null;
  /** The organizer's declaration, durable and settable - unlike the derived `essentialOptions`. */
  unaskedEssentials?: string[];
}

export interface Application {
  id: string;
  marketId: string;
  applicantEmail: string;
  formData: Record<string, unknown>;
  status: ApplicationStatus;
  applicationType: ApplicationType;
  mainApplicationId?: string;
  submittedAt?: string;
  updatedAt: string;
  assignedReviewerId?: string;
}

export interface PreconditionResult {
  id: string;
  passed: boolean;
  message: string;
  /** Null, not absent, when a guard's remedy spans two places: the server always sends the key. */
  resolutionLink?: string | null;
}

export interface TransitionRequest {
  toPhase: string;
}

export interface TransitionResponse {
  phase: string;
}

export interface TransitionBlockedResponse {
  error: string;
  currentPhase: string;
  targetPhase: string;
  blockers: PreconditionResult[];
}

export interface User {
  id: string;
  email: string;
  organizations?: string[]; // Organization ids
}

export interface TableTypeObject {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  maxCapacity: number;
  color?: string;
}

export interface WallSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  thicknessMm: number;
  isExterior: boolean;
}

export interface ObstacleZone {
  id: string;
  polygon: Array<[number, number]>;
  type: 'pillar' | 'stage' | 'no_table_zone' | 'custom';
}

export interface PlacedTableObject {
  id: string;
  tableTypeId: string;
  x: number;
  y: number;
  rotation: number;
  widthMm: number;
  heightMm: number;
  tableCode?: string;
}

export interface FloorplanSectionObject {
  id: string;
  name: string;
  locationName: string;
  tableIds: string[];
  tierId?: string;
}

export interface AisleConfigObject {
  wallBufferMm: number;
  tableSpacingMm: number;
  walkwayWidthMm: number;
}

export interface FloorplanObject {
  id: string;
  imageGridfsId?: string;
  scalePxPerUnit?: number;
  scaleUnit: string;
  referenceLineStart?: [number, number];
  referenceLineEnd?: [number, number];
  referenceLineLengthMm?: number;
  tableTypes: TableTypeObject[];
  walls: WallSegment[];
  obstacles: ObstacleZone[];
  placedTables: PlacedTableObject[];
  sections: FloorplanSectionObject[];
  imageWidth?: number;
  imageHeight?: number;
}

export interface FloorplanTemplate {
  id: string;
  name: string;
  ownerUserId?: string;
  organizationId?: string;
  tableTypes: TableTypeObject[];
  aisles: AisleConfigObject;
  createdAt: string;
  updatedAt: string;
}
