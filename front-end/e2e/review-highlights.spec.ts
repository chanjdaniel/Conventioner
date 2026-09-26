import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
import { seedApplication } from './helpers/seedApplication';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import type { APIRequestContext } from '@playwright/test';

/**
 * Which answers a reviewer reads first (E19/F03/S01).
 *
 * A reviewer working a queue reads two or three things and decides. The card used to show nine,
 * ordered by a heuristic that guessed - the organizer's own questions before the essential ones,
 * on the reasoning that custom questions distinguish applicants. This replaces the guess with
 * what the organizer actually said.
 *
 * The mark lives on the MARKET, not on a form field, which is what lets it name an ESSENTIAL
 * answer - and an essential availability answer can be the whole decision. A form-field flag
 * could only ever have marked half the card, and would have frozen with the form at the first
 * application, which is the moment an organizer first learns what they needed.
 */

/** A form with enough custom questions that hiding some of them is worth doing. */
const FORM = {
  fields: [
    { key: 'business_name', label: 'Business name', type: 'text', required: true, order: 0 },
    { key: 'what_you_sell', label: 'What you sell', type: 'text', required: true, order: 1 },
    { key: 'instagram', label: 'Instagram', type: 'text', required: false, order: 2 },
    { key: 'power_needed', label: 'Power needed', type: 'text', required: false, order: 3 },
    { key: 'heard_from', label: 'How you heard of us', type: 'text', required: false, order: 4 },
  ],
};

const ANSWERS = {
  business_name: 'Ember Ceramics',
  what_you_sell: 'Hand-thrown stoneware',
  instagram: '@emberceramics',
  power_needed: 'One outlet',
  heard_from: 'A friend who vends',
  essential_full_name: 'Nadia Ember',
};

