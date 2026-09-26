import { type Locator, type Page } from '@playwright/test';
import { marketSetupPath } from '../helpers/marketScreens';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Page object for the Market Setup wizard view.
 * Covers wizard step navigation (Back/Next/Assign),
 * and interactions with the setup wizard sub-components.
 */
export class MarketSetupPage {
  readonly page: Page;

  // Wizard navigation
  readonly assignButton: Locator;

  // Page 1: Path choice overlay
  readonly choosePathButton: Locator;
  readonly choosePathManualCard: Locator;

  // Page 1: Locations
  readonly locationAddButton: Locator;

  // Page 1: Sections
  readonly sectionAddButton: Locator;

  // Page 2: Assignment Options
  readonly optionsMaxAssignmentsInput: Locator;
  readonly optionsMaxProportionInput: Locator;

  // Tabs: the view hosts the setup wizard, the form builder and the application monitor
  readonly setupTab: Locator;
  readonly formTab: Locator;
  readonly applicationsTab: Locator;
  readonly importButton: Locator;

  // Phase control panel, above the tabs
  readonly phaseControlPanel: Locator;
  readonly currentPhase: Locator;
  readonly phaseBlockers: Locator;

  readonly assignError: Locator;
  /** Why Assign is unavailable in this market's phase (E10/F03/S02). */
  readonly assignPhaseHint: Locator;

  constructor(page: Page) {
    this.page = page;

    this.assignButton = page.getByTestId('market-setup-assign-button');

    this.choosePathButton = page.getByTestId('market-setup-choose-path-button');
    this.choosePathManualCard = page.getByTestId('choose-path-manual');

    this.locationAddButton = page.getByTestId('setup-location-add-button');

    this.sectionAddButton = page.getByTestId('setup-section-add-button');
    this.optionsMaxAssignmentsInput = page.getByTestId('setup-options-max-assignments-input');
    this.optionsMaxProportionInput = page.getByTestId('setup-options-max-proportion-input');

    this.setupTab = page.getByTestId('market-setup-setup-tab');
    this.formTab = page.getByTestId('market-setup-form-tab');
    this.applicationsTab = page.getByTestId('market-setup-applications-tab');
    this.importButton = page.getByTestId('market-setup-import-button');

    this.phaseControlPanel = page.getByTestId('phase-rail');
    this.currentPhase = page.getByTestId('phase-rail-current');
    this.phaseBlockers = page.getByTestId('phase-rail-blockers');

    this.assignError = page.getByTestId('market-setup-assign-error');
    this.assignPhaseHint = page.getByTestId('market-setup-assign-phase-hint');
  }

  // --- Tabs ---

  async openSetupTab(): Promise<void> {
    await this.setupTab.click();
  }

  async openApplicationsTab(): Promise<void> {
    await this.applicationsTab.click();
  }

  /** Leave for the CSV import flow, the way the organizer does: from the Applications tab. */
  async startCsvImport(): Promise<void> {
    await this.importButton.click();
    await this.page.waitForURL('**/import-applications');
  }

  // --- Phase control ---

  /**
   * Move the market to a phase, and wait for the panel to say it got there.
   *
   * `expectedLabel` is the phase as the organizer reads it, not the stored value: asserting on it
   * is what turns a refused transition into a failure that names the phase rather than a timeout
   * somewhere later.
   */
  /**
   * Fire a transition from the rail.
   *
   * Only the one step onward sits on the rail itself; back and destructive edges are behind the
   * overflow menu (E10/F01/S01), so this opens it when the step it wants is not on show.
   */
  async clickTransition(toPhase: string): Promise<void> {
    const action = this.page.getByTestId(`phase-transition-${toPhase}`);
    if (!(await action.isVisible().catch(() => false))) {
      await this.page.getByTestId('phase-rail-menu-button').click();
    }
    await action.click();
  }

  async advancePhaseTo(toPhase: string, expectedLabel: string): Promise<void> {
    await this.clickTransition(toPhase);

    // Publishing confirms, because it is one of the two edges with no route back: it puts a
    // public check-in page on the air.
    const publishConfirm = this.page.getByTestId('sweep-confirm-submit-button');
    if (await publishConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await publishConfirm.click();
    }

    await this.page.getByTestId('phase-rail-current').waitFor({ state: 'visible' });
    await this.page
      .getByTestId('phase-rail-current')
      .filter({ hasText: expectedLabel })
      .waitFor({ timeout: 10000 });
  }

