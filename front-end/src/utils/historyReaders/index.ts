/**
 * The history's words, one file per area: each area's readers, keyed by the entry's action and
 * kind, merged into one table, and the stored values each area names or words, merged for
 * `fieldValue`. A key two areas both define refuses to load, so a split cannot silently change
 * which words an entry gets.
 *
 * A new reader goes in its area's file; a new area is a file, one import line below and one line in
 * `AREAS`, each sorted by file name. Only this file imports the areas, and its test after loading
 * it: each area imports `shared.ts`, which reads the merged tables here, so an area imported before
 * this file would be merged before it had loaded.
 */
import * as applications from './applications';
import * as applying from './applying';
import * as assignment from './assignment';
import * as discord from './discord';
import * as door from './door';
import * as lifecycle from './lifecycle';
import * as organization from './organization';
import * as payments from './payments';
import * as people from './people';
import * as setup from './setup';
import * as vendors from './vendors';
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import { isPlacementKind } from '@/utils/placementHistory';
import type { HistoryArea, HistoryReader } from './shared';

const AREAS: Readonly<Record<string, HistoryArea>> = {
  applications,
  applying,
  assignment,
  discord,
  door,
  lifecycle,
  organization,
  payments,
  people,
  setup,
  vendors,
};

/** One table from each area's, refusing a key two areas both define. */
export function merged<T>(
  what: string,
  tables: Readonly<Record<string, Readonly<Partial<Record<string, T>>> | undefined>>,
): Readonly<Partial<Record<string, T>>> {
  const table: Partial<Record<string, T>> = {};
  const owner: Record<string, string> = {};
  for (const [area, own] of Object.entries(tables)) {
    for (const [key, value] of Object.entries(own ?? {})) {
      if (key in owner) {
        throw new Error(
          `The history's ${what} "${key}" is defined by both ${owner[key]} and ${area}`,
        );
      }
      owner[key] = area;
      table[key] = value;
    }
  }
  return table;
}

function each<K extends keyof HistoryArea>(part: K) {
  return Object.fromEntries(Object.entries(AREAS).map(([area, exports]) => [area, exports[part]]));
}

/** Every area's readers, by key. */
export const HISTORY_READERS: Readonly<Partial<Record<string, HistoryReader>>> = merged(
  'reader',
  each('readers'),
);

/** The stored values the screens already name, in their words. A phase is named by the market's
 * path (`fieldValue`). */
export const NAMED_VALUES = merged('named value', each('namedValues'));

/** The stored values that are lists or objects, in words rather than JSON. */
export const WORDED_VALUES = merged('worded value', each('wordedValues'));

/**
 * The keys an entry's readers are asked by, in order: a placement kind of `assign` first, then its
 * kind under any action (`dealt`), then its action and kind, then every kind of its action. The
 * first reader with words for the sentence words it, and the first with rows for its changes gives
 * them; with none, `marketHistory.ts` falls back to a plain sentence and a plain before and after.
 */
export function readerKeys(entry: Pick<MarketHistoryEntry, 'action' | 'kind'>): string[] {
  const kind = entry.kind ?? '';
  return [
    ...new Set([
      ...(entry.action === 'assign' && isPlacementKind(entry.kind) ? [`assign/${kind}`] : []),
      `*/${kind}`,
      `${entry.action}/${kind}`,
      `${entry.action}/*`,
    ]),
  ];
}

/** The readers an entry may be worded by, in the order `readerKeys` asks them. */
export function readersOf(entry: Pick<MarketHistoryEntry, 'action' | 'kind'>): HistoryReader[] {
  return readerKeys(entry).flatMap((key) => HISTORY_READERS[key] ?? []);
}
