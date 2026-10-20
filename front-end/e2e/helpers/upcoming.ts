/**
 * Market dates still to come, for a spec that picks them on the calendar (E31/F01/S01).
 *
 * A market leaves draft only with dates that have not passed, and the calendar steps a month at a
 * time, so a spec that walks through it needs dates a little ahead of whenever it runs rather than
 * a fixed year. Calendar days, computed in UTC like every market date.
 */
export function upcomingSaturday(weeksAfterTheFirst = 0, monthsAhead = 2): string {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1));
  const toSaturday = (6 - first.getUTCDay() + 7) % 7;
  first.setUTCDate(first.getUTCDate() + toSaturday + 7 * weeksAfterTheFirst);
  return first.toISOString().slice(0, 10);
}
