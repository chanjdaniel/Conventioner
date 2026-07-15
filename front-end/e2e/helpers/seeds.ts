import type { APIRequestContext } from '@playwright/test'

/**
 * Result returned by seedMarketWithVendors().
 */
export interface SeedResult {
  marketId: string
  userId: string
  marketName: string
  orgId: string
}

/**
 * Result returned by seedPublishedMarketWithAssignments().
 */
export interface PublishedSeedResult extends SeedResult {
  marketSlug: string
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
    .replace(/^-|-$/g, '')
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
  })
  if (!loginRes.ok()) {
    throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`)
  }
  const loginBody = (await loginRes.json()) as {
    user_data: { id: string; email: string }
  }
  return loginBody.user_data.id
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
  })
  if (!orgsRes.ok()) {
    throw new Error(`Organization list failed: ${orgsRes.status()} ${await orgsRes.text()}`)
  }
  const body = (await orgsRes.json()) as { organizations: { id: string }[] }
  if (body.organizations && body.organizations.length > 0) {
    return body.organizations[0].id
  }

  const createRes = await request.post(`${baseURL}/organizations`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: { name: 'E2E Test Org' },
  })
  if (!createRes.ok()) {
    throw new Error(`Test org creation failed: ${createRes.status()} ${await createRes.text()}`)
  }
  const createBody = (await createRes.json()) as { organization_id: string }
  return createBody.organization_id
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
  await loginViaApi(request, baseURL, email, password)
  return ensureTestOrgAuthenticated(request, baseURL, email)
}

/**
 * Minimal application form with a single "business_name" text field.
 * Used by seeds so the form-fields guard is satisfied before opening applications.
 */
const MINIMAL_APPLICATION_FORM = {
  fields: [
    {
      key: 'business_name',
      label: 'Business Name',
      type: 'text',
      required: false,
      options: [],
      order: 0,
    },
  ],
}

/**
 * Create a test market with vendor data via the back-end API, through the
 * application-based path (no CSV upload through the UI overlay).
 *
 * The market is created in draft phase with a finalized application form and
 * source data uploaded so the assignment engine can compute assignments.
 *
 * The market stays in draft - callers that need applications_open or archived
 * must transition themselves. This keeps seedAssignedMarket callers compatible.
 *
 * The D9 lock ordering is enforced: the application form is finalized BEFORE
 * any Application document could be created, though none are created here.
 *
 * @param request   Playwright APIRequestContext
 * @param baseURL   Backend URL
 * @param email     Test user email
 * @param password  Test user password
 */
export async function seedMarketWithVendors(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<SeedResult> {
  const userId = await loginViaApi(request, baseURL, email, password)
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email)

  const marketName = `E2E Market ${Date.now()}`
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  })
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`)
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string }

  // Step 2: Finalize the application form while market is still in draft.
  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: MINIMAL_APPLICATION_FORM,
  })
  if (!formRes.ok()) {
    throw new Error(`Application form save failed: ${formRes.status()} ${await formRes.text()}`)
  }

  // Step 3: Upload source data so the assignment engine can compute assignments.
  // The solver reads from the source_data collection; without it assignment fails.
  // This dependency will be removed in Phase 5 (assignment solver adapter).
  const csvContent = [
    'email,vendor_name,table_choice,buddy_email,day_1',
    'alice@example.com,Alice,Full table,,Gold',
    'bob@example.com,Bob,Full table,,Gold',
  ].join('\n')
  const srcRes = await request.post(`${baseURL}/source-data/${marketId}`, {
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
  })
  if (!srcRes.ok()) {
    throw new Error(`Source data upload failed: ${srcRes.status()} ${await srcRes.text()}`)
  }

  return { marketId, userId, marketName, orgId }
}

