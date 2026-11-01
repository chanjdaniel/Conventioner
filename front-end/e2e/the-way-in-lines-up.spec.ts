import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The navigation drawer, the password pages and the market chooser at `/init` line up (items 10
 * and 11 of bug 43; E26/F10/S01; T161).
 *
 * Sign out sat a few pixels off the rows above it, shorter, with a wider divider, and read in
 * another font and ink than they did. The password pages were Title Case, with a left-aligned
 * title over a centred subtitle and an input whose right border was painted over by the input
 * inside it. `/init`'s two buttons stand whole on one row at a desk's size.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not rendered');
  return b;
};

test('every row of the navigation drawer is one shape, Sign out included', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/markets');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.nav .item')).map((item) => {
      const row = item.getBoundingClientRect();
      const icon = item.querySelector('svg')!.getBoundingClientRect();
      return {
        x: Math.round(row.x),
        width: Math.round(row.width),
        height: Math.round(row.height),
        icon: Math.round(icon.x),
      };
    }),
  );
  expect(rows.length).toBeGreaterThanOrEqual(3);
  for (const key of ['x', 'width', 'height', 'icon'] as const) {
    expect(new Set(rows.map((row) => row[key])).size, `${key}: ${JSON.stringify(rows)}`).toBe(1);
  }
});

async function readsLikeSignIn(page: Page, path: string) {
  await page.goto(path);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Reset your password');
  const description = page.locator('.description');
  expect((await box(description)).x).toBe((await box(title)).x);
  expect(await description.evaluate((el) => getComputedStyle(el).textAlign)).not.toBe('center');

  // Every field is whole: its border box reaches the submit button's edge and no further, and
  // nothing inside it paints past that border.
  const submit = await box(page.locator('button[type="submit"]'));
  for (const field of await page.locator('input').all()) {
    const holder = field.locator('xpath=ancestor-or-self::*[contains(@class, "field")][1]');
    const outer = await box(holder);
    const inner = await box(field);
    expect(Math.round(outer.x + outer.width)).toBe(Math.round(submit.x + submit.width));
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  }
  // Each field is named by a label, not by a placeholder that goes when typing starts.
  for (const field of await page.locator('input').all()) {
    const id = await field.getAttribute('id');
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  }
}

test('asking for a reset reads like signing in', async ({ page }) => {
  await readsLikeSignIn(page, '/reset-password-request');
  await expect(page.getByTestId('password-reset-request-submit-button')).toHaveText(
    'Send reset link',
  );
  await expect(page.getByTestId('password-reset-request-back-link')).toHaveText('Back to sign in');
});

test('choosing a new password reads like signing in', async ({ page }) => {
  await readsLikeSignIn(page, '/reset-password?token=not-a-real-token');
  await expect(page.getByTestId('password-reset-submit-button')).toHaveText('Reset password');
});

/**
 * The market chooser at `/init` fits its window: its two buttons stand whole on one row. It keeps
 * the desktop floor like every organizer screen not named in `meta.fitsAPhone`, so a phone lays it
 * out 1000px wide by design (the design language's Layout), and it is measured at a desk's size.
 */
test('the market chooser fits a 1440px window', async ({ authenticatedPage: page }) => {
  await page.goto('/init');
  const buttons = [
    page.getByTestId('init-setup-new-market-button'),
    page.getByTestId('init-load-existing-market-button'),
  ];
  await expect(buttons[1]).toBeVisible();

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  const [left, right] = [await box(buttons[0]), await box(buttons[1])];
  for (const b of [left, right]) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(innerWidth);
  }
  // One row: side by side at the same height, so a wrap or a stack fails.
  expect(Math.abs(right.y - left.y)).toBeLessThanOrEqual(1);
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
});

/**
 * Sign out is a row of the drawer like the three links above it, so its words are drawn as theirs
 * are: it read in Outfit and the body's slate while they read in Merge One and the product's black
 * (rereview note 14).
 */
for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`Sign out reads like the drawer's links at ${size.width}px`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/markets');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByTestId('app-nav');
    await expect(drawer.getByRole('button', { name: 'Sign out' })).toBeVisible();

    const looks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="app-nav"] .nav .item')).map((item) => {
        const words = Array.from(item.children).find((c) => c.tagName !== 'svg')!;
        const s = getComputedStyle(words);
        return `${words.textContent?.trim()}: ${s.fontFamily} ${s.fontSize} ${s.fontWeight} ${s.color}`;
      }),
    );
    expect(looks.length).toBeGreaterThanOrEqual(3);
    const look = (line: string) => line.slice(line.indexOf(':') + 2);
    expect(new Set(looks.map(look)).size, looks.join('\n')).toBe(1);
  });
}
