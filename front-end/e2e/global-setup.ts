import type { FullConfig } from '@playwright/test';
import { mongoEval } from './helpers/mongo';
import { hostNetworkSettled } from './helpers/networkSettles';
import { stackReady } from './helpers/stackReady';

/**
 * Every run starts with no sign-in attempts counted (T12), once the host's container network has
 * settled, so a stack started just before it does not fail its first spec (`networkSettles.ts`),
 * and once the stack is ready, the back end answering and the sign-in page drawn (`stackReady.ts`).
 * The network comes first, since a page loaded while it changes would fail.
 *
 * The applicant sign-in limits count per address and per caller for a quarter of an hour, in the
 * database. Specs sign in with fixed addresses, and every browser request reaches the back end from
 * the same caller, so a second run within that quarter of an hour would start from the first one's
 * count and be refused.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  mongoEval('db.sign_in_attempts.deleteMany({})');
  await hostNetworkSettled();
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('e2e: the config names no baseURL to wait for the stack at');
  await stackReady(baseURL);
}
