import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { ensureTestOrg, loginViaApi, SEED_MARKET_DATE } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApplication, seedApprovedVendor } from './helpers/seedApplication';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { VendorsPage } from './pages/VendorsPage';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * A table-share request that pairs nobody is shown to the organizer (E27/F01/S03).
 *
 * The question asks for "the exact email address they submitted", and real answers do not always
 * give one. A request the product could not meet used to become an ordinary half-table request in
 * silence, so a vendor who asked to sit with a friend met a stranger on market day. Now the review
 * card and the vendor's detail say why, and block nothing.
 *
 * Applications are seeded in the shape the write stores (`essential_fields.py`): the applicant's
 * words, and the address read out of them.
 */

/** Each request, by who made it: [their words, the address read out of them, table choice]. */
const REQUESTS: Record<string, [string, string, string]> = {
  // A valid pair: the address sits inside a sentence, in other case.
  'ana@share.test': ['Please seat me with Bo@Share.test', 'bo@share.test', 'half'],
  'bo@share.test': ['', '', 'half'],
  'cy@share.test': ['my friend Sam', '', 'half'],
  'di@share.test': ['ghost@share.test', 'ghost@share.test', 'half'],
  'ed@share.test': ['fy@share.test', 'fy@share.test', 'half'],
  'fy@share.test': ['', '', 'full'],
};

const NOTICES: Record<string, string | null> = {
  'ana@share.test': null,
  'cy@share.test': 'There is no email address in their answer',
  'di@share.test': 'Nobody else in this market applied as ghost@share.test',
  'ed@share.test': 'fy@share.test asked for a whole table',
};

function shareAnswers(email: string): Record<string, unknown> {
  const [words, address, choice] = REQUESTS[email];
  return {
    essential_table_choice: choice,
    essential_table_share_answer: words,
    essential_table_share_email: address,
  };
}

async function seedDraftMarketWithAForm(request: APIRequestContext): Promise<string> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const headers = { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email };

  const created = await request.post(`${BACKEND_URL}/markets`, {
    headers,
    data: {
      name: `E2E Table Share ${Date.now()}`,
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
    data: {
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', required: true, order: 0 },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();
  return marketId;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate((user) => {
    localStorage.setItem('user', JSON.stringify(user));
  }, TEST_USER.email);
}

test.describe('A table-share request that pairs nobody is shown', () => {
  test('on the review card, and not on a request that pairs', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedDraftMarketWithAForm(request);
    for (const email of Object.keys(REQUESTS)) {
      seedApplication(marketId, email, {
        business_name: `Shop of ${email}`,
        essential_full_name: email.split('@')[0],
        ...shareAnswers(email),
      });
    }

    await signIn(page);
    await page.goto(marketSetupPath(marketId, 'applications'));
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    const notice = page.getByTestId('app-monitor-table-share-notice');

    for (const [email, expected] of Object.entries(NOTICES)) {
      await monitor.advanceTo(email);
      if (expected === null) await expect(notice).toHaveCount(0);
      else await expect(notice).toContainText(expected);
    }

    // The card reads the applicant's own words, not the address read out of them.
    await monitor.advanceTo('ana@share.test');
    await expect(monitor.answers).toContainText('Please seat me with Bo@Share.test');
  });

  test("in the vendor's detail, after the assignment has run", async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      {
        name: `E2E Table Share Vendors ${Date.now()}`,
        run: false,
      },
    );
    for (const email of Object.keys(REQUESTS)) {
      seedApprovedVendor(seed.marketId, email, {
        dates: [SEED_MARKET_DATE],
        tiers: ['Gold'],
        tableChoice: REQUESTS[email][2],
        shareWith: REQUESTS[email][1],
        extra: { essential_table_share_answer: REQUESTS[email][0] },
      });
    }
    const run = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/assignment`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(run.ok(), await run.text()).toBeTruthy();

    await signIn(page);
    const vendors = new VendorsPage(page);
    await vendors.goto(seed.marketId);
    const notice = page.getByTestId('vendors-detail-table-share-notice');

    for (const [email, expected] of Object.entries(NOTICES)) {
      await vendors.search(email);
      await expect(vendors.vendorListItems).toHaveCount(1);
      await vendors.clickVendor(0);
      await expect(vendors.detailPanel).toBeVisible();
      if (expected === null) await expect(notice).toHaveCount(0);
      else await expect(notice).toContainText(expected);
      await vendors.closeDetail();
    }
  });
});
