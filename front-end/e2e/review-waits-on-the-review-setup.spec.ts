import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, APP_API, CsvImportPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { savePlan } from './helpers/savePlan';
import { completePlan } from './helpers/seeds';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { MarketSetupPage } from './pages/MarketSetupPage';
import { OpenApplicationsDialog } from './pages/OpenApplicationsDialog';

/**
 * Review waits on what reviewers read first and the automatic rejections (T206).
 *
 * The whole fix as an organizer meets it: a fresh draft is refused Review on both decisions, the
 * rail leads to Review setup, and each "none" decides in one click. A market whose vendors apply on
 * its page then opens through "Open applications", which names both decisions; a Google Form
 * market's first import is refused until both are decided, then takes it into Review. A market that
 * reached Review before the fix, with neither decided, is refused nothing new; and a move refused
 * with several things open lists both decisions among the rest, each with its fix.
 */

const HIGHLIGHTS_OPEN =
  'Nothing says what a reviewer reads first. On Review setup, tick the answers that lead the card, or choose Nothing leads the card.';
const REJECTIONS_OPEN =
  'The automatic rejections are not decided. On Review setup, add a rule that rejects an answer, or choose No automatic rejections.';
const DECISIONS = ['review_highlights_decided', 'rejection_rules_decided'];

/** Press one of Review setup's "none"s, and wait for its write to land. */
async function chooseNone(page: Page, section: 'review-highlights' | 'rejection-rules') {
  const path = section === 'review-highlights' ? '/review-highlights' : '/rejection-rules';
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes(path) && response.request().method() === 'PUT',
    ),
    page.getByTestId(`${section}-none`).click(),
  ]);
  await expect(page.getByTestId(`${section}-none-chosen`)).toBeVisible();
}

