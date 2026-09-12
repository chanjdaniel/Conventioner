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

  /** The checkbox for one offered market date (ISO string). */
  dateCheckbox(date: string): Locator {
    return this.page.getByTestId(`apply-essential-date-${date}`);
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

  tableTypeRankName(index: number): Locator {
    return this.page.getByTestId(`apply-essential-table-type-rank-name-${index}`);
  }

  tableTypeRankUp(index: number): Locator {
    return this.page.getByTestId(`apply-essential-table-type-rank-up-${index}`);
  }

  tableTypeRankDown(index: number): Locator {
    return this.page.getByTestId(`apply-essential-table-type-rank-down-${index}`);
  }
}
