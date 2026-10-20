import { computed, ref, type Ref } from 'vue';
import { api } from '@/utils/api';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { ESSENTIAL_KEY_PREFIX } from '@/utils/essentialFields';
import { getFormattedDate } from '@/utils/utils';
import { datesWithinReach } from '@/utils/datesWithinReach';
import { verdictLine } from '@/utils/verdicts';
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
  Application,
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
}

export interface VendorTableAssignment {
  tableCode: string;
  tableChoice: string;
  section: string;
  tier: string;
  location: string;
}

/** One vendor as the Vendors list and the vendor drawer read them: their application and seats. */
export interface VendorRow {
  rowIndex: number;
  email: string;
  displayEmail: string;
  assignmentsByDate: Map<string, VendorTableAssignment>;
  isAssigned: boolean;
  assignedDateCount: number;
  /** The dates they could have had: their own answers, within the market's ceiling. */
  reachableDateCount: number;
  /** Every answer, keyed by field key; the drawer shows the organizer's own questions. */
  answers: Record<string, unknown>;
  /** Why their table-share request pairs nobody, when it does not (E27/F01/S03). */
  tableShareNotice: TableShareNoticeData | null;
  /** Who gave their verdict, and when (E34/F01/S01); null where nobody was recorded. */
  verdict: string | null;
  /** Whether the assignment run reads them: an approved applicant (E36/F02/S04). */
  inTheRun: boolean;
  /** Their application's status, which the Vendors list shows for anyone outside the run. */
  status: string;
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

function answerText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
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
 * Vendors list narrows them to the vendors the assignment places (`placeable`).
 */
export function useVendorDetails(marketId: Ref<string>, market: Ref<Market | null | undefined>) {
  const applications = ref<Application[]>([]);
  const tableRows = ref<MarketTableRowResponse[]>([]);
  const vendorNames = ref<VendorNames>({});
  /**
   * Who the assignment run places. The tables read serves every applicant (E36/F02/S02), the ones
   * outside the run with why, so the run's own are those it says nothing against.
   */
  const placeable = ref<Set<string>>(new Set());
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
          vendors?: { email: string; notApproved?: unknown }[];
        }>(`/markets/${encoded}/tables`),
      ]);
      applications.value = Array.isArray(applicationList) ? applicationList : [];
      placeable.value = new Set(
        (tablesResp.data?.vendors ?? [])
          .filter((vendor) => !vendor.notApproved)
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
      placeable.value = new Set();
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
        email,
        displayEmail: emailRaw || `Applicant ${index + 1}`,
        assignmentsByDate,
        isAssigned: !unassignedEmails.value.has(email) && assignmentsByDate.size > 0,
        assignedDateCount: assignmentsByDate.size,
        // A hand placement can give more than they asked for; never read as "3 of 2".
        reachableDateCount: Math.max(
          assignmentsByDate.size,
          datesWithinReach(
            answers,
            marketDates.value.map((d) => d.date),
            market.value?.setupObject?.assignmentOptions?.maxAssignmentsPerVendor,
          ),
        ),
        answers,
        tableShareNotice: application.tableShareNotice ?? null,
        verdict: verdictLine(application),
        inTheRun: placeable.value.has(email),
        status: application.status,
      };
    }),
  );

  function rowFor(email: string): VendorRow | null {
    const address = email.trim().toLowerCase();
    return rows.value.find((row) => row.email === address) ?? null;
  }

  /** The organizer's own questions, in the order their form asks them, as this vendor answered. */
  function submission(row: VendorRow): { label: string; value: string }[] {
    return (market.value?.applicationForm?.fields ?? [])
      .filter((field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX))
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((field) => ({
        label: field.label || field.key,
        value: answerText(row.answers[field.key]) || 'Not answered',
      }));
  }

  /** Where they were placed on this date, or null - which is what makes the card's state. */
  function placementOn(row: VendorRow, date: string): string | null {
    const assignment = row.assignmentsByDate.get(date);
    return assignment ? assignmentSummary(assignment) : null;
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
    placeable,
    isLoading,
    loaded,
    loadError,
    load,
    marketDates,
    rows,
    rowFor,
    submission,
    placementOn,
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