async function seedMarketWithAForm(
  request: APIRequestContext,
): Promise<{ marketId: string; market: unknown }> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const headers = { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email };

  const created = await request.post(`${BACKEND_URL}/markets`, {
    headers,
    data: {
      name: `E2E Highlights ${Date.now()}`,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [TEST_USER.email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { market_id: marketId } = (await created.json()) as { market_id: string };

  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    headers,
    data: FORM,
  });
  expect(form.ok(), await form.text()).toBeTruthy();

  const fetched = await request.get(`${BACKEND_URL}/markets/${marketId}`, { headers });
  return { marketId, market: ((await fetched.json()) as { market: unknown }).market };
}

test.describe('What a reviewer reads first', () => {
  let marketId: string;
  let market: unknown;

  test.beforeAll(async ({ request }) => {
    ({ marketId, market } = await seedMarketWithAForm(request));
    // Two applicants, so the disclosure's open state can be watched ACROSS cards - which is the
    // criterion that keeps this from taxing a reviewer once per card at card forty.
    seedApplication(marketId, 'nadia@ember.test', ANSWERS);
    seedApplication(marketId, 'rafi@kiln.test', { ...ANSWERS, business_name: 'Kiln & Co' });
  });

  async function openTheMarket(page: import('@playwright/test').Page, tab: string): Promise<void> {
    await page.goto('/login');
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
      },
      { m: market, user: TEST_USER.email },
    );
    await page.goto(marketSetupPath(marketId, tab));
  }

  test('a market that marked nothing shows every answer, with no disclosure', async ({
    authenticatedPage: page,
  }) => {
    // An empty list is not a reason to hide an application: the card reads exactly as it always
    // has. This runs first, so it describes the seeded market before the next test marks anything.
    await openTheMarket(page, 'applications');
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();

    await expect(monitor.answers).toBeVisible();
    await expect(page.getByTestId('app-monitor-leading')).toHaveCount(0);
    await expect(page.getByTestId('app-monitor-rest')).toHaveCount(0);
  });

  test('an organizer marks answers, and the card then leads with them', async ({
    authenticatedPage: page,
  }) => {
    await openTheMarket(page, 'form');

    // One custom question and one ESSENTIAL answer - the case a flag on a FormField could never
    // have covered, because the essential answers are not form fields at all.
    const highlights = page.getByTestId('review-highlights');
    await expect(highlights).toBeVisible();

    // Each toggle is its own save, so each is awaited: navigating while one is still in flight
    // reads a market that is a click behind, which is a race in the TEST and not in the product.
    for (const key of ['what_you_sell', 'essential_full_name']) {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/markets/${marketId}/review-highlights`) &&
            response.request().method() === 'PUT',
        ),
        highlights.getByTestId(`review-highlight-${key}`).click(),
      ]);
    }

    // It saved, rather than only ticking a box: the market itself carries it now.
    const response = await page.request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const body = (await response.json()) as { market: { reviewHighlights?: string[] } };
    expect(body.market.reviewHighlights).toEqual(['what_you_sell', 'essential_full_name']);

    await page.goto(marketSetupPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();

    const leading = page.getByTestId('app-monitor-leading');
    await expect(leading).toBeVisible();
    await expect(leading.locator('dt')).toHaveText(['What you sell', 'Full name']);

    // The rest are hidden, and the disclosure says how many without being opened.
    const rest = page.getByTestId('app-monitor-rest');
    await expect(rest).toBeVisible();
    await expect(page.getByTestId('app-monitor-rest-summary')).toHaveText('4 more answers');
    await expect(rest.locator('dt').first()).not.toBeVisible();

    // Opening it once holds for the whole session - a reviewer does not reopen this forty times.
    await page.getByTestId('app-monitor-rest-summary').click();
    await expect(rest.locator('dt').first()).toBeVisible();

    // Onto the next card - whichever the queue puts up, since its order is not this test's point.
    const first = ((await monitor.email.textContent()) ?? '').trim();
    await monitor.skipButton.click();
    await expect(monitor.email).not.toHaveText(first);
    await expect(page.getByTestId('app-monitor-rest')).toHaveJSProperty('open', true);
    await expect(rest.locator('dt').first()).toBeVisible();
  });

  test('unmarking every answer returns the card to showing all of them', async ({
    authenticatedPage: page,
  }) => {
    await openTheMarket(page, 'form');
    const highlights = page.getByTestId('review-highlights');
    await expect(highlights.getByTestId('review-highlight-what_you_sell')).toBeVisible();

    for (const key of ['what_you_sell', 'essential_full_name']) {
      const choice = highlights.getByTestId(`review-highlight-${key}`);
      if (!(await choice.locator('input').isChecked())) continue;
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/markets/${marketId}/review-highlights`) &&
            response.request().method() === 'PUT',
        ),
        choice.click(),
      ]);
    }

    await page.goto(marketSetupPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();

    await expect(monitor.answers).toBeVisible();
    await expect(page.getByTestId('app-monitor-rest')).toHaveCount(0);
  });

  /**
   * The point of the whole feature (E19/F03/S02).
   *
   * An organizer authoring a form is guessing what will matter. A reviewer on card twelve KNOWS -
   * and by then the form has FROZEN, because an application exists. This is why the list lives on
   * the market and not on the form: on the form it would be settable only before it was knowable.
   */
  test('a reviewer changes what leads the card from the queue, with the form frozen', async ({
    authenticatedPage: page,
  }) => {
    await openTheMarket(page, 'form');

    // The precondition this story is FOR: applications exist, so the form builder is locked.
    await expect(page.getByTestId('form-builder-lock-banner')).toBeVisible();

    await page.goto(marketSetupPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();

    // Where the reviewer is now, so it can be shown they are still there afterwards.
    const before = ((await monitor.email.textContent()) ?? '').trim();

    await page.getByTestId('app-monitor-choose-highlights').click();
    const highlights = page.getByTestId('review-highlights');
    await expect(highlights).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/markets/${marketId}/review-highlights`) &&
          response.request().method() === 'PUT',
      ),
      highlights.getByTestId('review-highlight-instagram').click(),
    ]);

    // The card in front of them changed, without leaving the queue and without a reload.
    const leading = page.getByTestId('app-monitor-leading');
    await expect(leading.locator('dt')).toHaveText(['Instagram']);
    await expect(page.getByTestId('app-monitor-rest-summary')).toHaveText('5 more answers');

    // And they are still on the same application: the marks change what the card SHOWS, never
    // which one is up.
    await expect(monitor.email).toHaveText(before);

    // One list, not two: the form builder reads back what the queue wrote.
    await page.goto(marketSetupPath(marketId, 'form'));
    await expect(
      page
        .getByTestId('review-highlights')
        .getByTestId('review-highlight-instagram')
        .locator('input'),
    ).toBeChecked();

    // And it is there for whoever reviews next - a fresh load of the queue, not this page's state.
    await page.goto(marketSetupPath(marketId, 'applications'));
    await monitor.waitForLoaded();
    await expect(page.getByTestId('app-monitor-leading').locator('dt')).toHaveText(['Instagram']);
  });
});
