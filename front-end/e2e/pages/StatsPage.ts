import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Stats tab (/markets/:marketId/stats): who applied, a column a day (or
 * week) and the review as one split bar (E45/F01/S01, T201), and a chart per choice question,
 * narrowed to the approved or the assigned (E45/F01/S02); between them the room, the tables asked
 * against the plan's per day and per tier (T201); above them the placement and money
 * headlines (E45/F01/S03).
 */
export class StatsPage {
  readonly page: Page;
  readonly total: Locator;
  readonly none: Locator;
  /** The chart of applications over time: its image, columns, axis, top mark and numbers. */
  readonly overTimePlot: Locator;
  readonly overTimeColumns: Locator;
  readonly overTimeAxis: Locator;
  readonly overTimeMost: Locator;
  readonly overTimeNumbers: Locator;
  readonly overTimeRows: Locator;
  /** The review's split bar, hidden from a screen reader, and the parts drawn in it. */
  readonly statusBar: Locator;
  readonly statusBarParts: Locator;
  /** The Room section: its cards, `days` and `tiers`. */
  readonly room: Locator;
  readonly answers: Locator;
  readonly questions: Locator;
  /** "N of M": how many of every application the charts count. */
  readonly amongCount: Locator;

  constructor(page: Page) {
    this.page = page;
    this.total = page.getByTestId('stats-applicants-total');
    this.none = page.getByTestId('stats-applicants-none');
    this.overTimePlot = page.getByTestId('stats-over-time-plot');
    this.overTimeColumns = page.getByTestId('stats-over-time-column');
    this.overTimeAxis = page.getByTestId('stats-over-time-axis');
    this.overTimeMost = page.getByTestId('stats-over-time-most');
    this.overTimeNumbers = page.getByTestId('stats-over-time-numbers');
    this.overTimeRows = page.getByTestId('stats-over-time-row');
    this.statusBar = page.getByTestId('stats-status-bar');
    this.statusBarParts = page.getByTestId('stats-status-bar-part');
    this.room = page.getByTestId('stats-room');
    this.answers = page.getByTestId('stats-answers');
    this.questions = page.getByTestId('stats-question');
    this.amongCount = page.getByTestId('stats-among-count');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'stats'));
  }

  /** A headline at the top of the page: `used`, `free`, `unassigned`, `owed`, `paid`, `stillOwed`. */
  headline(id: string): Locator {
    return this.page.getByTestId(`stats-headline-${id}`);
  }

  /** A headline's figure: "4", "$117.50". */
  headlineFigure(id: string): Locator {
    return this.headline(id).getByTestId('stats-headline-figure');
  }

  /** A status's legend line, by the All view filter it opens: `undecided`, `reviewer_approved`, ... */
  status(filter: string): Locator {
    return this.page.locator(`[data-testid="stats-status"][data-value="${filter}"]`);
  }

  statusCount(filter: string): Locator {
    return this.status(filter).getByTestId('stats-status-count');
  }

  /** A Room card: `days` or `tiers`. */
  roomCard(id: 'days' | 'tiers'): Locator {
    return this.page.getByTestId(`stats-room-${id}`);
  }

  /** A Room card's rows, in order, each a label, its words and its bar. */
  roomRows(id: 'days' | 'tiers'): Locator {
    return this.roomCard(id).getByTestId('stats-room-row');
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
