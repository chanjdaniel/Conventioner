import { execFileSync } from 'node:child_process';
import { mongoContainer } from './containerNames';

/** The stack's database, as reached from inside its own Mongo container. */
const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

/**
 * Run a script against the stack's database and return what it printed, trimmed.
 *
 * For what no endpoint does: an applicant's submission before there was a submit endpoint, a
 * document shaped as an older build wrote it, a token only an email carries. The one place the
 * suite shells into Mongo, so the container, the address and the flags are said once - they were
 * copied into fifteen files.
 */
export function mongoEval(script: string): string {
  return execFileSync(
    'docker',
    ['exec', mongoContainer(), 'mongosh', MONGO_URI, '--quiet', '--eval', script],
    { encoding: 'utf-8', timeout: 10_000 },
  ).trim();
}
