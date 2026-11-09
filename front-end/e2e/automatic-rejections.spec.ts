import type { Page } from '@playwright/test';
import {
  test,
  expect,
  TEST_USER,
  APP_API,
  CsvImportPage,
  ApplicationMonitorPage,
} from './fixtures';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { EXPORT_HEADERS, EXPORT_MAPPING, RESPONSES, exportOf } from './helpers/googleFormExport';

/**
 * The organizer sets the automatic rejections (E33/F03/S01).
 *
 * The real market rejects every applicant who does not agree to the no-show terms, or who is not a
 * student, alumnus or another accepted affiliation of its school. On the form's last step, Review
 * setup, a rule names one choice question and the answers that reject. It stays editable after the
 * form locks, and closes when the market reaches Assignment, saying why.
 */
const OUTSIDER = 'No, I am not an Example College student/alumni/staff';
const FIELDS = [
  {
    key: 'affiliation',
    label: 'Are you an Example College student or alumni?',
    type: 'select',
    required: true,
    options: [
      'Yes, I am a CURRENT Example College student',
      'Yes, I am Example College alumni/staff',
      OUTSIDER,
    ],
    order: 0,
  },
  {
    key: 'no_shows',
    label: 'I understand that no-shows will not be considered next time',
    type: 'checkbox',
    required: false,
    options: [],
    order: 1,
  },
  { key: 'business', label: 'Business name', type: 'text', required: true, options: [], order: 2 },
];

async function openReviewSetup(page: Page, marketId: string) {
  await page.goto(marketSetupPath(marketId, 'form'));
  await page.getByTestId('form-step-review').click();
  await expect(page.getByTestId('automatic-rejections')).toBeVisible({ timeout: 15000 });
}

async function addRule(page: Page, key: string, answer: string) {
  await page.getByTestId('rejection-rule-question').selectOption(key);
  await page.getByTestId('rejection-rule-add').click();
  // The add itself saves a rule with no answer yet, a PUT of its own: wait for the one that ticks.
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith('/rejection-rules') &&
      r.request().method() === 'PUT' &&
      (r.request().postDataJSON().rules as { key: string; answers: string[] }[]).some(
        (rule) => rule.key === key && rule.answers.includes(answer),
      ),
  );
  await page.getByTestId(`rejection-answer-${key}-${answer}`).locator('input').check();
  expect((await saved).ok()).toBeTruthy();
}

