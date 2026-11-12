/**
 * The Stats tab's strip (T201): three or four big-number tiles chosen by the market's phase, each a
 * link to where its figure is worked on, a zero whose link would list nothing told but not linked.
 */
import { describe, expect, it } from 'vitest';
import type { MarketStats } from '@/utils/marketStats';
import { statsHeadlines } from '@/utils/statsHeadlines';

const APPLICATIONS = '/markets/m%201/applications';
const ATTENDANCE = '/markets/m%201/attendance';
const PAYMENTS = '/markets/m%201/payments';

function stats(over: Partial<MarketStats> = {}): MarketStats {
  return {
    applicants: {
      total: 36,
      addedByHand: 4,
      statuses: {
        open: 10,
        under_review: 2,
        needs_follow_up: 3,
        reviewer_approved: 17,
        reviewer_rejected: 4,
      },
      submittedAt: [],
      openedAt: null,
      closedAt: null,
    },
    answers: { questions: [], groups: { all: 36, approved: 20, assigned: 0 } },
    room: {
      dates: [
        { date: '2099-05-01', asked: 42, tables: 30 },
        { date: '2099-05-08', asked: 41.5, tables: 30 },
      ],
      tiers: [],
    },
    fill: null,
    checkIn: null,
    headlines: { placements: null, money: null },
    ...over,
  } as MarketStats;
}

const PLACED = { tableDaysUsed: 84, tableDays: 120, tableDaysFree: 36, unassigned: 3 };
const MONEY = { currency: 'CAD', owedCents: 200000, paidCents: 55000, stillOwedCents: 145000 };
const CHECK_IN = {
  dates: [
    { date: '2099-05-01', expected: 24, checkedIn: 18 },
    { date: '2099-05-08', expected: 20, checkedIn: 0 },
  ],
  came: 31,
};
const ASSIGNED = { headlines: { placements: PLACED, money: MONEY } };

function read(phase: string, over: Partial<MarketStats> = {}, today = '2099-04-01') {
  return statsHeadlines(phase, stats(over), 'm 1', today);
}

