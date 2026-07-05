import type { APIRequestContext } from '@playwright/test';

/**
 * Result returned by seedMarketWithVendors().
 */
export interface SeedResult {
  marketId: string;
  userId: string;
  marketName: string;
}

/**
 * Create a test market with vendor data via the back-end API.
 *
 * Uses Playwright's APIRequestContext so cookies flow automatically
 * across requests (Flask uses server-side session cookies, not JWT).
 *
 * Prerequisites:
 * - Back-end must be running (via Docker compose or standalone)
 * - A test user must already exist (use the seed fixture: scripts/seed_fixture.sh)
 *
 * @param request   Playwright APIRequestContext (from `test.request` or `playwright.request.newContext`)
 * @param baseURL   Backend URL, e.g. `https://localhost:5000` (note HTTPS + self-signed cert)
 * @param email     Test user email
 * @param password  Test user password
 */
export async function seedMarketWithVendors(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<SeedResult> {
  // Step 1: Login to get a session cookie and the user UUID
  const loginRes = await request.post(`${baseURL}/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const loginBody = await loginRes.json() as {
    user_data: { id: string; email: string };
  };
  const userId = loginBody.user_data.id;

  // Step 2: Create a market (user must own it)
  const marketName = `E2E Market ${Date.now()}`;
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      roles: { [userId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = await createRes.json() as { market_id: string };

  // Step 3: Upload a minimal vendor CSV with 2 vendors
  const csvContent = [
    'email,vendor_name,table_choice,buddy_email,day_1',
    'alice@example.com,Alice,Full table,,Gold',
    'bob@example.com,Bob,Full table,,Gold',
  ].join('\n');

  const uploadRes = await request.post(`${baseURL}/source-data/${marketId}`, {
    headers: {
      'X-Owner-Email': email,
    },
    multipart: {
      file: {
        name: 'vendors.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent, 'utf-8'),
      },
    },
  });
  if (!uploadRes.ok()) {
    throw new Error(`CSV upload failed: ${uploadRes.status()} ${await uploadRes.text()}`);
  }

  return { marketId, userId, marketName };
}
