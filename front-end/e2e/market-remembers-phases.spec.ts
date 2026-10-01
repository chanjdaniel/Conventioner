import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';

/**
 * A market remembers where it has been (bug 8, E26/F06/S03; settles claims-and-room 06).
 *
 * The archived rail read evidence rather than history: a stored assignment meant Assignment, a
 * published form meant Applications Open, and nothing meant Market Days. So a market that ran was
 * told it "was assigned but never published, so no check-in page went on the air", and one
 * archived while taking applications that it "was abandoned before it ran".
 */
async function transition(request: APIRequestContext, marketId: string, toPhase: string) {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase },
  });
  expect(res.ok(), `to ${toPhase}: ${await res.text()}`).toBeTruthy();
}

test('a market archived after its market days says it ran, though nobody checked in', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await transition(request, marketId, 'archived');

  await page.goto(marketSetupPath(marketId, 'setup'));
  const frozen = page.getByTestId('phase-rail-frozen');
  await expect(frozen).toContainText('It was published and ran its market days.', {
    timeout: 15000,
  });
  await expect(page.locator('[data-phase="market_days"]')).toHaveAttribute('data-state', 'done');
});

test('a market that opened applications says so, though it went back to draft', async ({
  authenticatedPage: page,
  request,
}) => {
  // No applications, so it may return to draft.
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Reopening for editing clears the form's published stamp - the only evidence there was.
  await transition(request, marketId, 'applications_open');
  await transition(request, marketId, 'draft');
  await transition(request, marketId, 'archived');

  await page.goto(marketSetupPath(marketId, 'setup'));
  const frozen = page.getByTestId('phase-rail-frozen');
  await expect(frozen).toContainText('It opened applications but was never assigned.', {
    timeout: 15000,
  });
  await expect(page.locator('[data-phase="applications_open"]')).toHaveAttribute(
    'data-state',
    'done',
  );
  await expect(page.locator('[data-phase="assignment"]')).toHaveAttribute('data-state', 'frozen');
});