test.describe('Automatic rejections', () => {
  test('the no-show agreement and the affiliation, set before and after the form locks', async ({
    authenticatedPage: page,
  }) => {
    const { marketId } = await seedPhaseMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    const form = await page.request.put(`${APP_API}/markets/${marketId}/application-form`, {
      data: { fields: FIELDS },
    });
    expect(form.ok(), await form.text()).toBeTruthy();

    await openReviewSetup(page, marketId);
    // Free text is not a choice, so it is never offered; the server refuses it outright.
    await expect(page.getByTestId('rejection-rule-question')).not.toContainText('Business name');
    const freeText = await page.request.put(`${APP_API}/markets/${marketId}/rejection-rules`, {
      data: { rules: [{ key: 'business', answers: ['Acme'] }] },
    });
    expect(freeText.status()).toBe(400);

    await addRule(page, 'no_shows', 'not ticked');

    // Applications open: the form locks, the rules do not (decision 24).
    await transitionMarket(page.request, APP_API, TEST_USER.email, marketId, 'applications');
    await openReviewSetup(page, marketId);
    await expect(page.getByTestId('rejection-rules-locked')).toHaveCount(0);
    await addRule(page, 'affiliation', OUTSIDER);

    await page.reload();
    await page.getByTestId('form-step-review').click();
    await expect(
      page.getByTestId('rejection-answer-no_shows-not ticked').locator('input'),
    ).toBeChecked();
    await expect(
      page.getByTestId(`rejection-answer-affiliation-${OUTSIDER}`).locator('input'),
    ).toBeChecked();
  });

  test('from Assignment on, the rules are shown fixed with the reason, and refused', async ({
    authenticatedPage: page,
  }) => {
    const { marketId } = await seedAssignedMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );

    await openReviewSetup(page, marketId);
    await expect(page.getByTestId('rejection-rules-locked')).toContainText(
      'The automatic rejections are closed while tables are allocated.',
    );
    await expect(page.getByTestId('rejection-rule-add')).toHaveCount(0);

    const refused = await page.request.put(`${APP_API}/markets/${marketId}/rejection-rules`, {
      data: { rules: [] },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain('closed while tables are allocated');
  });
});

test.describe('The rules reject, with a reason (E33/F03/S02)', () => {
  test('the preview lists the rows a rule will reject, an import rejects them, and a reviewer overturns one', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedApplicantMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    const rule = await page.request.put(`${APP_API}/markets/${seed.marketId}/rejection-rules`, {
      data: { rules: [{ key: 'essential_table_choice', answers: ['half'] }] },
    });
    expect(rule.ok(), await rule.text()).toBeTruthy();

    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await expect(importPage.view).toBeVisible({ timeout: 15000 });
    await importPage.chooseFile(exportOf(RESPONSES.nadia, RESPONSES.theo, RESPONSES.ines));
    await importPage.mapColumns(EXPORT_HEADERS, EXPORT_MAPPING);
    await importPage.clickPreview();

    // Before anything is written, the preview names every row the rule will reject, with the
    // reason the review will show, and its headline counts them (E38/F03/S02).
    await expect(importPage.previewCounts).toHaveText(
      '3 of 3 rows will be imported; 1 of them will be rejected by your automatic rejections',
    );
    await expect(importPage.previewMerge).toContainText(
      'awaiting your review, except the 1 listed below, which arrives already rejected.',
    );
    await expect(importPage.rejectedCount).toHaveText('1');
    // Who may overturn one is the market's change row, an Admin or the owner by default (E38/F06/S01).
    await expect(importPage.rejectedWhy).toHaveText(
      'A check that your rules reject who they should. These are imported as rejected, each with its reason; an Admin or the owner can overturn one.',
    );
    await expect(importPage.rejectedRows).toHaveCount(1);
    const rejected = importPage.rejectedRows.first();
    await expect(rejected.getByTestId('import-row-name')).toHaveText('Theo Marchetti');
    await expect(rejected.getByTestId('import-row-number')).toHaveText('Row 3');
    await rejected.locator(':scope > summary').click();
    await expect(rejected.getByTestId('import-row-reason')).toHaveText(
      'Rejected automatically: Answered “Half a table, shared” to “Table choice”',
    );
    // The samples are the rows that import and no rule rejects: a check of the mapping alone.
    await expect(importPage.sampleRows.getByTestId('import-row-name')).toHaveText([
      'Nadia Okonkwo',
      'Ines Albrecht',
    ]);
    const before = await page.request.get(`${APP_API}/markets/${seed.marketId}/applications`);
    expect((await before.json()).applications).toEqual([]);

    await importPage.clickConfirm();
    await expect(page.getByTestId('import-result-rejected-note')).toContainText(
      '1 was rejected by your automatic rejections, each with its reason; an Admin or the owner can overturn any of them.',
    );

    // The first import took the market into Review (E38/F04/S01); its done step leads there.
    await page.getByTestId('import-finish-button').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    const monitor = new ApplicationMonitorPage(page);
    await monitor.switchTo();
    await monitor.waitForLoaded();
    // Nadia and Ines wait: Theo arrived already rejected, the rule his giver and his answer the
    // reason.
    expect(await monitor.queuedEmails()).toEqual(['nadia@ember.test', 'ines@loom.test']);
    await monitor.openDecided();
    const theo = page
      .getByTestId('app-monitor-decided-row')
      .filter({ hasText: 'theo@thistle.test' });
    await expect(theo.getByTestId('app-monitor-decided-giver')).toHaveText(
      'Rejected automatically: Answered “Half a table, shared” to “Table choice”',
    );

    // Overturning it makes it the reviewer's.
    await theo.getByTestId('app-monitor-decided-approve-button').click();
    await expect(theo.getByTestId('app-monitor-decided-giver')).toHaveText(
      new RegExp(`^Approved by ${TEST_USER.email}, `),
    );
  });
});

