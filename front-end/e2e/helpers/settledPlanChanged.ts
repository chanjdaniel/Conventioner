import { execFileSync } from 'node:child_process';
import { mongoContainer } from './containerNames';

/**
 * Change the plan of a market that has left draft, as only a market older than the rule could have
 * (E31/F01/S01).
 *
 * The setup settles on leaving draft, so no request can shrink a room after the assignment ran.
 * A market that left draft before that rule could, and a pin at a table its plan no longer has -
 * an orphaned pin - is what `NoOrphanedPinGuard` and the marks on Result and Vendors exist for.
 * Written straight into Mongo, the way such a market's plan already sits there.
 */
export function changeASettledPlan(marketId: string, setupObject: Record<string, unknown>): void {
  execFileSync(
    'docker',
    [
      'exec',
      mongoContainer(),
      'mongosh',
      'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin',
      '--quiet',
      '--eval',
      `db.markets.updateOne({id:${JSON.stringify(marketId)}}, {$set:{setupObject: ${JSON.stringify(setupObject)}}})`,
    ],
    { encoding: 'utf-8' },
  );
}
