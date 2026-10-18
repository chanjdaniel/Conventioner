/**
 * Satisfaction as the Result page shows it: a whole percent, rounded DOWN.
 *
 * Rounding to the nearest showed a run that missed one date in 210 as "100%", which tells the
 * organizer nobody was short-changed when someone was (known gap 7). The small nudge keeps a score
 * that is exactly whole, but lands a hair below it in floating point, from losing a percent.
 */
export function satisfactionPercent(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Not applicable';
  return `${Math.floor(score * 100 + 1e-9)}%`;
}
