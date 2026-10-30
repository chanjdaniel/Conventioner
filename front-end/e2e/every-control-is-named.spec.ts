import path from 'path';
import { fileURLToPath } from 'url';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage, FloorplanWorkflowPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { TablesPage } from './pages/TablesPage';
import { namelessControls } from './helpers/accessibleNames';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { CsvImportPage } from './pages/CsvImportPage';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';
import { mongoEval } from './helpers/mongo';
import { seedFloorplanTemplate } from './helpers/seedFloorplanTemplate';

/**
 * Every control can be reached and named by assistive technology (bug 44; E26/F10/S03).
 *
 * The plan's name fields, the sign-in code and a form preview's checkbox were announced as nothing;
 * "More…" opened a list of plain buttons, not a menu; the sign-in page's tabs were buttons, not a
 * tab list; and the floorplan choice was not a dialog at all.
 */
const GOLD = { id: 1, name: 'Gold' };

test('every field on the plan, the rules and the form preview has a name', async ({
  authenticatedPage: page,
  request,
}) => {
  // Vendors apply on its page, so its form has all four steps, the preview among them.
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    data: {
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', required: true, order: 0 },
        { key: 'insured', label: 'I have insurance', type: 'checkbox', required: false, order: 1 },
        {
          key: 'craft',
          label: 'Craft',
          type: 'select',
          required: true,
          order: 2,
          options: ['Ceramics', 'Prints'],
        },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();
  // One rule of each kind, so every control a rule draws is on screen: with none, the walk saw the
  // card's "Add a rule" and nothing else, and every control inside a rule went unnamed (E26 re-walk).
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [
      { id: 1, target: 'application.submitted_at', ordering: [], direction: 'ascending' },
      { id: 2, target: 'craft', ordering: ['Ceramics'], direction: null },
    ],
    marketDates: [{ date: '2099-05-01' }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 4 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
    // A price group with a condition, so its name, prices and condition are walked (E43/F01/S02).
    pricing: {
      currency: 'CAD',
      halfTablePercent: 50,
      groups: [
        {
          name: 'Ceramicists',
          conditions: [{ key: 'craft', answers: ['Ceramics'] }],
          prices: [{ tier: 'Gold', cents: 2000 }],
        },
      ],
      everyoneElse: [{ tier: 'Gold', cents: 3500 }],
    },
  });

  for (const tab of ['setup', 'settings', 'form']) {
    await page.goto(marketSetupPath(marketId, tab));
    await expect(page.getByTestId('market-bar-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await namelessControls(page), `the ${tab} page`).toEqual([]);
  }

  // The form tab is four steps, each drawing its own controls (E33/F01/S01): walk every one, and
  // the header says which is open to assistive technology.
  await page.goto(marketSetupPath(marketId, 'form'));
  const steps = page.getByRole('navigation', { name: 'Application form setup' });
  for (const step of ['Essential questions', 'Your questions', 'Preview', 'Review setup']) {
    await steps.getByRole('button', { name: step }).click();
    await expect(steps.getByRole('button', { name: step })).toHaveAttribute('aria-current', 'step');
    await page.waitForLoadState('networkidle');
    expect(await namelessControls(page), `the form's ${step} step`).toEqual([]);
  }

  // Removing a rule, or one of its answers, is a named button a keyboard reaches.
  await page.goto(marketSetupPath(marketId, 'settings'));
  await expect(page.getByTestId('priority-rule-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Remove rule 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Ceramics from rule 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove rule 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('priority-rule-row')).toHaveCount(1);
});

test('the sign-in page is a tab list, and every field on it has a name', async ({ page }) => {
  await page.goto('/login');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  expect(await namelessControls(page), 'sign in').toEqual([]);

  await tabs.getByRole('tab', { name: 'Register' }).click();
  await expect(tabs.getByRole('tab', { name: 'Register' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await namelessControls(page), 'register').toEqual([]);

  const login = new LoginPage(page);
  await tabs.getByRole('tab', { name: 'Sign-in code' }).click();
  await login.otpEmailInput.fill(`nobody-${Date.now()}@example.com`);
  await login.otpSubmitButton.click();
  await expect(login.otpCodeInput).toBeVisible();
  expect(await namelessControls(page), 'sign-in code').toEqual([]);
});

test('every field a vendor meets has a name, from signing in to applying', async ({
  page,
  request,
}) => {
  const { marketId, marketSlug } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject() },
  );
  const vendor = `vendor-${Date.now()}@example.com`;
  await page.goto(`/${marketSlug}/applicant-login?redirect=apply`);
  await expect(page.getByTestId('applicant-login-email-input')).toBeVisible();
  expect(await namelessControls(page), 'email step').toEqual([]);

  await page.getByTestId('applicant-login-email-input').fill(vendor);
  await page.getByTestId('applicant-login-request-btn').click();
  await expect(page.getByTestId('applicant-login-code-input')).toBeVisible();
  expect(await namelessControls(page), 'code step').toEqual([]);

  // Email is off on this stack, so the code the vendor would read is planted in its place.
  createApplicantLoginChallenge(marketId, vendor, '135790');
  await page.getByTestId('applicant-login-code-input').fill('135790');
  await page.getByTestId('applicant-login-verify-btn').click();
  await page.waitForURL(new RegExp(`/${marketSlug}/apply`));
  await expect(page.getByTestId('apply-form')).toBeVisible();
  expect(await namelessControls(page), 'the application form').toEqual([]);
});

test('"More…" is a menu that opens into its items and closes back to its button', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(marketId, 'applications'));
  const more = page.getByTestId('phase-rail-menu-button');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const items = menu.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThan(0);
  await expect(items.first()).toBeFocused();

  // Arrow keys walk the items; Escape closes the menu and hands focus back.
  if ((await items.count()) > 1) {
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('every field on every other organizer screen and dialog has a name', async ({
  authenticatedPage: page,
  request,
}) => {
  const published = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const named = async (where: string) => expect(await namelessControls(page), where).toEqual([]);

  await page.goto('/markets');
  await expect(page.getByTestId('markets-create-button')).toBeVisible();
  await named('the markets list');
  await page.getByTestId('markets-create-button').click();
  await expect(page.getByTestId('new-market-name-input')).toBeVisible();
  await named('the new-market dialog');
  await page.keyboard.press('Escape');

  await page.goto(`/markets?q=${encodeURIComponent(published.marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  await page.getByTestId('manage-market-add-user-button').click();
  await expect(page.getByTestId('manage-market-add-user-input')).toBeVisible();
  // Its Permissions section, open, and a row's confirmation (E39/F01/S04).
  await page.getByTestId('manage-market-permissions-toggle').click();
  await expect(page.getByTestId('manage-market-permission-select').first()).toBeVisible();
  // Its History section's filters, and an entry opened to its before and after (E40/F01/S03).
  await page.getByTestId('manage-market-history-toggle').click();
  await page.getByTestId('market-history-toggle').first().click();
  await expect(page.getByTestId('market-history-changes')).toBeVisible();
  await named('Manage market');
  await page.getByTestId('manage-market-permission-select').first().selectOption('owner');
  await expect(page.getByTestId('manage-market-permission-confirm-window')).toBeVisible();
  await named("a change to Manage market's permissions");
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/organizations');
  await page.getByTestId('organizations-manage-button').first().click();
  await expect(page.getByTestId('manage-org-window')).toBeVisible();
  // Its History section, an entry opened to its before and after (E40/F02/S01).
  await page.getByTestId('manage-org-history-toggle').click();
  await page.getByTestId('org-history-toggle').first().click();
  await expect(page.getByTestId('org-history-changes')).toBeVisible();
  await named('Manage organization');
  await page.keyboard.press('Escape');
  await page.getByTestId('organizations-create-button').click();
  await named('the new-organization dialog');
  await page.keyboard.press('Escape');

  for (const screen of ['assignments', 'vendors', 'attendance'] as const) {
    // With a filter set, so its chip and "Clear all" are walked too (E28/F02/S02).
    const filtered = screen === 'attendance' ? '' : '?choice=full';
    await page.goto(`${marketScreenPath(published.marketId, screen)}${filtered}`);
    await expect(page.getByTestId('market-bar-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await named(screen);
  }

  // The export, with "Placed" chosen so a seat's section, tier and size are walked too (E42/F01/S01).
  await page.goto(marketScreenPath(published.marketId, 'vendors'));
  await page.getByTestId('vendors-export-button').click();
  await expect(page.getByTestId('vendor-export-summary')).not.toBeEmpty();
  await page.getByTestId('vendor-export-placed').selectOption('placed');
  await named('the export dialog');
  await page.keyboard.press('Escape');

  // The placement history, opened with the run's entry in it (E35/F03/S03).
  const tables = new TablesPage(page);
  await tables.goto(published.marketId);
  await tables.openHistory();
  await expect(tables.historyEntries.first()).toBeVisible();
  await named('the placement history');
  await page.keyboard.press('Escape');

  await page.goto(`/${published.marketSlug}/check-in`);
  await page.waitForLoadState('networkidle');
  await named('the public check-in page');
});

test('every field of the import has a name', async ({ authenticatedPage: page, request }) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv' },
  );
  const importPage = new CsvImportPage(page);
  await page.goto(marketScreenPath(marketId, 'import'));
  await importPage.chooseFile(
    [
      'Timestamp,Email Address,Which days can you attend?,Rank the sections [Main Hall],Rank the sections [Garden]',
      '2026/05/02 9:14:03,nadia@ember.test,Saturday one,1st,2nd',
    ].join('\n'),
  );
  await expect(importPage.columnRows.first()).toBeVisible();
  await importPage.targetSelectAt(2).selectOption('essential_available_dates');
  expect(await namelessControls(page), 'the mapping step').toEqual([]);
});

test('the floorplan choice is a dialog', async ({ authenticatedPage: page, request }) => {
  // A draft with no sections yet, which is where the choice is offered.
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(marketId, 'setup'));
  await page.getByTestId('market-setup-choose-path-button').click();
  const dialog = page.getByRole('dialog', { name: 'Choose your setup path' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByTestId('choose-path-manual')).toBeVisible();
  await expect(dialog.getByTestId('choose-path-floorplan')).toBeVisible();
});

test('every field of the floorplan table types has a name, in the form and the dialog', async ({
  authenticatedPage: page,
  request,
}) => {
  // Max Capacity was a `<label>` tied to no control, so its choice had no name (T45).
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const floorplan = new FloorplanWorkflowPage(page);
  await floorplan.goto(marketId);
  await floorplan.reachTableTypes(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-floorplan.png'),
  );
  await floorplan.tableTypeAddBtn.click();
  await expect(page.getByRole('group', { name: 'Max Capacity' })).toBeVisible();
  expect(await namelessControls(page), 'the add form').toEqual([]);
  await floorplan.tableTypeCancelBtn.click();

  await floorplan.addTableType('Six-foot', '1800', '750');
  await floorplan.openTableTypeEdit('Six-foot');
  const dialog = page.getByRole('dialog', { name: 'Edit Table Type' });
  await expect(dialog.getByRole('group', { name: 'Max Capacity' })).toBeVisible();
  expect(await namelessControls(page), 'the Edit Table Type dialog').toEqual([]);
});

test('every control of the floorplan template dialogs has a name, the list and the confirm too', async ({
  authenticatedPage: page,
  request,
}) => {
  // One saved template, so Load Template has a list and a confirm view to walk (T45).
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const template = await seedFloorplanTemplate(request, BACKEND_URL, [
    { id: 'round', name: 'Round', widthMm: 1500, heightMm: 1500, maxCapacity: 2, color: '#4A90D9' },
  ]);
  const floorplan = new FloorplanWorkflowPage(page);
  await floorplan.goto(marketId);
  await floorplan.reachSaveStep(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-floorplan.png'),
  );

  await floorplan.templateSaveOpenBtn.click();
  await expect(floorplan.templateNameInput).toBeVisible();
  expect(await namelessControls(page), 'Save Template').toEqual([]);
  await page.keyboard.press('Escape');

  await floorplan.templateLoadOpenBtn.click();
  const card = floorplan.templateLoadWindow.getByRole('button', { name: new RegExp(template) });
  await expect(card).toBeVisible();
  expect(await namelessControls(page), 'Load Template, its list').toEqual([]);
  await card.click();
  await expect(page.getByRole('dialog', { name: 'Confirm Load' })).toBeVisible();
  expect(await namelessControls(page), 'Load Template, its confirm view').toEqual([]);
});

test('every control of a vendor notes panel has a name, wherever it opens', async ({
  authenticatedPage: page,
  request,
}) => {
  // A row carrying each kind of note (E31/F04/S04): the walk only sees what it seeds (bug 50).
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  mongoEval(
    `db.applications.updateOne({market_id:${JSON.stringify(seed.marketId)}, applicant_email:"alice@example.com"}, {$set:{"form_data.essential_request":"An extra chair"}}); db.vendor_notes.insertOne({market_id:${JSON.stringify(seed.marketId)}, vendor_email:"alice@example.com", note:"Chair set aside", from_sheet:"Paid"})`,
  );

  await page.goto(marketScreenPath(seed.marketId, 'attendance'));
  await page.getByTestId('attendance-notes-alice@example.com-summary').click();
  await expect(page.getByTestId('attendance-notes-alice@example.com-sheet')).toBeVisible();
  expect(await namelessControls(page), 'the door, with notes open').toEqual([]);

  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=alice%40example.com`);
  await expect(page.getByTestId('vendors-detail-notes-sheet')).toBeVisible();
  // Every tab of the drawer, each its own controls (E35/F01/S01).
  for (const tab of ['application', 'assignments', 'history']) {
    await page.getByTestId(`vendor-drawer-tab-${tab}`).click();
    await expect(page.getByTestId(`vendor-drawer-panel-${tab}`)).toBeVisible();
    expect(await namelessControls(page), `a vendor's panel, ${tab}`).toEqual([]);
  }
});
