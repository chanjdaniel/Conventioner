import type { Locator } from '@playwright/test';

/**
 * Page object for a chooser of one person (T204), a `SearchPicker` holding one address: a field that
 * names who is chosen and finds another by typing part of their address.
 */
export class PersonChooser {
  readonly root: Locator;
  readonly field: Locator;
  readonly list: Locator;
  /** The rows the list draws, in its order. */
  readonly options: Locator;
  readonly more: Locator;

  /** `testid` is the picker's own, on the root whose `-input`, `-list` and `-option` it prefixes. */
  constructor(scope: { getByTestId(testid: string): Locator }, testid: string) {
    this.root = scope.getByTestId(testid);
    this.field = this.root.getByTestId(`${testid}-input`);
    this.list = this.root.getByTestId(`${testid}-list`);
    this.options = this.root.getByTestId(`${testid}-option`);
    this.more = this.root.getByTestId(`${testid}-more`);
  }

  /** The list's row for one address. */
  option(email: string): Locator {
    return this.options.and(this.root.locator(`[data-value="${email}"]`));
  }

  /** The addresses the list draws, sorted, its row for the one chosen among them. */
  async offered(): Promise<string[]> {
    const values = await this.options.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-value') ?? ''),
    );
    return values.sort();
  }

  /** Find one person by typing their whole address, and take the match with Enter. */
  async choose(email: string): Promise<void> {
    await this.field.fill(email);
    await this.option(email).waitFor();
    await this.field.press('Enter');
    await this.list.waitFor({ state: 'detached' });
  }
}
