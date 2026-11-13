import { describe, expect, it } from 'vitest';
import {
  PAGE_LABELS,
  TAB_PAGES,
  SETUP_VIEW_PAGES,
  hasAssignment,
  pageOfRoute,
  tabOf,
  tabsFor,
  type MarketPage,
} from '@/utils/marketPage';
import { currentPage, pageForTab } from '@/utils/marketGuide';
import { MarketPhase, type Allocation } from '@/assets/types/datatypes';
import { assignmentPlacing } from './support/assignment';

/**
 * How a market's pages are reached (E22/F04/S02, from the-assignment-tab ticket 02).
 *
 * The bar carries Market Setup, Application Form, Applications, Assignment, Attendance, Tools and
 * Stats in every phase. The Assignment tab holds four pages - Settings, Assignments, Vendors and
 * Payments (E38/F08/S01; E44/F02/S01) - and a tab opens
 * the page the market is worked on in its phase: the one carrying the dot.
 */
describe('the page a market is worked on in its phase', () => {
  it('opens a draft on the PLAN, not the form', () => {
    // The plan comes first and the form is built from it (the-order-of-the-work ticket 01).
    expect(currentPage(MarketPhase.Draft, 'none')).toBe('setup');
  });

  it('works the stage where applications arrive and are reviewed on the Applications page', () => {
    expect(currentPage(MarketPhase.Applications, 'none')).toBe('applications');
  });

  it('is the rules until tables are allocated, and the assignments after', () => {
    // Where the table allocation stands, as the market read serves it (T316): hand assignments
    // alone are not an allocation, so the run on Settings is still the work.
    const pages: Record<Allocation, MarketPage> = {
      none: 'settings',
      pinned: 'settings',
      current: 'assignments',
      stale: 'assignments',
      published: 'assignments',
      changed_since_published: 'assignments',
    };
    for (const [allocation, page] of Object.entries(pages) as [Allocation, MarketPage][]) {
      expect(currentPage(MarketPhase.Assignment, allocation), allocation).toBe(page);
    }
    // A read that did not carry it reads as nothing allocated.
    expect(currentPage(MarketPhase.Assignment, undefined)).toBe('settings');
    expect(currentPage(MarketPhase.Assignment, null)).toBe('settings');
  });

  it('is the assignments of a market left in Offers, once anything is assigned', () => {
    expect(currentPage(MarketPhase.Offers, 'none')).toBe('settings');
    for (const allocation of ['pinned', 'current', 'published'] as const) {
      expect(currentPage(MarketPhase.Offers, allocation), allocation).toBe('assignments');
    }
  });

  it('is attendance while the market is running', () => {
    expect(currentPage(MarketPhase.MarketDays, 'published')).toBe('attendance');
  });

  it('is the result of an archived market that ran, and the plan of one that never did', () => {
    expect(currentPage(MarketPhase.Archived, 'published')).toBe('assignments');
    expect(currentPage(MarketPhase.Archived, 'none')).toBe('setup');
  });

  it('still gives a page to a phase this build does not recognise', () => {
    // The plan is editable in every phase, so it is the one page that is never wrong to show.
    for (const unknown of [undefined, null, '', 'a_phase_from_the_future']) {
      expect(currentPage(unknown, 'none')).toBe('setup');
    }
  });
});

