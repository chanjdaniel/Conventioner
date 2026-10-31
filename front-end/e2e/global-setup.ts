import { mongoEval } from './helpers/mongo';
import { hostNetworkSettled } from './helpers/networkSettles';

/**
 * Every run starts with no sign-in attempts counted (T12), and once the host's container network
 * has settled, so a stack started just before it does not fail its first spec (`networkSettles.ts`).
 *
 * The applicant sign-in limits count per address and per caller for a quarter of an hour, in the
 * database. Specs sign in with fixed addresses, and every browser request reaches the back end from
 * the same caller, so a second run within that quarter of an hour would start from the first one's
 * count and be refused.
 */
export default async function globalSetup(): Promise<void> {
  mongoEval('db.sign_in_attempts.deleteMany({})');
  await hostNetworkSettled();
}
