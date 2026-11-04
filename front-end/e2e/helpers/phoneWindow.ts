import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

/**
 * A journey on the phone in an organizer's hand and at a desk (T142, T180): the two windows, and
 * what each journey checks in them.
 *
 * The phone is a phone's own emulation, not a narrow window: touch, device scaling and a phone's
 * reading of the page's viewport meta, which a plain 390px window has none of.
 */
export const PHONE_AND_DESK = [
  {
    name: 'on a phone',
    phone: true,
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'at a desk', phone: false, use: { viewport: { width: 1440, height: 900 } } },
] as const;

export type PhoneOrDesk = (typeof PHONE_AND_DESK)[number];

/** The window as the page lays itself out in it, and how far the page runs past it. */
export const widths = (page: Page) =>
  page.evaluate(() => ({
    layout: window.innerWidth,
    sideways: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    zoom: window.visualViewport?.scale ?? 1,
  }));

/** The checks of one window, measured against its own size. */
export function inTheWindow(size: PhoneOrDesk) {
  const { width, height } = size.use.viewport;
  return {
    /** The page keeps the window's width: nothing scrolls sideways, nothing zooms out. */
    async expectFits(page: Page, what: string): Promise<void> {
      expect(await widths(page), `${what} keeps the window's width`).toEqual({
        layout: width,
        sideways: 0,
        zoom: 1,
      });
    },

    /** A box wholly inside the window, across and down. */
    async expectInside(locator: Locator, what: string): Promise<void> {
      // Retried, since a drawer measured on its slide's last frame ends a hair past the window.
      await expect(async () => {
        const box = await locator.boundingBox();
        expect(box, `${what} is drawn`).not.toBeNull();
        expect(box!.x, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
        expect(box!.y, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${what} ends inside the window`).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height, `${what} ends inside the window`).toBeLessThanOrEqual(height);
      }).toPass({ timeout: 2000 });
    },

    /** A tap on a phone, a click at a desk. */
    press: (locator: Locator) => (size.phone ? locator.tap() : locator.click()),
  };
}
