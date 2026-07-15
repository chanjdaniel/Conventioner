import type { Locator, Page } from '@playwright/test';

/** Where an applicant reads their own application back, and edits it while the market is open. */
export class ApplicantDashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}/applicant/dashboard`);
  }

  get view(): Locator {
    return this.page.getByTestId('applicant-dashboard-page');
  }

  get editForm(): Locator {
    return this.page.getByTestId('applicant-dashboard-edit');
  }

  /** The banner an application that exists but has never been saved carries. */
  get unsubmittedNotice(): Locator {
    return this.page.getByTestId('applicant-dashboard-unsubmitted');
  }

  /** The saved answer the server has, as the applicant reads it back. */
  field(key: string): Locator {
    return this.page.getByTestId(`applicant-dashboard-field-${key}`);
  }

  get editButton(): Locator {
    return this.page.getByTestId('applicant-dashboard-edit-btn');
  }

  editInput(key: string): Locator {
    return this.page.getByTestId(`applicant-dashboard-edit-input-${key}`);
  }

  get saveButton(): Locator {
    return this.page.getByTestId('applicant-dashboard-save-btn');
  }

  get cancelButton(): Locator {
    return this.page.getByTestId('applicant-dashboard-cancel-btn');
  }

  async startEditing() {
    await this.editButton.click();
    await this.editForm.waitFor();
  }
}
