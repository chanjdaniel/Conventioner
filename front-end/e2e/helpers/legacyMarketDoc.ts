import { execFileSync } from 'node:child_process';
import { mongoContainer, backendContainer } from './containerNames';

/**
 * Reach into the stack's Mongo and back end to reproduce, and then repair, a market document
 * written by the build that predates `phase`.
 *
 * There is no product path back to that document shape - the whole point of PR 4 is that the
 * running app can no longer produce it - so the only way to test the upgrade is to write the
 * shape directly and run the real migration script against it.
 */

const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

function mongoEval(script: string): string {
  return execFileSync(
    'docker',
    ['exec', mongoContainer(), 'mongosh', MONGO_URI, '--quiet', '--eval', script],
    { encoding: 'utf-8' },
  ).trim();
}

export interface MarketLifecycle {
  phase: string | null;
  isDraft: boolean | null;
}

/**
 * Rewrite a market into the shape the OLD build stored for a PUBLISHED market.
 *
 * Publishing used to be `PUT isDraft: false`. `create_market` had already stamped
 * `phase: "draft"` and `update_market` re-applied the stored phase, so the phase never moved:
 * `isDraft` was the only publish signal the document carried.
 */
export function makeLegacyPublishedMarket(marketId: string): void {
  mongoEval(
    `db.markets.updateOne({id: ${JSON.stringify(marketId)}}, ` +
      `{$set: {phase: "draft", isDraft: false}})`,
  );
}

export function readMarketLifecycle(marketId: string): MarketLifecycle {
  const raw = mongoEval(
    `const m = db.markets.findOne({id: ${JSON.stringify(marketId)}}, {_id: 0, phase: 1, isDraft: 1});` +
      `print(JSON.stringify({phase: m?.phase ?? null, isDraft: m?.isDraft ?? null}))`,
  );
  return JSON.parse(raw) as MarketLifecycle;
}

/** Run the real migration script, in the back-end container, against the live database. */
export function runIsDraftConsistencyMigration(): string {
  return execFileSync(
    'docker',
    ['exec', backendContainer(), 'python', 'migrations/migrate_is_draft_consistency.py'],
    { encoding: 'utf-8' },
  );
}
