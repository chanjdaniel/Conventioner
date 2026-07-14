import type { APIRequestContext } from '@playwright/test';

/**
 * Result returned by seedMarketWithVendors().
 */
export interface SeedResult {
  marketId: string;
  userId: string;
  marketName: string;
  orgId: string;
}

/**
 * Result returned by seedPublishedMarketWithAssignments().
 */
export interface PublishedSeedResult extends SeedResult {
  marketSlug: string;
}

/**
 * Replicate the front-end marketNameToKebabSlug logic for URL-safe slugs.
 */
export function marketNameToSlug(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Log in via the API so the request context carries a Flask session cookie.
 * Returns the user UUID.
 */
export async function loginViaApi(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<string> {
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
  return loginBody.user_data.id;
}

/**
 * Helper: ensure the test user has at least one organization.
 * Assumes the request context already carries a Flask session cookie
 * (the /organizations endpoints are login-protected).
 * Creates an organization named 'E2E Test Org' if none exist.
 * Returns the organization ID.
 */
export async function ensureTestOrgAuthenticated(
  request: APIRequestContext,
  baseURL: string,
  email: string,
): Promise<string> {
  const orgsRes = await request.get(`${baseURL}/organizations`, {
    headers: { 'X-Owner-Email': email },
  });
  if (!orgsRes.ok()) {
    throw new Error(`Organization list failed: ${orgsRes.status()} ${await orgsRes.text()}`);
  }
  const body = await orgsRes.json() as { organizations: { id: string }[] };
  if (body.organizations && body.organizations.length > 0) {
    return body.organizations[0].id;
  }

  const createRes = await request.post(`${baseURL}/organizations`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: { name: 'E2E Test Org' },
  });
  if (!createRes.ok()) {
    throw new Error(`Test org creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const createBody = await createRes.json() as { organization_id: string };
  return createBody.organization_id;
}

/**
 * Helper: log in and ensure the test user has at least one organization.
 * Use this from call sites whose request context has never authenticated.
 * Returns the organization ID.
 */
export async function ensureTestOrg(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<string> {
  await loginViaApi(request, baseURL, email, password);
  return ensureTestOrgAuthenticated(request, baseURL, email);
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
  const userId = await loginViaApi(request, baseURL, email, password);

  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

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
      organizationId: orgId,
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

  return { marketId, userId, marketName, orgId };
}

/**
 * Create a published market with vendor data and a configured setup_object
 * so that the assignment algorithm can compute assignments on-the-fly.
 *
 * Unlike seedMarketWithVendors(), this also configures the market's
 * setup_object (column mapping, dates, sections, tiers, locations) and
 * publishes the market via the transition endpoint (draft -> archived, the same
 * edge the product's Done button takes) so the check-in API and vendor/table
 * views work. Publishing has to move the phase: isDraft is derived from it, and
 * the public slug lookup serves markets past draft only.
 *
 * The CSV includes a proper date column so the assignment algorithm
 * produces meaningful per-date assignments.
 *
 * @returns PublishedSeedResult with marketSlug for navigating to
 *          the public check-in URL.
 */
export async function seedPublishedMarketWithAssignments(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<PublishedSeedResult> {
  // Step 1: Login
  const userId = await loginViaApi(request, baseURL, email, password);

  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

  // Step 2: Create a market
  const marketName = `E2E Published ${Date.now()}`;
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      name: marketName,
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
  const { market_id: marketId } = await createRes.json() as { market_id: string };

  // Step 3: Upload a vendor CSV with tier values in the date column
  const csvContent = [
    'email,vendor_name,table_choice,buddy_email,market_date,tier',
    'alice@example.com,Alice,Full table,,Gold,Gold',
    'bob@example.com,Bob,Full table,,Gold,Gold',
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

  // Step 4: Fetch the market so we can enrich it with a setup_object
  const getMarketRes = await request.get(`${baseURL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': email },
  });
  if (!getMarketRes.ok()) {
    throw new Error(`Market fetch failed: ${getMarketRes.status()} ${await getMarketRes.text()}`);
  }
  const { market } = await getMarketRes.json() as { market: Record<string, unknown> };

  // Step 5: Attach the setup_object, then publish via the transition endpoint
  // Hardcode colValues to match the CSV above — avoids issues with
  // source-data API response format differences between endpoints.
  const setupObject = {
    colNames: ['email', 'vendor_name', 'table_choice', 'buddy_email', 'market_date', 'tier'],
    colValues: [],
    colInclude: [true, true, true, true, true, true],
    enumPriorityOrder: [[], [], [], [], [], []],
    priority: [
      { id: 0, colNameIdx: 4, dataType: 'String', sortingOrder: 'ascending' },
    ],
    marketDates: [
      { date: '2026-05-01', colNameIdx: 4, colName: 'market_date' },
    ],
    tiers: [
      { id: 0, name: 'Gold' },
    ],
    locations: [
      { name: 'Main Hall' },
    ],
    sections: [
      {
        name: 'A',
        location: { name: 'Main Hall' },
        tier: { id: 0, name: 'Gold' },
        count: 3,
      },
    ],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
      emailColNameIdx: 0,
      tableChoiceColNameIdx: 2,
      tableShareEmailColNameIdx: 3,
      maxDaysColNameIdx: null,
    },
    floorplans: null,
  };

  const publishRes = await request.put(`${baseURL}/markets/${marketId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      ...market,
      setupObject,
    },
  });
  if (!publishRes.ok()) {
    throw new Error(`Market setup put failed: ${publishRes.status()} ${await publishRes.text()}`);
  }

  // Publish via the transition endpoint so phase advances and isDraft stays in sync.
  const transitionRes = await request.post(`${baseURL}/markets/${marketId}/transition`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: { toPhase: 'archived' },
  });
  if (!transitionRes.ok()) {
    throw new Error(`Market transition failed: ${transitionRes.status()} ${await transitionRes.text()}`);
  }

  const marketSlug = marketNameToSlug(marketName);

  const assignRes = await request.get(`${baseURL}/markets/${marketId}/assignment`, {
    headers: { 'X-Owner-Email': email },
  });
  if (!assignRes.ok()) {
    throw new Error(`Assignment fetch failed: ${assignRes.status()} ${await assignRes.text()}`);
  }
  const assignedMarket = await assignRes.json() as Record<string, unknown>;

  const storeRes = await request.put(`${baseURL}/markets/${marketId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      ...market,
      setupObject,
      assignmentObject: assignedMarket.assignmentObject || {},
    },
  });
  if (!storeRes.ok()) {
    throw new Error(`Assignment store failed: ${storeRes.status()} ${await storeRes.text()}`);
  }

  return { marketId, userId, marketName, orgId, marketSlug };
}
