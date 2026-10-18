import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the organizer's Attendance page (/markets/:marketId/attendance): one market date
 * at a time, every vendor expected that day, and who has come (E29/F01).
 */
export class AttendanceStatusPage {
  readonly page: Page;
  readonly summary: Locator;
  readonly rows: Locator;
  readonly search: Locator;

  constructor(page: Page) {
    this.page = page;
    this.summary = page.getByTestId('attendance-summary');
    this.rows = page.getByTestId('attendance-row');
    this.search = page.getByTestId('attendance-search');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'attendance'));
  }

  /** The tab for one market date. */
  date(date: string): Locator {
    return this.page.getByTestId(`attendance-date-${date}`);
  }

  /** One vendor's row on the date shown. */
  row(vendorEmail: string): Locator {
    return this.page.locator(`[data-testid="attendance-row"][data-vendor="${vendorEmail}"]`);
  }

  /** "Not yet", or when they checked in and who made it. */
  status(vendorEmail: string): Locator {
    return this.row(vendorEmail).getByTestId('attendance-row-status');
  }

  async show(which: 'all' | 'not-yet' | 'here'): Promise<void> {
    await this.page.getByTestId(`attendance-show-${which}`).click();
  }

  async checkIn(vendorEmail: string): Promise<void> {
    await this.row(vendorEmail).getByTestId('attendance-check-in').click();
  }

  async undo(vendorEmail: string): Promise<void> {
    await this.row(vendorEmail).getByTestId('attendance-undo').click();
  }
}
