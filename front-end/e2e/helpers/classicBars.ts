import { expect } from '@playwright/test';
import type { Locator, Page, PlaywrightWorkerArgs } from '@playwright/test';

/**
 * Drives a browser that draws classic scroll bars. Headless Chromium hides them by a launch flag, so
 * a bar's defect never shows in a spec's own browser; `launchOptions` cannot change within a spec's
 * describe, since it forces a new worker, so this launches a browser of its own without the flag.
 */
export async function withClassicBars(
  { playwright, baseURL }: Pick<PlaywrightWorkerArgs, 'playwright'> & { baseURL?: string },
  viewport: { width: number; height: number },
  drive: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await playwright.chromium.launch({
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    const context = await browser.newContext({ baseURL: baseURL!, viewport });
    const page = await context.newPage();
    // Outside `body`, where the app's rule does not reach, so this says what the browser draws, and
    // finding no bar on a scroller later means the app hid it.
    const drawn = await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;width:100px;height:100px;overflow:scroll';
      document.documentElement.append(box);
      const bar = box.offsetWidth - box.clientWidth;
      box.remove();
      return bar;
    });
    expect(drawn, 'this browser draws classic bars').toBeGreaterThan(0);
    await drive(page);
  } finally {
    await browser.close();
  }
}

/** The width a scroller gives to a bar, less its borders. */
export function barWidth(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return (el as HTMLElement).offsetWidth - el.clientWidth - borders;
  });
}

/** The width the page's own bar takes of the window, which the app leaves alone. */
export function pageBarWidth(page: Page): Promise<number> {
  return page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
}

/**
 * Each element under `body` that gives room to a bar across or down, but a text field, whatever it
 * is: finding none says nothing in the app drew one, not only the scrollers a test knew to name.
 */
export function barsDrawn(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.body.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        if (el.tagName === 'TEXTAREA') return false;
        const style = getComputedStyle(el);
        if (!/auto|scroll/.test(style.overflowX + style.overflowY)) return false;
        const across =
          el.offsetWidth -
          el.clientWidth -
          parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth);
        const down =
          el.offsetHeight -
          el.clientHeight -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth);
        return across > 0.5 || down > 0.5;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  );
}
