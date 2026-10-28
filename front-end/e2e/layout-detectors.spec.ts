import { test, expect } from './fixtures';
import {
  detectLayout,
  gates,
  misplacedBars,
  PHONE_WIDTH,
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
    minTarget: 24,
    comfortableTarget: width < PHONE_WIDTH ? 44 : undefined,
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

  test('a tap target under 24px fails on a phone, and only there', async ({ page }) => {
    const html = `<button data-testid="lookup" style="width: 200px; height: 20px">Look up</button>`;
    expect(
      (await findingsOn(page, html, 390)).map((f) => `${f.kind} ${f.el}: ${f.detail}`),
    ).toEqual(['small-target button[lookup]: 200x20px, under 24px']);
    expect(await findingsOn(page, html, 1440)).toEqual([]);
  });

  test('a phone target under 44px is reported, and a label counts toward its target', async ({
    page,
  }) => {
    await findingsOn(
      page,
      `<button data-testid="lookup" style="width: 200px; height: 36px">Look up</button>
       <label style="display: block; padding: 4px 0"><input data-testid="gold" type="checkbox"
         style="width: 20px; height: 20px; margin: 0"> Gold</label>`,
      390,
    );
    const all = await page.evaluate(detectLayout, {
      spaceScale: SPACE_SCALE,
      textScale: TYPE_SCALE,
      minTarget: 24,
      comfortableTarget: 44,
    });
    const targets = all.filter((f) => /target/.test(f.kind));
    expect(targets.map((f) => `${f.kind} ${f.el}: ${f.detail}`)).toEqual([
      'tight-target button[lookup]: 200x36px, under 44px',
      'tight-target label > input[gold]: 20x20px and its label, under 44px',
    ]);
    expect(targets.some((f) => gates(f, 390))).toBe(false);
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
      'input[hidden]: 16x16px, under 24px',
      'input[inert]: 16x16px, under 24px',
    ]);
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
