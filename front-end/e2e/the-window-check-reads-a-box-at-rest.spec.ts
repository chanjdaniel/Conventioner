import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { inTheWindow, PHONE_AND_DESK } from './helpers/phoneWindow';

/**
 * The window's check reads a box where it rests, not on its way there (T205).
 *
 * The vendor drawer slides in by `transform`, and its last frames still stand a fraction of a
 * thousandth of a pixel off its place. Read in one of them on a phone, it ended at
 * 390.0000305175781 of 390, about 1 run in 20, though it rests at 390 exactly.
 */
const [PHONE] = PHONE_AND_DESK;

test.use(PHONE.use);

/** A panel on the window's right edge, placed and drawn by the CSS given. */
async function panel(page: Page, css: string): Promise<void> {
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin: 0; }
      #panel { position: fixed; top: 0; right: 0; height: 100px; ${css} }
    </style></head><body><div id="panel"></div></body></html>`);
}

test('a panel still sliding in is read where it comes to rest', async ({ page }) => {
  await panel(page, 'width: 92vw; transform: translateX(100%); transition: transform 0.25s;');
  await page.locator('#panel').evaluate((el) => {
    el.getBoundingClientRect();
    (el as HTMLElement).style.transform = 'translateX(0)';
  });

  await inTheWindow(PHONE).expectInside(page.locator('#panel'), 'the panel');
});

test('a panel resting past the window is still caught', async ({ page }) => {
  await panel(page, 'width: 92vw; transform: translateX(1px);');

  await expect(
    inTheWindow(PHONE).expectInside(page.locator('#panel'), 'the panel'),
  ).rejects.toThrow('the panel ends inside the window');
});
