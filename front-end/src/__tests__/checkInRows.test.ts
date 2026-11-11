/**
 * The Check-in section's rows (T201): a row per market day, its vendors checked in of those
 * expected, and beside it how many are not yet in, linking to Attendance on that day; a day with
 * nobody missing says so and links nowhere.
 */
import { describe, expect, it } from 'vitest';
import { checkInRows, type CheckInCounts } from '@/utils/checkInRows';

const CHECK_IN: CheckInCounts = {
  dates: [
    { date: '2099-08-01', expected: 24, checkedIn: 18 },
    { date: '2099-08-02', expected: 20, checkedIn: 20 },
    { date: '2099-08-03', expected: 0, checkedIn: 0 },
  ],
  came: 26,
};
const BEFORE = '2099-07-31';

describe('checkInRows', () => {
  it('reads each day as its vendors checked in of those expected, named by its date', () => {
    const card = checkInRows(CHECK_IN, 'm-1', 'market_days', BEFORE)!;

    expect(card.rows.map(({ key, label, words }) => ({ key, label, words }))).toEqual([
      { key: '2099-08-01', label: 'Saturday, August 1, 2099', words: '18 of 24 checked in' },
      { key: '2099-08-02', label: 'Sunday, August 2, 2099', words: '20 of 20 checked in' },
      { key: '2099-08-03', label: 'Monday, August 3, 2099', words: 'Nobody is assigned' },
    ]);
  });

  it('draws every day on the card largest expected, the mark at its own expected', () => {
    const card = checkInRows(CHECK_IN, 'm-1', 'market_days', BEFORE)!;

    expect(card.scale).toBe(24);
    expect(card.rows.map((row) => [row.checkedIn, row.expected])).toEqual([
      [18, 24],
      [20, 20],
      // Nobody to check in: no bar.
      [null, 0],
    ]);
  });

  it('links the vendors not yet in to Attendance on that day', () => {
    const [saturday] = checkInRows(CHECK_IN, 'm-1', 'market_days', BEFORE)!.rows;

    expect(saturday!.missing).toEqual({
      words: '6 not yet',
      to: { path: '/markets/m-1/attendance', query: { date: '2099-08-01' } },
    });
  });

  it('says a day with nobody missing is all in, and links nowhere', () => {
    const [, sunday, monday] = checkInRows(CHECK_IN, 'm-1', 'market_days', BEFORE)!.rows;

    expect(sunday!.missing).toEqual({ words: 'Everyone is in', to: null });
    expect(monday!.missing).toBeNull();
  });

  it('says of a day that is over that those missing did not come, as the door does', () => {
    const rows = checkInRows(CHECK_IN, 'm-1', 'market_days', '2099-08-02')!.rows;

    // Saturday is over; Sunday is today.
    expect(rows[0]!.missing!.words).toBe('6 did not come');
    expect(checkInRows(CHECK_IN, 'm-1', 'archived', BEFORE)!.rows[0]!.missing!.words).toBe(
      '6 did not come',
    );
  });

  it('reads a day of one vendor with nobody in yet', () => {
    const rows = checkInRows(
      { dates: [{ date: '2099-08-01', expected: 1, checkedIn: 0 }], came: 0 },
      'm-1',
      'market_days',
      BEFORE,
    )!.rows;

    expect(rows[0]!.words).toBe('0 of 1 checked in');
    expect(rows[0]!.missing!.words).toBe('1 not yet');
  });

  it('gives no card before the market reaches Market Days, or for a plan of no date', () => {
    expect(checkInRows(null, 'm-1', 'assignment', BEFORE)).toBeNull();
    expect(checkInRows({ dates: [], came: 0 }, 'm-1', 'market_days', BEFORE)).toBeNull();
  });
});
