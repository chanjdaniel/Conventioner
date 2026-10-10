import { describe, expect, it } from 'vitest';
import {
  filterOptions,
  placeFilterQuery,
  readResultFilters,
  vendorShown,
  rowStatus,
  statusCounts,
  tablesMatching,
  type MarketTableRow,
} from '@/utils/resultFilters';

function row(overrides: Partial<MarketTableRow>): MarketTableRow {
  return {
    date: '2026-11-18',
    assignment: [],
    assignmentSlots: [null, null],
    location: 'Hall',
    section: 'A',
    tableChoice: 'Half Table',
    tableCode: 'A1',
    tier: 'Gold',
    ...overrides,
  };
}

const full = row({ tableCode: 'A1', tableChoice: 'Full Table', assignmentSlots: ['a@x', 'a@x'] });
const pair = row({ tableCode: 'A2', assignmentSlots: ['b@x', 'c@x'] });
const half = row({ tableCode: 'A3', assignmentSlots: [null, 'd@x'] });
const empty = row({ tableCode: 'B1', section: 'B', tier: 'Silver' });
const otherDay = row({ tableCode: 'A1', date: '2026-11-19' });
const ROWS = [full, pair, half, empty, otherDay];

describe('a table’s status', () => {
  it('is assigned when every seat it offers is taken', () => {
    expect(rowStatus(full).label).toBe('assigned');
    expect(rowStatus(pair).label).toBe('assigned');
  });

  it('is partial when a half table has one side free, and says which', () => {
    expect(rowStatus(half)).toMatchObject({ label: 'partial', leftEmail: null, rightEmail: 'd@x' });
  });

  it('is empty with nobody in it', () => {
    expect(rowStatus(empty).label).toBe('empty');
  });
});

/**
 * The counts are a filter as well as a count (E28/F02/S01). They follow the other filters and
 * ignore their own, so choosing "empty" does not turn the assigned and partial counts into 0.
 */
describe('the result filters', () => {
  it('reads every filter from the address, and nothing it does not recognise', () => {
    expect(
      readResultFilters({
        date: '2026-11-18',
        section: ['B', 'C'],
        choice: 'FULL',
        status: 'empty',
      }),
    ).toEqual({ date: '2026-11-18', section: 'B', tier: '', choice: 'full', status: 'empty' });
    expect(readResultFilters({ choice: 'large', status: 'occupied' })).toMatchObject({
      choice: '',
      status: '',
    });
  });

  it('narrows the tables to one status', () => {
    const shown = tablesMatching(ROWS, readResultFilters({ status: 'partial' }));
    expect(shown.map((r) => r.tableCode)).toEqual(['A3']);
  });

  it('combines a status with the other filters', () => {
    const shown = tablesMatching(
      ROWS,
      readResultFilters({ status: 'empty', date: '2026-11-18', section: 'B' }),
    );
    expect(shown).toEqual([empty]);
  });

  it('counts each status under the other filters, ignoring its own', () => {
    const filters = readResultFilters({ date: '2026-11-18', status: 'empty' });
    expect(statusCounts(ROWS, filters)).toEqual({ assigned: 2, partial: 1, empty: 1 });
  });

  it('counts every table when nothing is chosen', () => {
    expect(statusCounts(ROWS, readResultFilters({}))).toEqual({
      assigned: 2,
      partial: 1,
      empty: 2,
    });
  });
});

/**
 * The vendors page filters as the tables page does (E28/F02/S02), and asks where each vendor is
 * PLACED: a vendor row spans every date, so section and tier mean "placed there on the chosen date,
 * or on any date when none is chosen", and the table filter is how they are placed, not what they
 * asked for.
 */
describe('the vendor filters', () => {
  const placements = new Map([
    ['2026-11-18', { section: 'A', tier: 'Gold', tableChoice: 'Full Table' }],
    ['2026-11-19', { section: 'B', tier: 'Silver', tableChoice: 'Half Table' }],
  ]);
  const unplaced = new Map();
  const shown = (query: Record<string, string>, onlyUnassigned = false, isAssigned = true) =>
    vendorShown(placements, readResultFilters(query), { onlyUnassigned, isAssigned });

  it('shows everyone with no filter', () => {
    expect(shown({})).toBe(true);
    expect(
      vendorShown(unplaced, readResultFilters({}), { onlyUnassigned: false, isAssigned: false }),
    ).toBe(true);
  });

  it('a date is the vendors placed that day', () => {
    expect(shown({ date: '2026-11-18' })).toBe(true);
    expect(shown({ date: '2026-11-20' })).toBe(false);
  });

  it('a section or tier is where they are placed on any of their dates', () => {
    expect(shown({ section: 'B' })).toBe(true);
    expect(shown({ tier: 'Gold' })).toBe(true);
    expect(shown({ section: 'C' })).toBe(false);
  });

  it('with a date, a section or tier is where they are placed that day', () => {
    expect(shown({ date: '2026-11-18', section: 'A' })).toBe(true);
    expect(shown({ date: '2026-11-18', section: 'B' })).toBe(false);
    // Section from one day and tier from another is not one placement.
    expect(shown({ section: 'A', tier: 'Silver' })).toBe(false);
  });

  it('the table filter is how they are placed', () => {
    expect(shown({ choice: 'half' })).toBe(true);
    expect(shown({ date: '2026-11-18', choice: 'half' })).toBe(false);
  });

  it('a vendor with no placement drops out under any of them', () => {
    const none = (query: Record<string, string>) =>
      vendorShown(unplaced, readResultFilters(query), { onlyUnassigned: false, isAssigned: false });
    expect(none({ date: '2026-11-18' })).toBe(false);
    expect(none({ tier: 'Gold' })).toBe(false);
  });

  it('ignores the table status, which is a fact about tables', () => {
    expect(shown({ status: 'empty' })).toBe(true);
  });

  it('"unassigned only" is the vendors without a table, and with a date, not placed that day', () => {
    expect(shown({}, true, true)).toBe(false);
    expect(
      vendorShown(unplaced, readResultFilters({}), { onlyUnassigned: true, isAssigned: false }),
    ).toBe(true);
    expect(shown({ date: '2026-11-20' }, true, true)).toBe(true);
    expect(shown({ date: '2026-11-18' }, true, true)).toBe(false);
  });
});

describe('the filters across the two pages', () => {
  it('carries where, and nothing that belongs to one page', () => {
    expect(
      placeFilterQuery({
        date: '2026-11-18',
        section: 'A',
        tier: 'Gold',
        choice: 'half',
        status: 'empty',
        vendor: 'a@x',
        show: 'unassigned',
      }),
    ).toEqual({ date: '2026-11-18', section: 'A', tier: 'Gold', choice: 'half' });
    expect(placeFilterQuery({ choice: 'large' })).toEqual({});
  });

  it('offers only the values the tables have, in order', () => {
    expect(filterOptions(ROWS)).toEqual({
      dates: ['2026-11-18', '2026-11-19'],
      sections: ['A', 'B'],
      tiers: ['Gold', 'Silver'],
    });
  });
});
