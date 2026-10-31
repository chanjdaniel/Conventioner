import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import {
  ALUMNI,
  EXAMPLE_GROUPS,
  NO_CLUB,
  PLAN,
  SECOND_DATE,
  STUDENT,
  seedExampleMarket,
} from './helpers/exampleCollegeMarket';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * Price groups on the Pricing card (E43/F01/S02).
 *
 * The organizer names groups over the market's own choice questions, each priced per tier; a vendor
 * pays the cheapest group they are in, and "Everyone else" when they are in none. The fixture is the
 * Example College table: three groups and "Everyone else", Gold and Silver, one configuration of a general card.
 */
async function ok(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  expect(res.ok(), `${what}: ${await res.text()}`).toBeTruthy();
}

/** Add a group on the card, as an organizer does: its name, its conditions, its prices. */
async function addGroup(card: Locator, index: number, group: (typeof EXAMPLE_GROUPS)[number]) {
  await card.getByTestId('pricing-add-group').click();
  const name = card.getByTestId(`pricing-group-${index}-name`);
  await expect(name).toBeFocused();
  await name.fill(group.name);
  for (const condition of group.conditions) {
    await card.getByTestId(`pricing-group-${index}-rule-question`).selectOption(condition.key);
    await card.getByTestId(`pricing-group-${index}-rule-add`).click();
    for (const answer of condition.answers) {
      await card
        .getByTestId(`pricing-group-${index}-answer-${condition.key}-${answer}`)
        .locator('input')
        .check();
    }
  }
  await card.getByRole('textbox', { name: `${group.name} Gold` }).fill(group.prices[0]);
  await card.getByRole('textbox', { name: `${group.name} Silver` }).fill(group.prices[1]);
}

