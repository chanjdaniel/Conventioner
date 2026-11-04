import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, openEntry } from './helpers/componentLibrary';

/**
 * Every select draws the app's own chevron (F06 of the 2026-11-02 walk): `.field--select`, read off
 * the component library's primitives entry, whose panels hold each state of it. No sign-in, no
 * seed. A browser lays out what a stylesheet test cannot, so this measures what comes to the page:
 * the computed look, and that the files named really load.
 */

const STATES = [
  { panel: 'Select: empty', file: '/icons/select-chevron.svg', disabled: false },
  { panel: 'Select: filled', file: '/icons/select-chevron.svg', disabled: false },
  { panel: 'Select: disabled', file: '/icons/select-chevron-disabled.svg', disabled: true },
  {
    panel: 'Select: with error, as Pricing marks it',
    file: '/icons/select-chevron.svg',
    disabled: false,
  },
  {
    panel: 'Select: a long option, cut before the chevron',
    file: '/icons/select-chevron.svg',
    disabled: false,
  },
] as const;

const selectIn = (page: Page, panel: string): Locator =>
  page.getByRole('region', { name: panel, exact: true }).locator('select');

const lookOf = (select: Locator) =>
  select.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      appearance: style.appearance,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      textOverflow: style.textOverflow,
      opacity: style.opacity,
    };
  });

/** The image a computed `background-image` names, by its path, so an origin does not matter. */
const pathOf = (backgroundImage: string): string =>
  new URL(/^url\("(.+)"\)$/.exec(backgroundImage)?.[1] ?? 'about:blank').pathname;

eachWindow('a select draws the chevron', () => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'primitives');
  });

  for (const { panel, file, disabled } of STATES) {
    test(`${panel}: the chevron and its room`, async ({ page }) => {
      const look = await lookOf(selectIn(page, panel));
      expect(look.appearance).toBe('none');
      expect(look.paddingLeft).toBe('12px');
      expect(look.paddingRight).toBe('36px');
      expect(pathOf(look.backgroundImage)).toBe(file);
      expect(look.backgroundPosition).toBe('calc(100% - 12px) 50%');
      expect(look.textOverflow).toBe('ellipsis');
      if (disabled) expect(look.opacity).toBe('1');
    });
  }

  test('both files load from the app itself', async ({ page }) => {
    for (const file of new Set(STATES.map((state) => state.file))) {
      const naturalWidth = await page.evaluate(
        (src) =>
          new Promise<number>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth);
            image.onerror = () => resolve(0);
            image.src = src;
          }),
        file,
      );
      expect(naturalWidth, file).toBeGreaterThan(0);
    }
  });
});

test.describe('a select in forced colours', () => {
  test.use({ forcedColors: 'active' });

  test("keeps the browser's own arrow, which the forced palette can see", async ({ page }) => {
    await openEntry(page, 'primitives');
    for (const { panel } of STATES) {
      const look = await lookOf(selectIn(page, panel));
      expect(look.appearance, panel).toBe('auto');
      expect(look.backgroundImage, panel).toBe('none');
      expect(look.paddingRight, panel).toBe('12px');
    }
  });
});
