import type { APIRequestContext } from '@playwright/test';

/**
 * Write a market's plan through the plan's own write (E21/F03/S02), as Market Setup does: read the
 * plan's revision, then save the plan from it (ADR 0024).
 *
 * Seeds used to PUT the whole market with a new `setupObject` spread over it. That route is gone
 * (E21/F03/S06): a write names what it changes, and the plan's carries the plan and, while the
 * market is a draft, its intake mode. A save carries the revision its copy of the plan was read at,
 * and the server refuses one with none or an older one, so a seed never writes the plan blind.
 * Throws with the server's words on a refusal; answers the plan's revision now stored.
 */
export async function savePlan(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  marketId: string,
  setupObject: Record<string, unknown>,
  intakeMode?: 'csv' | 'form',
): Promise<number> {
  const address = `${baseURL}/markets/${encodeURIComponent(marketId)}`;
  const read = await request.get(address);
  if (!read.ok()) {
    throw new Error(`Market read failed: ${read.status()} ${await read.text()}`);
  }
  const { market } = (await read.json()) as { market: { planRevision: number } };
  const res = await request.put(`${address}/plan`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      setupObject,
      ...(intakeMode ? { intakeMode } : {}),
      planRevision: market.planRevision,
    },
  });
  if (!res.ok()) {
    throw new Error(`Plan write failed: ${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { planRevision: number }).planRevision;
}
