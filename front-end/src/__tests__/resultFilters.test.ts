import { describe, expect, it } from 'vitest';
import {
  readResultFilters,
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
