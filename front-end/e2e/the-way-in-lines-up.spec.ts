import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The navigation drawer and the password pages line up (items 10 and 11 of bug 43; E26/F10/S01).
 *
 * Sign out sat a few pixels off the rows above it, shorter, with a wider divider. The password
 * pages were Title Case, with a left-aligned title over a centred subtitle and an input whose
 * right border was painted over by the input inside it.
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
