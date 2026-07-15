import type { SetupObject, TierObject } from '@/assets/types/datatypes';

function splitTierTokens(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Unique tier names from `colValues` for columns mapped as market dates (`colNameIdx`).
 * Order: each market date in configured order, then each distinct cell value in `colValues[idx]`
 * (same order as when the column was scanned), with comma-separated cells split like the assignment backend.
 */
export function collectDefaultTierNames(setup: SetupObject): string[] {
  const { colValues, marketDates, colNames } = setup;
  if (!Array.isArray(colValues) || !Array.isArray(marketDates)) return [];

  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const md of marketDates) {
    const idx = md.colNameIdx;
    if (idx < 0 || idx >= colNames.length || idx >= colValues.length) continue;

    const values = colValues[idx];
    if (!Array.isArray(values)) continue;

    for (const raw of values) {
      for (const token of splitTierTokens(raw)) {
        if (!seen.has(token)) {
          seen.add(token);
          ordered.push(token);
        }
      }
    }
  }

  return ordered;
}

export function buildDefaultTierObjects(names: string[]): TierObject[] {
  return names.map((name, index) => ({
    id: index + 1,
    name,
  }));
}
