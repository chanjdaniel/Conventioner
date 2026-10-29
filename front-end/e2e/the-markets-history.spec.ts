import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { completePlan } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Every change on a market, read in Manage market's History section (E40/F01/S03).
 *
 * The changes are made the way the screens make them, through the API, on a fixture market: a
 * setup change and a run of renames in draft, a verdict in review, a seat placed by hand in
 * assignment, and a colleague given a role and then a different one. The section reads them back
 * newest first, each a sentence, a page at a time.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const COLLEAGUE = { email: 'e2e-history-colleague@example.com', password: 'e2epassword123' };
const VENDOR = 'e2e-history-vendor@example.com';
/** Enough renames that the first page ends before the setup change. */
const RENAMES = 24;

test.beforeAll(() => ensureVerifiedUser(COLLEAGUE.email, COLLEAGUE.password));

async function ok(response: Awaited<ReturnType<APIRequestContext['put']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** A market with every kind of change the story names, and its name as it ended. */
async function seedAHistory(request: APIRequestContext) {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const plan = completePlan();
  await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, {
    ...plan,
    sections: plan.sections.map((section) => ({ ...section, count: 6 })),
  });
  let marketName = seed.marketName;
  for (let n = 1; n <= RENAMES; n++) {
    marketName = `${seed.marketName} ${n}`;
    await ok(
      await request.put(`${BACKEND_URL}/markets/${seed.marketId}/name`, {
        data: { name: marketName },
      }),
    );
  }
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications_open');
  // As an import leaves it, which review waits for.
  const applicationId = seedApplicationWithStatus(seed.marketId, 'open', VENDOR);
  for (const phase of ['applications_closed', 'review']) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, phase);
  }
  await ok(
    await request.put(
      `${BACKEND_URL}/markets/${seed.marketId}/applications/${applicationId}/review`,
      { data: { status: 'reviewer_approved' } },
    ),
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'assignment');
  await ok(
    await request.put(`${BACKEND_URL}/markets/${seed.marketId}/placements`, {
      data: {
        email: VENDOR,
        date: plan.marketDates[0].date,
        table_code: 'Hall A 1',
        table_choice: 'Full Table',
      },
    }),
  );
  await ok(
    await request.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
      data: { user_email: COLLEAGUE.email, role: 'editor' },
    }),
  );
  const colleagueId = await request
    .get(`${BACKEND_URL}/markets/${seed.marketId}`)
    .then(async (response) => {
      const { market } = (await response.json()) as {
        market: { role_emails: Record<string, string> };
      };
      return Object.keys(market.role_emails).find(
        (id) => market.role_emails[id] === COLLEAGUE.email,
      );
    });
  await ok(
    await request.put(`${BACKEND_URL}/markets/${seed.marketId}/roles/${colleagueId}`, {
      data: { role: 'viewer' },
    }),
  );
  return { marketId: seed.marketId, marketName };
}

async function openManage(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await expect(manage.history).toBeVisible();
  return manage;
}

test('every kind of change reads as a sentence, newest first, and older ones load on request', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  const me = TEST_USER.email;

  await expect(manage.historySentences).toHaveCount(25);
  const first = await manage.historySentences.allInnerTexts();
  expect(first.slice(0, 5)).toEqual([
    `${me} changed ${COLLEAGUE.email} from Editor to Viewer`,
    `${me} gave ${COLLEAGUE.email} the Editor role`,
    expect.stringMatching(
      new RegExp(`^${me} placed ${VENDOR} at Hall A 1 \\(Full Table\\) on May 1, 2099$`),
    ),
    `${me} moved the market from Review to Assignment`,
    `${me} set ${VENDOR} to Approved`,
  ]);
  expect(first).not.toContain(`${me} changed Market Setup: sections`);

  // Older entries come beneath the newest, in the same open dialog.
  await manage.historyLoadMore.click();
  // The form, the setup change, the renames, four phase moves, the verdict, the seat, two roles.
  await expect(manage.historySentences).toHaveCount(2 + RENAMES + 4 + 1 + 1 + 2);
  const all = await manage.historySentences.allInnerTexts();
  expect(all.slice(-2)).toEqual([
    `${me} changed Market Setup: sections`,
    `${me} changed the application form`,
  ]);
  await expect(manage.historyLoadMore).toHaveCount(0);
  await expect(manage.window).toBeVisible();

  // An entry opens to show what it was before and after.
  const roleChange = page.getByTestId('market-history-entry').first();
  await roleChange.getByTestId('market-history-toggle').click();
  await expect(roleChange.getByTestId('market-history-changes')).toContainText('Role');
  await expect(roleChange.getByTestId('market-history-changes')).toContainText('Editor');
  await expect(roleChange.getByTestId('market-history-changes')).toContainText('Viewer');
});

test('each filter narrows the list, and a vendor links to their drawer', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(25);

  await manage.historyKind.selectOption('People');
  await expect(manage.historySentences).toHaveCount(2);

  await manage.historyKind.selectOption('');
  await manage.historyVendor.fill(VENDOR);
  await expect(manage.historySentences).toHaveCount(2);
  await expect(manage.historySentences.first()).toContainText(`placed ${VENDOR}`);
  await expect(manage.historySentences.last()).toContainText('to Approved');

  // Who may be narrowed to is whoever changed something here: the colleague only received.
  await expect(manage.historyWho.locator('option')).toHaveText(['Anyone', TEST_USER.email]);

  await page.getByTestId('market-history-vendor-link').first().click();
  await expect(page).toHaveURL(`/markets/${marketId}/vendors?vendor=${VENDOR}`);
  await expect(page.locator('#vendor-drawer-title')).toHaveText(VENDOR);
});
