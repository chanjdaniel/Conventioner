import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the Markets list (MarketsView) and its finder: search, organization, phase and
 * sort, all held in the page's address (E25/F01/S01).
 */
export class MarketsPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly orgSelect: Locator;
  readonly sortSelect: Locator;
  readonly resultCount: Locator;
  readonly noMatch: Locator;
  readonly clearFiltersButton: Locator;
  readonly cardNames: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId('markets-search-input');
    this.orgSelect = page.getByTestId('markets-org-select');
    this.sortSelect = page.getByTestId('markets-sort-select');
    this.resultCount = page.getByTestId('markets-result-count');
    this.noMatch = page.getByTestId('markets-no-match');
    this.clearFiltersButton = page.getByTestId('markets-clear-filters-button');
    this.cardNames = page.getByTestId('market-card-name');
  }

  async goto(query = ''): Promise<void> {
    await this.page.goto(`/markets${query}`);
    await expect(this.searchInput).toBeVisible();
  }

  phaseToggle(phase: string): Locator {
    return this.page.getByTestId(`markets-phase-toggle-${phase}`);
  }

  /** The phases the filter offers a toggle for, in the order shown. */
  async offeredPhases(): Promise<string[]> {
    const ids = await this.page
      .locator('[data-testid^="markets-phase-toggle-"]')
      .evaluateAll((toggles) => toggles.map((toggle) => toggle.getAttribute('data-testid') ?? ''));
    return ids.map((id) => id.replace('markets-phase-toggle-', ''));
  }

  /** The phase toggles pressed: none means every phase. */
  get pressedPhases(): Locator {
    return this.page.locator('[data-testid^="markets-phase-toggle-"][aria-pressed="true"]');
  }

  /** The market names on show, in the order shown. */
  async expectNames(names: string[]): Promise<void> {
    await expect(this.cardNames).toHaveText(names);
  }

  /** One market's card, by its name. */
  card(name: string): Locator {
    return this.page.getByTestId('market-card').filter({ hasText: name });
  }

  async openMarket(name: string): Promise<void> {
    await this.card(name).click();
  }
}
