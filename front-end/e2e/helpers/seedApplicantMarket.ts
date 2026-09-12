import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { mongoContainer } from './containerNames';
import { loginViaApi, ensureTestOrgAuthenticated, marketNameToSlug } from './seeds';
import { seedApplication } from './seedApplication';

/**
 * Seed result for a market that an applicant can log into.
 *
 * The market is published past `draft` and in `applications_open` phase with a
 * configured application form. An Application document exists for the applicant
 * so the back end treats their email as known.
 */
export interface ApplicantMarketSeed {
  marketId: string;
  marketName: string;
  marketSlug: string;
  orgId: string;
}

const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

/** Two fields typical of an application form — required, so a save that skipped
 *  validation would be noticeable. */
export const APPLICATION_FIELDS = [
  {
    key: 'business_name',
    label: 'Business Name',
    type: 'text',
    required: true,
    options: [],
    order: 0,
  },
  {
    key: 'product_type',
    label: 'What do you sell?',
    type: 'text',
    required: true,
    options: [],
    order: 1,
  },
];

/** The dates, sections and table types a seeded market plan offers. */
export const PLAN_DATES = ['2026-08-01', '2026-08-08', '2026-08-15'];
export const PLAN_SECTIONS = ['Main Hall', 'Garden'];
export const PLAN_TABLE_TYPES = ['Full Table', 'Half Table'];

/**
 * A market plan (camelCase `setupObject`) that offers the essential questions everything they
 * need: dates, sections, and a floorplan carrying table types - the same three sources the
 * back end derives the essential offering from.
 */
export function planSetupObject(dates: string[] = PLAN_DATES) {
  return {
    colNames: [],
    colValues: [],
    colInclude: [],
    enumPriorityOrder: [],
    priority: [],
    marketDates: dates.map((date) => ({ date, colNameIdx: null })),
    tiers: [],
    locations: [{ name: 'Indoors' }],
    sections: PLAN_SECTIONS.map((name) => ({
      name,
      location: { name: 'Indoors' },
      tier: null,
      count: 4,
    })),
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
      emailColNameIdx: null,
      tableChoiceColNameIdx: null,
      tableShareEmailColNameIdx: null,
      maxDaysColNameIdx: null,
    },
    floorplans: [
      {
        tableTypes: PLAN_TABLE_TYPES.map((name) => ({
          name,
          widthMm: 1800,
          heightMm: 800,
          maxCapacity: 2,
        })),
      },
    ],
  };
}

/**
 * Create a published market in `applications_open` phase with an application
 * form and an Application document for the test applicant.
 *
 * This is the minimum setup needed for the applicant login flow: the market
 * must be past `draft` so the public login endpoint can resolve it, and an
 * Application document must exist so the back end considers the email known
 * when sending login codes.
 *
 * @returns Metadata needed to navigate to the login page and reference the market.
 */
export async function seedApplicantMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  options: { setupObject?: Record<string, unknown> } = {},
): Promise<ApplicantMarketSeed> {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

  const marketName = `E2E Applicant ${Date.now()}`;
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [userId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
      ...(options.setupObject ? { setupObject: options.setupObject } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  // Write the application form — this is what the guards check before
  // accepting a transition into `applications_open`.
  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: { fields: APPLICATION_FIELDS },
  });
  if (!formRes.ok()) {
    throw new Error(`Application form save failed: ${formRes.status()} ${await formRes.text()}`);
  }

  // Transition to applications_open — the guards require the form to exist.
  const transitionRes = await request.post(`${baseURL}/markets/${marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: { toPhase: 'applications_open' },
  });
  if (!transitionRes.ok()) {
    throw new Error(
      `Market transition failed: ${transitionRes.status()} ${await transitionRes.text()}`,
    );
  }

  return { marketId, marketName, marketSlug: marketNameToSlug(marketName), orgId };
}

/**
 * Create an Application document for a market, straight into Mongo.
 *
 * The back end's `request-code` endpoint checks whether an Application exists
 * for the given email on the market before considering it a "known" address
 * (which gates the email send). This helper seeds that document so the test
 * can exercise the known-address branch.
 */
export function seedApplicationDoc(
  marketId: string,
  applicantEmail: string = 'applicant-e2e@example.com',
): string {
  return seedApplication(marketId, applicantEmail, {});
}

/**
 * Create a login challenge in `applicant_login_challenges` with a known
 * plaintext code.
 *
 * The 5d back end stores codes as salted SHA-256 hashes (`salt:digest`),
 * so the test cannot read a code out of MongoDB after requesting one. This
 * helper inserts a challenge directly with the correct hash for a known
 * code, letting the test verify the full end-to-end flow.
 *
 * Call this BEFORE requesting a code through the UI (or intercept the
 * request-code API call so the manually inserted challenge is not overwritten).
 */
export function createApplicantLoginChallenge(marketId: string, email: string, code: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
  const codeHash = `${salt}:${hash}`;
  const emailLower = email.toLowerCase();
  const expiryTs = Date.now() + 300_000;
  const createdAt = new Date().toISOString();

  const evalJs = [
    `db.applicant_login_challenges.replaceOne(`,
    `  { market_id: ${JSON.stringify(marketId)}, email: ${JSON.stringify(emailLower)} },`,
    `  {`,
    `    market_id: ${JSON.stringify(marketId)},`,
    `    email: ${JSON.stringify(emailLower)},`,
    `    code_hash: ${JSON.stringify(codeHash)},`,
    `    consumed: false,`,
    `    expires_at: new Date(${expiryTs}),`,
    `    created_at: ${JSON.stringify(createdAt)}`,
    `  },`,
    `  { upsert: true }`,
    `)`,
  ].join('\n');

  execFileSync(
    'docker',
    ['exec', mongoContainer(), 'mongosh', MONGO_URI, '--quiet', '--eval', evalJs],
    { encoding: 'utf-8' },
  );
}
