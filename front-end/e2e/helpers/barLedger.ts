import type { Locator } from '@playwright/test';

/**
 * How a `BarLedger` row lays out its answer, as a reader sees it (T201): its label, bar and count on
 * one line, the bar between the two, in a card wider than 32rem; the bar under the label and the
 * count in a narrower one; or neither, which is a fault. The row is the element carrying the
 * ledger's `testid`, its parts `<testid>-label`, `<testid>-bar` and `<testid>-count`.
 */
export async function rowLayout(row: Locator): Promise<'one line' | 'stacked' | 'neither'> {
  return row.evaluate((element) => {
    const testid = element.getAttribute('data-testid');
    const part = (name: string) =>
      element.querySelector(`[data-testid="${testid}-${name}"]`)!.getBoundingClientRect();
    const [label, bar, count] = [part('label'), part('bar'), part('count')];
    const middle = (box: DOMRect) => box.top + box.height / 2;
    const beside = (box: DOMRect, other: DOMRect) =>
      middle(box) >= other.top && middle(box) <= other.bottom;
    if (
      label.right <= bar.left &&
      bar.right <= count.left &&
      beside(bar, label) &&
      beside(count, label)
    ) {
      return 'one line';
    }
    if (bar.top >= Math.max(label.bottom, count.bottom) - 0.5) return 'stacked';
    return 'neither';
  });
}
