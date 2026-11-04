import type { Locator } from '@playwright/test';

/**
 * Page object for a `ChoiceField` (T223), which is a native select at 12 choices or fewer and a
 * `SearchPicker` past that, so a spec chooses the same way on a small seed and at real size.
 */
export class ChoiceField {
  /** The select itself, or the picker's root. */
  readonly root: Locator;
  /** The picker's field; a select has none. */
  readonly field: Locator;
  /** The picker's open list. */
  readonly list: Locator;
  /** The rows the picker's list draws, in its order. */
  readonly options: Locator;
  readonly more: Locator;
  /** What the picker's list says when the words find nothing. */
  readonly none: Locator;
  /** The chips of a `SearchPicker` of several, and the button on each that takes it away. */
  readonly chips: Locator;
  readonly chipRemoves: Locator;

  /** `testid` is the control's own, on the root whose `-input`, `-list` and `-option` it prefixes. */
  constructor(scope: { getByTestId(testid: string): Locator }, testid: string) {
    this.root = scope.getByTestId(testid);
    this.field = this.root.getByTestId(`${testid}-input`);
    this.list = this.root.getByTestId(`${testid}-list`);
    this.options = this.root.getByTestId(`${testid}-option`);
    this.more = this.root.getByTestId(`${testid}-more`);
    this.none = this.root.getByTestId(`${testid}-none`);
    this.chips = this.root.getByTestId(`${testid}-chip`);
    this.chipRemoves = this.root.getByTestId(`${testid}-chip-remove`);
  }

  /** Whether it is the select, rather than the field to type in. */
  async isSelect(): Promise<boolean> {
    return this.root.evaluate((element) => element.tagName === 'SELECT');
  }

  /** The list's row for one value. */
  option(value: string): Locator {
    return this.options.and(this.root.locator(`[data-value=${JSON.stringify(value)}]`));
  }

  /**
   * Choose by value. At the field, `words` are typed to find the row; they default to the value,
   * so give them where the label differs from it, as a date's or "Ignore this value" does.
   */
  async choose(value: string, words: string = value): Promise<void> {
    if (await this.isSelect()) {
      await this.root.selectOption(value);
      return;
    }
    await this.field.fill(words);
    await this.option(value).click();
    await this.list.waitFor({ state: 'detached' });
  }

  /**
   * Choose by value without typing, for a short list whose labels the spec need not know: at the
   * field, from the list as it opens, so its row must be within the cap.
   */
  async pick(value: string): Promise<void> {
    if (await this.isSelect()) {
      await this.root.selectOption(value);
      return;
    }
    await this.field.click();
    await this.option(value).click();
    await this.list.waitFor({ state: 'detached' });
  }
}
