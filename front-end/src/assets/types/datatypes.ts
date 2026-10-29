export enum MarketRole {
  Owner = 'owner',
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

export enum MarketPhase {
  Draft = 'draft',
  /**
   * The one stage where applications arrive and are reviewed (E38/F04/S01): "Review" on a Google
   * Form market, "Applications" on one whose vendors apply on its page (`pathPhaseLabel`).
   */
  Applications = 'applications',
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

/** An approved application a run cannot place, as the refusal names it (bug 42). */
export interface IncompleteApplication {
  applicationId: string;
  applicantEmail: string;
  /** The questions it never answered, by their labels. */
  missing: string[];
}

/** A choice question and the answers to it that reject an application (E33/F03/S01). */
export interface RejectionRule {
  key: string;
  answers: string[];
}

/** A question an automatic rejection may name, and the answers it offers. */
export interface RejectionQuestion {
  key: string;
  label: string;
  answers: Array<{ value: string; label: string }>;
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
  /** Whom this reader may make a follow-up's owner (T15): everyone who holds a role on the market,
   *  named in `roles` or reached through its organization, to a reader in the organization, and
   *  the people `roles` names to anyone else. Served on the read of one market to an Editor or
   *  above; Manage market keeps listing `roles` alone. */
  peopleOnMarket?: string[];
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
  /** Which answers reject an application automatically (E33/F03/S01). On the market, beside the
   *  highlights: they outlast the form's lock, until the market reaches Assignment. */
  rejectionRules?: RejectionRule[];
  /** Every question a rule may name, with the answers it offers: served, so the review setup
   *  offers exactly what the write takes (`back-end/rejection_rules.py`). */
  rejectionQuestions?: RejectionQuestion[];
  /** Why the automatic rejections can no longer change, or null while they can. */
  rejectionRulesLockReason?: string | null;
  /**
   * Why the application form cannot be edited, or null when it can (E21/F02/S03). Computed by the
   * server on every read of ONE market from the D9 rule - the phase, and whether an application
   * exists - and never writable. Undefined on a read that does not carry it, such as the list.
   */
  applicationFormLockReason?: string | null;
  /**
   * Why this market cannot be started from a Google Form's responses CSV, or null when it can
   * (E24/F03): the proposal's own refusal, served on the market so the flow and the Market Setup
   * action mirror it rather than deciding it. Undefined on a read that does not carry it.
   */
  csvStartRefusal?: string | null;
  /** Why the assignment rules can no longer change, or null while they can (E22/F02/S02). */
  assignmentRulesLockReason?: string | null;
  /** Which of the solver's inputs changed since the assignment ran (E22/F03/S01). */
  assignmentOutOfDate?: string[];
  /** Hand placements at a seat the plan no longer has (bug 31); Publish is refused while any. */
  orphanedPins?: Array<{ email: string; date: string; tableCode: string }>;
  /**
   * Every phase the market is known to have entered (E26/F06/S03), served from its phase history.
   * Read with `phaseRecordComplete`: when that is false the market predates the record, and a
   * phase missing here is unknown rather than never reached.
   */
  phasesReached?: string[];
  phaseRecordComplete?: boolean;
  /**
   * Why the person reading cannot change this market, or null while they can (E26/F06/S01): the
   * rule every write meets on the server, served so a screen offers no control it would refuse.
   * Undefined on a read that does not carry it, such as the list.
   */
  readOnlyReason?: string | null;
  /**
   * Why the person reading cannot take this market's admin actions - moving its phase, publishing
   * results, importing - or null while they can (E26/F08/S01). Served
   * beside `readOnlyReason`, from the same permission check the writes ask.
   */
  adminActionsReason?: string | null;
  /**
   * Why the person reading cannot give verdicts on this market's applications, or null while they
   * can (E34): below EDITOR, archived, or once the review has closed (E36/F01/S01).
   */
  verdictLockReason?: string | null;
  /**
   * Why the person reading cannot add a vendor who never applied, or null while they can
   * (E36/F03/S01): below EDITOR, or outside the assignment and market days.
   */
  addVendorReason?: string | null;
  /**
   * Why the person reading cannot publish this market's results now, or null while they can
   * (E36/F04/S01): an admin's, on a form market in assignment with a current run.
   */
  publishResultsReason?: string | null;
  /** Why the assignment cannot be run now, or null while it can (E36/F04/S02). */
  assignRefusalReason?: string | null;
  /** How many applicants will read each outcome, while results may be published; else null. */
  publishOutcomes?: { haveATable: number; notAssigned: number } | null;
  /**
   * What would refuse each move open from this phase, judged by the guards the move runs; empty
   * for a move that would succeed (E31/F02/S01). Served so a screen says no before the click.
   */
  transitionBlockers?: Record<string, PreconditionResult[]>;
  /** Whether the organizer has stopped taking applications inside the stage (E38/F04/S02). */
  applicationsStopped?: boolean;
  /**
   * Why taking applications cannot be stopped or resumed now, or null while it can: served so the
   * rail offers the action exactly when the endpoint would take it (E38/F04/S02).
   */
  applicationsStopReason?: string | null;
  /** Why the setup on Market Setup can no longer change, or null in draft (E31/F01/S02). */
  setupLockReason?: string | null;
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
  /** Not complete: someone must reach out to the applicant first (E34/F02/S01). Undecided. */
  NeedsFollowUp = 'needs_follow_up',
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

/**
 * Why an application's table-share request pairs nobody (E27/F01/S03), or, for one that stands,
 * another applicant it named and did not use, served on the organizer's
 * applications list and derived from the market's other applications when read. `address` is the
 * one the request named; there is none when the answer held no address.
 */
export interface TableShareNotice {
  reason:
    | 'no_address'
    | 'no_applicant'
    | 'partner_wants_full_table'
    | 'partner_not_accepted'
    | 'partner_asked_for_someone_else'
    | 'another_named_not_used';
  address?: string;
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
  /** Organizer's list only: set when this applicant's table-share request pairs nobody. */
  tableShareNotice?: TableShareNotice | null;
  /** Organizer's only: who gave the verdict, and when (E34/F01/S01). Null without one. */
  verdictBy?: VerdictGiver | null;
  verdictAt?: string | null;
  /** Organizer's only: why an automatic rule rejected it (E33/F03/S02). */
  verdictReason?: string | null;
  /** Organizer's only: who is reaching out, while it needs a follow-up (E34/F02/S01). */
  followUpOwner?: { userId?: string | null; email: string } | null;
  /** Organizer's only: the reviewer looking at it, while their claim stands (E34/F03/S02). */
  heldBy?: { userId?: string | null; email: string } | null;
  /**
   * Applicant's only, once results are published (E36/F05/S02): whether they have a table, and
   * where. Null and empty before; a verdict is never served to them.
   */
  outcome?: 'has_a_table' | 'not_assigned' | null;
  seats?: ApplicantSeat[];
  /** Who recorded a vendor who never applied, and when (E36/F03/S01). Absent on any who applied. */
  addedBy?: { userId?: string | null; email: string } | null;
  addedAt?: string | null;
}

/** One seat an applicant holds, as their page lists it once results are published (E36/F05/S02). */
export interface ApplicantSeat {
  date: string;
  tableCode: string;
  tableChoice: string;
  section: string;
  location: string;
}

/** A person, or an automatic rejection rule (E33/F03), named as a verdict's giver. */
export interface VerdictGiver {
  kind: 'person' | 'rule';
  userId?: string | null;
  email?: string | null;
  rule?: string | null;
}

export interface PreconditionResult {
  id: string;
  passed: boolean;
  message: string;
  /** Null, not absent, when a guard's remedy spans two places: the server always sends the key. */
  resolutionLink?: string | null;
  /** What following the link does ("Add a location"); present exactly when the link is. */
  resolutionLabel?: string | null;
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

/**
 * One of the three things an assignment is made from, as the server names them in
 * `assignmentOutOfDate` (`back-end/assignment/made_from.py`, `GROUPS`).
 */
export type AssignmentInputGroup = 'rules' | 'plan' | 'applications';
