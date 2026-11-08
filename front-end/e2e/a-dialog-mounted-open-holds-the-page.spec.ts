import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { seedTheScreens } from './helpers/seedTheScreens';
import { MarketSetupPage } from './pages/MarketSetupPage';
import { TablesPage } from './pages/TablesPage';

/**
 * A dialog mounted already open holds the page behind it inert (T181).
 *
 * The change-placement dialog mounts with `v-if` and `:open="true"`, so it was open from setup,
 * before its root's template ref bound: `useInertBehind` walked once with nothing to walk from and
 * never again. The dialog said `aria-modal="true"` while Tab walked out of it onto the market bar
 * and the phase rail behind it, since September. The choose-path overlay on Setup mounts the same
 * way, and had the same bug (T228 covers it here).
 *
 * The change-placement dialog is opened on the screens seed's big market: 36 vendors over four
 * dates, so the page behind the dialog is full of controls Tab could reach. The choose-path overlay
 * is opened on its CSV draft, whose plan has no sections yet, which is where the choice is offered.
 */

const SIZES = [
  { name: 'on a phone', viewport: { width: 390, height: 844 } },
  { name: 'at a desk', viewport: { width: 1440, height: 900 } },
] as const;

let bigMarketId: string;
let csvDraftId: string;

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  ({
    big: { marketId: bigMarketId },
    csvDraft: { marketId: csvDraftId },
  } = await seedTheScreens(request, BACKEND_URL, TEST_USER.email, TEST_USER.password));
});

/** Whether an element sits inside something marked `inert`, itself included. */
const heldInert = (locator: Locator) => locator.evaluate((el) => el.closest('[inert]') !== null);

/** Whether the focused element is inside the window with this test id. */
const focusInside = (page: Page, windowTestid: string) =>
  page.evaluate(
    (testid) =>
      document.querySelector(`[data-testid="${testid}"]`)?.contains(document.activeElement) ??
      false,
    windowTestid,
  );

/**
 * With the dialog open, the page behind it is out of play, and Tab from the dialog's last control
 * comes back round to the dialog; Escape closes it and gives the page back.
 */
async function expectTheDialogHoldsThePage(page: Page, dialog: Locator, windowTestid: string) {
  await expect(dialog).toBeVisible();
  await expect.poll(() => focusInside(page, windowTestid)).toBe(true);

  // The page behind is out of play: the market bar, the rail and the app's own header.
  await expect.poll(() => heldInert(page.getByTestId('market-frame'))).toBe(true);
  await expect.poll(() => heldInert(page.getByTestId('phase-rail-menu-button'))).toBe(true);
  await expect.poll(() => heldInert(page.getByTestId('app-bar'))).toBe(true);
  expect(await heldInert(dialog)).toBe(false);

  const controls = dialog.locator(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href]',
  );
  const count = await controls.count();
  expect(count, 'the dialog draws controls').toBeGreaterThan(1);
  await controls.nth(count - 1).focus();
  for (let press = 0; press < count + 1; press++) {
    await page.keyboard.press('Tab');
    // The browser's own chrome sits between the document's end and its start, where nothing in
    // the page is focused; anywhere else it must be the dialog.
    const where = await page.evaluate(
      (testid) =>
        document.activeElement === document.body
          ? 'the browser'
          : document.querySelector(`[data-testid="${testid}"]`)?.contains(document.activeElement)
            ? 'the dialog'
            : (document.activeElement?.getAttribute('data-testid') ??
              document.activeElement?.tagName ??
              'nothing'),
      windowTestid,
    );
    expect(['the dialog', 'the browser'], `Tab ${press + 1} reached ${where}`).toContain(where);
  }
  await expect.poll(() => focusInside(page, windowTestid)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => heldInert(page.getByTestId('market-frame'))).toBe(false);
  await expect.poll(() => heldInert(page.getByTestId('app-bar'))).toBe(false);
}

for (const size of SIZES) {
  test(`the change-placement dialog holds the page behind it, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const tables = new TablesPage(page);
    await page.goto(marketScreenPath(bigMarketId, 'assignments'));
    const seat = tables.tableRows.first().getByTestId('tables-seat-occupied').first();
    await expect(seat).toBeVisible({ timeout: 15000 });

    const change = seat.getByTestId('tables-seat-change');
    await change.focus();
    await page.keyboard.press('Enter');
    await expectTheDialogHoldsThePage(page, tables.dialog, 'placement-dialog-window');

    // Focus is on the seat's Change again.
    await expect(change).toBeFocused();
  });

  test(`the choose-path overlay holds the page behind it, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const setup = new MarketSetupPage(page);
    await page.goto(marketScreenPath(csvDraftId, 'setup'));
    await expect(setup.choosePathButton).toBeVisible({ timeout: 15000 });

    // A click, as an organizer opens it; Escape is choosing manual, which changes nothing.
    await setup.choosePathButton.click();
    await expectTheDialogHoldsThePage(
      page,
      page.getByRole('dialog', { name: 'Choose your setup path' }),
      'choose-path-window',
    );
  });
}
