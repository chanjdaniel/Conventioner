import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { detectLayout, gates, minTargetAt, SPACE_SCALE, TYPE_SCALE } from './layoutDetectors';
import { inTheWindow, PHONE_AND_DESK, type PhoneOrDesk } from './phoneWindow';

/**
 * The component library (`/dev/components`, T200), as each of its specs opens it: a page of the
 * development build every stack runs, with no sign-in and no seed, at a desk and on a phone.
 *
 * `eachWindow` declares a spec's tests once per window; `openEntry` opens the index or one entry
 * and waits for it to be drawn; `expectLaidOut` holds the page to the layout detectors' gating
 * findings and to the window's width.
 */

export const LIBRARY_PATH = '/dev/components';

/** The tests of `body`, declared once for the phone and once for the desk. */
export function eachWindow(title: string, body: (size: PhoneOrDesk) => void): void {
  for (const size of PHONE_AND_DESK) {
    test.describe(`${title}, ${size.name}`, () => {
      test.use(size.use);
      body(size);
    });
  }
}

/** The library's index, or one entry by its id, drawn. */
export async function openEntry(page: Page, entry?: string): Promise<void> {
  await page.goto(entry ? `${LIBRARY_PATH}/${entry}` : LIBRARY_PATH);
  await expect(page.getByTestId(entry ? `library-entry-${entry}` : 'library-index')).toBeVisible();
}

/** Nothing scrolls sideways, and the detectors find nothing clipped, overlapping or off-scale. */
export async function expectLaidOut(page: Page, size: PhoneOrDesk, what: string): Promise<void> {
  await inTheWindow(size).expectFits(page, what);
  const { width } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(
    findings.filter((finding) => gates(finding, width)),
    `${what}: the layout detectors' gating findings`,
  ).toEqual([]);
}