test.describe('Review waits on the review setup', () => {
  test('a draft decides both in two clicks, and "Open applications" names them before Review opens', async ({
    authenticatedPage: page,
  }) => {
    const market = await seedApplicantMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { draft: true, reviewSetupUndecided: true },
    );
    const setup = new MarketSetupPage(page);
    const fix = page.getByTestId('phase-rail-fix');
    const next = page.getByTestId('phase-rail-next');
    const opening = new OpenApplicationsDialog(page);

    await page.goto(marketScreenPath(market.marketId, 'setup'));
    await expect(fix).toHaveText('Decide what reviewers read first', { timeout: 15000 });
    await expect(next).toContainText(HIGHLIGHTS_OPEN);
    await expect(opening.opener).toBeDisabled();

    await fix.click();
    await expect(page).toHaveURL(/\/form\?step=review$/);
    for (const section of ['review-highlights', 'rejection-rules']) {
      await expect(page.getByTestId(`${section}-undecided`)).toHaveText(
        'Not decided yet. Opening applications waits on this.',
      );
    }

    // One click each. The rail moves on to the second, which it names without a link to the page
    // it is on, and then frees the move.
    await chooseNone(page, 'review-highlights');
    await expect(next).toContainText(REJECTIONS_OPEN);
    await expect(fix).toHaveCount(0);
    await expect(opening.opener).toBeDisabled();
    await chooseNone(page, 'rejection-rules');
    await expect(opening.opener).toBeEnabled();

    // From another page, the dialog names both decisions, and its Change leads back to Review
    // setup, closing it.
    await setup.setupTab.click();
    await expect(page).toHaveURL(/\/setup$/);
    await opening.start();
    await expect(opening.leads).toHaveText('Nothing leads the card');
    await expect(opening.rejections).toHaveText('Automatic rejections: None');
    await opening.changeReviewSetup.click();
    await expect(opening.dialog).toBeHidden();
    await expect(page).toHaveURL(/\/form\?step=review$/);
    await expect(setup.currentPhase).toHaveText('Draft');

    // A mark replaces the "none", and the dialog reads it by its label.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/review-highlights') && response.request().method() === 'PUT',
      ),
      page.getByTestId('review-highlight-business_name').locator('input').check(),
    ]);
    await expect(page.getByTestId('review-highlights-none-chosen')).toHaveCount(0);
    await opening.start();
    await expect(opening.leads).toHaveText('What a reviewer reads first: Business Name');
    await expect(opening.rejections).toHaveText('Automatic rejections: None');

    await opening.confirm.click();
    await expect(opening.dialog).toBeHidden();
    await expect(setup.currentPhase).toHaveText('Applications', { timeout: 10000 });
    await expect(page).toHaveURL(/\/applications$/);
  });

  test("a Google Form draft's first import waits on both, then takes it into Review", async ({
    authenticatedPage: page,
  }) => {
    const market = await seedApplicantMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv', reviewSetupUndecided: true },
    );
    const importPage = new CsvImportPage(page);
    const fix = page.getByTestId('phase-rail-fix');

    // Refused, naming the first open decision; the rail's fix is its way to Review setup.
    await page.goto(marketScreenPath(market.marketId, 'import'));
    await expect(importPage.wrongPhase).toContainText(
      'This market is not ready for its first import',
      { timeout: 15000 },
    );
    await expect(importPage.wrongPhase).toContainText(HIGHLIGHTS_OPEN);
    await expect(importPage.upload).toHaveCount(0);
    await expect(fix).toHaveText('Decide what reviewers read first');

    await fix.click();
    await expect(page).toHaveURL(/\/form\?step=review$/);
    for (const section of ['review-highlights', 'rejection-rules']) {
      await expect(page.getByTestId(`${section}-undecided`)).toHaveText(
        'Not decided yet. Your first import waits on this.',
      );
    }
    await chooseNone(page, 'review-highlights');
    await chooseNone(page, 'rejection-rules');

    // Decided, the rail's next fix is the import itself, and it now takes the file.
    await expect(fix).toHaveText('Import responses');
    await fix.click();
    await expect(importPage.upload).toBeVisible({ timeout: 15000 });
    await importPage.chooseFile(CSV);
    await importPage.mapColumns(HEADERS, MAPPING);
    await expect(importPage.allMapped).toBeVisible();
    await importPage.clickPreview();
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('Imported 1 new application');
    await expect(new MarketSetupPage(page).currentPhase).toHaveText('Review');
  });

  test('a market already in Review with neither decided is asked nothing', async ({
    authenticatedPage: page,
  }) => {
    const market = await seedApplicantMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
    );
    // As a market that left draft before the decisions were stored: neither field at all.
    mongoEval(
      `db.markets.updateOne({id: ${JSON.stringify(market.marketId)}}, ` +
        `{$set: {reviewHighlights: [], rejectionRules: []}, ` +
        `$unset: {nothingLeadsTheCard: '', noAutomaticRejections: ''}})`,
    );

    const read = await page.request.get(`${APP_API}/markets/${market.marketId}`);
    expect(read.ok(), await read.text()).toBeTruthy();
    const served = (await read.json()).market as {
      phase: string;
      nothingLeadsTheCard: boolean;
      noAutomaticRejections: boolean;
      transitionBlockers: Record<string, Array<{ id: string }>>;
    };
    expect(served.phase).toBe('applications');
    expect(served.nothingLeadsTheCard).toBe(false);
    expect(served.noAutomaticRejections).toBe(false);
    const refusedBy = Object.values(served.transitionBlockers).flatMap((blockers) =>
      blockers.map((blocker) => blocker.id),
    );
    expect(refusedBy.filter((id) => DECISIONS.includes(id))).toEqual([]);

    await page.goto(marketSetupPath(market.marketId, 'form?step=review'));
    await expect(page.getByTestId('review-highlights')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('automatic-rejections')).toBeVisible();
    for (const section of ['review-highlights', 'rejection-rules']) {
      await expect(page.getByTestId(`${section}-undecided`)).toHaveCount(0);
      await expect(page.getByTestId(`${section}-none`)).toHaveCount(0);
      await expect(page.getByTestId(`${section}-none-chosen`)).toHaveCount(0);
    }
    await expect(page.getByTestId('phase-rail-fix').filter({ hasText: 'Decide' })).toHaveCount(0);
  });

  test('a move refused with several things open lists both decisions among the rest, each with its fix', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedPhaseMarket(page.request, APP_API, TEST_USER.email, TEST_USER.password, {
      intakeMode: 'form',
    });
    const setup = new MarketSetupPage(page);
    const opening = new OpenApplicationsDialog(page);
    await page.goto(marketSetupPath(seed.marketId, 'form'));
    await expect(opening.opener).toBeEnabled({ timeout: 15000 });

    // While the page stands ready, the market changes under it, as another organizer's writes
    // would: the location goes, and both decisions are undone.
    await savePlan(page.request, APP_API, TEST_USER.email, seed.marketId, {
      ...completePlan(),
      locations: [],
      sections: [{ name: 'Hall A', tier: { id: 1, name: 'Gold' }, count: 5 }],
    });
    for (const [path, data] of [
      ['review-highlights', { keys: [] }],
      ['rejection-rules', { rules: [] }],
    ] as const) {
      const res = await page.request.put(`${APP_API}/markets/${seed.marketId}/${path}`, { data });
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    await opening.start();
    await opening.confirm.click();
    await expect(opening.dialog).toBeHidden();
    await expect(setup.phaseBlockers).toContainText(HIGHLIGHTS_OPEN);
    await expect(setup.phaseBlockers).toContainText(REJECTIONS_OPEN);
    await expect(setup.phaseBlockers.getByTestId('blocker-resolution-link')).toHaveText([
      /Add a location/,
      /Decide what reviewers read first/,
      /Decide the automatic rejections/,
    ]);
    await expect(setup.currentPhase).toHaveText('Draft');

    await setup.phaseBlockers
      .getByTestId('blocker-resolution-link')
      .filter({ hasText: 'Decide the automatic rejections' })
      .click();
    await expect(page).toHaveURL(/\/form\?step=review$/);
    await expect(page.getByTestId('rejection-rules-undecided')).toBeVisible();
  });
});

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Business name',
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
  'What do you sell?',
];

const MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
  'Which days can you attend?': 'essential_available_dates',
  'How many days do you want?': 'essential_max_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  'Rank the sections': 'essential_section_ranking',
  'Business name': 'business_name',
  'What do you sell?': 'product_type',
};

const CSV = [
  HEADERS.join(','),
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,2099-08-01,1,Gold,half,"Garden, Main Hall",Pottery',
].join('\n');
