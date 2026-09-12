import { execFileSync } from 'node:child_process';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { mongoContainer } from './helpers/containerNames';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  seedPhaseMarket,
  seedApplicationWithStatus,
  type PhaseMarketSeed,
} from './helpers/seedPhaseMarket';

const SCREENSHOT_DIR = 'e2e-screenshots/phase-state-machine';
const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

async function transitionViaPage(page: Page, marketId: string, toPhase: string): Promise<void> {
  const res = await page.request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Transition to ${toPhase} failed: ${res.status()} ${body}`);
  }
}

async function loadMarket(page: Page, marketId: string): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${BACKEND_URL}/markets/${encodeURIComponent(marketId)}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const json = await res.json();
  return json.market as Record<string, unknown>;
}

function setMarketInPage(page: Page, marketBody: Record<string, unknown>) {
  return page.evaluate(
    ({ market, user }: { market: Record<string, unknown>; user: string }) => {
      localStorage.setItem('market', JSON.stringify(market));
      localStorage.setItem('user', JSON.stringify(user));
    },
    { market: marketBody, user: TEST_USER.email },
  );
}

function runMongo(evalJs: string): string {
  return execFileSync(
    'docker',
    ['exec', mongoContainer(), 'mongosh', MONGO_URI, '--quiet', '--eval', evalJs],
    { encoding: 'utf-8' },
  ).trim();
}

/**
 * Seed a market and navigate it to the `offers` phase via the API.
 * Seeds approved applications, transitions to assignment, resolves them,
 * then transitions to offers. The market is left in `offers` ready for the
 * sweep transition.
 */
async function setupMarketToOffers(request: APIRequestContext): Promise<PhaseMarketSeed> {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

  // Navigate to review
  await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'applications_open' },
  });
  await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'applications_closed' },
  });
  await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'review' },
  });

  // Seed approved applications so assignment guard passes
  const appId = seedApplicationWithStatus(
    seed.marketId,
    'reviewer_approved',
    'sweep-setup@example.com',
  );

  await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'assignment' },
  });

  // Resolve the approved app so offers guard passes
  runMongo(
    `db.applications.updateOne({id: ${JSON.stringify(appId)}}, {$set: {status: "assigned"}})`,
  );

  await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'offers' },
  });

  return seed;
}

test.describe('Phase state machine - full walk', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('walk draft -> applications_open -> applications_closed -> review -> assignment -> offers -> market_days', async ({
    authenticatedPage: page,
  }) => {
    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto('/market-setup');
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId('phase-control-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Draft');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-draft.png`, fullPage: true });

    await page.getByTestId('phase-transition-applications_open').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Applications Open', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-applications-open.png`, fullPage: true });

    await page.getByTestId('phase-transition-applications_closed').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText(
      'Applications Closed',
      { timeout: 10000 },
    );
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-applications-closed.png`, fullPage: true });

    await page.getByTestId('phase-transition-review').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Review', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-review.png`, fullPage: true });

    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'walk-a@example.com');
    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'walk-b@example.com');

    await page.getByTestId('phase-transition-assignment').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Assignment', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-assignment.png`, fullPage: true });

    runMongo(
      `db.applications.updateMany({market_id: ${JSON.stringify(seed.marketId)}, status: "reviewer_approved"}, {$set: {status: "assigned"}})`,
    );

    await page.getByTestId('phase-transition-offers').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Offers', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-offers.png`, fullPage: true });

    await page.getByTestId('phase-transition-market_days').click();
    // Sweep confirmation dialog should appear
    const sweepDialog = page.getByTestId('sweep-confirm-dialog');
    await expect(sweepDialog).toBeVisible({ timeout: 5000 });
    await expect(sweepDialog).toContainText('Begin Market Days');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/06b-sweep-confirmation.png`,
      fullPage: true,
    });
    await page.getByTestId('sweep-confirm-confirm').click();
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Market Days', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-market-days.png`, fullPage: true });

    await expect(page.getByTestId('phase-transition-archived')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-ready-to-archive.png`, fullPage: true });
  });
});

test.describe('Phase state machine - guard: assignment blocked by unreviewed apps', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('cannot enter assignment while applications are still open', async ({
    authenticatedPage: page,
  }) => {
    await transitionViaPage(page, seed.marketId, 'applications_open');
    await transitionViaPage(page, seed.marketId, 'applications_closed');
    await transitionViaPage(page, seed.marketId, 'review');

    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'guard-a@example.com');
    seedApplicationWithStatus(seed.marketId, 'open', 'guard-b@example.com');

    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto('/market-setup');
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Review', {
      timeout: 10000,
    });

    await page.getByTestId('phase-transition-assignment').click();

    const blockers = page.getByTestId('phase-control-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });
    await expect(blockers).toContainText('still awaiting review');
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Review');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-blocked-assignment.png`, fullPage: true });
  });
});

