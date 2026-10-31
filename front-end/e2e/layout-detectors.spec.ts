import { test, expect } from './fixtures';
import {
  detectLayout,
  gates,
  minTargetAt,
  misplacedBars,
  PHONE_MAX_WIDTH,
  pinnedBottom,
  SPACE_SCALE,
  TYPE_SCALE,
  type Finding,
} from './helpers/layoutDetectors';
import type { Page } from '@playwright/test';

/**
 * Each gating detector of the layout sweep fires on the defect it is named for, and none fires on a
 * page that only looks like one (T79).
 *
 * The sweep passing on every screen means nothing unless its detectors can fail, so each is shown
 * one fixture element with its defect. Its quiet twin matters as much: the trial's first run raised
 * 54 overlaps and 11 clipped texts that were none (closed `<details>`, boxes wider than their words,
 * ellipses), and a gate that cries wolf is switched off.
 */

async function findingsOn(page: Page, html: string, width = 1440): Promise<Finding[]> {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; font: 14px/20px sans-serif; }
    h1 { font-size: 26px; margin: 0; }
    button { font: inherit; }
  </style></head><body>${html}</body></html>`);
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  return findings.filter((f) => gates(f, width));
}

const of = (findings: Finding[], kind: string) => findings.filter((f) => f.kind === kind);

test.describe('The layout detectors', () => {
  test('an element wider than the window overflows the page and leaves the window', async ({
    page,
  }) => {
    const found = await findingsOn(
      page,
      `<div style="width: 390px"><div data-testid="wide" style="width: 488px">A card too wide</div></div>`,
      390,
    );
    expect(of(found, 'page-h-overflow').map((f) => f.detail)).toEqual([
      'page is 98px wider than the 390px window',
    ]);
    expect(of(found, 'outside-viewport').map((f) => `${f.el}: ${f.detail}`)).toContain(
      'div > div[wide]: spans x 0 to 488 in a 390px window',
    );
    expect(of(found, 'child-outside-parent').map((f) => `${f.el}: ${f.detail}`)).toEqual([
      'div > div[wide]: 98px outside div',
    ]);
  });

  test('text cut off by its box is clipped', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<div data-testid="cut" style="width: 100px; height: 20px; overflow: hidden; white-space: nowrap">
         Fall Makers Fair at the Old Cannery</div>
       <div data-testid="short" style="width: 200px; height: 20px; overflow: hidden">
         <p style="margin: 0">One line</p><p style="margin: 0">and the next</p></div>`,
    );
    expect(of(found, 'clipped-x').map((f) => f.el)).toEqual(['div[cut]']);
    expect(of(found, 'clipped-x')[0].detail).toMatch(/^text cut off \d+px past the right edge$/);
    expect(of(found, 'clipped-y').map((f) => f.el)).toEqual(['div[short]']);
    expect(of(found, 'clipped-y')[0].detail).toMatch(/^text cut off \d+px past the bottom edge$/);
  });

  test('two texts drawn over each other overlap', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<p data-testid="under" style="margin: 0">Main Hall</p>
       <p data-testid="over" style="margin: -12px 0 0">Courtyard</p>`,
    );
    expect(of(found, 'overlap').map((f) => f.el)).toEqual(['p[under] ~ p[over]']);
    expect(of(found, 'overlap')[0].detail).toMatch(/^\d+x8px overlap$/);
  });

  test('text in a column too narrow for it is squeezed', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<table><tr><td data-testid="dates" style="width: 1px">2099-08-01, 2099-08-08</td></tr></table>`,
    );
    expect(of(found, 'squeezed-text').map((f) => f.el)).toEqual(['tbody > tr > td[dates]']);
    expect(of(found, 'squeezed-text')[0].detail).toMatch(/^22 characters over \d+ lines in \d+px$/);
  });

  test('type off the scale is off-scale', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<h2 data-testid="heading" style="font-size: 28px">Sign in</h2>`,
    );
    expect(of(found, 'off-scale-type').map((f) => `${f.el}: ${f.detail}`)).toEqual([
      'h2[heading]: font-size 28px',
    ]);
  });

  test('a tap target under 44px fails on a phone, and only there', async ({ page }) => {
    const html = `<button data-testid="lookup" style="width: 200px; height: 36px">Look up</button>`;
    expect(
      (await findingsOn(page, html, 390)).map((f) => `${f.kind} ${f.el}: ${f.detail}`),
    ).toEqual(['small-target button[lookup]: 200x36px, under 44px']);
    expect(await findingsOn(page, html, 1440)).toEqual([]);
  });

  test("a control's label counts toward its target", async ({ page }) => {
    const found = await findingsOn(
      page,
      `<label style="display: block; padding: 12px 0"><input data-testid="gold" type="checkbox"
         style="width: 20px; height: 20px; margin: 0"> Gold</label>
       <label style="display: block; padding: 4px 0"><input data-testid="silver" type="checkbox"
         style="width: 20px; height: 20px; margin: 0"> Silver</label>`,
      390,
    );
    expect(of(found, 'small-target').map((f) => `${f.el}: ${f.detail}`)).toEqual([
      'label > input[silver]: 20x20px and its label, under 44px',
    ]);
  });

  test('a label nobody can see or tap does not save a small target', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<input id="hidden" data-testid="hidden" type="checkbox" style="width: 16px; height: 16px">
       <label for="hidden" style="display: block; padding: 24px 0; visibility: hidden">Gold</label>
       <input id="inert" data-testid="inert" type="checkbox" style="width: 16px; height: 16px">
       <div inert><label for="inert" style="display: block; padding: 24px 0">Silver</label></div>`,
      390,
    );
    expect(of(found, 'small-target').map((f) => `${f.el}: ${f.detail}`)).toEqual([
      'input[hidden]: 16x16px, under 44px',
      'input[inert]: 16x16px, under 44px',
    ]);
  });

  test('a link in a sentence is exempt, and one drawn on a line of its own is a target', async ({
    page,
  }) => {
    // WCAG 2.5.8 exempts a target in a run of text; a link drawn as a block of its own under the
    // sentence is not in one, wherever it stands in the markup (the rail's next step, T142).
    const found = await findingsOn(
      page,
      `<p style="margin: 0">Pick the dates first. <a href="#" data-testid="inline">Go there</a></p>
       <p style="margin: 0">Pick the dates first.
         <a href="#" data-testid="own" style="display: flex; width: fit-content">Go there</a></p>`,
      390,
    );
    expect(of(found, 'small-target').map((f) => f.el)).toEqual(['p > a[own]']);
  });

  test('a page that only looks broken raises nothing', async ({ page }) => {
    const found = await findingsOn(
      page,
      `<header style="position: sticky; top: 0; background: white"><h1>A stuck bar</h1></header>
       <p style="margin: 0">Scrolled under the bar, as a long page is</p>
       <span style="position: absolute; width: 1px; height: 1px; overflow: hidden; white-space: nowrap">
         read to a screen reader and never drawn</span>
       <div style="width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
         title="Alexandria Montgomery-Featherstonehaugh Ceramics">
         Alexandria Montgomery-Featherstonehaugh Ceramics</div>
       <details><summary>More</summary><p style="margin: -20px 0 0">Shut, so not drawn</p></details>
       <div style="position: relative"><p style="margin: 0">Under a menu</p>
         <ul style="position: absolute; top: 0; margin: 0; background: white"><li>Over it</li></ul></div>`,
    );
    expect(found).toEqual([]);
  });
});

