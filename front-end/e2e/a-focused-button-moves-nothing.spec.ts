import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEntry } from './helpers/componentLibrary';

/**
 * A button's focus takes no room (Daniel's word on 2026-11-04): the green border is drawn inside the
 * edge, so the box a keyboard lands on is where it was and the size it was, and so are the boxes
 * around it, a market card among them, whose name is the button it draws the border for. Each stop
 * is read focused, then blurred, since the browser's Tab goes on from where focus was.
 */

const SIZES = [
  { name: 'a desk', width: 1280, height: 800 },
  { name: 'a phone', width: 390, height: 844 },
];

/** Presses Tab through the buttons and says where focus moved a box, and how many it read. */
async function walkTheButtons(page: Page): Promise<{ moved: string[]; read: number }> {
  const moved: string[] = [];
  let read = 0;
  const seen = new Set<string>();
  for (let press = 0; press < 150; press++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.matches("button, .btn, [role='button'], .add-row")) return null;
      el.dataset.walked ??= String(Math.random());
      const boxes = () => {
        for (const animation of document.getAnimations()) animation.finish();
        const held: string[] = [];
        for (
          let node: Element | null = el, up = 0;
          node && up < 5;
          node = node.parentElement, up++
        ) {
          const { x, y, width, height } = node.getBoundingClientRect();
          held.push([x, y, width, height].map((v) => v.toFixed(1)).join(' '));
        }
        return held;
      };
      const focused = boxes();
      el.blur();
      return { id: el.dataset.walked, name: el.innerText.trim(), focused, atRest: boxes() };
    });
    if (!stop) continue;
    if (seen.has(stop.id)) break;
    seen.add(stop.id);
    read++;
    if (stop.focused.join() !== stop.atRest.join()) {
      moved.push(`${stop.name}: at rest ${stop.atRest} -> focused ${stop.focused}`);
    }
  }
  return { moved, read };
}

for (const size of SIZES) {
  test(`on ${size.name}, focus moves no button in the library's primitives`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openEntry(page, 'primitives');
    const { moved, read } = await walkTheButtons(page);
    expect(moved).toEqual([]);
    expect(read).toBeGreaterThan(5);
  });

  test(`on ${size.name}, focus moves no button or card on Markets`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/markets');
    await page.getByTestId('market-card').first().waitFor();
    const { moved, read } = await walkTheButtons(page);
    expect(moved).toEqual([]);
    expect(read).toBeGreaterThan(3);
  });
}
