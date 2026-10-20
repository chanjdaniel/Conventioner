import { randomInt } from 'node:crypto';

/**
 * A market name no other seeding worker will also make. A market's name is its public address,
 * unique across markets, and a name of `Date.now()` alone was made twice whenever two parallel
 * workers seeded in the same millisecond - the second creation refused, a flaky failure in
 * whichever spec lost. Still digits after the prefix, so a spec matching `\d+` reads it as before.
 */
export function uniqueMarketName(prefix: string): string {
  return `${prefix} ${Date.now()}${randomInt(1000, 10000)}`;
}
