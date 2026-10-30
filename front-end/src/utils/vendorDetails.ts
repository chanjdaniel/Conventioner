import { computed, ref, type Ref } from 'vue';
import { api } from '@/utils/api';
import { fetchMarketApplications } from '@/utils/applicantApi';
// One rendering of an answer for the drawer, its dialog and the review card alike (E41/F01/S01).
import { ESSENTIAL_KEY_PREFIX, answerText } from '@/utils/essentialFields';
import { getFormattedDate } from '@/utils/utils';
import { datesTheyNeed } from '@/utils/datesWithinReach';
import { addedLine, verdictLine } from '@/utils/verdicts';
import { priceLine } from '@/utils/pricing';
import {
  overrideIndex,
  reasonIndex,
  type OverriddenPlacement,
  type PlacementOverride,
  type PlacementReason,
  type UnplacedDate,
} from '@/utils/placementReason';
import type { VendorNames } from '@/utils/vendorIdentity';
import type {
  AnswerUpdate,
  Application,
  ApplicationStatus,
  Market,
  MarketDateObject,
  TableShareNotice as TableShareNoticeData,
} from '@/assets/types/datatypes';

interface AssignmentStatisticsResponse {
  unassignedVendors?: unknown[];
  unplacedDates?: UnplacedDate[];
  overriddenPlacements?: OverriddenPlacement[];
}

export interface MarketTableRowResponse {
  date: string;
  assignment: string[];
  location: string;
  section: string;
  tableChoice: string;
  tableCode: string;
  tier: string;
  /** Each occupant's price for this table-day, in cents; none where it is unpriced (E43/F01/S01). */
  prices?: { email: string; cents: number }[];
}

export interface VendorTableAssignment {
  tableCode: string;
  tableChoice: string;
  section: string;
  tier: string;
  location: string;
  /** What this assignment costs for its day, in cents, or null where the market prices nothing. */
  priceCents: number | null;
}

/** One vendor as the Vendors list and the vendor drawer read them: their application and seats. */
export interface VendorRow {
  rowIndex: number;
  /** Their application, which "Update info" writes to (E41/F01/S01). */
  applicationId: string;
  email: string;
  displayEmail: string;
  assignmentsByDate: Map<string, VendorTableAssignment>;
  isAssigned: boolean;
  assignedDateCount: number;
  /**
   * The dates they need a table on: their own answers, within the market's ceiling; every market
   * day for a vendor added by hand (E38/F08/S02).
   */
  reachableDateCount: number;
  /**
   * Every answer, keyed by field key, an organizer's update read in its place (E41/F01/S01); the
   * drawer shows the organizer's own questions.
   */
  answers: Record<string, unknown>;
  /** The answers an organizer updated: who, when, and what the vendor wrote. */
  answerUpdates: Record<string, AnswerUpdate>;
  /** Why their table-share request pairs nobody, when it does not (E27/F01/S03). */
  tableShareNotice: TableShareNoticeData | null;
  /** Who gave their verdict, and when (E34/F01/S01); null where nobody was recorded. */
  verdict: string | null;
  /**
   * Whether they need a table, as the server says (E38/F08/S02): the run's own, and a vendor added
   * by hand, who is out of the run and unassigned like anyone until seated.
   */
  needsATable: boolean;
  /** Their application's status, which the Vendors list shows for anyone outside the run. */
  status: ApplicationStatus;
  /** Recorded on the day rather than applying (E36/F03/S01): outside the run, though approved. */
  added: boolean;
}

/** One of the organizer's own questions as the drawer lists it. */
export interface SubmittedAnswer {
  key: string;
  label: string;
  value: string;
  /** An organizer's update of it, or null where the answer is the vendor's own. */
  update: AnswerUpdate | null;
}

