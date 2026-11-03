import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's `primitives` entry (T200): every primitive of `primitives.css` in its
 * variants and states, each in a labelled panel, ending with the choices left for Daniel; at a
 * desk and on a phone, nothing scrolls sideways or is clipped, and the live controls act.
 */

const SECTIONS = [
  'Buttons',
  'Fields',
  'Chips',
  'Add-row, drag handle and link',
  'Card grid',
  'Note and choice cards',
];

eachWindow('the primitives entry', (size) => {
  test('shows every primitive, labelled, and fits the window', async ({ page }) => {
    await openEntry(page, 'primitives');

    const entry = page.getByTestId('library-entry-primitives');
    for (const title of SECTIONS) {
      await expect(entry.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    for (const label of ['Primary', 'Secondary', 'Destructive', 'Compact', 'Select: disabled']) {
      await expect(entry.getByRole('region', { name: label, exact: true })).toBeVisible();
    }
    await expect(entry.locator('.chip')).toHaveCount(5);
    await expect(page.getByTestId('choices-for-you')).toBeVisible();
    await expectLaidOut(page, size, 'the primitives entry');
  });

  test('its live controls act, and read out what they hold', async ({ page }) => {
    await openEntry(page, 'primitives');
    const press = inTheWindow(size).press;

    const toggles = page.getByRole('group', { name: 'Statuses' });
    await press(toggles.getByRole('button', { name: 'Approved' }));
    await expect(toggles.getByRole('button', { name: 'Approved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const toggled = page.getByRole('region', { name: 'Toggle (aria-pressed)' });
    await expect(toggled.getByTestId('read-out')).toHaveText('Pressed: Open, Approved');

    const filled = page.getByRole('region', { name: 'Text: filled' });
    await filled.getByRole('textbox').fill('Example Prints');
    await expect(filled.getByTestId('read-out')).toHaveText('Typed: Example Prints');

    const section = page.getByRole('region', { name: 'Select: filled' });
    await section.getByRole('combobox').selectOption('South Wing');
    await expect(section.getByTestId('read-out')).toHaveText('Chosen: South Wing');
  });
});
