import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { completePlan, loginViaApi, ensureTestOrgAuthenticated } from './seeds';
import { decideReviewSetup } from './decideReviewSetup';
import { mongoEval } from './mongo';
import { uniqueMarketName } from './uniqueName';
import { saveApplicationForm } from './saveApplicationForm';

export interface PhaseMarketSeed {
  marketId: string;
  marketName: string;
  orgId: string;
  userId: string;
}

const TWO_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: false, options: [], order: 0 },
  { key: 'category', label: 'Category', type: 'text', required: false, options: [], order: 1 },
];

/**
 * Create a draft market with an application form (two fields), a complete plan and its review
 * setup decided, so it may open applications (E31/F01/S01, T206). Does NOT transition - leaves the
 * market in draft.
 */
export async function seedPhaseMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  // How vendors reach it; absent, a CSV market, as the server reads it. A spec about the form
  // path's words asks for `form` (E31/F03/S03). `orgId` is the organization it belongs to, which
  // `email` must run; absent, the seed owner's first. A spec about the review setup's decisions
  // asks for them left undecided (T206).
  options: { intakeMode?: 'csv' | 'form'; orgId?: string; reviewSetupUndecided?: boolean } = {},
): Promise<PhaseMarketSeed> {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = options.orgId ?? (await ensureTestOrgAuthenticated(request, baseURL));

  const marketName = uniqueMarketName('E2E Phase');
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      setupObject: completePlan(),
      ...(options.intakeMode ? { intakeMode: options.intakeMode } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  await saveApplicationForm(request, baseURL, marketId, { fields: TWO_FIELDS });
  if (!options.reviewSetupUndecided) await decideReviewSetup(request, baseURL, marketId);

  return { marketId, marketName, orgId, userId };
}

/**
 * Transition a market to a target phase via the API.
 */
export async function transitionMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  marketId: string,
  toPhase: string,
): Promise<void> {
  const res = await request.post(`${baseURL}/markets/${marketId}/transition`, {
    headers: { 'Content-Type': 'application/json' },
    data: { toPhase },
  });
  if (!res.ok()) {
    throw new Error(`Transition to ${toPhase} failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Insert an application document via mongosh with a specific status.
 */
export function seedApplicationWithStatus(
  marketId: string,
  status: string,
  applicantEmail = 'applicant@example.com',
  /** The answers, when a test reads them back: a name the review shows, say. */
  formData: Record<string, unknown> = { name: 'Test App', category: 'Crafts' },
): string {
  const applicationId = randomUUID();
  mongoEval(
    `db.applications.insertOne(${JSON.stringify({
      id: applicationId,
      market_id: marketId,
      applicant_email: applicantEmail,
      form_data: formData,
      status,
      application_type: 'main',
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })})`,
  );
  return applicationId;
}

/**
 * Create a draft market whose application form has no custom fields, its review setup decided
 * (T206) unless a spec asks for it undecided.
 *
 * `withDates` decides whether the market plan offers anything: a market with a date asks the
 * essential questions, and a market with an empty plan asks nothing at all. That is the whole
 * difference `FormHasFieldsGuard` has to see, and neither market has a custom field to hide
 * behind.
 */
export async function seedFormlessPhaseMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  withDates: boolean,
  options: { intakeMode?: 'csv' | 'form'; reviewSetupUndecided?: boolean } = {},
): Promise<PhaseMarketSeed> {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL);

  const marketName = `E2E Formless ${randomUUID().slice(0, 8)}`;
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      ...(options.intakeMode ? { intakeMode: options.intakeMode } : {}),
      // With dates, complete: a market that may leave draft (E31/F01/S01), whose form is the
      // essential questions its plan asks. Without, a plan that offers nothing at all.
      setupObject: withDates
        ? completePlan()
        : {
            priority: [],
            marketDates: [],
            tiers: [],
            locations: [],
            sections: [],
            assignmentOptions: {},
          },
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };
  if (!options.reviewSetupUndecided) await decideReviewSetup(request, baseURL, marketId);

  return { marketId, marketName, orgId, userId };
}

/**
 * Store a computed assignment on a market, so it may enter `market_days`.
 *
 * `market_days` means the market is RUNNING, and its entry invariant is that an assignment exists
 * (E03/F03): publishing is what opens check-in on its vendor page, and a market with no placements
 * serves a page that can tell nobody where to stand. A phase walk that reaches market days without
 * one is walking into a state the product forbids, so the seed provides it rather than the guard
 * being loosened.
 *
 * Written straight into Mongo because computing a real assignment needs a whole market plan, and
 * these tests are about the phase machine rather than about placement.
 */
export function seedStoredAssignment(marketId: string, emails: string[] = ['walk-a@example.com']) {
  const vendorAssignments = emails.map((email, index) => ({
    email,
    date: '2026-08-01',
    tableCode: `A${index + 1}`,
    tableChoice: 'Full Table',
    section: 'Main Hall',
    tier: 'Standard',
    location: 'Hall',
  }));

  mongoEval(
    `db.markets.updateOne({id:${JSON.stringify(marketId)}}, {$set:{"assignmentObject.vendorAssignments": ${JSON.stringify(vendorAssignments)}}})`,
  );
}
