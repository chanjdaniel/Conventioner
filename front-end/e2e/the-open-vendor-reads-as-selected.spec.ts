import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { settle } from './helpers/settle';
import { VendorsPage } from './pages/VendorsPage';
import type { Locator } from '@playwright/test';

/**
 * The vendor whose details are open reads as selected (E38 follow-up to F01): its row takes the
 * design language's selected look, the on toggle's green tint inside a green border, where it once
 * drew a 2px black outline the focus halo did not cover. A row focused by the keyboard draws the
 * halo on its white ground instead, so the two states never read alike.
 */

/** As the browser computes `--mm-chip-positive`, `--mm-green` and `--focus-halo`'s glow. */
const SELECTED_GROUND = 'rgb(223, 235, 232)';
const GREEN = 'rgb(54, 130, 111)';
const WHITE = 'rgb(255, 255, 255)';
const HALO = 'rgba(54, 130, 111, 0.35)';

/** The look of a row, as the browser paints it. */
function lookOf(row: Locator) {
  return row.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      ground: s.backgroundColor,
      border: s.borderTopColor,
      outline: s.outlineStyle === 'none' ? 'none' : `${s.outlineStyle} ${s.outlineWidth}`,
      shadow: s.boxShadow,
    };
  });
}

for (const size of [
  { name: 'a desk', width: 1440, height: 900 },
  { name: 'a phone', width: 390, height: 844 },
]) {
  test(`on ${size.name}, the open vendor's row reads as selected and a focused one wears the halo`, async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.setViewportSize({ width: size.width, height: size.height });

    const vendors = new VendorsPage(page);
    await vendors.goto(seed.marketId);
    const rows = vendors.vendorListItems;
    await expect(rows).toHaveCount(2, { timeout: 15000 });

    // Tab to the first row, as a keyboard user does: `:focus-visible` is what the keyboard gets.
    const first = rows.first();
    for (let press = 0; press < 60; press++) {
      await page.keyboard.press('Tab');
      if (await first.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
    await settle(page);
    const focused = await lookOf(first);
    expect(focused.outline).toBe('none');
    expect(focused.shadow).toContain(HALO);
    expect(focused.ground).toBe(WHITE);

    // Open it: the row behind the drawer is the selected one, and no other row is.
    await page.keyboard.press('Enter');
    await expect(vendors.detailCloseButton).toBeVisible();
    await settle(page);
    const open = await lookOf(first);
    expect(open.outline).toBe('none');
    expect(open.ground).toBe(SELECTED_GROUND);
    expect(open.border).toBe(GREEN);
    expect(open.shadow).not.toContain(HALO);
    expect((await lookOf(rows.nth(1))).ground).toBe(WHITE);
  });
}
