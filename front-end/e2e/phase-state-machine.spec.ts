import { execFileSync } from 'node:child_process';
import { marketSetupPath } from './helpers/marketScreens';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { mongoContainer } from './helpers/containerNames';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  seedPhaseMarket,
  seedFormlessPhaseMarket,
  seedApplicationWithStatus,
  seedStoredAssignment,
  type PhaseMarketSeed,
} from './helpers/seedPhaseMarket';

const SCREENSHOT_DIR = 'e2e-screenshots/phase-state-machine';
const MONGO_URI = 'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin';

/**
 * Fire a transition that is not the one step onward.
 *
 * The rail carries a single forward action; back, destructive and off-spine edges are behind the
 * overflow menu (E10/F01/S01).
 */
async function openRailMenu(page: Page, toPhase: string): Promise<void> {
  await page.getByTestId('phase-rail-menu-button').click();
  await page.getByTestId(`phase-transition-${toPhase}`).click();
}

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
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-draft.png`, fullPage: true });

    await page.getByTestId('phase-transition-applications_open').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-applications-open.png`, fullPage: true });

    await page.getByTestId('phase-transition-applications_closed').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Closed', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-applications-closed.png`, fullPage: true });

    await page.getByTestId('phase-transition-review').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-review.png`, fullPage: true });

    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'walk-a@example.com');
    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'walk-b@example.com');

    await page.getByTestId('phase-transition-assignment').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Assignment', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-assignment.png`, fullPage: true });

    runMongo(
      `db.applications.updateMany({market_id: ${JSON.stringify(seed.marketId)}, status: "reviewer_approved"}, {$set: {status: "assigned"}})`,
    );

    await openRailMenu(page, 'offers');
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Offers', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-offers.png`, fullPage: true });

    // market_days means the market is RUNNING, and its entry invariant is that an assignment
    // exists (E03/F03) - publishing puts the check-in page on the air, and a market with no
    // placements serves a page that can tell nobody where to stand.
    seedStoredAssignment(seed.marketId);
    await page.getByTestId('phase-transition-market_days').click();

    // Publishing confirms, because it is one of the two edges with no route back - derived from
    // the transition table, not listed in the panel (E10/F04/S01). The dialog used to ask "Begin
    // Market Days? No offers are pending - no vendors will be marked refused", which answered a
    // question about a feature MVP does not have; it names the consequence now (E10/F04/S02).
    const publishDialog = page.getByTestId('sweep-confirm-window');
    await expect(publishDialog).toBeVisible({ timeout: 5000 });
    await expect(publishDialog).toContainText('Publish Market');
    await expect(publishDialog).toContainText('check-in page on the air');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/06b-publish-confirmation.png`,
      fullPage: true,
    });
    await page.getByTestId('sweep-confirm-submit-button').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days', {
      timeout: 10000,
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-market-days.png`, fullPage: true });

    // Archiving is behind the overflow menu, never presented as the way onward (E10/F01/S01).
    await page.getByTestId('phase-rail-menu-button').click();
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
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review', {
      timeout: 10000,
    });

    await page.getByTestId('phase-transition-assignment').click();

    const blockers = page.getByTestId('phase-rail-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });
    await expect(blockers).toContainText('still awaiting review');
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review');

    // The remedy is reviewing the applications, which is one tab along - so the link goes there
    // and going there is visible. It used to point at `/market-setup`, the page it was displayed
    // on, so clicking it did nothing at all (E14/F01/S03).
    const fix = blockers.getByTestId('blocker-resolution-link');
    await expect(fix).toBeVisible();
    await fix.click();
    await expect(page).toHaveURL(/tab=applications/);
    await expect(page.getByTestId('market-setup-applications-tab')).toHaveClass(/active/);
    // Exactly one tab reads as current; the others must not keep the marker.
    await expect(page.getByTestId('market-setup-setup-tab')).not.toHaveClass(/active/);

    // And once you are on the tab that holds the fix, the panel stops offering to take you there.
    // Keyed on the anchor itself rather than the testid this change introduced, so the assertion
    // means "no link" rather than "no element with a name that is new here".
    await expect(blockers).toContainText('still awaiting review');
    await expect(blockers.locator('a.blocker-link')).toHaveCount(0);

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
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Assignment', {
      timeout: 10000,
    });

    await openRailMenu(page, 'offers');

    const blockers = page.getByTestId('phase-rail-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });
    await expect(blockers).toContainText('still approved');
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Assignment');

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
        <h1>Sweep test - application states</h1>
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
    // market_days means the market is RUNNING, and its entry invariant is that an assignment
    // exists (E03/F03) - publishing puts the check-in page on the air, and a market with no
    // placements serves a page that can tell nobody where to stand.
    seedStoredAssignment(seed.marketId);
    await transitionViaPage(page, seed.marketId, 'market_days');

    const afterSent = queryStatus(sentEmail);
    const afterAccepted = queryStatus(acceptedEmail);

    expect(afterSent).toBe('vendor_refused');
    expect(afterAccepted).toBe('vendor_accepted');

    await page.setContent(`
      <html><body style="font-family:monospace;font-size:16px;padding:40px;background:#fff">
        <h1>Sweep test - application states</h1>
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
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days', {
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

    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open', {
      timeout: 10000,
    });

    await page.getByTestId('phase-rail-menu-button').click();
    const archiveBtn = page.getByTestId('phase-transition-archived');
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    const dialog = page.getByTestId('archive-confirm-window');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Archive this market?');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/12-archive-confirmation.png`,
      fullPage: true,
    });

    // Cancel
    await page.getByTestId('archive-confirm-cancel-button').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open');

    // Confirm. The menu closes when a transition is chosen, so archiving again reopens it -
    // which is the point of putting a destructive edge behind one.
    await page.getByTestId('phase-rail-menu-button').click();
    await archiveBtn.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.getByTestId('archive-confirm-submit-button').click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Archived', {
      timeout: 10000,
    });
    await expect(page.getByTestId('phase-rail-frozen')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-archived.png`, fullPage: true });
  });
});

test.describe('Phase state machine - guard: a form of essential questions alone', () => {
  test('a market with no custom fields but a date on the plan opens applications', async ({
    request,
    authenticatedPage: page,
  }) => {
    const seed = await seedFormlessPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      true,
    );

    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft', {
      timeout: 10000,
    });

    await page.getByTestId('phase-transition-applications_open').click();

    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open', {
      timeout: 10000,
    });
    await expect(page.getByTestId('phase-rail-blockers')).toBeHidden();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/11-essential-only-form-opens.png`,
      fullPage: true,
    });
  });

  test('a market whose plan offers nothing is blocked, and told to add dates', async ({
    request,
    authenticatedPage: page,
  }) => {
    const seed = await seedFormlessPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      false,
    );

    const marketBody = await loadMarket(page, seed.marketId);
    await setMarketInPage(page, marketBody);
    await page.goto(marketSetupPath(String(marketBody.id)));
    await expect(page.locator('.market-setup-view')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('phase-transition-applications_open').click();

    const blockers = page.getByTestId('phase-rail-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });
    await expect(blockers).toContainText('asks nothing');
    await expect(blockers).toContainText('dates');
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft');

    // Two remedies in two different tabs - add dates to the plan, or add a custom field to the
    // form - so there is no one tab to point at, and the message names both instead. The panel is
    // proven present by the message above, so this is an absent link rather than an absent panel.
    await expect(blockers.locator('a.blocker-link')).toHaveCount(0);
    await expect(blockers).toContainText('custom field');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/12-empty-plan-blocked.png`,
      fullPage: true,
    });
  });
});

test.describe('The applications surface says which phase it is in', () => {
  /**
   * One surface serves three phases (E18/F02/S03), which ticket 11 settled by measuring: recording
   * a verdict has no phase gate at all, importing spans two of the three, and applications-closed
   * changes nothing for a CSV market.
   *
   * The cost is the rail showing three steps over one place, and the mitigation is that the
   * surface SAYS which. Hiding the Import button is not stating it - a surface whose only
   * difference is a missing control teaches an organizer that the phases are arbitrary.
   */
  test('an organizer can tell the three apart by reading, not by which button is missing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const move = (toPhase: string) =>
      request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
        data: { toPhase },
      });
    const conditionNow = async () => {
      await setMarketInPage(page, await loadMarket(page, seed.marketId));
      await page.goto(marketSetupPath(seed.marketId, 'applications'));
      const line = page.getByTestId('market-setup-applications-condition');
      await expect(line).toBeVisible({ timeout: 15000 });
      return (await line.innerText()).trim();
    };

    await move('applications_open');
    const open = await conditionNow();
    await expect(page.getByTestId('market-setup-import-button')).toBeEnabled();

    await move('applications_closed');
    const closed = await conditionNow();
    // Still offered: importing spans two of the three phases.
    await expect(page.getByTestId('market-setup-import-button')).toBeEnabled();

    await move('review');
    const review = await conditionNow();
    // Withdrawn here - and the withdrawal is explained rather than silent.
    await expect(page.getByTestId('market-setup-import-button')).toBeDisabled();
    await expect(page.getByTestId('market-setup-import-blocked-reason')).toBeVisible();

    expect(new Set([open, closed, review]).size, `"${open}" / "${closed}" / "${review}"`).toBe(3);
    expect(review).toMatch(/decided/);
  });
});

test.describe('Where the workspace opens', () => {
  /**
   * The workspace opens the surface the phase is worked on (E18/F02/S02).
   *
   * It used to fall back to the plan whatever the market was doing, so an organizer returning to a
   * market mid-review landed on its dates. The original finding asked for the OPPOSITE of what
   * ships here - the form until it was finalized, then the plan - and ticket 01 overturned it: the
   * plan comes first, because the form is built from it.
   */
  test('a draft opens on the plan, and a market past draft does not', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

    await setMarketInPage(page, await loadMarket(page, seed.marketId));
    await page.goto(marketSetupPath(seed.marketId));
    await expect(page.getByTestId('market-setup-setup-tab')).toHaveClass(/active/);

    await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'archived' },
    });
    await setMarketInPage(page, await loadMarket(page, seed.marketId));
    await page.goto(marketSetupPath(seed.marketId));
    await expect(page.getByTestId('market-setup-assignment-tab')).toHaveClass(/active/);
    await expect(page.getByTestId('market-setup-setup-tab')).not.toHaveClass(/active/);
  });

  test('an explicit stage in the URL still wins, so a shared link keeps working', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await setMarketInPage(page, await loadMarket(page, seed.marketId));

    // A draft would otherwise open on the plan.
    await page.goto(marketSetupPath(seed.marketId, 'applications'));
    await expect(page.getByTestId('market-setup-applications-tab')).toHaveClass(/active/);
  });
});
