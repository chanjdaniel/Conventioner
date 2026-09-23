import type { Locator, Page } from '@playwright/test';

/** The application form page: `/:marketSlug/apply`. Requires applicant sign-in; redirects to login otherwise. */
export class ApplyPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}/apply`);
  }

  get form(): Locator {
    return this.page.getByTestId('apply-form');
  }

  get marketName(): Locator {
    return this.page.getByTestId('apply-market-name');
  }

  input(key: string): Locator {
    return this.page.getByTestId(`apply-input-${key}`);
  }

  async fillField(key: string, value: string) {
    await this.input(key).fill(value);
  }

  get submitButton(): Locator {
    return this.page.getByTestId('apply-submit-button');
  }

  async submit() {
    await this.submitButton.click();
  }

  get error(): Locator {
    return this.page.getByTestId('apply-error');
  }

  // ── Essential fields ─────────────────────────────────────────────────

  get essentialFields(): Locator {
    return this.page.getByTestId('apply-essential-fields');
  }

  get essentialEmail(): Locator {
    return this.page.getByTestId('apply-essential-email');
  }

  /** Identity, asked of every applicant whatever the market plan offers (E13/F01/S01). */
  get fullNameInput(): Locator {
    return this.page.getByTestId('apply-essential-full-name-input');
  }

  /**
   * The row for one offered market date.
   *
   * Availability is no longer its own question (E19/F01/S02): an organizer's own form has always
   * asked it as one grid - tiers per day, or "not available" - so availability is derived from the
   * tier answer rather than asked beside it.
   */
  dateRow(date: string): Locator {
    return this.page.getByTestId(`apply-essential-tier-day-${date}`);
  }

  /** Say that this is a day the applicant cannot attend. */
  notAvailableCheckbox(date: string): Locator {
    return this.page.getByTestId(`apply-essential-unavailable-${date}`);
  }

  /**
   * The words naming that day: the date as the applicant reads it. Asserted whole, so a second
   * year appended to it is a failure - which a `toContainText` on a substring is not
   * (E14/F01/S01).
   */
  dateLabel(date: string): Locator {
    return this.dateRow(date).locator('.essential-tier-day-label');
  }

  /**
   * Tier is a hard filter AND it sets the price, so it is answered per date (E01/F05): a checkbox
   * per (date, tier), in a row for each date the applicant ticked above.
   */
  tierCheckbox(date: string, tier: string): Locator {
    return this.page.getByTestId(`apply-essential-tier-${date}-${tier}`);
  }

  /** Table choice is a radio over the three fixed ways a table can be occupied. */
  tableChoiceRadio(value: 'full' | 'half' | 'either'): Locator {
    return this.page.getByTestId(`apply-essential-table-choice-${value}`);
  }

  get tableShareEmailInput(): Locator {
    return this.page.getByTestId('apply-essential-table-share-email-input');
  }

  get maxDatesInput(): Locator {
    return this.page.getByTestId('apply-essential-max-dates-input');
  }

  sectionRankName(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-name-${index}`);
  }

  sectionRankUp(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-up-${index}`);
  }

  sectionRankDown(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-down-${index}`);
  }
}
