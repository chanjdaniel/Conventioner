import { test, expect } from './fixtures';
import {
  installTheSweep,
  LOOKS,
  rememberFieldsAtRest,
  walkTheMenus,
  type SweepInPage,
} from './helpers/focusSweep';
import { SCREENS, walkTheScreens, type SweepTest } from './helpers/screens';
import type { Page } from '@playwright/test';

/**
 * The focus sweep catches the defects it is named for, and passes their quiet twins (T181).
 *
 * The sweep passing on every screen means nothing unless its checks can fail, so each is shown a
 * fixture of its defect beside a page that only looks like one, as `layout-detectors.spec.ts` does
 * for the layout sweep's detectors.
 */

/** The halo and the border as the app draws them, on `:focus` so a script's focus draws them too. */
const STYLE = `
  body { margin: 0; font: 14px/20px sans-serif; }
  a { display: block; width: 160px; height: 36px; margin: 0; border: 1px solid #333;
    border-radius: 6px; background: #eee; }
  a:focus { outline: none; box-shadow: 0 0 0 3px ${LOOKS.halo}; }
  button { font: inherit; width: 160px; height: 36px; margin: 0; border: 1px solid #333;
    border-radius: 6px; background: #eee; }
  button:focus { outline: 2px solid ${LOOKS.border}; outline-offset: -2px; }
  .box { width: 320px; height: 120px; margin: 40px; overflow: hidden; }
`;

async function show(page: Page, html: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(
    `<!doctype html><html><head><style>${STYLE}</style></head><body>${html}</body></html>`,
  );
  await installTheSweep(page);
}

/** What the sweep says is wrong with how the control it reaches first by Tab shows focus. */
async function problemsOfTheFirstStop(page: Page): Promise<string[] | null> {
  await page.keyboard.press('Tab');
  const verdict = await page.evaluate(
    (looks) => (window as unknown as SweepInPage).focusSweepJudge(looks),
    LOOKS,
  );
  return verdict?.problems ?? null;
}

/**
 * A box clipping an absolutely or a fixed placed link, its halo at the box's top left corner,
 * the box made their containing block by `holds`; with `holds` empty the box is static and holds
 * neither.
 */
const placedIn = (holds: string, placed: 'absolute' | 'fixed') =>
  `<div class="box" style="${holds}">
     <a href="#" style="position: ${placed}; left: 0; top: 0">Approve</a></div>`;

const HOLDERS = [
  'transform: translateX(0)',
  'filter: opacity(1)',
  'will-change: transform',
  'contain: paint',
];

