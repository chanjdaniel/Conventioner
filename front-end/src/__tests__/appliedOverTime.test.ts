/**
 * Applications over time, as the Stats tab's column chart draws them (T201): a bucket per day in
 * the reader's calendar from the day applications opened, or the first response if that came
 * earlier, to today while they are open or to the day they closed, empty days kept as gaps, and a
 * bucket per week of Monday to Sunday once the span passes six weeks.
 */
import { describe, expect, it } from 'vitest';
import { MarketPhase } from '@/assets/types/datatypes';
import { appliedOverTime, type IntakeTimes } from '@/utils/appliedOverTime';

// Local times, so the day each falls on is the same wherever the suite runs.
function times(more: Partial<IntakeTimes>): IntakeTimes {
  return { submittedAt: [], openedAt: null, closedAt: null, ...more };
}

const counts = (chart: ReturnType<typeof appliedOverTime>) =>
  chart!.buckets.map((b) => [b.start, b.count]);

describe('applications over time', () => {
  it('counts a column per day from the opening to today while applications are open', () => {
    const chart = appliedOverTime(
      times({
        openedAt: '2026-10-01T09:00:00',
        submittedAt: ['2026-10-01T10:00:00', '2026-10-03T11:00:00', '2026-10-03T23:30:00'],
      }),
      MarketPhase.Applications,
      '2026-10-05',
    );

    expect(chart!.unit).toBe('day');
    expect(counts(chart)).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 0],
      ['2026-10-03', 2],
      ['2026-10-04', 0],
      ['2026-10-05', 0],
    ]);
    expect(chart!.total).toBe(3);
  });

  it('ends at the day applications closed, not today', () => {
    const chart = appliedOverTime(
      times({
        openedAt: '2026-10-01T09:00:00',
        closedAt: '2026-10-03T18:00:00',
        submittedAt: ['2026-10-02T10:00:00'],
      }),
      MarketPhase.Assignment,
      '2026-11-20',
    );

    expect(counts(chart)).toEqual([
      ['2026-10-01', 0],
      ['2026-10-02', 1],
      ['2026-10-03', 0],
    ]);
  });

  it('starts at the first response when a Google Form took responses before the market opened', () => {
    const chart = appliedOverTime(
      times({
        openedAt: '2026-10-04T09:00:00',
        submittedAt: ['2026-10-02T10:00:00', '2026-10-04T10:00:00'],
      }),
      MarketPhase.Applications,
      '2026-10-04',
    );

    expect(chart!.buckets[0].start).toBe('2026-10-02');
    expect(chart!.buckets).toHaveLength(3);
  });

  it('with no record of the opening, starts at the first response', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-10-02T10:00:00', '2026-10-03T10:00:00'] }),
      MarketPhase.Applications,
      '2026-10-03',
    );

    expect(counts(chart)).toEqual([
      ['2026-10-02', 1],
      ['2026-10-03', 1],
    ]);
  });

  it('out of applications with no record of the close, ends at the last response', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-10-02T10:00:00', '2026-10-03T10:00:00'] }),
      MarketPhase.Archived,
      '2027-02-01',
    );

    expect(chart!.buckets.at(-1)!.start).toBe('2026-10-03');
  });

  it('draws a response that came after the close', () => {
    const chart = appliedOverTime(
      times({
        openedAt: '2026-10-01T09:00:00',
        closedAt: '2026-10-02T18:00:00',
        submittedAt: ['2026-10-04T10:00:00'],
      }),
      MarketPhase.Assignment,
      '2026-10-10',
    );

    expect(chart!.buckets.at(-1)).toMatchObject({ start: '2026-10-04', count: 1 });
  });

  it('reads each time as a day in the reader’s calendar', () => {
    // 23:30 local is the same local day, whatever its UTC day.
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-10-01T23:30:00', '2026-10-02T00:30:00'] }),
      MarketPhase.Applications,
      '2026-10-02',
    );

    expect(counts(chart)).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 1],
    ]);
  });

  it('skips a time it cannot read', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['not a time', '2026-10-02T10:00:00'] }),
      MarketPhase.Applications,
      '2026-10-02',
    );

    expect(chart!.total).toBe(1);
  });

  it('has nothing to draw when nobody applied with a time', () => {
    expect(
      appliedOverTime(
        times({ openedAt: '2026-10-01T09:00:00' }),
        MarketPhase.Applications,
        '2026-10-02',
      ),
    ).toBeNull();
  });

  it('keeps days for six weeks: 42 days are 42 columns', () => {
    const chart = appliedOverTime(
      times({ openedAt: '2026-09-01T09:00:00', submittedAt: ['2026-09-01T10:00:00'] }),
      MarketPhase.Applications,
      '2026-10-12',
    );

    expect(chart!.unit).toBe('day');
    expect(chart!.buckets).toHaveLength(42);
  });

  it('past 42 days counts by weeks of Monday to Sunday', () => {
    // Tuesday Sep 1 to Tuesday Oct 13, 2026: 43 days, in the weeks of Mon Aug 31 to Mon Oct 12.
    const chart = appliedOverTime(
      times({
        openedAt: '2026-09-01T09:00:00',
        submittedAt: [
          '2026-09-01T10:00:00',
          '2026-09-06T10:00:00', // Sunday: the first week still
          '2026-09-07T10:00:00', // Monday: the second
          '2026-10-13T10:00:00',
        ],
      }),
      MarketPhase.Applications,
      '2026-10-13',
    );

    expect(chart!.unit).toBe('week');
    expect(chart!.buckets).toHaveLength(7);
    expect(chart!.buckets[0]).toMatchObject({ start: '2026-08-31', end: '2026-09-06', count: 2 });
    expect(chart!.buckets[1]).toMatchObject({ start: '2026-09-07', end: '2026-09-13', count: 1 });
    expect(chart!.buckets.slice(2, 6).map((b) => b.count)).toEqual([0, 0, 0, 0]);
    expect(chart!.buckets[6]).toMatchObject({ start: '2026-10-12', end: '2026-10-18', count: 1 });
  });

  it('names each day and week as the axis and the table say them', () => {
    const days = appliedOverTime(
      times({ submittedAt: ['2026-10-01T10:00:00'] }),
      MarketPhase.Applications,
      '2026-10-02',
    )!;
    expect(days.buckets[0]).toMatchObject({ label: 'Oct 1', name: 'Thu, Oct 1, 2026' });

    const weeks = appliedOverTime(
      times({ submittedAt: ['2026-09-01T10:00:00'] }),
      MarketPhase.Applications,
      '2026-11-01',
    )!;
    expect(weeks.buckets[0]).toMatchObject({ label: 'Aug 31', name: 'Aug 31 to Sep 6, 2026' });
    expect(weeks.buckets.at(-1)).toMatchObject({ label: 'Oct 26', name: 'Oct 26 to Nov 1, 2026' });
  });

  it('says the chart in one sentence: how many, over what span, and the busiest', () => {
    const chart = appliedOverTime(
      times({
        openedAt: '2026-10-01T09:00:00',
        submittedAt: [
          '2026-10-01T10:00:00',
          '2026-10-03T10:00:00',
          '2026-10-03T11:00:00',
          '2026-10-04T10:00:00',
          '2026-10-04T11:00:00',
        ],
      }),
      MarketPhase.Applications,
      '2026-10-05',
    )!;

    // Two days tie for the most: the first is named.
    expect(chart.summary).toBe('5 applications from Oct 1 to 5, 2026, most on Oct 3: 2');
  });

  it('says one day as one day, and one application as one', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-10-01T10:00:00'] }),
      MarketPhase.Archived,
      '2027-01-01',
    )!;

    expect(chart.summary).toBe('1 application on Oct 1, 2026');
  });

  it('names the busiest week by its span', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-09-01T10:00:00', '2026-09-08T10:00:00', '2026-09-09T10:00:00'] }),
      MarketPhase.Applications,
      '2026-11-01',
    )!;

    expect(chart.summary).toBe(
      '3 applications from Aug 31 to Nov 1, 2026, most in the week of Sep 7 to 13: 2',
    );
  });

  it('gives the year at both ends when the span crosses one', () => {
    const chart = appliedOverTime(
      times({ submittedAt: ['2026-12-30T10:00:00', '2027-01-02T10:00:00'] }),
      MarketPhase.Archived,
      '2027-03-01',
    )!;

    expect(chart.summary).toBe(
      '2 applications from Dec 30, 2026 to Jan 2, 2027, most on Dec 30: 1',
    );
  });
});
