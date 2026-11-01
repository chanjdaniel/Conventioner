/**
 * The Stats tab's headlines (E45/F01/S03): the market's placements and money in figures, each
 * linking to the page that shows it, with that page's filter.
 */
import { describe, expect, it } from 'vitest';
import { statsHeadlines, type Headlines } from '@/utils/statsHeadlines';

const PLACED = { tableDaysUsed: 4, tableDays: 8, tableDaysFree: 3, unassigned: 2 };
const MONEY = { currency: 'CAD', owedCents: 11750, paidCents: 10000, stillOwedCents: 3500 };

function read(headlines: Headlines) {
  return statsHeadlines(headlines, 'm 1').map(({ id, figure, words, to }) => ({
    id,
    figure,
    words,
    to,
  }));
}

describe('statsHeadlines', () => {
  it('tells the placements, each linking to the page and filter that shows it', () => {
    expect(read({ placements: PLACED, money: null })).toEqual([
      { id: 'used', figure: '4', words: 'of 8 table-days used', to: '/markets/m%201/assignments' },
      {
        id: 'free',
        figure: '3',
        words: 'table-days free',
        to: { path: '/markets/m%201/assignments', query: { status: 'empty' } },
      },
      {
        id: 'unassigned',
        figure: '2',
        words: 'vendors unassigned',
        to: { path: '/markets/m%201/vendors', query: { show: 'unassigned' } },
      },
    ]);
  });

  it('tells the money in the market currency, still owed opening who owes', () => {
    expect(read({ placements: null, money: MONEY })).toEqual([
      { id: 'owed', figure: '$117.50', words: 'owed', to: '/markets/m%201/payments' },
      { id: 'paid', figure: '$100', words: 'paid', to: '/markets/m%201/payments' },
      {
        id: 'stillOwed',
        figure: '$35',
        words: 'still owed',
        to: { path: '/markets/m%201/payments', query: { show: 'owes' } },
      },
    ]);
  });

  it('puts the placements before the money', () => {
    expect(read({ placements: PLACED, money: MONEY }).map((h) => h.id)).toEqual([
      'used',
      'free',
      'unassigned',
      'owed',
      'paid',
      'stillOwed',
    ]);
  });

  it('speaks of one in the singular', () => {
    const one = read({
      placements: { tableDaysUsed: 1, tableDays: 1, tableDaysFree: 1, unassigned: 1 },
      money: null,
    });
    expect(one.map((h) => h.words)).toEqual([
      'of 1 table-day used',
      'table-day free',
      'vendor unassigned',
    ]);
  });

  it('links no zero to a filter that would list nothing, as the Assignments counts do not', () => {
    const none = read({
      placements: { tableDaysUsed: 8, tableDays: 8, tableDaysFree: 0, unassigned: 0 },
      money: { ...MONEY, paidCents: 11750, stillOwedCents: 0 },
    });
    expect(none.filter((h) => h.to === null).map((h) => h.id)).toEqual([
      'free',
      'unassigned',
      'stillOwed',
    ]);
  });

  it('tells nothing before an assignment and without prices', () => {
    expect(read({ placements: null, money: null })).toEqual([]);
  });
});