test.describe('Phase state machine - guard: offers blocked by leftover approved', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('cannot enter offers while approved applications remain', async ({
    authenticatedPage: page,
  }) => {
    await transitionViaPage(page, seed.marketId, 'applications_open');
    await transitionViaPage(page, seed.marketId, 'applications_closed');
    await transitionViaPage(page, seed.marketId, 'review');

    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'offer-a@example.com');
    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'offer-b@example.com');

    await transitionViaPage(page, seed.marketId, 'assignment');

    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto('/market-setup');
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Assignment', {
      timeout: 10000,
    });

    await page.getByTestId('phase-transition-offers').click();

    const blockers = page.getByTestId('phase-control-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });
    await expect(blockers).toContainText('still approved');
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Assignment');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-blocked-offers.png`, fullPage: true });
  });
});

test.describe('Phase state machine - sweep', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    seed = await setupMarketToOffers(request);
  });

  test('offers -> market_days sweeps assignment_sent to vendor_refused, leaves vendor_accepted alone', async ({
    authenticatedPage: page,
  }) => {
    const sentEmail = 'sweep-sent@example.com';
    const acceptedEmail = 'sweep-accepted@example.com';

    seedApplicationWithStatus(seed.marketId, 'assignment_sent', sentEmail);
    seedApplicationWithStatus(seed.marketId, 'vendor_accepted', acceptedEmail);

    function queryStatus(appEmail: string): string {
      return runMongo(
        `db.applications.findOne({applicant_email: ${JSON.stringify(appEmail)}, market_id: ${JSON.stringify(seed.marketId)}}, {status: 1}).status`,
      );
    }

    const beforeSent = queryStatus(sentEmail);
    const beforeAccepted = queryStatus(acceptedEmail);

    // Render a status page that proves the before/after states
    await page.setContent(`
      <html><body style="font-family:monospace;font-size:16px;padding:40px;background:#fff">
        <h1>Sweep test — application states</h1>
        <h2>Before transition (offers phase)</h2>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">
          <tr><th>Email</th><th>Status</th></tr>
          <tr><td>${sentEmail}</td><td style="font-weight:bold;color:#b91c1c">${beforeSent}</td></tr>
          <tr><td>${acceptedEmail}</td><td style="font-weight:bold;color:#15803d">${beforeAccepted}</td></tr>
        </table>
      </body></html>
    `);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11a-sweep-before.png`, fullPage: true });

    // Perform the sweep transition
    await transitionViaPage(page, seed.marketId, 'market_days');

    const afterSent = queryStatus(sentEmail);
    const afterAccepted = queryStatus(acceptedEmail);

    expect(afterSent).toBe('vendor_refused');
    expect(afterAccepted).toBe('vendor_accepted');

    await page.setContent(`
      <html><body style="font-family:monospace;font-size:16px;padding:40px;background:#fff">
        <h1>Sweep test — application states</h1>
        <h2>After transition to market_days</h2>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">
          <tr><th>Email</th><th>Status</th><th>Expected?</th></tr>
          <tr>
            <td>${sentEmail}</td>
            <td style="font-weight:bold;color:${afterSent === 'vendor_refused' ? '#15803d' : '#b91c1c'}">${afterSent}</td>
            <td>vendor_refused</td>
          </tr>
          <tr>
            <td>${acceptedEmail}</td>
            <td style="font-weight:bold;color:${afterAccepted === 'vendor_accepted' ? '#15803d' : '#b91c1c'}">${afterAccepted}</td>
            <td>vendor_accepted</td>
          </tr>
        </table>
        <p style="margin-top:20px">
          assignment_sent ${afterSent === 'vendor_refused' ? 'was' : 'was NOT'} swept to vendor_refused.
          vendor_accepted ${afterAccepted === 'vendor_accepted' ? 'was' : 'was NOT'} left untouched.
        </p>
      </body></html>
    `);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11b-sweep-after.png`, fullPage: true });

    // Also show the market_days UI
    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto('/market-setup');
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Market Days', {
      timeout: 10000,
    });
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/11c-market-days-after-sweep.png`,
      fullPage: true,
    });
  });
});

test.describe('Phase state machine - archive confirmation', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('archive shows confirmation, cancel preserves phase, confirm archives', async ({
    authenticatedPage: page,
  }) => {
    await transitionViaPage(page, seed.marketId, 'applications_open');

    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);

    await page.goto('/market-setup');
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Applications Open', {
      timeout: 10000,
    });

    const archiveBtn = page.getByTestId('phase-transition-archived');
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    const dialog = page.getByTestId('archive-confirm-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Archive this market?');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/12-archive-confirmation.png`,
      fullPage: true,
    });

    // Cancel
    await page.getByTestId('archive-confirm-cancel').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Applications Open');

    // Confirm
    await archiveBtn.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.getByTestId('archive-confirm-confirm').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('phase-control-current-phase')).toHaveText('Archived', {
      timeout: 10000,
    });
    await expect(page.getByTestId('phase-control-terminal')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-archived.png`, fullPage: true });
  });
});