  /**
   * The PLAN, named explicitly.
   *
   * A market's bare setup URL opens the surface its phase is worked on (E18/F02/S02), so
   * a page object whose other helpers all edit the plan has to say which surface it wants.
   */
  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketSetupPath(marketId, 'setup'));
  }

  /**
   * Assign lives on the ASSIGNMENT surface now (E18/F02/S04), not on the plan - it is refused
   * outside the assignment phase, so a permanently disabled button beside the dates explained a
   * rule instead of applying it.
   */
  async gotoAssignment(): Promise<void> {
    // Click the tab rather than navigating: a hard `goto` reloads the app and drops whatever the
    // debounced plan save has not written yet, which an organizer switching tabs never does.
    await this.page.getByTestId('market-setup-assignment-tab').click();
    await this.assignButton.waitFor({ state: 'visible', timeout: 15000 });
  }

  async clickAssign(): Promise<void> {
    if (!(await this.assignButton.isVisible())) await this.gotoAssignment();
    await this.assignButton.click();
  }

  async isAssignEnabled(): Promise<boolean> {
    if (!(await this.assignButton.isVisible())) await this.gotoAssignment();
    return await this.assignButton.isEnabled();
  }

  // --- Page 0: Market Dates ---

  /**
   * Choose a market day on the calendar.
   *
   * A market date is a date. It used to also need a spreadsheet column chosen beside it, and then
   * a row with an invisible native date input laid across it - the calendar replaced both
   * (E18/F01/S02), so this walks to the month and clicks the day.
   */
  async addMarketDate(date: string): Promise<void> {
    const [year, month] = date.split('-').map(Number);
    const wanted = `${MONTH_NAMES[month - 1]} ${year}`;
    const shown = this.page.getByTestId('setup-dates-month');
    await shown.waitFor({ state: 'visible', timeout: 15000 });

    // Step rather than jump: the control has no month picker, which is what an organizer has too.
    for (let guard = 0; guard < 60; guard += 1) {
      const now = (await shown.innerText()).trim();
      if (now === wanted) break;
      const [shownMonth, shownYear] = now.split(' ');
      const forward =
        Number(shownYear) < year ||
        (Number(shownYear) === year && MONTH_NAMES.indexOf(shownMonth) < month - 1);
      await this.page
        .getByTestId(forward ? 'setup-dates-next-month' : 'setup-dates-prev-month')
        .click();
    }

    await this.page.getByTestId(`setup-dates-day-${date}`).click();
  }

  /** Get a date column select by row index. */
  getDateColumnSelect(index: number): Locator {
    return this.page.getByTestId(`setup-dates-column-select-${index}`);
  }

  // --- Page 1: Path choice ---

  /** Select the Manual Setup path from the ChoosePathOverlay. */
  /**
   * Say that this market's sections are described by hand.
   *
   * The overlay used to open by itself on the wizard's sections page. On the one-page plan
   * editor (E10/F02/S01) it is offered from the Section Setup card instead, because an overlay
   * that opens by itself covers the dates the organizer is in the middle of typing. Describing
   * them by hand is what happens if nobody opens it at all, so this is a no-op when the offer is
   * already gone.
   */
  async selectManualPath(): Promise<void> {
    if (!(await this.choosePathButton.isVisible().catch(() => false))) return;
    await this.choosePathButton.click();
    await this.choosePathManualCard.click();
    await this.choosePathManualCard.waitFor({ state: 'hidden' }).catch(() => {});
  }

  // --- Page 1: Locations ---

  /** Add a new location with the given name. */
  /**
   * Name a tier.
   *
   * Tiers used to arrive pre-filled, scraped from the uploaded spreadsheet's cell values. There
   * is no spreadsheet behind a market any more and a tier is the organizer's own decision, so
   * every test that needs one names it.
   */
  async addTier(name: string, index: number = 0): Promise<void> {
    await this.page.getByTestId('setup-tier-add-button').click();
    const nameInput = this.page.getByTestId(`setup-tier-name-input-${index}`);
    await nameInput.waitFor({ state: 'visible' });
    await nameInput.fill(name);
  }

  async addLocation(name: string, index: number = 0): Promise<void> {
    await this.locationAddButton.click();
    const nameInput = this.page.getByTestId(`setup-location-name-input-${index}`);
    await nameInput.waitFor({ state: 'visible' });
    await nameInput.fill(name);
  }

  /** Get a location name input by row index. */
  getLocationNameInput(index: number): Locator {
    return this.page.getByTestId(`setup-location-name-input-${index}`);
  }

  // --- Page 1: Sections ---

  /** Add a new section row and configure it. */
  async addSection(
    name: string,
    locationOptionLabel: string,
    tierOptionLabel: string,
    count: number,
    index: number = 0,
  ): Promise<void> {
    await this.sectionAddButton.click();
    const nameInput = this.page.getByTestId(`setup-section-name-input-${index}`);
    await nameInput.waitFor({ state: 'visible' });
    await nameInput.fill(name);
    await this.page
      .getByTestId(`setup-section-location-select-${index}`)
      .selectOption({ label: locationOptionLabel });
    // Resolve the tier option matching the requested label, then select by index.
    // Index-based selection preserves the bound TierObject reference (with its id field);
    // index 0 is the disabled placeholder ("Select a tier"), so real options start at 1.
    const tierSelect = this.page.getByTestId(`setup-section-tier-select-${index}`);
    const tierOptionIndex = await tierSelect
      .locator('option')
      .evaluateAll(
        (options, label) =>
          options.findIndex((option) => (option.textContent ?? '').trim() === label),
        tierOptionLabel,
      );
    if (tierOptionIndex < 1) {
      throw new Error(`Tier option "${tierOptionLabel}" not found in section tier select`);
    }
    await tierSelect.selectOption({ index: tierOptionIndex });
    await this.page.getByTestId(`setup-section-count-input-${index}`).fill(String(count));
  }

  /** Get a section name input by row index. */
  getSectionNameInput(index: number): Locator {
    return this.page.getByTestId(`setup-section-name-input-${index}`);
  }

  /** Get a section location select by row index. */
  getSectionLocationSelect(index: number): Locator {
    return this.page.getByTestId(`setup-section-location-select-${index}`);
  }

  /** Get a section tier select by row index. */
  getSectionTierSelect(index: number): Locator {
    return this.page.getByTestId(`setup-section-tier-select-${index}`);
  }

  /** Get a section count input by row index. */
  getSectionCountInput(index: number): Locator {
    return this.page.getByTestId(`setup-section-count-input-${index}`);
  }

  // --- Page 2: Assignment Options ---

  /**
   * Set the max assignments per vendor.
   *
   * Assignment Options moved to the assignment surface with Assign (E18/F02/S04), so this goes
   * there if it is not already looking at it - a priority rule names a form field, and neither
   * card can be filled in meaningfully while a market is still being planned.
   */
  async setMaxAssignmentsPerVendor(value: number): Promise<void> {
    if (!(await this.optionsMaxAssignmentsInput.isVisible())) await this.gotoAssignment();
    await this.optionsMaxAssignmentsInput.fill(String(value));
  }

  /** Set the max half table proportion per section. */
  async setMaxHalfTableProportion(value: number): Promise<void> {
    await this.optionsMaxProportionInput.fill(String(value));
  }

  // --- Plan editor helpers ---

  /**
   * Wait for the plan editor to be on screen.
   *
   * It used to wait for the wizard's Next button; the plan is one page now (E10/F02/S01). It then
   * waited for Assign, which left the plan for the assignment surface (E18/F02/S04). What it waits
   * for now is the first thing the plan asks for: the calendar of market days (E18/F01/S02).
   */
  async waitForWizard(): Promise<void> {
    await this.page.getByTestId('setup-dates-month').waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Wait for the Assign button to become enabled (all required options configured). */
  async waitForAssignEnabled(): Promise<void> {
    if (!(await this.assignButton.isVisible())) await this.gotoAssignment();
    await this.assignButton.waitFor({ state: 'visible', timeout: 5000 });
    // The button should not be disabled
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="market-setup-assign-button"]',
        ) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      { timeout: 10000 },
    );
  }
}
