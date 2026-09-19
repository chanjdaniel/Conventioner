import { type Locator, type Page } from '@playwright/test';

/**
 * Page object for the Market Setup wizard view.
 * Covers wizard step navigation (Back/Next/Assign), the Discord webhook input,
 * and interactions with the setup wizard sub-components.
 */
export class MarketSetupPage {
  readonly page: Page;

  // Wizard navigation
  readonly assignButton: Locator;

  // Discord webhook
  readonly discordWebhookInput: Locator;

  // Page 0: Market Dates
  readonly datesAddButton: Locator;

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

    this.discordWebhookInput = page.getByTestId('market-setup-discord-webhook-input');

    this.datesAddButton = page.getByTestId('setup-dates-add-button');

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
    const publishConfirm = this.page.getByTestId('sweep-confirm-confirm');
    if (await publishConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await publishConfirm.click();
    }

    await this.page.getByTestId('phase-rail-current').waitFor({ state: 'visible' });
    await this.page
      .getByTestId('phase-rail-current')
      .filter({ hasText: expectedLabel })
      .waitFor({ timeout: 10000 });
  }

  async goto(): Promise<void> {
    await this.page.goto('/market-setup');
  }

  async clickAssign(): Promise<void> {
    await this.assignButton.click();
  }

  async isAssignEnabled(): Promise<boolean> {
    return await this.assignButton.isEnabled();
  }

  async fillDiscordWebhook(url: string): Promise<void> {
    await this.discordWebhookInput.fill(url);
  }

  // --- Page 0: Market Dates ---

  /** Add a new market date row and configure it. */
  /** A market date is a date. It used to also need a spreadsheet column chosen beside it. */
  async addMarketDate(date: string, index: number = 0): Promise<void> {
    await this.datesAddButton.click();
    const dateInput = this.page.getByTestId(`setup-dates-date-input-${index}`);
    await dateInput.waitFor({ state: 'visible' });
    await dateInput.fill(date);
  }

  /** Get a date input by row index. */
  getDateInput(index: number): Locator {
    return this.page.getByTestId(`setup-dates-date-input-${index}`);
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

  /** Set the max assignments per vendor. */
  async setMaxAssignmentsPerVendor(value: number): Promise<void> {
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
   * It used to wait for the wizard's Next button; the plan is one page now (E10/F02/S01), so the
   * thing to wait for is the one action it has.
   */
  async waitForWizard(): Promise<void> {
    await this.assignButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Wait for the Assign button to become enabled (all required options configured). */
  async waitForAssignEnabled(): Promise<void> {
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
