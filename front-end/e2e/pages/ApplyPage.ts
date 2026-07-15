import type { Locator, Page } from '@playwright/test'

/** The application form page: `/:marketSlug/apply`. Requires applicant sign-in; redirects to login otherwise. */
export class ApplyPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}/apply`)
  }

  get form(): Locator {
    return this.page.getByTestId('apply-form')
  }

  get marketName(): Locator {
    return this.page.getByTestId('apply-market-name')
  }

  input(key: string): Locator {
    return this.page.getByTestId(`apply-input-${key}`)
  }

  async fillField(key: string, value: string) {
    await this.input(key).fill(value)
  }

  get submitButton(): Locator {
    return this.page.getByTestId('apply-submit-button')
  }

  async submit() {
    await this.submitButton.click()
  }

  get error(): Locator {
    return this.page.getByTestId('apply-error')
  }
}
