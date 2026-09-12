import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { mongoContainer } from './containerNames';
import { loginViaApi, ensureTestOrgAuthenticated } from './seeds';

const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

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
 * Create a draft market with an application form (two fields).
 * Does NOT transition — leaves the market in draft.
 */
export async function seedPhaseMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<PhaseMarketSeed> {
  const userId = await loginViaApi(request, baseURL, email, password);
  const orgId = await ensureTestOrgAuthenticated(request, baseURL, email);

  const marketName = `E2E Phase ${Date.now()}`;
  const createRes = await request.post(`${baseURL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
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
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  const formRes = await request.put(`${baseURL}/markets/${marketId}/application-form`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
    data: { fields: TWO_FIELDS },
  });
  if (!formRes.ok()) {
    throw new Error(`Form save failed: ${formRes.status()} ${await formRes.text()}`);
  }

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
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
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
): string {
  const applicationId = randomUUID();
  execFileSync(
    'docker',
    [
      'exec',
      mongoContainer(),
      'mongosh',
      MONGO_URI,
      '--quiet',
      '--eval',
      `db.applications.insertOne(${JSON.stringify({
        id: applicationId,
        market_id: marketId,
        applicant_email: applicantEmail,
        form_data: { name: 'Test App', category: 'Crafts' },
        status,
        application_type: 'main',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })})`,
    ],
    { encoding: 'utf-8' },
  );
  return applicationId;
}