describe('statsHeadlines', () => {
  it('has no tile in draft', () => {
    expect(read('draft')).toEqual([]);
  });

  it('in applications, tells who applied, who is open to review and the table-days asked', () => {
    expect(read('applications')).toEqual([
      {
        id: 'applied',
        figure: '36',
        words: 'applied',
        link: { route: { path: APPLICATIONS, query: { view: 'all' } } },
      },
      {
        id: 'open',
        figure: '12',
        words: 'open to review',
        link: {
          route: {
            path: APPLICATIONS,
            query: { view: 'all', status: 'undecided', reviewer: 'anyone' },
          },
        },
      },
      {
        id: 'asked',
        figure: '83.5',
        words: 'of 60 table-days asked',
        link: { section: 'stats-room' },
      },
    ]);
  });

  it('in applications, links no zero that would list nothing, and leaves out a plan of no date', () => {
    const none = read('applications', {
      applicants: { ...stats().applicants, total: 0, addedByHand: 0, statuses: {} },
      room: null,
    });
    expect(none).toEqual([
      { id: 'applied', figure: '0', words: 'applied', link: null },
      { id: 'open', figure: '0', words: 'open to review', link: null },
    ]);
  });

  it('in assignment, tells the table-days used, who is unassigned and what is still owed', () => {
    expect(read('assignment', ASSIGNED)).toEqual([
      {
        id: 'used',
        figure: '84',
        words: 'of 120 table-days used',
        link: { route: '/markets/m%201/assignments' },
      },
      {
        id: 'unassigned',
        figure: '3',
        words: 'unassigned',
        link: { route: { path: '/markets/m%201/vendors', query: { show: 'unassigned' } } },
      },
      {
        id: 'stillOwed',
        figure: '$1,450.00',
        words: 'still owed',
        link: { route: { path: PAYMENTS, query: { show: 'owes' } } },
      },
    ]);
  });

  it('in assignment, links no zero and leaves out what has no figure yet', () => {
    const settled = read('assignment', {
      headlines: {
        placements: { ...PLACED, unassigned: 0 },
        money: { ...MONEY, paidCents: 200000, stillOwedCents: 0 },
      },
    });
    expect(settled.filter((tile) => !tile.link).map((tile) => tile.id)).toEqual([
      'unassigned',
      'stillOwed',
    ]);
    // Nothing stored and no prices: no tile, so no strip.
    expect(read('assignment')).toEqual([]);
  });

  it('in market days, counts the next market date ahead, naming it, and what is still owed', () => {
    expect(read('market_days', { ...ASSIGNED, checkIn: CHECK_IN })).toEqual([
      {
        id: 'checkedIn',
        figure: '18',
        words: 'of 24 checked in, May\u00a01,\u00a02099',
        link: { route: { path: ATTENDANCE, query: { date: '2099-05-01' } } },
      },
      {
        id: 'notYet',
        figure: '6',
        words: 'not yet in',
        link: { route: { path: ATTENDANCE, query: { date: '2099-05-01' } } },
      },
      {
        id: 'stillOwed',
        figure: '$1,450.00',
        words: 'still owed',
        link: { route: { path: PAYMENTS, query: { show: 'owes' } } },
      },
    ]);
  });

  it('in market days, counts today when it is a market date, else the next, else the last', () => {
    const counted = (today: string) =>
      read('market_days', { checkIn: CHECK_IN }, today).map((tile) => tile.words);
    expect(counted('2099-05-08')).toEqual([
      'of 20 checked in, May\u00a08,\u00a02099',
      'not yet in',
    ]);
    expect(counted('2099-05-02')).toEqual([
      'of 20 checked in, May\u00a08,\u00a02099',
      'not yet in',
    ]);
    // Every day is over: the last, whose missing did not come.
    expect(counted('2099-06-01')).toEqual([
      'of 20 checked in, May\u00a08,\u00a02099',
      'did not come',
    ]);
  });

  it('in market days, links no day nobody is missing from, nor one nobody is assigned to', () => {
    const everyone = read('market_days', {
      checkIn: { dates: [{ date: '2099-05-01', expected: 2, checkedIn: 2 }], came: 2 },
    });
    expect(everyone.map(({ id, figure, link }) => ({ id, figure, linked: !!link }))).toEqual([
      { id: 'checkedIn', figure: '2', linked: true },
      { id: 'notYet', figure: '0', linked: false },
    ]);
    const nobody = read('market_days', {
      checkIn: { dates: [{ date: '2099-05-01', expected: 0, checkedIn: 0 }], came: 0 },
    });
    expect(nobody.map(({ id, link }) => ({ id, linked: !!link }))).toEqual([
      { id: 'checkedIn', linked: false },
      { id: 'notYet', linked: false },
    ]);
  });

  it('in the archive, tells the vendors who came, the table-days used and what was paid', () => {
    expect(read('archived', { ...ASSIGNED, checkIn: CHECK_IN })).toEqual([
      { id: 'came', figure: '31', words: 'vendors came', link: { route: ATTENDANCE } },
      {
        id: 'used',
        figure: '84',
        words: 'of 120 table-days used',
        link: { route: '/markets/m%201/assignments' },
      },
      { id: 'paid', figure: '$550.00', words: 'paid', link: { route: PAYMENTS } },
    ]);
  });

  it('in the archive of a market that never ran, leaves out who came', () => {
    expect(read('archived', ASSIGNED).map((tile) => tile.id)).toEqual(['used', 'paid']);
  });

  it('speaks of one in the singular', () => {
    const one = read('archived', {
      checkIn: { ...CHECK_IN, came: 1 },
      headlines: { placements: { ...PLACED, tableDaysUsed: 1, tableDays: 1 }, money: null },
      room: { dates: [{ date: '2099-05-01', asked: 1, tables: 1 }], tiers: [] },
    });
    expect(one.map((tile) => tile.words)).toEqual(['vendor came', 'of 1 table-day used']);
    const asked = read('applications', {
      room: { dates: [{ date: '2099-05-01', asked: 1, tables: 1 }], tiers: [] },
    });
    expect(asked.at(-1)?.words).toBe('of 1 table-day asked');
  });

  it('reads results sent, between assignment and market days, as assignment', () => {
    expect(read('offers', ASSIGNED).map((tile) => tile.id)).toEqual([
      'used',
      'unassigned',
      'stillOwed',
    ]);
  });
});