function extractEmail(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  const obj = raw as { email?: unknown; vendorEmail?: unknown; vendor_email?: unknown };
  const candidate = obj.email ?? obj.vendorEmail ?? obj.vendor_email;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function errorText(err: unknown, fallback: string): string {
  const resp = (err as { response?: { data?: { error?: string } } })?.response;
  if (resp?.data?.error) return resp.data.error;
  return err instanceof Error && err.message ? err.message : fallback;
}

function assignmentSummary(assignment: VendorTableAssignment): string {
  const choice = assignment.tableChoice ? ` (${assignment.tableChoice})` : '';
  const parts = [`${assignment.tableCode || 'No table'}${choice}`];
  const meta = [assignment.section, assignment.tier, assignment.location]
    .filter((s) => !!s && s.trim().length > 0)
    .join(', ');
  if (meta) parts.push(meta);
  return parts.join(' - ');
}

/** One vendor on one date, as the reason and override indexes key them. */
const vendorOnDate = (email: string, date: string) => `${email.trim().toLowerCase()}|${date}`;

/**
 * A market's vendors, each with their application and their seats (E35/F01/S01): what the Vendors
 * list reads, and what the vendor drawer shows wherever it opens - from a seat, at the door, in
 * review. One loader, so the list and the drawer never read a vendor differently.
 *
 * Every application is kept, decided or not: the drawer opens on an applicant still in review. The
 * Vendors list counts the vendors who need a table (`needsATable`), as the server says of each.
 */
export function useVendorDetails(marketId: Ref<string>, market: Ref<Market | null | undefined>) {
  const applications = ref<Application[]>([]);
  const tableRows = ref<MarketTableRowResponse[]>([]);
  const vendorNames = ref<VendorNames>({});
  /**
   * Who needs a table: the run's own and the vendors added by hand (E38/F08/S02). The tables read
   * serves every applicant (E36/F02/S02) and says it of each.
   */
  const needingATable = ref<Set<string>>(new Set());
  const unplacedReasons = ref<Map<string, PlacementReason>>(new Map());
  const placementOverrides = ref<Map<string, PlacementOverride[]>>(new Map());
  const unassignedEmails = ref<Set<string>>(new Set());
  const isLoading = ref(false);
  const loaded = ref(false);
  const loadError = ref('');

  async function load(): Promise<void> {
    const id = marketId.value;
    if (!id) return;
    loadError.value = '';
    isLoading.value = true;
    const encoded = encodeURIComponent(id);
    try {
      const [applicationList, statsResp, tablesResp] = await Promise.all([
        fetchMarketApplications(id),
        api.get<AssignmentStatisticsResponse>(`/markets/${encoded}/assignment-statistics`),
        api.get<{
          rows: MarketTableRowResponse[];
          vendorNames: VendorNames;
          vendors?: { email: string; needsATable: boolean }[];
        }>(`/markets/${encoded}/tables`),
      ]);
      applications.value = Array.isArray(applicationList) ? applicationList : [];
      needingATable.value = new Set(
        (tablesResp.data?.vendors ?? [])
          .filter((vendor) => vendor.needsATable)
          .map((vendor) => vendor.email.trim().toLowerCase()),
      );
      unplacedReasons.value = reasonIndex(statsResp.data?.unplacedDates ?? []);
      placementOverrides.value = overrideIndex(statsResp.data?.overriddenPlacements ?? []);
      const statsList = statsResp.data?.unassignedVendors ?? [];
      unassignedEmails.value = new Set(
        statsList.map((item) => extractEmail(item).toLowerCase()).filter(Boolean),
      );
      tableRows.value = Array.isArray(tablesResp.data?.rows) ? tablesResp.data.rows : [];
      vendorNames.value = tablesResp.data?.vendorNames ?? {};
      loaded.value = true;
    } catch (err: unknown) {
      loadError.value = errorText(err, 'Failed to load vendors.');
      applications.value = [];
      tableRows.value = [];
      vendorNames.value = {};
      needingATable.value = new Set();
      unplacedReasons.value = new Map();
      placementOverrides.value = new Map();
      unassignedEmails.value = new Set();
    } finally {
      isLoading.value = false;
    }
  }

  const marketDates = computed<MarketDateObject[]>(
    () => market.value?.setupObject?.marketDates ?? [],
  );

  const assignmentsByEmail = computed(() => {
    const map = new Map<string, Map<string, VendorTableAssignment>>();
    for (const row of tableRows.value) {
      if (!Array.isArray(row.assignment)) continue;
      for (const email of row.assignment) {
        const address = String(email ?? '')
          .trim()
          .toLowerCase();
        if (!address) continue;
        const inner = map.get(address) ?? new Map<string, VendorTableAssignment>();
        map.set(address, inner);
        inner.set(row.date, {
          tableCode: row.tableCode,
          tableChoice: row.tableChoice,
          section: row.section,
          tier: row.tier,
          location: row.location,
          priceCents:
            row.prices?.find((price) => price.email.trim().toLowerCase() === address)?.cents ??
            null,
        });
      }
    }
    return map;
  });

  const rows = computed<VendorRow[]>(() =>
    applications.value.map((application, index) => {
      const emailRaw = (application.applicantEmail ?? '').trim();
      const email = emailRaw.toLowerCase();
      const assignmentsByDate =
        assignmentsByEmail.value.get(email) ?? new Map<string, VendorTableAssignment>();
      const answers = (application.formData ?? {}) as Record<string, unknown>;
      return {
        rowIndex: index,
        applicationId: application.id,
        email,
        displayEmail: emailRaw || `Applicant ${index + 1}`,
        assignmentsByDate,
        isAssigned: !unassignedEmails.value.has(email) && assignmentsByDate.size > 0,
        assignedDateCount: assignmentsByDate.size,
        // A hand placement can give more than they asked for; never read as "3 of 2".
        reachableDateCount: Math.max(
          assignmentsByDate.size,
          datesTheyNeed(
            { answers, added: Boolean(application.addedBy) },
            marketDates.value.map((d) => d.date),
            market.value?.setupObject?.assignmentOptions?.maxAssignmentsPerVendor,
          ),
        ),
        answers,
        answerUpdates: application.answerUpdates ?? {},
        tableShareNotice: application.tableShareNotice ?? null,
        // Someone added by hand says so, in place of a verdict nobody reviewed (E36/F03/S01).
        verdict: addedLine(application) ?? verdictLine(application),
        needsATable: needingATable.value.has(email),
        status: application.status,
        added: Boolean(application.addedBy),
      };
    }),
  );

  function rowFor(email: string): VendorRow | null {
    const address = email.trim().toLowerCase();
    return rows.value.find((row) => row.email === address) ?? null;
  }

  /**
   * The organizer's own questions, in the order their form asks them, as this vendor answered, each
   * update in its place with who made it and what the vendor wrote (E41/F01/S01).
   */
  function submission(row: VendorRow): SubmittedAnswer[] {
    return (market.value?.applicationForm?.fields ?? [])
      .filter((field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX))
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((field) => {
        const update = row.answerUpdates[field.key];
        return {
          key: field.key,
          label: field.label || field.key,
          value: answerText(row.answers[field.key]) || 'Not answered',
          update: update ?? null,
        };
      });
  }

  /** Where they were placed on this date, or null - which is what makes the card's state. */
  function placementOn(row: VendorRow, date: string): string | null {
    const assignment = row.assignmentsByDate.get(date);
    return assignment ? assignmentSummary(assignment) : null;
  }

  /** What their assignment that day costs, as its date card says it: "Gold, full table, $35"; null where
   * they hold none or the market prices nothing. */
  function priceOn(row: VendorRow, date: string): string | null {
    const assignment = row.assignmentsByDate.get(date);
    const currency = market.value?.setupObject?.pricing?.currency ?? 'CAD';
    return assignment ? priceLine(assignment, currency) : null;
  }

  /** Why they hold no table that day, as the server computed it; absent where they have one. */
  function reasonFor(email: string, date: string): PlacementReason | undefined {
    return unplacedReasons.value.get(vendorOnDate(email, date));
  }

  /** What their placement that day overrides, when it was made by hand and contradicts them. */
  function overridesFor(email: string, date: string): PlacementOverride[] | undefined {
    return placementOverrides.value.get(vendorOnDate(email, date));
  }

  function isOrphaned(email: string, date: string): boolean {
    const target = email.trim().toLowerCase();
    return (market.value?.orphanedPins ?? []).some(
      (pin) => pin.date === date && pin.email.trim().toLowerCase() === target,
    );
  }

  return {
    applications,
    tableRows,
    vendorNames,
    isLoading,
    loaded,
    loadError,
    load,
    marketDates,
    rows,
    rowFor,
    submission,
    placementOn,
    priceOn,
    reasonFor,
    overridesFor,
    isOrphaned,
  };
}

export type VendorDetails = ReturnType<typeof useVendorDetails>;

/** A market date as the drawer's assignment cards label it. */
export function dateLabel(date: string): string {
  return getFormattedDate(date) ?? date;
}
