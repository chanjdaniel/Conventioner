/**
 * How a market's pages are reached (E22/F04/S02, from the-assignment-tab ticket 02).
 *
 * Every market page has its own address, and the market's bar - rendered once, by `MarketFrame` -
 * reaches every one of them the same way. The bar carries Market Setup, Application Form,
 * Applications, Assignment, Attendance, Tools and Stats in every phase. The Assignment tab holds
 * four pages: Settings (the rules and the run), Assignments (the assignment by table, read and
 * changed), Vendors (the assignment by vendor) and Payments (the money the assignment is owed,
 * E44/F02/S01); the first two were Assignment and Result until E38/F08/S01. Import and a
 * location's layout (T257) are flows entered from a tab rather than places to go, so they stand
 * under that tab.
 *
 * A tab opens the page the market is worked on in its phase - the one carrying the dot - so the
 * bar and the rail beneath it say the same thing about where the market is. This replaced
 * `marketSurface.ts`, whose four surfaces could not name the assignment, Vendors or Attendance.
 */
import { MarketPhase, type Allocation, type Market } from '@/assets/types/datatypes';

export type MarketPage =
  | 'setup'
  | 'form'
  | 'applications'
  | 'settings'
  | 'assignments'
  | 'vendors'
  | 'payments'
  | 'attendance'
  | 'tools'
  | 'stats';

/** A flow entered from a tab, rather than a page of one. */
export type MarketFlow = 'import' | 'layout' | 'start-from-csv';

export type MarketTab =
  'setup' | 'form' | 'applications' | 'assignment' | 'attendance' | 'tools' | 'stats';

export const MARKET_PAGES: MarketPage[] = [
  'setup',
  'form',
  'applications',
  'settings',
  'assignments',
  'vendors',
  'payments',
  'attendance',
  'tools',
  'stats',
];

/**
 * The pages one view shows (`MarketSetupView`): the plan, the form, the applications and the rules.
 * The router's route for them, and the view's own reading of its address, both come from here.
 */
export const SETUP_VIEW_PAGES = ['setup', 'form', 'applications', 'settings'] as const;
export type SetupViewPage = (typeof SETUP_VIEW_PAGES)[number];

/**
 * Whether the market holds an assignment: any placement stored. The one statement of it, read by
 * the pages that ask whether there are rows to show - Assignments, Vendors, Payments, the run button
 * on Settings, the Discord card.
 * Where a market is worked on reads the served `allocation` instead (T316): hand assignments alone
 * store rows, but are no table allocation.
 */
export function hasAssignment(
  market: Pick<Market, 'assignmentObject'> | null | undefined,
): boolean {
  return (market?.assignmentObject?.vendorAssignments?.length ?? 0) > 0;
}

/** Whether applicants have been told whether they have a table, as the served allocation reads. */
export function resultsAreOut(allocation: Allocation | null | undefined): boolean {
  return allocation === 'published' || allocation === 'changed_since_published';
}

/**
 * Why no run may happen on a market though a seat is still given by hand on Assignments, or null
 * (T316): its results are published, or it was left in Offers, which nothing sets any more. There,
 * with every seat empty, Assignments says so in its own words and draws the tables to whoever may
 * assign, since the server's refusal points at Assignments itself.
 */
export function settledBy(
  market: Pick<Market, 'allocation' | 'phase'>,
): 'results' | 'offers' | null {
  if (resultsAreOut(market.allocation)) return 'results';
  return market.phase === MarketPhase.Offers ? 'offers' : null;
}

/** The pages under each tab, in the order its page row shows them. */
export const TAB_PAGES: Record<MarketTab, MarketPage[]> = {
  setup: ['setup'],
  form: ['form'],
  applications: ['applications'],
  assignment: ['settings', 'assignments', 'vendors', 'payments'],
  attendance: ['attendance'],
  tools: ['tools'],
  stats: ['stats'],
};

export const TAB_LABELS: Record<MarketTab, string> = {
  setup: 'Market Setup',
  form: 'Application Form',
  applications: 'Applications',
  assignment: 'Assignment',
  attendance: 'Attendance',
  tools: 'Tools',
  stats: 'Stats',
};

export const PAGE_LABELS: Record<MarketPage, string> = {
  setup: 'Market Setup',
  form: 'Application Form',
  applications: 'Applications',
  settings: 'Settings',
  assignments: 'Assignments',
  vendors: 'Vendors',
  payments: 'Payments',
  attendance: 'Attendance',
  tools: 'Tools',
  stats: 'Stats',
};

const FLOW_TAB: Record<MarketFlow, MarketTab> = {
  import: 'applications',
  layout: 'setup',
  'start-from-csv': 'setup',
};

/**
 * The tabs a market shows: all seven, for its whole life (E31/F03/S02).
 *
 * Attendance used to appear only once the check-in page went on the air, so the bar changed shape
 * as the market moved. A tab out of its phase now stays, read-only, and says when it matters
 * (`tabNote` in `utils/marketGuide.ts`) - an archived market that never ran says it has no
 * attendance (bug 30) rather than hiding the tab. Stats, last, is open in every phase: it reads the
 * market from its first application to its archive (E45/F01/S01). Tools, just left of it, holds the
 * manual tools an organizer runs whenever they choose, Discord first (E46/F01/S02).
 */
export function tabsFor(): MarketTab[] {
  return ['setup', 'form', 'applications', 'assignment', 'attendance', 'tools', 'stats'];
}

/** The tab a page or a flow stands under. */
export function tabOf(where: MarketPage | MarketFlow): MarketTab {
  if (where in FLOW_TAB) return FLOW_TAB[where as MarketFlow];
  const tab = (Object.keys(TAB_PAGES) as MarketTab[]).find((t) =>
    TAB_PAGES[t].includes(where as MarketPage),
  );
  return tab ?? 'setup';
}

/**
 * The page or flow a route is, from its name and params; null for a route that is not one. The one
 * reading of it, so the bar and the page row can never disagree about where the organizer is.
 */
export function pageOfRoute(
  name: string | symbol | null | undefined,
  params: Record<string, unknown>,
): MarketPage | MarketFlow | null {
  switch (name) {
    case 'market-setup': {
      const page = String(params.page ?? '');
      return (MARKET_PAGES as string[]).includes(page) ? (page as MarketPage) : 'setup';
    }
    case 'market-assignments':
      return 'assignments';
    case 'vendors':
      return 'vendors';
    case 'market-payments':
      return 'payments';
    case 'attendance-status':
      return 'attendance';
    case 'market-tools':
      return 'tools';
    case 'market-stats':
      return 'stats';
    case 'import-applications':
      return 'import';
    case 'market-layout':
      return 'layout';
    case 'start-from-csv':
      return 'start-from-csv';
    default:
      return null;
  }
}
