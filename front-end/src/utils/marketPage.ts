/**
 * How a market's pages are reached (E22/F04/S02, from the-assignment-tab ticket 02).
 *
 * Every market page has its own address, and the market's bar - rendered once, by `MarketFrame` -
 * reaches every one of them the same way. The bar carries Market Setup, Application Form,
 * Applications, Assignment, and Attendance once the market is published. The Assignment tab holds
 * three pages: Assignment (the rules and the run), Result (the assignment by table, read and
 * changed) and Vendors (the assignment by vendor). Import and Floorplan are flows entered from a
 * tab rather than places to go, so they stand under that tab.
 *
 * A tab opens the page the market is worked on in its phase - the one carrying the dot - so the
 * bar and the rail beneath it say the same thing about where the market is. This replaced
 * `marketSurface.ts`, whose four surfaces could not name Result, Vendors or Attendance.
 */
import { MarketPhase } from '@/assets/types/datatypes';

export type MarketPage =
  'setup' | 'form' | 'applications' | 'assignment' | 'result' | 'vendors' | 'attendance';

/** A flow entered from a tab, rather than a page of one. */
export type MarketFlow = 'import' | 'floorplan';

export type MarketTab = 'setup' | 'form' | 'applications' | 'assignment' | 'attendance';

export const MARKET_PAGES: MarketPage[] = [
  'setup',
  'form',
  'applications',
  'assignment',
  'result',
  'vendors',
  'attendance',
];

/** The pages under each tab, in the order its page row shows them. */
export const TAB_PAGES: Record<MarketTab, MarketPage[]> = {
  setup: ['setup'],
  form: ['form'],
  applications: ['applications'],
  assignment: ['assignment', 'result', 'vendors'],
  attendance: ['attendance'],
};

export const TAB_LABELS: Record<MarketTab, string> = {
  setup: 'Market Setup',
  form: 'Application Form',
  applications: 'Applications',
  assignment: 'Assignment',
  attendance: 'Attendance',
};

export const PAGE_LABELS: Record<MarketPage, string> = {
  setup: 'Market Setup',
  form: 'Application Form',
  applications: 'Applications',
  assignment: 'Assignment',
  result: 'Result',
  vendors: 'Vendors',
  attendance: 'Attendance',
};

const FLOW_TAB: Record<MarketFlow, MarketTab> = { import: 'applications', floorplan: 'setup' };

/** A market whose check-in page is on the air, or was: the only kind with an Attendance tab. */
const PUBLISHED: string[] = [MarketPhase.MarketDays, MarketPhase.Archived];

export function tabsFor(phase: string | undefined | null): MarketTab[] {
  const four: MarketTab[] = ['setup', 'form', 'applications', 'assignment'];
  return PUBLISHED.includes(String(phase)) ? [...four, 'attendance'] : four;
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
 * The page a market is worked on in its phase: the one carrying the dot.
 *
 * `hasAssignment` because the assignment phase is worked on the rules until there is a result, and
 * on the result after; an archived market that never ran one has nothing to show but its plan.
 */
export function currentPage(phase: string | undefined | null, hasAssignment: boolean): MarketPage {
  switch (phase) {
    case MarketPhase.Draft:
      return 'setup';
    case MarketPhase.ApplicationsOpen:
    case MarketPhase.ApplicationsClosed:
    case MarketPhase.Review:
      return 'applications';
    case MarketPhase.Assignment:
    case MarketPhase.Offers:
      return hasAssignment ? 'result' : 'assignment';
    case MarketPhase.MarketDays:
      return 'attendance';
    case MarketPhase.Archived:
      return hasAssignment ? 'result' : 'setup';
    default:
      // A phase this build does not recognise still gets a page. The plan is editable in every
      // phase, so it is the one page that is never wrong to show.
      return 'setup';
  }
}

/** The page a tab opens: the one carrying the dot when the tab holds it, else its first. */
export function pageForTab(
  tab: MarketTab,
  phase: string | undefined | null,
  hasAssignment: boolean,
): MarketPage {
  const current = currentPage(phase, hasAssignment);
  return TAB_PAGES[tab].includes(current) ? current : TAB_PAGES[tab][0];
}