/** The vendor's drawer, on its Assignments tab: a card for each of the market's two dates. */
async function priceLines(page: Page, marketId: string, email: string) {
  const query = new URLSearchParams({ vendor: email, vendorTab: 'assignments' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  const cards = page.getByTestId('vendors-detail-assignment-item');
  await expect(cards).toHaveCount(2, { timeout: 15000 });
  return [0, 1].map((n) => cards.nth(n).getByTestId('vendor-date-card-price'));
}

test.describe('price groups', () => {
  test('the Example College table entered as three groups prices each vendor by the cheapest they are in', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId, name: marketName } = await seedExampleMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    await page.goto(marketSetupPath(marketId, 'setup'));
    const card = page.getByTestId('plan-card-pricing');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('textbox', { name: 'Everyone else Gold' }).fill('35');
    await card.getByRole('textbox', { name: 'Everyone else Silver' }).fill('30');
    for (const [index, group] of EXAMPLE_GROUPS.entries()) await addGroup(card, index, group);
    // "Everyone else" stays the last row.
    await expect(card.locator('tbody tr th[scope="row"]').last()).toHaveText('Everyone else');
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });

    const stored = async () =>
      (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market.setupObject
        .pricing;
    await expect.poll(stored).toMatchObject({
      groups: EXAMPLE_GROUPS.map((group) => ({
        name: group.name,
        conditions: group.conditions,
        prices: [
          { tier: 'Gold', cents: Number(group.prices[0]) * 100 },
          { tier: 'Silver', cents: Number(group.prices[1]) * 100 },
        ],
      })),
      everyoneElse: [
        { tier: 'Gold', cents: 3500 },
        { tier: 'Silver', cents: 3000 },
      ],
    });

    // The market's History says what the card's last write changed, its group's conditions in the
    // card's words, one to a line: the rule that keeps a cell's lines (`.history-table td`).
    await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
    await page.getByTestId('market-card-manage-button').click();
    const manage = new ManageMarketPage(page);
    await manage.waitForOverlay();
    await manage.openHistory();
    await expect(manage.historySentences.first()).toContainText(
      `${TEST_USER.email} changed the prices: price groups`,
    );
    const changes = await manage.openHistoryEntry(0);
    const after = changes
      .locator('tbody tr')
      .filter({
        has: page.getByRole('rowheader', { name: 'Group “Example College alumni + club member”' }),
      })
      .locator('td')
      .nth(1);
    await expect(after).toHaveText(
      'Gold $25, Silver $22\n' +
        'when “Are you an Example College student or alumni?” includes “Example College alumni/staff”\n' +
        'and “Do you belong to any of these clubs?” includes “Art Club” or “Craft Club”',
      { useInnerText: true },
    );
    await expect(after).toHaveCSS('white-space', 'pre-line');
    // Each condition a line whose wrap hangs under it, so a long label never reads as two lines.
    const line = after.getByTestId('market-history-line');
    await expect(line).toHaveCount(3);
    await expect(line.nth(1)).toHaveCSS('display', 'block');
    expect(
      parseFloat(await line.nth(1).evaluate((el) => getComputedStyle(el).textIndent)),
    ).toBeLessThan(0);

    // A student in a club, who is a student too: the cheaper of the two. An alumnus in no club:
    // no group, so "Everyone else".
    const vendors = {
      'student@example.com': { affiliation: [STUDENT], clubs: ['Art Club'] },
      'alumnus@example.com': { affiliation: [ALUMNI], clubs: [NO_CLUB] },
    };
    for (const [email, extra] of Object.entries(vendors)) {
      seedApprovedVendor(marketId, email, {
        dates: [SEED_MARKET_DATE, SECOND_DATE],
        tiers: ['Gold', 'Silver'],
        sections: ['North Wing', 'Landing'],
        extra,
      });
    }
    for (const toPhase of ['applications', 'assignment']) {
      await ok(
        await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, { data: { toPhase } }),
        `move to ${toPhase}`,
      );
    }
    for (const [email, n] of [
      ['student@example.com', 1],
      ['alumnus@example.com', 2],
    ] as const) {
      for (const [date, section] of [
        [SEED_MARKET_DATE, 'North Wing'],
        [SECOND_DATE, 'Landing'],
      ]) {
        await ok(
          await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
            data: { email, date, table_code: `${section} ${n}`, table_choice: 'Full Table' },
          }),
          `place ${email}`,
        );
      }
    }

    const student = await priceLines(page, marketId, 'student@example.com');
    await expect(student[0]).toHaveText(
      'Gold, full table, Example College student + club member, $12',
    );
    await expect(student[1]).toHaveText(
      'Silver, full table, Example College student + club member, $10',
    );
    const alumnus = await priceLines(page, marketId, 'alumnus@example.com');
    await expect(alumnus[0]).toHaveText('Gold, full table, Everyone else, $35');
    await expect(alumnus[1]).toHaveText('Silver, full table, Everyone else, $30');
  });

  test('a condition on a question the form no longer asks is broken, and holds the draft', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedExampleMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
      ...PLAN,
      pricing: {
        currency: 'CAD',
        halfTablePercent: 50,
        groups: [
          {
            name: 'First years',
            conditions: [{ key: 'year_of_study', answers: ['First'] }],
            prices: [{ tier: 'Gold', cents: 1000 }],
          },
        ],
        everyoneElse: [{ tier: 'Gold', cents: 3500 }],
      },
    });

    // From another page of the market, the rail offers the fix, and it leads to the card.
    await page.goto(marketSetupPath(marketId, 'form'));
    const fix = page.getByTestId('phase-rail-fix');
    await expect(fix).toHaveText('Fix the price groups', { timeout: 15000 });
    await expect(page.getByTestId('phase-transition-applications')).toBeDisabled();
    await fix.click();
    await expect(page).toHaveURL(/\/setup$/);
    const card = page.getByTestId('plan-card-pricing');
    await expect(card.getByTestId('pricing-group-0-broken-year_of_study')).toContainText(
      'no longer asks',
      { timeout: 15000 },
    );
    await expect(card.getByTestId('pricing-group-0-broken')).toContainText('prices nobody');

    const refused = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase: 'applications' },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.text()).toContain('First years');

    // Removing the condition's group lets the market go.
    await card.getByTestId('pricing-group-0-remove').click();
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('phase-transition-applications')).toBeEnabled({
      timeout: 10000,
    });
  });
});
