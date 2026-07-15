import type { Locator, Page } from '@playwright/test';

/** The public application page: `/:marketSlug/apply`, reachable with no account and no session. */
export class ApplyPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}/apply`);
    await this.form.waitFor();
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

  /** Shown only after the answers have reached the server. */
  get savedBanner(): Locator {
    return this.page.getByTestId('apply-saved');
  }

  /**
   * Shown when answers typed in this browser before anyone signed in have been put back into the
   * form. The page restores them - they are almost always this applicant's - but it cannot know who
   * typed them, so it says so and will not submit them for anybody.
   */
  get draftNotice(): Locator {
    return this.page.getByTestId('apply-draft-notice');
  }

  async clearRestoredDraft() {
    await this.page.getByTestId('apply-draft-clear-button').click();
  }

  /**
   * Shown when answers typed on this device before anyone signed in meet an application that is
   * already saved. Either one of them may be this applicant's and the product cannot tell which, so
   * it changes neither and asks.
   */
  get draftChoice(): Locator {
    return this.page.getByTestId('apply-draft-choice');
  }

  /** "They're mine": the typed answers go into the form. Still nothing is sent. */
  async useTypedAnswers() {
    await this.page.getByTestId('apply-draft-choice-use-button').click();
  }

  /** "Keep my saved answers": the typed answers are discarded, by the one person entitled to. */
  async keepSavedAnswers() {
    await this.page.getByTestId('apply-draft-choice-keep-saved-button').click();
  }
}
