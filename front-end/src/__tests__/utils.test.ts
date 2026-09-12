import { describe, it, expect } from 'vitest';
import { getFormattedDate } from '@/utils/utils';

describe('getFormattedDate', () => {
  it('returns null for an empty string', () => {
    expect(getFormattedDate('')).toBeNull();
  });

  it('formats an ISO calendar date as weekday, month and day', () => {
    expect(getFormattedDate('2026-07-31')).toBe('Friday, July 31');
    expect(getFormattedDate('2026-01-01')).toBe('Thursday, January 1');
    expect(getFormattedDate('2024-02-29')).toBe('Thursday, February 29');
    expect(getFormattedDate('2026-12-31')).toBe('Thursday, December 31');
  });

  // A market date is a calendar day, not an instant: the same stored date
  // must render as the same day for every viewer on earth. The old
  // implementation pinned the date to a hardcoded -08:00 offset and rendered
  // it in the viewer's local timezone, showing the previous day to anyone
  // west of UTC-8 (e.g. Hawaii). Node re-reads process.env.TZ, so exercising
  // several zones in one process is reliable here.
  it('renders the same calendar day regardless of the viewer timezone', () => {
    const originalTz = process.env.TZ;
    const zones = [
      'Pacific/Honolulu',
      'America/Anchorage',
      'America/Los_Angeles',
      'UTC',
      'Asia/Tokyo',
      'Pacific/Kiritimati',
    ];
    try {
      for (const tz of zones) {
        process.env.TZ = tz;
        expect(getFormattedDate('2026-07-31'), `in ${tz}`).toBe('Friday, July 31');
      }
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});
