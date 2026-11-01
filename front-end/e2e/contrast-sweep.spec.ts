import { test, expect } from './fixtures';
import { settle } from './helpers/settle';
import { walkTheScreens, type Check } from './helpers/screens';
import type { Page } from '@playwright/test';
import { disabledWithoutLine, sweep } from './helpers/contrastSweep';

/**
 * Every rendered text node reaches WCAG AA, on the ground it is actually painted on (E16/F01/S05).
 *
 * `src/__tests__/contrast.test.ts` asserts the palette and is kept: it fails in milliseconds with a
 * precise message when `base.css` changes, where this sweep would only say "something on the
 * Applications screen went dark". What it cannot see is a USAGE. Two failures proved that:
 *
 *   - the Skip button put white text on `--mm-border`, at **1.74:1**. That token is exempt from the
 *     contract on the stated grounds that it "never carries text", so the unit test was structurally
 *     incapable of noticing that it had been made into a fill.
 *   - the current-phase label rendered `--mm-green` on the rail's `#fbfbfa` at **4.43:1**. The token
 *     is correct - 4.59 on white - but white was not the ground it was used on.
 *
 * **A sweep is only worth the states it walks**, so the states are one list, `helpers/screens.ts`,
 * shared with the accessibility and layout sweeps. Contrast does not change with the window, so each
 * state is measured at the first size it ships at.
 *
 * Each state is also checked for the one disabled state's line (`expectDisabledLine`), the other
 * half of how a disabled control reads.
 */

/**
 * A screen with no more visible text nodes than this has not rendered, whatever it reports.
 *
 * One, not more: the sparsest state walked is a market's public page, which measures two - the
 * market's name and its address - and a page still loading measures one, "Loading...". The floor
 * is here to catch a blank render, not to pin a design decision about how much copy a screen
 * carries.
 */
const MIN_TEXT_NODES = 1;

async function expectAA(page: Page, state: string): Promise<void> {
  await settle(page);
  const { failures, checked } = await sweep(page);
  expect(
    failures.map((f) => `"${f.text}" ${f.ratio}:1 (needs ${f.needs}) ${f.color} on ${f.ground}`),
    `${state} has text below AA`,
  ).toEqual([]);
  expect(checked, `${state} rendered almost no text, so its pass means nothing`).toBeGreaterThan(
    MIN_TEXT_NODES,
  );
}

/**
 * Every disabled control is drawn in the one disabled state, its line included (T162): a control of
 * a component's own drawn with `border: none` took the state's beige and ink and no line, so the app
 * showed two disabled looks side by side, and nothing failed. Its words are measured by `expectAA`.
 */
async function expectDisabledLine(page: Page, state: string): Promise<void> {
  expect(await disabledWithoutLine(page), `${state} has a disabled control with no line`).toEqual(
    [],
  );
}

const contrastTest = test.extend<{ check: Check }>({
  check: async ({ page }, use) => {
    await use(async (state) => {
      await expectAA(page, state);
      await expectDisabledLine(page, state);
    });
  },
});

test.describe('Every rendered text node reaches AA', () => {
  walkTheScreens(contrastTest, { everySize: false });
});
