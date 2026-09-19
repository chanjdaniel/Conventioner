import { describe, it, expect } from 'vitest';
import {
  getDateRange,
  getFormattedDate,
  getFormattedTimestamp,
  getShortDate,
  getTimestampDate,
  getTimestampTime,
} from '@/utils/utils';

const ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'UTC',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
];

/** Node re-reads process.env.TZ, so exercising several zones in one process is reliable here. */
function inEveryTimezone(check: (tz: string) => void) {
  const originalTz = process.env.TZ;
  try {
    for (const tz of ZONES) {
      process.env.TZ = tz;
      check(tz);
    }
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  }
}

describe('getFormattedDate', () => {
  it('returns null for an empty string', () => {
    expect(getFormattedDate('')).toBeNull();
  });

  it('formats an ISO calendar date as weekday, month, day and year', () => {
    expect(getFormattedDate('2026-07-31')).toBe('Friday, July 31, 2026');
    expect(getFormattedDate('2026-01-01')).toBe('Thursday, January 1, 2026');
    expect(getFormattedDate('2024-02-29')).toBe('Thursday, February 29, 2024');
    expect(getFormattedDate('2026-12-31')).toBe('Thursday, December 31, 2026');
  });

  it('always carries the year, so two markets a year apart are told apart where they are typed', () => {
    expect(getFormattedDate('2025-11-21')).toContain('2025');
    expect(getFormattedDate('2026-11-21')).toContain('2026');
  });

  it('gives back anything that is not a calendar day, rather than "Invalid Date"', () => {
    expect(getFormattedDate('next Saturday')).toBe('next Saturday');
  });

  // A market date is a calendar day, not an instant: the same stored date must render as the same
  // day for every viewer on earth. An earlier implementation pinned the date to a hardcoded -08:00
  // offset and rendered it in the viewer's local timezone, showing the previous day to anyone west
  // of UTC-8 (e.g. Hawaii).
  it('renders the same calendar day regardless of the viewer timezone', () => {
    inEveryTimezone((tz) => {
      expect(getFormattedDate('2026-07-31'), `in ${tz}`).toBe('Friday, July 31, 2026');
    });
  });
});

describe('getShortDate', () => {
  it('is the same day, abbreviated, and still carries the year', () => {
    expect(getShortDate('2026-07-31')).toBe('Jul 31, 2026');
    expect(getShortDate('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('is a calendar day too, so it does not move with the viewer', () => {
    inEveryTimezone((tz) => {
      expect(getShortDate('2026-07-31'), `in ${tz}`).toBe('Jul 31, 2026');
    });
  });

  it('gives back anything that is not a calendar day', () => {
    expect(getShortDate('')).toBe('');
    expect(getShortDate('sometime')).toBe('sometime');
  });
});

describe('timestamps', () => {
  // An instant, unlike a market date, IS local to whoever reads it, so these are pinned in one
  // fixed zone rather than across all of them.
  const SUBMITTED = '2026-09-15T14:20:18.000Z';

  function inUtc<T>(read: () => T): T {
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      return read();
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  }

  it('names the day an instant fell on', () => {
    expect(inUtc(() => getTimestampDate(SUBMITTED))).toBe('Sep 15, 2026');
  });

  it('drops the seconds, which nobody says out loud', () => {
    expect(inUtc(() => getTimestampTime(SUBMITTED))).toBe('2:20 PM');
  });

  it('reads the two together as a sentence', () => {
    expect(inUtc(() => getFormattedTimestamp(SUBMITTED))).toBe('Sep 15, 2026 at 2:20 PM');
  });

  it('says nothing when there is no timestamp', () => {
    expect(getTimestampDate(null)).toBe('');
    expect(getTimestampTime(undefined)).toBe('');
    expect(getFormattedTimestamp('')).toBe('');
  });
});

describe('getDateRange', () => {
  it('collapses the day when both ends share a month and a year', () => {
    expect(getDateRange(['2026-11-21', '2026-11-22'])).toBe('Nov 21-22, 2026');
  });

  it('names both months when the market crosses one', () => {
    expect(getDateRange(['2026-11-30', '2026-12-01'])).toBe('Nov 30 - Dec 1, 2026');
  });

  it('names both years when the market crosses one', () => {
    expect(getDateRange(['2026-12-31', '2027-01-01'])).toBe('Dec 31, 2026 - Jan 1, 2027');
  });

  it('is one day when there is one day', () => {
    expect(getDateRange(['2026-11-21'])).toBe('Nov 21, 2026');
  });

  it('counts the days when a range would hide how many there are', () => {
    expect(getDateRange(['2026-11-21', '2026-11-22', '2026-11-23'])).toBe(
      'Nov 21-23, 2026 (3 days)',
    );
  });

  it('reads the ends off the dates rather than trusting their order', () => {
    expect(getDateRange(['2026-11-22', '2026-11-21'])).toBe('Nov 21-22, 2026');
  });

  it('says a market has no dates rather than rendering an empty range', () => {
    expect(getDateRange([])).toBe('Not set');
    expect(getDateRange(undefined)).toBe('Not set');
  });

  it('is a calendar range, so it does not move with the viewer', () => {
    inEveryTimezone((tz) => {
      expect(getDateRange(['2026-11-21', '2026-11-22']), `in ${tz}`).toBe('Nov 21-22, 2026');
    });
  });
});
