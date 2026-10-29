import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Stats tab (/markets/:marketId/stats): who applied, by status and by
 * the day each applied (E45/F01/S01), and a chart per choice question, narrowed to the approved or
 * the assigned (E45/F01/S02).
 */
export class StatsPage {
  readonly page: Page;
  readonly total: Locator;
  readonly none: Locator;
  readonly days: Locator;
  readonly answers: Locator;
  readonly questions: Locator;
  /** "N of M": how many of every application the charts count. */
  readonly amongCount: Locator;

  constructor(page: Page) {
    this.page = page;
    this.total = page.getByTestId('stats-applicants-total');
    this.none = page.getByTestId('stats-applicants-none');
    this.days = page.getByTestId('stats-day');
    this.answers = page.getByTestId('stats-answers');
    this.questions = page.getByTestId('stats-question');
    this.amongCount = page.getByTestId('stats-among-count');
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

  /** The switch's button for a group: `all`, `approved` or `assigned`. */
  among(group: 'all' | 'approved' | 'assigned'): Locator {
    return this.page.getByTestId(`stats-among-${group}`);
  }

  /** A choice question's card, by its form field key. */
  question(key: string): Locator {
    return this.page.locator(`[data-testid="stats-question"][data-key="${key}"]`);
  }

  /** A card's rows, in the order it lists them. */
  answerRows(key: string): Locator {
    return this.question(key).getByTestId('stats-answer');
  }

  /** The count of an option, or of `other` or `none`. */
  answerCount(key: string, answer: string): Locator {
    const value = answer === 'other' || answer === 'none' ? answer : `option:${answer}`;
    return this.question(key)
      .locator(`[data-testid="stats-answer"][data-value="${value}"]`)
      .getByTestId('stats-answer-count');
  }
}
