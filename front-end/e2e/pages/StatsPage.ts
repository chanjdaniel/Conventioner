import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Stats tab (/markets/:marketId/stats): who applied, by status and by
 * the day each applied (E45/F01/S01).
 */
export class StatsPage {
  readonly page: Page;
  readonly total: Locator;
  readonly none: Locator;
  readonly days: Locator;

  constructor(page: Page) {
    this.page = page;
    this.total = page.getByTestId('stats-applicants-total');
    this.none = page.getByTestId('stats-applicants-none');
    this.days = page.getByTestId('stats-day');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'stats'));
  }

  /** A status's row, by the All view filter it opens: `undecided`, `reviewer_approved`, ... */
  status(filter: string): Locator {
    return this.page.locator(`[data-testid="stats-status"][data-value="${filter}"]`);
  }

  statusCount(filter: string): Locator {
    return this.status(filter).getByTestId('stats-status-count');
  }

  /** The day's row, as the ledger lists them, earliest first. */
  dayCount(index: number): Locator {
    return this.days.nth(index).getByTestId('stats-day-count');
  }
}