describe('the tabs', () => {
  it('are the same seven in every phase, Attendance, Tools and Stats included', () => {
    // Attendance included from draft, so the bar keeps one shape for the market's whole life
    // (E31/F03/S02); a tab out of its phase says when it matters instead of disappearing. Stats
    // reads the market from its first application to its archive (E45/F01/S01), and Tools, just
    // left of it, holds the manual tools an organizer runs in any phase (E46/F01/S02).
    expect(tabsFor()).toEqual([
      'setup',
      'form',
      'applications',
      'assignment',
      'attendance',
      'tools',
      'stats',
    ]);
  });

  it('put every page under exactly one tab', () => {
    const pages: MarketPage[] = Object.values(TAB_PAGES).flat();
    expect(new Set(pages).size).toBe(pages.length);
    expect(TAB_PAGES.assignment).toEqual(['settings', 'assignments', 'vendors', 'payments']);
  });

  it('read Settings, Assignments, Vendors and Payments under the Assignment tab', () => {
    // E38/F08/S01 named the first three; Payments joined them (E44/F02/S01).
    expect(TAB_PAGES.assignment.map((page) => PAGE_LABELS[page])).toEqual([
      'Settings',
      'Assignments',
      'Vendors',
      'Payments',
    ]);
  });

  it('name the tab a page or a flow stands under', () => {
    expect(tabOf('settings')).toBe('assignment');
    expect(tabOf('assignments')).toBe('assignment');
    expect(tabOf('vendors')).toBe('assignment');
    expect(tabOf('payments')).toBe('assignment');
    expect(tabOf('import')).toBe('applications');
    expect(tabOf('layout')).toBe('setup');
    expect(tabOf('stats')).toBe('stats');
    expect(tabOf('tools')).toBe('tools');
  });
});

describe('the page a tab opens', () => {
  it('is the page carrying the dot, when the tab holds it', () => {
    expect(pageForTab('assignment', MarketPhase.Assignment, 'current')).toBe('assignments');
    expect(pageForTab('assignment', MarketPhase.Assignment, 'published')).toBe('assignments');
    expect(pageForTab('assignment', MarketPhase.Assignment, 'pinned')).toBe('settings');
    expect(pageForTab('assignment', MarketPhase.Assignment, 'none')).toBe('settings');
    expect(pageForTab('assignment', MarketPhase.Assignment, undefined)).toBe('settings');
  });

  it("is the tab's first page otherwise", () => {
    expect(pageForTab('assignment', MarketPhase.Draft, 'none')).toBe('settings');
    expect(pageForTab('setup', MarketPhase.MarketDays, 'published')).toBe('setup');
    expect(pageForTab('attendance', MarketPhase.MarketDays, 'published')).toBe('attendance');
    expect(pageForTab('stats', MarketPhase.Applications, 'none')).toBe('stats');
    expect(pageForTab('tools', MarketPhase.MarketDays, 'published')).toBe('tools');
  });
});

describe('the page a route is', () => {
  it('reads the four pages of the market view off its address', () => {
    for (const page of ['setup', 'form', 'applications', 'settings']) {
      expect(pageOfRoute('market-setup', { page })).toBe(page);
    }
  });

  it('names the pages and flows that are views of their own', () => {
    expect(pageOfRoute('market-assignments', {})).toBe('assignments');
    expect(pageOfRoute('vendors', {})).toBe('vendors');
    expect(pageOfRoute('market-payments', {})).toBe('payments');
    expect(pageOfRoute('attendance-status', {})).toBe('attendance');
    expect(pageOfRoute('market-stats', {})).toBe('stats');
    expect(pageOfRoute('market-tools', {})).toBe('tools');
    expect(pageOfRoute('import-applications', {})).toBe('import');
    expect(pageOfRoute('market-layout', {})).toBe('layout');
    expect(pageOfRoute('market-layout', { locationId: 'loc-1' })).toBe('layout');
  });

  it('is nothing for a route that is not a market page', () => {
    expect(pageOfRoute('market', {})).toBeNull();
    expect(pageOfRoute('markets', {})).toBeNull();
    expect(pageOfRoute(undefined, {})).toBeNull();
  });
});

describe('whether a market has an assignment', () => {
  it('is whether any placement is stored', () => {
    expect(hasAssignment(null)).toBe(false);
    expect(hasAssignment({ assignmentObject: assignmentPlacing() })).toBe(false);
    expect(hasAssignment({ assignmentObject: assignmentPlacing('a@example.com') })).toBe(true);
  });
});

describe('the pages one view shows', () => {
  it('are the plan, the form, the applications and the rules, all under their own tabs', () => {
    expect(SETUP_VIEW_PAGES).toEqual(['setup', 'form', 'applications', 'settings']);
    for (const page of SETUP_VIEW_PAGES) expect(pageOfRoute('market-setup', { page })).toBe(page);
  });
});
