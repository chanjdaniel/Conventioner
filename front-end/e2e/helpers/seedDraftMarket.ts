import type { APIRequestContext } from '@playwright/test';
import { ensureTestOrgAuthenticated, loginViaApi } from './seeds';

export interface DraftMarketSeed {
  marketId: string;
  marketName: string;
  userId: string;
}

/**
 * A draft market with nothing on it: no plan, no form, the intake mode left to its default.
 * What an organizer has the moment the new-market dialog closes.
 */
export async function seedDraftMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  name = `E2E Draft ${Date.now()}`,
): Promise<DraftMarketSeed> {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      name,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [userId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };
  return { marketId, marketName: name, userId };
}
