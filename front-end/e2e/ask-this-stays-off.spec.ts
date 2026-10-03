import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * Switching off Section preference stays switched off whatever else the organizer edits
 * (E26/F03/S01, bug 29).
 *
 * Editing any custom field rebuilt the form from its fields alone, dropping the list of essential
 * questions the market does not ask, so the next "Save Form" asked Section preference again. On a
 * market started from a Google Form that made the import demand a column the file never had.
 */

const TIER = { id: 1, name: 'Gold' };
const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-11-07' }],
  tiers: [TIER],
  locations: [{ name: 'Hall' }],
  sections: [
    { name: 'North', location: { name: 'Hall' }, tier: TIER, count: 2 },
    { name: 'South', location: { name: 'Hall' }, tier: TIER, count: 2 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  floorplans: null,
};

test('"Ask this" stays off after a custom field is added and the form saved', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);

  await page.goto(marketSetupPath(marketId, 'form'));
  const askThis = page.getByRole('checkbox', { name: /Ask this/ });
  await expect(askThis).toBeChecked();
  await askThis.uncheck();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('button', { name: 'Add Field' }).click();
  await page.getByTestId('form-field-label-input').first().fill('Product category');
  await page.getByTestId('form-field-required-checkbox').first().check();
  await page.getByRole('button', { name: 'Save Form', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as {
    market: { applicationForm: { unaskedEssentials: string[]; fields: { label: string }[] } };
  };
  expect(market.applicationForm.fields.map((f) => f.label)).toEqual(['Product category']);
  expect(market.applicationForm.unaskedEssentials).toContain('essential_section_ranking');

  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Ask this/ })).not.toBeChecked();
  // The applicant form is what the preview renders: a switched-off question is not on it, and is
  // certainly not marked required.
  await expect(page.getByTestId('form-preview-essential-fields')).toBeVisible();
  await expect(page.getByTestId('form-preview-essential-section-ranking')).toHaveCount(0);
});
