import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApplication } from './helpers/seedApplication';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { marketScreenPath, marketSetupPath, oneByOnePath } from './helpers/marketScreens';

/**
 * What a market's screens say, and when (E31; map `what-to-show-and-when`).
 *
 * The walk of 2026-10-18 found every screen offering what the market could not do yet and
 * refusing only after the click, a CSV market wearing the form path's words for steps no vendor
 * sees, a bar that changed shape as the market moved, and a setup editable through market days.
 */
test.describe('What to show, and when', () => {
  test('an empty draft is told what is missing before the click, and where to fix it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    await page.goto(marketSetupPath(marketId, 'form'));

    // The step onward is drawn, and refused in words before anyone tries it.
    await expect(page.getByTestId('phase-transition-applications_open')).toBeDisabled();
    const next = page.getByTestId('phase-rail-next');
    await expect(next).toContainText('To open applications: This market has no market dates.');
    // Its fix is the rail's main button (E32/F01/S02).
    const fix = page.getByTestId('phase-rail-fix');
    await expect(fix).toHaveText('Pick market dates');
    await fix.click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'setup'));
  });

  test('a CSV market speaks of its Google Form, and a form market of applications', async ({
    authenticatedPage: page,
    request,
  }) => {
    const csv = await seedDraftMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      intakeMode: 'csv',
    });
    await page.goto(marketSetupPath(csv.marketId, 'setup'));
    await expect(page.getByTestId('phase-transition-applications_open')).toHaveText(
      'Import responses',
    );
    await expect(page.getByTestId('market-bar-tab-form')).toHaveText('Questions');
    // Plan, Import, Review: the closed phase is stepped through, never a stage (E32/F02/S01).
    await expect(page.getByTestId('phase-rail-spine')).toContainText('Import');
    await expect(page.getByTestId('phase-rail-spine')).not.toContainText('Applications Open');
    await expect(page.getByTestId('phase-rail-spine')).not.toContainText('Form Closed');

    const form = await seedDraftMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      intakeMode: 'form',
    });
    await page.goto(marketSetupPath(form.marketId, 'setup'));
    await expect(page.getByTestId('phase-transition-applications_open')).toHaveText(
      'Open Applications',
    );
    await expect(page.getByTestId('market-bar-tab-form')).toHaveText('Application Form');
  });

  test('the bar keeps all five tabs, and one out of its phase says when it matters', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('market-bar-tab-attendance')).toBeVisible();

    await page.getByTestId('market-bar-tab-attendance').click();
    await expect(page.getByTestId('market-tab-note')).toHaveText(
      'Opens when the market is published.',
    );
    await page.getByTestId('market-bar-tab-applications').click();
    await expect(page.getByTestId('market-tab-note')).toHaveText(
      'Applications arrive here once they open.',
    );
  });

  test('past draft the setup is settled, and a form market imports nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-setup-settled')).toContainText(
      'The setup is settled: it cannot change once applications have opened',
    );
    // Nobody has applied, so the way back is named.
    await expect(page.getByTestId('plan-setup-settled')).toContainText('go back to draft');
    await expect(page.locator('fieldset.plan-body')).toHaveAttribute('disabled', '');

    await page.goto(marketSetupPath(marketId, 'form'));
    // A locked form opens on its review setup; its questions say why they are fixed (E33/F01/S03).
    await page.getByTestId('form-step-questions').click();
    await expect(page.getByTestId('form-builder-lock-banner')).toContainText(
      'The application form is fixed: it cannot change once applications have opened',
    );

    await page.goto(marketSetupPath(marketId, 'applications'));
    await expect(page.getByTestId('market-setup-applications-condition')).toBeVisible();
    await expect(page.getByTestId('market-setup-import-button')).toHaveCount(0);
  });

  test('past draft the floorplan flow says the setup is settled, and offers nothing to draw', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    // Reached by its address, the way a bookmark or the back button would.
    await page.goto(marketScreenPath(marketId, 'floorplan'));
    const settled = page.getByTestId('floorplan-settled');
    await expect(settled).toContainText('The setup is settled');
    await expect(page.getByTestId('floorplan-upload-dropzone')).toHaveCount(0);
    await settled.getByRole('button', { name: 'Back to Market Setup' }).click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'setup'));
  });

  test('each tab past its phase says why, in the words of its path', async ({
    authenticatedPage: page,
    request,
  }) => {
    // A CSV market, assigning: it never opened applications, it collected on its Google Form.
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-setup-settled')).toContainText(
      'The setup is settled: it cannot change once the market has moved on to importing',
    );
    await page.goto(marketSetupPath(marketId, 'form'));
    // A locked form opens on its review setup; its questions say why they are fixed (E33/F01/S03).
    await page.getByTestId('form-step-questions').click();
    await expect(page.getByTestId('form-builder-lock-banner')).toContainText(
      'The questions are fixed: they cannot change once the market has moved on to importing',
    );
    await page.goto(marketSetupPath(marketId, 'applications'));
    await expect(page.getByTestId('market-setup-applications-condition')).toContainText(
      'The review is closed: every verdict settled when the assignment began.',
    );
  });

  test('a move the server would refuse says why in the menu', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    seedApplication(marketId, 'someone@example.com');
    await page.goto(marketSetupPath(marketId, 'applications'));

    await page.getByTestId('phase-rail-menu-button').click();
    const reopen = page.getByTestId('phase-transition-draft');
    await expect(reopen).toHaveAttribute('aria-disabled', 'true');
    await expect(reopen.getByTestId('phase-transition-reason')).toContainText(
      'cannot return to draft',
    );
    // Pressed anyway, it does nothing: the move is not tried and refused, it is not offered.
    await reopen.click({ force: true });
    await expect(page.getByTestId('phase-rail-blockers')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open');
  });

  test('deciding the last application opens the way to assignment, with no reload', async ({
    authenticatedPage: page,
    request,
  }) => {
    // The rail's verdict is the market's as last read; a verdict is a write, so it re-reads it.
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    seedApplication(marketId, 'last@example.com');
    for (const phase of ['applications_closed', 'review']) {
      await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, phase);
    }
    await page.goto(oneByOnePath(marketId));
    const begin = page.getByTestId('phase-transition-assignment');
    await expect(begin).toBeDisabled();

    await new ApplicationMonitorPage(page).approve('last@example.com');

    await expect(begin).toBeEnabled();
  });

  test('before a run nothing is shown as assigned', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );
    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.getByTestId('result-empty')).toContainText('Nothing assigned yet');
    await expect(page.getByTestId('phase-rail-next')).toHaveText(
      /Set the rules and run the assignment\./,
    );
    await expect(page.getByTestId('phase-transition-market_days')).toBeDisabled();

    // Vendors says the same, rather than counting everyone as unassigned.
    await page.goto(marketScreenPath(marketId, 'vendors'));
    const empty = page.getByTestId('vendors-empty');
    await expect(empty).toContainText('Nothing assigned yet');
    await expect(page.getByTestId('vendors-summary')).toHaveText('2 vendors');
    await expect(page.getByTestId('vendors-list-item')).toHaveCount(2);
    await expect(page.getByTestId('vendor-date-count')).toHaveCount(0);
    await empty.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/assignment$`));
  });
});
