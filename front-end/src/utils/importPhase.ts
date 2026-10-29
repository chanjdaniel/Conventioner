import type { Market } from '@/assets/types/datatypes';
import { MarketPhase } from '@/assets/types/datatypes';
import { blockersFor } from '@/utils/marketGuide';

/**
 * Whether a market can be imported into, and if not, why - in words that name an action the
 * organizer can take from the phase they are actually in.
 *
 * Mirrors `IMPORT_PHASES` and `import_refusal` in `back-end/csv_import.py`, which is the
 * enforcement: all three import endpoints are reachable directly, and a hidden button is not a
 * rule. This exists so the import can say no before the organizer picks a file.
 *
 * A Google Form market's first import, in draft, is its way into Review (E38/F04/S01), and in Review
 * "Redo import" reads the whole responses file again; from assignment on nothing more is imported.
 */
export const IMPORT_PHASES: readonly string[] = [MarketPhase.Draft, MarketPhase.Applications];

/** The guard the first import satisfies itself, by writing the rows it waits on (`guards.py`). */
const RESPONSES_IMPORTED = 'responses_imported';

export function canImportInto(phase: string | undefined | null): boolean {
  return IMPORT_PHASES.includes(String(phase ?? MarketPhase.Draft));
}

/**
 * Why importing is refused right now, or null when it is not. A draft's first import also waits on
 * what would keep it from entering Review - the move's served blockers, less the import's own - and
 * says the first of them, as the server does.
 */
export function importRefusal(market: Market | null | undefined): string | null {
  const phase = String(market?.phase ?? MarketPhase.Draft);
  if (!canImportInto(phase)) {
    return `This market is in the ${phase.replace(/_/g, ' ')} phase, past review, so it takes no more applications and nothing more can be imported.`;
  }
  if (phase !== MarketPhase.Draft || !market) return null;
  const [first] = blockersFor(market, MarketPhase.Applications).filter(
    (blocker) => blocker.id !== RESPONSES_IMPORTED,
  );
  return first?.message ?? null;
}