/**
 * Review waits on the automatic rejections (T206): a draft whose organizer has decided nothing is
 * not opened for review with no rule by accident. The rail leads to Review setup, which offers "No
 * automatic rejections" as one click; a rule that rejects an answer decides it too and replaces the
 * "none", while a rule with no answer ticked rejects nobody and decides nothing.
 */
test.describe('A draft decides the automatic rejections', () => {
  test('the rail leads to Review setup, and No automatic rejections decides it in one click', async ({
    authenticatedPage: page,
  }) => {
    const { marketId } = await seedPhaseMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form', reviewSetupUndecided: true },
    );
    const form = await page.request.put(`${APP_API}/markets/${marketId}/application-form`, {
      data: { fields: FIELDS },
    });
    expect(form.ok(), await form.text()).toBeTruthy();
    // What a reviewer reads first decided, so this is all the move waits on.
    const highlights = await page.request.put(`${APP_API}/markets/${marketId}/review-highlights`, {
      data: { keys: [], nothingLeadsTheCard: true },
    });
    expect(highlights.ok(), await highlights.text()).toBeTruthy();

    await page.goto(marketSetupPath(marketId, 'form'));
    const fix = page.getByTestId('phase-rail-fix');
    const open = page.getByTestId('phase-transition-applications');
    await expect(fix).toHaveText('Decide the automatic rejections', { timeout: 15000 });
    await expect(open).toBeDisabled();

    await fix.click();

    await expect(page).toHaveURL(/\/form\?step=review$/);
    // The rail offers no link to where the organizer already is.
    await expect(fix).toHaveCount(0);
    const notice = page.getByTestId('rejection-rules-undecided');
    await expect(notice).toHaveText('Not decided yet. Opening applications waits on this.');

    const rulesWrite = () =>
      page.waitForResponse(
        (response) =>
          response.url().includes(`/markets/${marketId}/rejection-rules`) &&
          response.request().method() === 'PUT',
      );
    const none = page.getByTestId('rejection-rules-none');
    await Promise.all([rulesWrite(), none.click()]);

    const readBack = page.getByTestId('rejection-rules-none-chosen');
    await expect(readBack).toHaveText(
      'No automatic rejections: every application arrives undecided.',
    );
    await expect(notice).toHaveCount(0);
    await expect(none).toHaveCount(0);
    // The rail moves on: nothing else refuses the move, so it offers the move itself.
    await expect(open).toBeEnabled();

    // A rule replaces the "none", but rejects nobody until an answer is ticked, so it decides
    // nothing yet.
    await page.getByTestId('rejection-rule-question').selectOption('no_shows');
    await Promise.all([rulesWrite(), page.getByTestId('rejection-rule-add').click()]);
    await expect(readBack).toHaveCount(0);
    await expect(notice).toBeVisible();
    await expect(open).toBeDisabled();

    // Ticking an answer decides it.
    const answer = page.getByTestId('rejection-answer-no_shows-not ticked').locator('input');
    await Promise.all([rulesWrite(), answer.check()]);
    await expect(notice).toHaveCount(0);
    await expect(none).toHaveCount(0);
    await expect(open).toBeEnabled();

    // Removing the last such rule in draft asks again.
    await Promise.all([rulesWrite(), page.getByTestId('rejection-rule-remove-no_shows').click()]);
    await expect(notice).toBeVisible();
    await expect(none).toBeVisible();
    await expect(open).toBeDisabled();
  });
});
