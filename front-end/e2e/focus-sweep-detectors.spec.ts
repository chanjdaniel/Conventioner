import { test, expect } from './fixtures';
import { installTheSweep, LOOKS, walkTheMenus, type SweepInPage } from './helpers/focusSweep';
import { SCREENS, walkTheScreens, type SweepTest } from './helpers/screens';
import type { Page } from '@playwright/test';

/**
 * The focus sweep catches the defects it is named for, and passes their quiet twins (T181).
 *
 * The sweep passing on every screen means nothing unless its checks can fail, so each is shown a
 * fixture of its defect beside a page that only looks like one, as `layout-detectors.spec.ts` does
 * for the layout sweep's detectors.
 */

/** The halo as the app draws it, here on `:focus` so a script's focus draws it too. */
const STYLE = `
  body { margin: 0; font: 14px/20px sans-serif; }
  button { font: inherit; width: 160px; height: 36px; margin: 0; border: 1px solid #333;
    border-radius: 6px; background: #eee; }
  button:focus { outline: none; box-shadow: 0 0 0 3px ${LOOKS.halo}; }
  .box { width: 320px; height: 120px; margin: 40px; overflow: hidden; }
`;

async function show(page: Page, html: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(
    `<!doctype html><html><head><style>${STYLE}</style></head><body>${html}</body></html>`,
  );
  await installTheSweep(page);
}

/** What the sweep says is wrong with the halo of the button it reaches by Tab. */
async function problemsOfTheButton(page: Page): Promise<string[] | null> {
  await page.keyboard.press('Tab');
  const verdict = await page.evaluate(
    (looks) => (window as unknown as SweepInPage).focusSweepJudge(looks),
    LOOKS,
  );
  return verdict?.problems ?? null;
}

/**
 * A box clipping an absolutely or a fixed placed button, its halo at the box's top left corner,
 * the box made their containing block by `holds`; with `holds` empty the box is static and holds
 * neither.
 */
const placedIn = (holds: string, placed: 'absolute' | 'fixed') =>
  `<div class="box" style="${holds}">
     <button style="position: ${placed}; left: 0; top: 0">Approve</button></div>`;

const HOLDERS = [
  'transform: translateX(0)',
  'filter: opacity(1)',
  'will-change: transform',
  'contain: paint',
];

test.describe('The focus sweep', () => {
  for (const holds of HOLDERS) {
    for (const placed of ['absolute', 'fixed'] as const) {
      test(`a halo cut off by a box with ${holds} is caught, for a button placed ${placed}`, async ({
        page,
      }) => {
        await show(page, placedIn(holds, placed));
        expect(await problemsOfTheButton(page)).toEqual([
          'a halo cut off by div.box (overflow hidden hidden), at its left top',
        ]);
      });
    }
  }

  test('a halo cut off by a static box around a transformed one is caught', async ({ page }) => {
    // The transformed box holds the button, and the static box clips what flows in it, the
    // transformed box among it.
    await show(
      page,
      `<div class="box"><div class="moved" style="transform: translateX(0)">
         <button style="position: absolute; left: 0; top: 0">Approve</button></div></div>`,
    );
    expect(await problemsOfTheButton(page)).toEqual([
      'a halo cut off by div.box (overflow hidden hidden), at its left top',
    ]);
  });

  test('a box holding no placed button leaves its halo whole', async ({ page }) => {
    // A static box with `overflow: hidden` clips what flows in it, not what is placed on the page.
    for (const placed of ['absolute', 'fixed'] as const) {
      await show(page, placedIn('', placed).replace('left: 0; top: 0', 'left: 8px; top: 8px'));
      expect(await problemsOfTheButton(page), `a ${placed} button`).toEqual([]);
    }
  });

  /**
   * A menu button and its menu of two items. Enter opens it and Escape closes it; a working menu
   * then moves focus to its first item and ArrowDown to the next, a broken one leaves focus on its
   * button.
   */
  const menu = (works: boolean) => `
    <button data-testid="row-menu" aria-haspopup="menu" aria-expanded="false"
      aria-controls="row-actions">Actions</button>
    <div id="row-actions" role="menu" hidden>
      <button role="menuitem" tabindex="-1">Approve</button>
      <button role="menuitem" tabindex="-1">Reject</button>
    </div>
    <script>
      const button = document.querySelector('[aria-haspopup]');
      const list = document.getElementById('row-actions');
      const items = [...list.querySelectorAll('[role=menuitem]')];
      const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        list.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        if (${works}) items[0].focus();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        if (e.key !== 'ArrowDown') return;
        const at = items.indexOf(document.activeElement);
        if (at >= 0) items[(at + 1) % items.length].focus();
      });
    </script>`;

  test('a menu that leaves focus on its button is caught', async ({ page }) => {
    await show(page, menu(false));
    expect(await walkTheMenus(page, 'the fixture')).toEqual([
      'the fixture: the menu row-actions, opened by button[data-testid=row-menu], ' +
        'left item 1 unfocused: focus is on button[data-testid=row-menu]',
      'the fixture: the menu row-actions, opened by button[data-testid=row-menu], ' +
        'left item 2 unfocused: focus is on button[data-testid=row-menu]',
    ]);
  });

  test('a menu whose arrows walk its items passes', async ({ page }) => {
    await show(page, menu(true));
    expect(await walkTheMenus(page, 'the fixture')).toEqual([]);
  });

  test('a phone added to a sweep leaves the sizes every other sweep walks', async () => {
    // `walkTheScreens` registers a test a screen; a stand-in for Playwright's `test` keeps the
    // registrations, so only the sizes it reads are under test here.
    const before = SCREENS.map((s) => s.sizes.map((size) => size.width));
    const registered: string[] = [];
    const stand = Object.assign((name: string) => void registered.push(name), {
      beforeAll: () => {},
    }) as unknown as SweepTest;
    walkTheScreens(stand, { everySize: true, alsoAt: { width: 800, height: 600 } });
    expect(registered).toHaveLength(SCREENS.length);
    expect(SCREENS.map((s) => s.sizes.map((size) => size.width))).toEqual(before);
  });
});
