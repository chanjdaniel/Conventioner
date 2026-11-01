import { test, expect } from './fixtures';
import { disabledWithoutLine, sweep } from './helpers/contrastSweep';
import type { Page } from '@playwright/test';

/**
 * The contrast sweep's measure fails on the defects it is meant to catch, and passes their quiet
 * twins (T162).
 *
 * The sweep passing on every screen means nothing unless its measure can fail. It read each text
 * node's own colour and skipped only an opacity of 0, so a line dimmed by `opacity: 0.8` passed
 * unseen: the Vendors page's green counts drew at 3.2:1 while the sweep measured 4.59:1.
 */

/** The failures on a fixture page, each as `"text" ratio`. */
async function failuresOn(page: Page, html: string): Promise<string[]> {
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; font: 14px/20px sans-serif; background: #fff; }
  </style></head><body>${html}</body></html>`);
  const { failures } = await sweep(page);
  return failures.map((f) => `"${f.text}" ${f.ratio}`);
}

test.describe('The contrast measure', () => {
  test('text dimmed by an ancestor’s opacity is measured as it is drawn', async ({ page }) => {
    // #36826f is 4.59:1 on white; under an ancestor at 0.8 it draws as #5e9b8c, 3.21:1.
    expect(
      await failuresOn(
        page,
        `<div style="opacity: 0.8"><p><span style="color: #36826f">12 of 24</span></p></div>`,
      ),
    ).toEqual(['"12 of 24" 3.21']);
  });

  test('opacities multiply down the chain', async ({ page }) => {
    // #595959 is 7:1 on white; at 0.9 x 0.8 = 0.72 it draws at about 3.6:1.
    expect(
      await failuresOn(
        page,
        `<div style="opacity: 0.9"><div style="opacity: 0.8"><p style="color: #595959">Dimmed twice</p></div></div>`,
      ),
    ).toHaveLength(1);
  });

  test('the same text at full opacity, or dimmed but still dark enough, passes', async ({
    page,
  }) => {
    expect(
      await failuresOn(
        page,
        `<p style="color: #36826f">12 of 24</p>
         <div style="opacity: 0.8"><p style="color: #272323">Dark enough at 0.8</p></div>`,
      ),
    ).toEqual([]);
  });

  test('a colour below AA on its own is still caught', async ({ page }) => {
    expect(await failuresOn(page, `<p style="color: #999">Too light</p>`)).toEqual([
      '"Too light" 2.85',
    ]);
  });
});

test.describe('The disabled line', () => {
  /** The disabled controls on a fixture page that draw no line. */
  async function linelessOn(page: Page, html: string): Promise<string[]> {
    await page.setContent(`<!doctype html><html><head><style>
      body { margin: 0; font: 14px/20px sans-serif; background: #fff; }
      button { font: inherit; padding: 8px 16px; background: #f4f0e8; color: #5e5852; }
    </style></head><body>${html}</body></html>`);
    return disabledWithoutLine(page);
  }

  test('a disabled button drawn with no border, or a transparent one, is caught', async ({
    page,
  }) => {
    expect(
      await linelessOn(
        page,
        `<button class="publish-button" style="border: none" disabled>Publish results</button>
         <button class="nav-btn" style="border: 1px solid transparent" disabled>Next</button>`,
      ),
    ).toEqual(['button.publish-button "Publish results"', 'button.nav-btn "Next"']);
  });

  test('a disabled button inside its line, an enabled one with none, a hidden one, a link-styled one and a read-only form pass', async ({
    page,
  }) => {
    expect(
      await linelessOn(
        page,
        `<button style="border: 1px solid #d9d4cc" disabled>Save</button>
         <button style="border: none">Publish results</button>
         <button style="border: none; display: none" disabled>Hidden</button>
         <input type="checkbox" disabled />
         <button style="border: none; background: none; padding: 0" disabled>Resend code in 30s</button>
         <fieldset disabled><button style="border: none">12</button><input style="all: unset" value="Gold" /></fieldset>`,
      ),
    ).toEqual([]);
  });
});