/**
 * Create a published market with vendor data and a configured setupObject
 * so that the assignment algorithm can compute assignments on-the-fly.
 *
 * Unlike seedMarketWithVendors(), this also configures the market's
 * setupObject (column mapping, dates, sections, tiers, locations) and
 * publishes the market via the transition endpoint (draft -> archived, the same
 * edge the product's Done button takes) so the check-in API and vendor/table
 * views work.
 *
 * The assignment engine still requires source_data (populated by the CSV
 * intake). A minimal inline CSV is uploaded to satisfy that dependency while
 * the assignment solver still routes through source_data. This dependency
 * belongs to Phase 5 of Conventioner and is explicitly NOT removed here.
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
  const userId = await loginViaApi(request, baseURL, email, password)
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email)

  const marketName = `E2E Published ${Date.now()}`
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  })
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`)
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string }

  // Step 2: Finalize the application form while market is still in draft.
  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: MINIMAL_APPLICATION_FORM,
  })
  if (!formRes.ok()) {
    throw new Error(`Application form save failed: ${formRes.status()} ${await formRes.text()}`)
  }

  // Step 3: Upload source data so the assignment engine can compute assignments.
  // The solver reads from the source_data collection, not from setupObject.colValues.
  // This dependency will be removed in Phase 5 (assignment solver adapter).
  const csvContent = [
    'email,vendor_name,table_choice,buddy_email,market_date,tier',
    'alice@example.com,Alice,Full table,,Gold,Gold',
    'bob@example.com,Bob,Full table,,Gold,Gold',
  ].join('\n')

  const srcRes = await request.post(`${baseURL}/source-data/${marketId}`, {
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
  })
  if (!srcRes.ok()) {
    throw new Error(`Source data upload failed: ${srcRes.status()} ${await srcRes.text()}`)
  }

  // Step 4: Put the setupObject directly.
  // colName is included because the assignment solver's _calculate_date_flexibility
  // calls toAttrString(market_date.col_name) which crashes on None.
  // This coupling belongs to Phase 5 and is explicitly NOT removed here.
  const setupObject = {
    colNames: ['email', 'vendor_name', 'table_choice', 'buddy_email', 'market_date', 'tier'],
    colValues: [],
    colInclude: [true, true, true, true, true, true],
    enumPriorityOrder: [[], [], [], [], [], []],
    priority: [{ id: 0, colNameIdx: 4, dataType: 'String', sortingOrder: 'ascending' }],
    marketDates: [{ date: '2026-05-01', colNameIdx: 4, colName: 'market_date' }],
    tiers: [{ id: 0, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
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
  }

  // Fetch the market so we can enrich it.
  const getMarketRes = await request.get(`${baseURL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': email },
  })
  if (!getMarketRes.ok()) {
    throw new Error(`Market fetch failed: ${getMarketRes.status()} ${await getMarketRes.text()}`)
  }
  const { market } = (await getMarketRes.json()) as { market: Record<string, unknown> }

  const setupRes = await request.put(`${baseURL}/markets/${marketId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      ...market,
      setupObject,
    },
  })
  if (!setupRes.ok()) {
    throw new Error(`Market setup put failed: ${setupRes.status()} ${await setupRes.text()}`)
  }

  // Step 4: Publish via the transition endpoint (draft -> archived).
  const transRes = await request.post(`${baseURL}/markets/${marketId}/transition`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: { toPhase: 'archived' },
  })
  if (!transRes.ok()) {
    throw new Error(`Market transition failed: ${transRes.status()} ${await transRes.text()}`)
  }

  const marketSlug = marketNameToSlug(marketName)

  // Step 5: Fetch computed assignment and store it on the market.
  const assignRes = await request.get(`${baseURL}/markets/${marketId}/assignment`, {
    headers: { 'X-Owner-Email': email },
  })
  if (!assignRes.ok()) {
    throw new Error(`Assignment fetch failed: ${assignRes.status()} ${await assignRes.text()}`)
  }
  const assignedMarket = (await assignRes.json()) as Record<string, unknown>

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
  })
  if (!storeRes.ok()) {
    throw new Error(`Assignment store failed: ${storeRes.status()} ${await storeRes.text()}`)
  }

  return { marketId, userId, marketName, orgId, marketSlug }
}
