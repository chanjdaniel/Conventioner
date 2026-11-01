import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { VendorsPage } from './pages/VendorsPage';
import { completePlan } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Every change on a market, read in Manage market's History section (E40/F01/S03).
 *
 * The changes are made the way the screens make them, through the API, on a fixture market: a
 * setup change and a run of renames in draft, a verdict in review, a table assigned by hand in
 * assignment, and a colleague given a role and then a different one. The section reads them back
 * newest first, each a sentence, a page at a time.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const COLLEAGUE = { email: 'e2e-history-colleague@example.com', password: 'e2epassword123' };
const VENDOR = 'e2e-history-vendor@example.com';
const VENDOR_NAME = 'Hollis Vendor';
/** Enough renames that the first page of ten ends before the setup change. */
const RENAMES = 6;

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
  // As an import leaves it, which a Google Form market's stage waits for, with the essential
  // answers the Vendors page reads, so the drawer a vendor link opens has a vendor to show.
  const application = {
    ...approvedVendorApplication(seed.marketId, VENDOR, {
      dates: [plan.marketDates[0].date],
      tiers: ['Gold'],
      fullName: VENDOR_NAME,
    }),
    status: 'open',
  };
  insertApplications([application]);
  const applicationId = application.id;
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications');
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
        market: { peopleWithAccess: Array<{ userId: string; email: string }> };
      };
      return market.peopleWithAccess.find((person) => person.email === COLLEAGUE.email)?.userId;
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
  // Closed until opened, its heading in sight, so the sections after it stay in reach.
  await expect(manage.historySentences).toHaveCount(0);
  await manage.openHistory();
  return manage;
}

test('every kind of change reads as a sentence, newest first, and older ones load on request', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  const me = TEST_USER.email;

  await expect(manage.historySentences).toHaveCount(10);
  const first = await manage.historySentences.allInnerTexts();
  expect(first.slice(0, 5)).toEqual([
    `${me} changed ${COLLEAGUE.email} from Editor to Viewer`,
    `${me} gave ${COLLEAGUE.email} the Editor role`,
    expect.stringMatching(
      new RegExp(
        `^${me} assigned ${VENDOR_NAME} ${VENDOR} at Hall A 1 \\(Full Table\\) on May 1, 2099$`,
      ),
    ),
    // A Google Form market's stage is its Review, as its other screens name it.
    `${me} moved the market from Review to Assignment`,
    `${me} set ${VENDOR_NAME} ${VENDOR} to Approved`,
  ]);
  expect(first).not.toContain(`${me} changed Market Setup: sections`);

  // Older entries come beneath the newest, in the same open dialog.
  await manage.historyLoadMore.click();
  // The form, the setup change, the renames, two phase moves, the verdict, the assignment, two roles.
  await expect(manage.historySentences).toHaveCount(2 + RENAMES + 2 + 1 + 1 + 2);
  const all = await manage.historySentences.allInnerTexts();
  expect(all.slice(-2)).toEqual([
    `${me} changed Market Setup: sections`,
    `${me} changed the application form`,
  ]);
  await expect(manage.historyLoadMore).toHaveCount(0);
  await expect(manage.window).toBeVisible();

  // An entry opens to show what it was before and after.
  const roleChange = await manage.openHistoryEntry(0);
  await expect(roleChange).toContainText('Role');
  await expect(roleChange).toContainText('Editor');
  await expect(roleChange).toContainText('Viewer');
});

test('each filter narrows the list, and a vendor links to their drawer', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(10);

  await manage.historyKind.selectOption('People');
  await expect(manage.historySentences).toHaveCount(2);

  await manage.historyKind.selectOption('');
  await manage.historyVendor.fill(VENDOR);
  await expect(manage.historySentences).toHaveCount(2);
  await expect(manage.historySentences.first()).toContainText(`assigned ${VENDOR_NAME}`);
  await expect(manage.historySentences.last()).toContainText('to Approved');

  // Who may be narrowed to is whoever changed something here: the colleague only received.
  await expect(manage.historyWho.locator('option')).toHaveText(['Anyone', TEST_USER.email]);

  await manage.historyVendorLinks.first().click();
  await expect(page).toHaveURL(`/markets/${marketId}/vendors?vendor=${VENDOR}`);
  await expect(new VendorsPage(page).detailPanel).toContainText(VENDOR);
});

test('a market whose vendors apply on its page names its stage Applications', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications');

  const manage = await openManage(page, seed.marketName);

  await expect(manage.historySentences.first()).toHaveText(
    `${TEST_USER.email} moved the market from Draft to Applications`,
  );
});
