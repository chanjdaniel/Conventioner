import type { APIRequestContext } from '@playwright/test';
import { savePlan } from './savePlan';
import {
  approvedVendorApplication,
  insertApplications,
  seedApprovedVendor,
} from './seedApplication';
import { uniqueMarketName } from './uniqueName';

/**
 * The market day every seeded vendor says they can attend.
 *
 * Shared on purpose: a vendor is only placeable on a date they answered for, so a setupObject
 * whose market date differs from this silently assigns nobody, and the failure reads as "the
 * solver is broken" rather than "the seed disagrees with itself".
 */
// Still to come: a market leaves draft only with dates that have not passed (E31/F01/S01). A Friday,
// as the date it replaced was.
export const SEED_MARKET_DATE = '2099-05-01';

/**
 * The least a market needs to leave draft (E31/F01/S01): a date still to come, a location, and a
 * tier with tables. For a seed whose subject is not the plan; the market asks the essential
 * questions this offering implies, as any market that opens does.
 */
export function completePlan(marketDate: string = SEED_MARKET_DATE, more: string[] = []) {
  return {
    priority: [],
    marketDates: [marketDate, ...more].map((date) => ({ date })),
    tiers: [{ id: 1, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      { name: 'Hall A', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count: 5 },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  };
}

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
  const loginBody = (await loginRes.json()) as {
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
  const body = (await orgsRes.json()) as { organizations: { id: string }[] };
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
  const createBody = (await createRes.json()) as { organization_id: string };
  return createBody.organization_id;
}

/**
 * Make `email` an admin of the organization, as its owner, whose session the request carries.
 *
 * An organization's admins run its markets (T15), so this makes them Admin on every market the
 * organization holds. Idempotent across runs: a second add changes nothing and answers 400, so the
 * organization is asked instead.
 */
export async function ensureOrganizationAdmin(
  request: APIRequestContext,
  baseURL: string,
  orgId: string,
  email: string,
): Promise<void> {
  const made = await request.post(`${baseURL}/organizations/${orgId}/admins`, {
    data: { user_email: email },
  });
  if (made.ok()) return;
  const orgs = await request.get(`${baseURL}/organizations`);
  const { organizations = [] } = (await orgs.json()) as {
    organizations?: { id: string; adminEmails?: string[] }[];
  };
  if (!organizations.find((o) => o.id === orgId)?.adminEmails?.includes(email)) {
    throw new Error(`Making ${email} an organization admin failed: ${await made.text()}`);
  }
}

/**
 * Log in and make sure the user belongs to at least `count` organizations, creating the rest.
 *
 * For a spec whose subject needs a CHOICE of organization: with one, the create-market dialog
 * picks it for you. Such a spec passed only when an earlier one happened to have created more,
 * which split runs (CI shards) stopped guaranteeing.
 */
export async function ensureTestOrgs(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  count: number,
): Promise<void> {
  await loginViaApi(request, baseURL, email, password);
  const orgsRes = await request.get(`${baseURL}/organizations`, {
    headers: { 'X-Owner-Email': email },
  });
  if (!orgsRes.ok()) {
    throw new Error(`Organization list failed: ${orgsRes.status()} ${await orgsRes.text()}`);
  }
  const { organizations = [] } = (await orgsRes.json()) as { organizations?: unknown[] };
  for (let n = organizations.length; n < count; n++) {
    const res = await request.post(`${baseURL}/organizations`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
      data: { name: `E2E Test Org ${n + 1} ${Date.now()}` },
    });
    if (!res.ok()) {
      throw new Error(`Test org creation failed: ${res.status()} ${await res.text()}`);
    }
  }
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
};

/**
 * Create a test market with vendor data via the back-end API, through the
 * application-based path (no CSV upload through the UI overlay).
 *
 * The market is created in draft phase with a finalized application form and
 * source data uploaded so the assignment engine can compute assignments.
 *
 * The market stays in draft - callers that need applications or archived
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
  /**
   * A name of the caller's choosing. A market can only be renamed while it is a draft
   * (E21/F03/S04), so a spec that needs a particular name for a market further along gives it here.
   * `dates` are the market's dates, every vendor available on each; one, `SEED_MARKET_DATE`, unless
   * named. `intakeMode` is how vendors reach it; absent, a CSV market, as the server reads it.
   */
  options: { name?: string; dates?: string[]; intakeMode?: 'csv' | 'form' } = {},
): Promise<SeedResult> {
  const [firstDate, ...moreDates] = options.dates ?? [SEED_MARKET_DATE];
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

  const marketName = options.name ?? uniqueMarketName('E2E Market');
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
      // Complete, so the market may leave draft (E31/F01/S01).
      setupObject: completePlan(firstDate, moreDates),
      ...(options.intakeMode ? { intakeMode: options.intakeMode } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  // Step 2: Finalize the application form while market is still in draft.
  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: MINIMAL_APPLICATION_FORM,
  });
  if (!formRes.ok()) {
    throw new Error(`Application form save failed: ${formRes.status()} ${await formRes.text()}`);
  }

  // Step 3: Seed the vendors the assignment engine will place. They are approved applications,
  // which is what a vendor is; this used to be a fabricated CSV upload because the solver read a
  // separate source_data collection.
  for (const applicant of ['alice@example.com', 'bob@example.com']) {
    seedApprovedVendor(marketId, applicant, { dates: [firstDate, ...moreDates], tiers: ['Gold'] });
  }

  return { marketId, userId, marketName, orgId };
}

