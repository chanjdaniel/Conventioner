import type { APIRequestContext } from '@playwright/test';

/**
 * Write a market's plan through the plan's own write (E21/F03/S02).
 *
 * Seeds used to PUT the whole market with a new `setupObject` spread over it. That route is gone
 * (E21/F03/S06): a write names what it changes, and the plan's carries the plan and, while the
 * market is a draft, its intake mode. Throws with the server's words on a refusal.
 */
export async function savePlan(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  marketId: string,
  setupObject: Record<string, unknown>,
  intakeMode?: 'csv' | 'form',
): Promise<void> {
  const res = await request.put(`${baseURL}/markets/${encodeURIComponent(marketId)}/plan`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: intakeMode ? { setupObject, intakeMode } : { setupObject },
  });
  if (!res.ok()) {
    throw new Error(`Plan write failed: ${res.status()} ${await res.text()}`);
  }
}
