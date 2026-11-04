import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, openEntry } from './helpers/componentLibrary';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { inTheWindow, type PhoneOrDesk } from './helpers/phoneWindow';

/**
 * The component library's `components` entry (T200): each reusable component that exists today,
 * the real one, in the variants and states its props allow, its section naming the screens that
 * use it, ending with the choices left for Daniel; at a desk and on a phone, nothing scrolls
 * sideways or is clipped, and the components that act do.
 */

const COMPONENTS = [
  'ReadFailed',
  'PhaseBadge',
  'SummaryCard',
  'EmailAddress',
  'VendorNameButton',
  'RowMenu',
  'StepHeader',
  'AnswerValue',
  'SignInMessage',
  'BarLedger',
];

/**
 * The library's `expectLaidOut`, less one finding the real component brings with it:
 * `StepHeader`'s step is a 32px target, and its one screen, the form tab, is built for a desk
 * (the router's `fitsAPhone` names only Applications among a market's pages), so on a phone its
 * steps are under a thumb's 44px. The entry shows the component as it is, and asks Daniel about
 * it in its choices; every other finding still fails.
 */
async function expectLaidOut(page: Page, size: PhoneOrDesk, what: string): Promise<void> {
  await inTheWindow(size).expectFits(page, what);
  const { width } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  const stepAtDeskSize = (finding: { kind: string; el: string }) =>
    finding.kind === 'small-target' && finding.el.endsWith('.step-button');
  expect(
    findings.filter((finding) => gates(finding, width) && !stepAtDeskSize(finding)),
    `${what}: the layout detectors' gating findings`,
  ).toEqual([]);
}

eachWindow('the existing components entry', (size) => {
  test('shows each component, labelled with its screens, and fits the window', async ({ page }) => {
    await openEntry(page, 'components');

    const entry = page.getByTestId('library-entry-components');
    for (const name of COMPONENTS) {
      const heading = entry.getByRole('heading', { level: 2, name, exact: true });
      await expect(heading).toBeVisible();
      await expect(heading.locator('xpath=following-sibling::p[1]')).toContainText('Used on:');
    }
    // Six phases on each of the two intake paths, then no phase and an unknown one; and the
    // market rows' badges.
    await expect(entry.getByTestId('phase-badge')).toHaveCount(6 * 2 + 2 + 3);
    for (const state of ['Failed: offline', 'Empty: nothing counted', 'Empty: no notice']) {
      await expect(entry.getByRole('region', { name: state, exact: true })).toBeVisible();
    }
    await expect(
      entry
        .getByRole('region', { name: 'Waiting: the link is on its way (disabled)' })
        .getByRole('button', { name: 'Send the link again' }),
    ).toBeDisabled();
    // The ledger is unfolded, as today: every answer to the question is a row.
    await expect(entry.getByTestId('library-answer')).toHaveCount(228);
    await expect(page.getByTestId('choices-for-you')).toBeVisible();
    await expectLaidOut(page, size, 'the existing components entry');
  });

  test('its vendor name and row menu act, and read out what they did', async ({ page }) => {
    await openEntry(page, 'components');
    const press = inTheWindow(size).press;

    const vendor = page.getByRole('region', { name: 'A named vendor' });
    const name = await vendor.getByTestId('vendor-identity-name').textContent();
    await press(page.getByTestId('library-vendor-named'));
    await expect(
      page.getByRole('region', { name: 'Pressed', exact: true }).getByTestId('read-out'),
    ).toHaveText(`Opened the drawer of: ${name!.trim()}`);

    const menuButton = page.getByTestId('library-entry-menu-button');
    await press(menuButton);
    await expect(page.getByTestId('library-entry-menu')).toBeVisible();
    await press(page.getByTestId('library-entry-menu-remove'));
    await expect(page.getByTestId('library-entry-menu')).toBeHidden();
    await expect(menuButton).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Chosen', exact: true }).getByTestId('read-out'),
    ).toHaveText('Chose: remove');

    // Words on the button: named by them, and the same menu behind it.
    const words = page.getByRole('button', { name: 'organizer@example.com' });
    await press(words);
    await expect(page.getByTestId('library-account-menu')).toBeVisible();
    await press(page.getByTestId('library-account-menu-sign-out'));
    await expect(page.getByTestId('library-account-menu')).toBeHidden();
    await expect(words).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Chosen', exact: true }).getByTestId('read-out'),
    ).toHaveText('Chose: sign-out');
  });
});
