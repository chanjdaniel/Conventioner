import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Stats tab (/markets/:marketId/stats): who applied, a column a day (or
 * week) and the review as one split bar (E45/F01/S01, T201), and a chart per choice question,
 * narrowed to the approved or the assigned (E45/F01/S02); between them the room, the tables asked
 * against the plan's per day and per tier (T201), how full each section is each day (T201), where the
 * money stands and who has come each day (T201); above them the strip of tiles the phase chooses
 * (T201).
 */
export class StatsPage {
  readonly page: Page;
  /** The strip of tiles at the top, chosen by the phase; absent in draft. */
  readonly strip: Locator;
  readonly total: Locator;
  readonly none: Locator;
  /** "Counting…", while the figures are read. */
  readonly counting: Locator;
  /** The failure line, when the figures could not be read. */
  readonly error: Locator;
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
  /** The How full section: its table of sections against days. */
  readonly fill: Locator;
  /** The Money section: owed, paid and still owed, and a bar of paid against owed. */
  readonly money: Locator;
  readonly moneyBar: Locator;
  /** The Check-in section's rows, a market day each, in order. */
  readonly checkIn: Locator;
  readonly checkInRows: Locator;
  readonly answers: Locator;
  readonly questions: Locator;
  /** "N of M": how many of every application the charts count. */
  readonly amongCount: Locator;

  constructor(page: Page) {
    this.page = page;
    this.strip = page.getByTestId('stats-headlines');
    this.total = page.getByTestId('stats-applicants-total');
    this.none = page.getByTestId('stats-applicants-none');
    this.counting = page.getByTestId('stats-counting');
    this.error = page.getByTestId('stats-error');
    this.overTimePlot = page.getByTestId('stats-over-time-plot');
    this.overTimeColumns = page.getByTestId('stats-over-time-column');
    this.overTimeAxis = page.getByTestId('stats-over-time-axis');
    this.overTimeMost = page.getByTestId('stats-over-time-most');
    this.overTimeNumbers = page.getByTestId('stats-over-time-numbers');
    this.overTimeRows = page.getByTestId('stats-over-time-row');
    this.statusBar = page.getByTestId('stats-status-bar');
    this.statusBarParts = page.getByTestId('stats-status-bar-part');
    this.room = page.getByTestId('stats-room');
    this.fill = page.getByTestId('stats-fill');
    this.money = page.getByTestId('stats-money');
    this.moneyBar = page.getByTestId('stats-money-bar-bar');
    this.checkIn = page.getByTestId('stats-check-in');
    this.checkInRows = page.getByTestId('stats-check-in-row');
    this.answers = page.getByTestId('stats-answers');
    this.questions = page.getByTestId('stats-question');
    this.amongCount = page.getByTestId('stats-among-count');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'stats'));
  }

  /**
   * A tile of the strip: `applied`, `open`, `asked`, `used`, `unassigned`, `stillOwed`,
   * `checkedIn`, `notYet`, `came` or `paid`.
   */
  headline(id: string): Locator {
    return this.page.getByTestId(`stats-headline-${id}`);
  }

  /** A tile's figure: "4", "$117.50". */
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

  /** A How full row's cells, by section or `total`: each its figures ("28/30") and its step. */
  async fillCells(section: string): Promise<[string, string][]> {
    const row =
      section === 'total'
        ? this.fill.getByTestId('stats-fill-total')
        : this.fill.locator(`[data-testid="stats-fill-row"][data-key="${section}"]`);
    return row
      .locator('td')
      .evaluateAll((cells) =>
        cells.map((cell) => [
          cell.querySelector('[data-testid="stats-fill-figures"]')?.textContent?.trim() ?? '',
          cell.getAttribute('data-step') ?? '',
        ]),
      ) as Promise<[string, string][]>;
  }

  /** A Money figure, its label over its amount: `owed`, `paid` or `stillOwed`. */
  moneyFigure(id: 'owed' | 'paid' | 'stillOwed'): Locator {
    return this.money.getByTestId(`stats-money-${id}`);
  }

  /** A market day's Check-in row, by its date. */
  checkInRow(date: string): Locator {
    return this.page.locator(`[data-testid="stats-check-in-row"][data-key="${date}"]`);
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
