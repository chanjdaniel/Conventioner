import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import { blockersFor, intakeModeOf } from '@/utils/marketGuide';

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

/** Said of a market whose vendors apply on its page, in any phase; `import_refusal`'s, word for word. */
const FORM_MARKET_REFUSAL =
  'This market takes applications on its own page, so nothing is imported into it.';

/** Whether this market's vendors apply on its page, so it takes no import at all (E31/F03/S04). */
export function takesNoImport(market: Market | null | undefined): boolean {
  return Boolean(market) && intakeModeOf(market) === IntakeMode.Form;
}

export function canImportInto(phase: string | undefined | null): boolean {
  return IMPORT_PHASES.includes(String(phase ?? MarketPhase.Draft));
}

/**
 * What would keep a draft's first import from taking it into Review: the move's served blockers,
 * less the import's own, in the guards' order. Empty past draft, where an import moves nothing, and
 * on a market whose vendors apply on its page, which takes no import at all.
 * Mirrors `first_import_blockers` in `back-end/csv_import.py`, behind `import_refusal`'s intake check.
 */
export function firstImportBlockers(market: Market | null | undefined): PreconditionResult[] {
  if (
    !market ||
    takesNoImport(market) ||
    String(market.phase ?? MarketPhase.Draft) !== MarketPhase.Draft
  )
    return [];
  return blockersFor(market, MarketPhase.Applications).filter(
    (blocker) => blocker.id !== RESPONSES_IMPORTED,
  );
}

/**
 * Why importing is refused right now, or null when it is not. A market whose vendors apply on its
 * page takes no import in any phase, said before its phase or plan, as the server does. A draft's
 * first import also waits on what would keep it from entering Review (`firstImportBlockers`), and
 * says every one of them at once, as the server does (T205/F09): one trip to Market Setup, not one
 * per missing thing.
 */
export function importRefusal(market: Market | null | undefined): string | null {
  if (takesNoImport(market)) return FORM_MARKET_REFUSAL;
  const phase = String(market?.phase ?? MarketPhase.Draft);
  if (!canImportInto(phase)) {
    return `This market is in the ${phase.replace(/_/g, ' ')} phase, past review, so it takes no more applications and nothing more can be imported.`;
  }
  const blockers = firstImportBlockers(market);
  return blockers.length ? blockers.map((blocker) => blocker.message).join(' ') : null;
}