/**
 * Create a published market with vendor data and a configured setupObject
 * so that the assignment algorithm can compute assignments on-the-fly.
 *
 * Unlike seedMarketWithVendors(), this also configures the market's
 * setupObject (dates, sections, tiers, locations) and publishes the market by
 * walking it through the transition endpoint to `market_days`, the phase the
 * check-in page serves, so the check-in API and vendor/table views work.
 *
 * Vendors are seeded as approved applications, which is what the solver reads. They used to be
 * a fabricated CSV upload, back when the solver read a separate source_data collection.
 *
 * @returns PublishedSeedResult with marketSlug for navigating to
 *          the public check-in URL.
 */
export async function seedPublishedMarketWithAssignments(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  // The one market date, still to come unless a spec names another.
  // `intakeMode` as the market is created; absent, it is a CSV market, as it always was here.
  // `vendors`, the approved vendors, each given a table: alice and bob unless a spec needs more,
  // a door long enough to scroll, say.
  options: { marketDate?: string; intakeMode?: 'csv' | 'form'; vendors?: string[] } = {},
): Promise<PublishedSeedResult> {
  const marketDate = options.marketDate ?? SEED_MARKET_DATE;
  const vendors = options.vendors ?? ['alice@example.com', 'bob@example.com'];
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

  const marketName = uniqueMarketName('E2E Published');
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
      ...(options.intakeMode ? { intakeMode: options.intakeMode } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  // Step 2: Finalize the application form while market is still in draft.
  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: MINIMAL_APPLICATION_FORM,
  });
  if (!formRes.ok()) {
    throw new Error(`Application form save failed: ${formRes.status()} ${await formRes.text()}`);
  }

  // Step 3: Seed the vendors as approved applications - what a vendor is. This used to upload a
  // fabricated CSV, because the solver read a separate source_data collection.
  insertApplications(
    vendors.map((applicant) =>
      approvedVendorApplication(marketId, applicant, { dates: [marketDate], tiers: ['Gold'] }),
    ),
  );

  // Step 4: Put the setupObject directly. A market date is now just a date: it carried a
  // spreadsheet column name only so the solver could look the answer up by heading.
  const setupObject = {
    priority: [],
    marketDates: [{ date: marketDate }],
    tiers: [{ id: 0, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      {
        name: 'A',
        location: { name: 'Main Hall' },
        tier: { id: 0, name: 'Gold' },
        count: Math.max(3, vendors.length),
      },
    ],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
    },
    floorplans: null,
  };

  await savePlan(request, baseURL, email, marketId, setupObject);

  const marketSlug = marketNameToSlug(marketName);

  // Step 4: Publish, by walking the edges a real organizer walks, running the assignment from the
  // phase that runs it. `market_days` means "this market is running" and is the only phase
  // check-in serves; its entry invariant is that an assignment exists, because a market with no
  // placements would serve a check-in page that can tell nobody where to stand.
  //
  // The assignment used to be run first, from `draft`. Assign is an operation of the `assignment`
  // phase and refuses everywhere else (E10/F03/S02), so the seed now walks the journey rather
  // than taking a shortcut through it.
  const transitionTo = async (toPhase: string) => {
    const res = await request.post(`${baseURL}/markets/${marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
      data: { toPhase },
    });
    if (!res.ok()) {
      throw new Error(`Transition to ${toPhase} failed: ${res.status()} ${await res.text()}`);
    }
  };

  for (const toPhase of ['applications', 'assignment']) {
    await transitionTo(toPhase);
  }

  const assignRes = await request.post(`${baseURL}/markets/${marketId}/assignment`, {
    headers: { 'X-Owner-Email': email },
  });
  if (!assignRes.ok()) {
    throw new Error(`Assignment run failed: ${assignRes.status()} ${await assignRes.text()}`);
  }

  // A market whose vendors apply on its page tells them before it goes live (E36/F04/S02).
  if (options.intakeMode === 'form') {
    const published = await request.post(`${baseURL}/markets/${marketId}/publish-results`, {
      headers: { 'X-Owner-Email': email },
    });
    if (!published.ok()) {
      throw new Error(`Publishing results failed: ${published.status()} ${await published.text()}`);
    }
  }

  await transitionTo('market_days');

  return { marketId, userId, marketName, orgId, marketSlug };
}
