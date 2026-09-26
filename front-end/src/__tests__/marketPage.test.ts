import { describe, expect, it } from 'vitest';
import {
  TAB_PAGES,
  currentPage,
  pageForTab,
  pageOfRoute,
  tabOf,
  tabsFor,
  type MarketPage,
} from '@/utils/marketPage';
import { MarketPhase } from '@/assets/types/datatypes';

/**
 * How a market's pages are reached (E22/F04/S02, from the-assignment-tab ticket 02).
 *
 * The bar carries Market Setup, Application Form, Applications, Assignment, and Attendance once the
 * market is published. The Assignment tab holds three pages - Assignment, Result, Vendors - and a
 * tab opens the page the market is worked on in its phase: the one carrying the dot.
 */
describe('the page a market is worked on in its phase', () => {
  it('opens a draft on the PLAN, not the form', () => {
    // The plan comes first and the form is built from it (the-order-of-the-work ticket 01).
    expect(currentPage(MarketPhase.Draft, false)).toBe('setup');
  });

  it('gives the three application phases ONE page', () => {
    const pages = [
      MarketPhase.ApplicationsOpen,
      MarketPhase.ApplicationsClosed,
      MarketPhase.Review,
    ].map((phase) => currentPage(phase, false));
    expect(new Set(pages)).toEqual(new Set(['applications']));
  });

  it('is the rules until an assignment exists, and the result after', () => {
    expect(currentPage(MarketPhase.Assignment, false)).toBe('assignment');
    expect(currentPage(MarketPhase.Assignment, true)).toBe('result');
    expect(currentPage(MarketPhase.Offers, true)).toBe('result');
  });

  it('is attendance while the market is running', () => {
    expect(currentPage(MarketPhase.MarketDays, true)).toBe('attendance');
  });

  it('is the result of an archived market that ran, and the plan of one that never did', () => {
    expect(currentPage(MarketPhase.Archived, true)).toBe('result');
    expect(currentPage(MarketPhase.Archived, false)).toBe('setup');
  });

  it('still gives a page to a phase this build does not recognise', () => {
    // The plan is editable in every phase, so it is the one page that is never wrong to show.
    for (const unknown of [undefined, null, '', 'a_phase_from_the_future']) {
      expect(currentPage(unknown, false)).toBe('setup');
    }
  });
});

describe('the tabs', () => {
  it('are four until the market is published, and gain Attendance then', () => {
    const four = ['setup', 'form', 'applications', 'assignment'];
    for (const phase of [
      MarketPhase.Draft,
      MarketPhase.ApplicationsOpen,
      MarketPhase.Review,
      MarketPhase.Assignment,
      MarketPhase.Offers,
    ]) {
      expect(tabsFor(phase), phase).toEqual(four);
    }
    expect(tabsFor(MarketPhase.MarketDays)).toEqual([...four, 'attendance']);
    expect(tabsFor(MarketPhase.Archived)).toEqual([...four, 'attendance']);
  });

  it('put every page under exactly one tab', () => {
    const pages: MarketPage[] = Object.values(TAB_PAGES).flat();
    expect(new Set(pages).size).toBe(pages.length);
    expect(TAB_PAGES.assignment).toEqual(['assignment', 'result', 'vendors']);
  });

  it('name the tab a page or a flow stands under', () => {
    expect(tabOf('result')).toBe('assignment');
    expect(tabOf('vendors')).toBe('assignment');
    expect(tabOf('import')).toBe('applications');
    expect(tabOf('floorplan')).toBe('setup');
  });
});

describe('the page a tab opens', () => {
  it('is the page carrying the dot, when the tab holds it', () => {
    expect(pageForTab('assignment', MarketPhase.Assignment, true)).toBe('result');
    expect(pageForTab('assignment', MarketPhase.Assignment, false)).toBe('assignment');
  });

  it("is the tab's first page otherwise", () => {
    expect(pageForTab('assignment', MarketPhase.Draft, false)).toBe('assignment');
    expect(pageForTab('setup', MarketPhase.MarketDays, true)).toBe('setup');
    expect(pageForTab('attendance', MarketPhase.MarketDays, true)).toBe('attendance');
  });
});

describe('the page a route is', () => {
  it('reads the four pages of the market view off its address', () => {
    for (const page of ['setup', 'form', 'applications', 'assignment']) {
      expect(pageOfRoute('market-setup', { page })).toBe(page);
    }
  });

  it('names the pages and flows that are views of their own', () => {
    expect(pageOfRoute('market-result', {})).toBe('result');
    expect(pageOfRoute('vendors', {})).toBe('vendors');
    expect(pageOfRoute('attendance-status', {})).toBe('attendance');
    expect(pageOfRoute('import-applications', {})).toBe('import');
    expect(pageOfRoute('floorplan-editor', {})).toBe('floorplan');
  });

  it('is nothing for a route that is not a market page', () => {
    expect(pageOfRoute('market', {})).toBeNull();
    expect(pageOfRoute('markets', {})).toBeNull();
    expect(pageOfRoute(undefined, {})).toBeNull();
  });
});
