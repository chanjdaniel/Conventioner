import type { Locator } from '@playwright/test';

/**
 * Page object for the reviewer picker (T204), wherever it is drawn: the chosen as chips above a
 * field that finds a person by typing part of their address.
 */
export class ReviewerChooser {
  readonly root: Locator;
  readonly field: Locator;
  readonly list: Locator;
  /** The rows the list draws, in its order. */
  readonly options: Locator;
  readonly more: Locator;
  /** Everyone chosen, in the order they were chosen. */
  readonly chips: Locator;

  constructor(scope: Locator) {
    this.root = scope.getByTestId('reviewer-picker');
    this.field = this.root.getByTestId('reviewer-picker-input');
    this.list = this.root.getByTestId('reviewer-picker-list');
    this.options = this.root.getByTestId('reviewer-picker-option');
    this.more = this.root.getByTestId('reviewer-picker-more');
    this.chips = this.root.getByTestId('reviewer-picker-chip');
  }

  /** One person's chip, there only while they are chosen. */
  chip(email: string): Locator {
    return this.chips.filter({ hasText: email });
  }

  /** The button that takes one person's chip away. */
  removeButton(email: string): Locator {
    return this.chip(email).getByTestId('reviewer-picker-chip-remove');
  }

  /** The list's row for one address. */
  option(email: string): Locator {
    return this.options.and(this.root.locator(`[data-value="${email}"]`));
  }

  /** Find each person by typing their whole address, and take the match with Enter. */
  async choose(...emails: string[]): Promise<void> {
    for (const email of emails) {
      await this.field.fill(email);
      await this.option(email).waitFor();
      await this.field.press('Enter');
      await this.chip(email).waitFor();
    }
  }

  /** Take these people off by their chips' buttons. */
  async remove(...emails: string[]): Promise<void> {
    for (const email of emails) {
      await this.removeButton(email).click();
      await this.chip(email).waitFor({ state: 'detached' });
    }
  }
}