test.describe('The focus sweep', () => {
  for (const holds of HOLDERS) {
    for (const placed of ['absolute', 'fixed'] as const) {
      test(`a halo cut off by a box with ${holds} is caught, for a link placed ${placed}`, async ({
        page,
      }) => {
        await show(page, placedIn(holds, placed));
        expect(await problemsOfTheFirstStop(page)).toEqual([
          'a halo cut off by div.box (overflow hidden hidden), at its left top',
        ]);
      });
    }
  }

  test('a halo cut off by a static box around a transformed one is caught', async ({ page }) => {
    // The transformed box holds the link, and the static box clips what flows in it, the
    // transformed box among it.
    await show(
      page,
      `<div class="box"><div class="moved" style="transform: translateX(0)">
         <a href="#" style="position: absolute; left: 0; top: 0">Approve</a></div></div>`,
    );
    expect(await problemsOfTheFirstStop(page)).toEqual([
      'a halo cut off by div.box (overflow hidden hidden), at its left top',
    ]);
  });

  test('a box holding no placed link leaves its halo whole', async ({ page }) => {
    // A static box with `overflow: hidden` clips what flows in it, not what is placed on the page.
    for (const placed of ['absolute', 'fixed'] as const) {
      await show(page, placedIn('', placed).replace('left: 0; top: 0', 'left: 8px; top: 8px'));
      expect(await problemsOfTheFirstStop(page), `a ${placed} link`).toEqual([]);
    }
  });

  /** A button as a screen's own rule draws it; `focus` is what it draws on `:focus`, over STYLE. */
  const button = (rest: string, focus: string, words = 'Approve') => `
    <style>
      .it { ${rest} }
      .it:focus { ${focus} }
    </style>
    <button class="it">${words}</button>`;
  const DEEP = `outline-color: ${LOOKS.borderOnFill};`;
  const GREEN_FILL = `background: ${LOOKS.border}; color: white; border: none;`;

  test('a button that draws the green border on its edge passes', async ({ page }) => {
    await show(page, button('', ''));
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
  });

  test('a button that wears the halo rather than the border is caught', async ({ page }) => {
    await show(page, button('', `outline: none; box-shadow: 0 0 0 3px ${LOOKS.halo};`));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      `a button wore the halo: box-shadow ${LOOKS.halo} 0px 0px 0px 3px`,
      'a button drew no green border: outline none',
    ]);
  });

  test('a border outside the edge is caught', async ({ page }) => {
    await show(page, button('margin: 8px;', 'outline-offset: 2px;'));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      "a button's border is not on its edge: offset 2px",
    ]);
  });

  test('a border the green fill hides is caught, and the deep green on it passes', async ({
    page,
  }) => {
    await show(page, button(GREEN_FILL, ''));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      `a button's border is ${LOOKS.border}, where ${LOOKS.borderOnFill} would show`,
    ]);
    await show(page, button(GREEN_FILL, DEEP));
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
  });

  test('a border the button’s own green border hides is caught', async ({ page }) => {
    await show(page, button(`border-color: ${LOOKS.border};`, ''));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      `a button's border is ${LOOKS.border}, where ${LOOKS.borderOnFill} would show`,
    ]);
  });

  test('the deep green where the plain green shows is caught', async ({ page }) => {
    await show(page, button('', DEEP));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      `a button's border is ${LOOKS.borderOnFill}, where ${LOOKS.border} would show`,
    ]);
  });

  test('a border drawn over a padless button’s words is caught', async ({ page }) => {
    await show(page, button('width: auto; padding: 0; border: none; background: none;', ''));
    expect(await problemsOfTheFirstStop(page)).toEqual([
      'a button draws its border over its words',
    ]);
  });

  test('a long name cut short inside a button, clear of its border, passes', async ({ page }) => {
    await show(
      page,
      button(
        'display: flex; width: 200px; padding: 0 12px;',
        '',
        `<span style="min-width: 0; overflow: hidden; white-space: nowrap;">${'A long name '.repeat(9)}</span>`,
      ),
    );
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
  });

  test('a name cut short only at a padless button’s edge is caught', async ({ page }) => {
    await show(
      page,
      button(
        'display: flex; width: 200px; padding: 0; border: none; background: none;',
        '',
        `<span style="min-width: 0; overflow: hidden; white-space: nowrap;">${'A long name '.repeat(9)}</span>`,
      ),
    );
    expect(await problemsOfTheFirstStop(page)).toEqual([
      'a button draws its border over its words',
    ]);
  });

  /** A padless text button whose border runs clear around its words, `at` from the window's edge. */
  const textButton = (at: number) =>
    button(
      `width: auto; padding: 0; border: none; background: none; margin: ${at}px;`,
      'outline-offset: 2px;',
    );

  test('a padless text button whose border runs clear around its words passes', async ({
    page,
  }) => {
    await show(page, textButton(8));
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
  });

  test("a text button whose border runs off the window's edge is caught", async ({ page }) => {
    await show(page, textButton(0));
    expect(await problemsOfTheFirstStop(page)).toEqual(['a border runs off the window']);
  });

  test('a text button whose border is cut off is caught', async ({ page }) => {
    await show(page, `<div class="box" style="margin: 8px">${textButton(0)}</div>`);
    expect(await problemsOfTheFirstStop(page)).toEqual([
      'a border cut off by div.box (overflow hidden hidden), at its left top',
    ]);
  });

  test('a button that focus resizes is caught', async ({ page }) => {
    await show(page, button('height: 36px;', 'height: 40px;'));
    await rememberFieldsAtRest(page);
    expect(await problemsOfTheFirstStop(page)).toEqual([
      'focus resized a button: 160x36 -> 160x40',
    ]);
  });

  test('a card may draw the border for the button naming it', async ({ page }) => {
    await show(
      page,
      `<style>
        .card { width: 240px; padding: 8px; border-radius: 6px; }
        .card button { outline: none; }
        .card:has(button:focus) { outline: 2px solid ${LOOKS.border}; outline-offset: -2px; }
      </style>
      <div class="card"><h3><button>A market</button></h3></div>`,
    );
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
  });

  /**
   * A file input drawn invisible inside the label that stands for it, as `FileDropZone.vue` draws
   * one, with no outline as `primitives.css` gives every input, the label wearing the halo while
   * the input has focus when `wears`.
   */
  const dropZone = (wears: boolean) => `
    <style>
      .zone { display: block; position: relative; width: 320px; margin: 40px; padding: 24px;
        border: 2px dashed #999; border-radius: 8px; background: #f6f1e7; }
      .zone input { position: absolute; inset: 0; width: 1px; height: 1px; opacity: 0; }
      .zone input:focus { outline: none; }
      ${wears ? `.zone:has(input:focus) { box-shadow: 0 0 0 3px ${LOOKS.halo}; }` : ''}
    </style>
    <label class="zone"><input type="file" data-testid="zone-input" /><span>Drop a file</span></label>`;

  test('a drop zone that shows no focus for its file input is caught', async ({ page }) => {
    await show(page, dropZone(false));
    expect(await problemsOfTheFirstStop(page)).toEqual(['a control drew no halo: box-shadow none']);
  });

  test("a drop zone that wears its file input's halo passes", async ({ page }) => {
    await show(page, dropZone(true));
    expect(await problemsOfTheFirstStop(page)).toEqual([]);
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
