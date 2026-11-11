import type { Locator, Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';

/**
 * Page object for the Payments page (`/markets/:marketId/payments`): its toolbar, the market's
 * figures, and the vendors' table in its list frame.
 */
export class PaymentsPage {
  readonly page: Page;

  readonly search: Locator;
  readonly summary: Locator;
  readonly noneShown: Locator;
  /** "Loading vendors…", where the list stands until the vendors' names are read. */
  readonly vendorsLoading: Locator;
  readonly rows: Locator;
  /** "Showing 50 of 120": there only while the cap leaves rows off. */
  readonly listCount: Locator;
  readonly showMore: Locator;
  /** The table's four headings, each a sort. */
  readonly sortButtons: Locator;

  constructor(page: Page) {
    this.page = page;

    this.search = page.getByTestId('payments-search');
    this.summary = page.getByTestId('payments-summary');
    this.noneShown = page.getByTestId('payments-none-shown');
    this.vendorsLoading = page.getByTestId('payments-vendors-loading');
    this.rows = page.getByTestId('payments-row');
    this.listCount = page.getByTestId('payments-list-count');
    this.showMore = page.getByTestId('payments-list-more');
    this.sortButtons = page.locator('[data-testid^="payments-sort-"]');
  }

  async goto(marketId: string, query = ''): Promise<void> {
    await this.page.goto(`${marketScreenPath(marketId, 'payments')}${query}`);
    await this.rows.first().waitFor();
  }

  /** One of the four figures that head the page: `owedCents`, `paidCents` and so on. */
  total(figure: string): Locator {
    return this.page.getByTestId(`payments-total-${figure}`);
  }

  /** The "Show only" filter for `owes`, `paid` or `over`. */
  filter(state: 'owes' | 'paid' | 'over'): Locator {
    return this.page.getByTestId(`payments-show-${state}`);
  }

  sort(column: 'vendor' | 'owed' | 'paid' | 'difference'): Locator {
    return this.page.getByTestId(`payments-sort-${column}`);
  }

  /** The heading the table is sorted by, which says which way. */
  columnSortedBy(order: 'ascending' | 'descending'): Locator {
    return this.page.getByTestId('payments-list').locator(`th[aria-sort="${order}"]`);
  }

  /** On the open drawer's Payment tab: records a payment, the rest of its form as it opens. */
  async recordPayment(amount: string): Promise<void> {
    await this.page.getByTestId('payment-record').click();
    const dialog = this.page.getByTestId('record-payment-window');
    await dialog.waitFor();
    await this.page.getByTestId('record-payment-amount').fill(amount);
    await this.page.getByTestId('record-payment-submit-button').click();
    await dialog.waitFor({ state: 'hidden' });
  }

  async closeDrawer(): Promise<void> {
    const close = this.page.getByTestId('vendors-detail-close');
    await close.click();
    await close.waitFor({ state: 'hidden' });
  }
}