test.describe('The market bar check', () => {
  test('names the screen whose bar stands apart, against where the others stand', () => {
    const bars = new Map([
      [
        1440,
        new Map<string, [number, number]>([
          ['the result', [16, 1408]],
          ['the vendors', [16, 1408]],
          ['the floorplan', [0, 1440]],
        ]),
      ],
      [1920, new Map<string, [number, number]>([['the result', [240, 1440]]])],
    ]);
    expect(misplacedBars(bars)).toEqual([
      {
        width: 1440,
        usual: 'x 16, width 1408',
        apart: ['the floorplan: x 0, width 1440'],
      },
    ]);
  });
});

test.describe('The pinned area', () => {
  /** A page long enough to scroll a window's height, with `html` at its top. */
  async function pinnedOn(page: Page, html: string) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!doctype html><html><head><style>
      body { margin: 0; font: 14px/20px sans-serif; }
    </style></head><body>${html}<div style="height: 3000px">The page</div></body></html>`);
    return page.evaluate(pinnedBottom);
  }

  const header = `<header data-testid="banner" style="position: sticky; top: 0; height: 44px; z-index: 30;
    background: black">Banner</header>`;

  test('a pinned header and a block pinned under it count, measured after a scroll', async ({
    page,
  }) => {
    const pinned = await pinnedOn(
      page,
      `${header}<div style="height: 200px">Above the block</div>
       <div data-testid="bar" style="position: sticky; top: 44px; height: 56px; background: white">
         The bar</div>`,
    );
    expect(pinned).toEqual({ bottom: 100, el: 'div[bar]' });
  });

  test('a block that scrolls away, or sticks only sideways, does not count', async ({ page }) => {
    const pinned = await pinnedOn(
      page,
      `${header}<div data-testid="rail" style="height: 300px">The rail, in the flow</div>
       <div style="height: 120px"><div data-testid="short" style="position: sticky; top: 44px;
         height: 40px">Stuck inside a box that scrolls away</div></div>
       <div data-testid="column" style="position: sticky; left: 0; width: 80px; height: 400px">
         Sticks sideways</div>`,
    );
    expect(pinned).toEqual({ bottom: 44, el: 'header[banner]' });
  });

  test('an open drawer or dialog, and what is pinned inside it, does not count', async ({
    page,
  }) => {
    const pinned = await pinnedOn(
      page,
      `${header}
       <div data-testid="scrim" style="position: fixed; inset: 0; background: rgba(0,0,0,.3)"></div>
       <aside data-testid="drawer" style="position: fixed; top: 0; right: 0; width: 360px;
         height: 100vh; overflow: auto; background: white">
         <div data-testid="drawer-head" style="position: sticky; top: 0; height: 160px">Head</div>
         <div style="height: 2000px">Its content</div></aside>
       <div role="dialog" data-testid="dialog" style="position: fixed; top: 0; left: 0;
         width: 300px; height: 200px; background: white">A small dialog</div>`,
    );
    expect(pinned).toEqual({ bottom: 44, el: 'header[banner]' });
  });

  test('the page is left where it was', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`${header}<div style="height: 3000px">The page</div>`);
    await page.evaluate(() => window.scrollTo(0, 120));
    await page.evaluate(pinnedBottom);
    expect(await page.evaluate(() => window.scrollY)).toBe(120);
  });
});

test.describe('The phone target gate', () => {
  test('gates phone targets at 44px at the width base.css raises them, and only there', () => {
    expect(minTargetAt(PHONE_MAX_WIDTH)).toBe(44);
    expect(minTargetAt(PHONE_MAX_WIDTH + 1)).toBe(24);
  });

  test('renders the sign-in button at 44px on a phone and 36px past it', async ({ page }) => {
    // The gate's phone break and base.css's must be one number, so a window between them cannot
    // slip past: the sweep holds a phone to 44px while the CSS still paints 24px, or the reverse.
    const measure = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/login');
      const button = page.getByTestId('login-submit-button');
      await button.waitFor();
      const targetMin = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--target-min').trim(),
      );
      const height = await button.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      return { targetMin, height };
    };

    expect(await measure(PHONE_MAX_WIDTH)).toEqual({ targetMin: '44px', height: 44 });
    expect(await measure(PHONE_MAX_WIDTH + 1)).toEqual({ targetMin: '24px', height: 36 });
  });
});
