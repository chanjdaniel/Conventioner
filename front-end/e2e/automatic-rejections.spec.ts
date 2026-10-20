import type { Page } from '@playwright/test';
import {
  test,
  expect,
  TEST_USER,
  BACKEND_URL,
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
 * UBC student, alumnus or another accepted affiliation. On the form's last step, Review setup, a
 * rule names one choice question and the answers that reject. It stays editable after the form
 * locks, and closes when the market reaches Assignment, saying why.
 */
const NOT_UBC = 'No, I am not a UBC student/alumni/staff';
const FIELDS = [
  {
    key: 'affiliation',
    label: 'Are you a UBC student or alumni?',
    type: 'select',
    required: true,
    options: ['Yes, I am a CURRENT UBC student', 'Yes, I am an UBC alumni/staff', NOT_UBC],
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
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/rejection-rules') && r.request().method() === 'PUT',
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
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    const form = await page.request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
      data: { fields: FIELDS },
    });
    expect(form.ok(), await form.text()).toBeTruthy();

    await openReviewSetup(page, marketId);
    // Free text is not a choice, so it is never offered; the server refuses it outright.
    await expect(page.getByTestId('rejection-rule-question')).not.toContainText('Business name');
    const freeText = await page.request.put(`${BACKEND_URL}/markets/${marketId}/rejection-rules`, {
      data: { rules: [{ key: 'business', answers: ['Acme'] }] },
    });
    expect(freeText.status()).toBe(400);

    await addRule(page, 'no_shows', 'not ticked');

    // Applications open: the form locks, the rules do not (decision 24).
    await transitionMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      marketId,
      'applications_open',
    );
    await openReviewSetup(page, marketId);
    await expect(page.getByTestId('rejection-rules-locked')).toHaveCount(0);
    await addRule(page, 'affiliation', NOT_UBC);

    await page.reload();
    await page.getByTestId('form-step-review').click();
    await expect(
      page.getByTestId('rejection-answer-no_shows-not ticked').locator('input'),
    ).toBeChecked();
    await expect(
      page.getByTestId(`rejection-answer-affiliation-${NOT_UBC}`).locator('input'),
    ).toBeChecked();
  });

  test('from Assignment on, the rules are shown fixed with the reason, and refused', async ({
    authenticatedPage: page,
  }) => {
    const { marketId } = await seedAssignedMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );

    await openReviewSetup(page, marketId);
    await expect(page.getByTestId('rejection-rules-locked')).toContainText('reached Assignment');
    await expect(page.getByTestId('rejection-rule-add')).toHaveCount(0);

    const refused = await page.request.put(`${BACKEND_URL}/markets/${marketId}/rejection-rules`, {
      data: { rules: [] },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain('reached Assignment');
  });
});

test.describe('The rules reject, with a reason (E33/F03/S02)', () => {
  test('an import rejects the rows a rule meets, and a reviewer overturns one', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedApplicantMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    const rule = await page.request.put(`${BACKEND_URL}/markets/${seed.marketId}/rejection-rules`, {
      data: { rules: [{ key: 'essential_table_choice', answers: ['half'] }] },
    });
    expect(rule.ok(), await rule.text()).toBeTruthy();

    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await expect(importPage.view).toBeVisible({ timeout: 15000 });
    await importPage.importCsv(
      exportOf(RESPONSES.nadia, RESPONSES.theo),
      EXPORT_HEADERS,
      EXPORT_MAPPING,
    );
    await expect(page.getByTestId('import-result-rejected-note')).toContainText(
      '1 was rejected by your automatic rejections',
    );

    await page.getByTestId('phase-transition-review').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    const monitor = new ApplicationMonitorPage(page);
    await monitor.waitForLoaded();
    // Only Nadia waits: Theo arrived already rejected, the rule his giver and his answer the reason.
    expect(await monitor.queuedEmails()).toEqual(['nadia@ember.test']);
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
