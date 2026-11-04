import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, LIBRARY_PATH, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';

/**
 * The component library's index (T200): a development build's page that opens with no sign-in and
 * no seed, lists every entry the library will hold in its groups with what each serves, links the
 * built ones and shows the rest as coming, and fits a phone and a desk.
 */

const ENTRIES = [
  'primitives',
  'components',
  'dialog',
  'combobox',
  'filter-toggles',
  'list-frame',
  'summaries',
  'folds',
  'proposals',
  'export-vendors',
];

eachWindow('the component library', (size) => {
  test('the index lists every entry with what it serves, signed out', async ({ page }) => {
    await page.context().clearCookies();
    await openEntry(page);

    await expect(page).toHaveURL(new RegExp(`${LIBRARY_PATH}$`));
    for (const entry of ENTRIES) {
      await expect(page.getByTestId(`library-index-${entry}`)).toContainText('Serves:');
    }
    await expectLaidOut(page, size, 'the index');
  });

  test('a built entry is a link; its page has the way to the others', async ({ page }) => {
    await openEntry(page);
    await inTheWindow(size).press(
      page.getByTestId('library-index-primitives').getByRole('link', { name: 'Primitives' }),
    );
    await expect(page.getByTestId('library-entry-primitives')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Primitives');
    await expect(page.getByTestId('library-serves')).toContainText('Every screen');

    if (size.phone) {
      await expect(page.getByTestId('library-side-index')).toBeHidden();
      await page.getByTestId('library-entry-select').selectOption('');
    } else {
      await expect(page.getByTestId('library-entry-select')).toBeHidden();
      await page
        .getByTestId('library-side-index')
        .getByRole('link', { name: 'All components' })
        .click();
    }
    await expect(page.getByTestId('library-index')).toBeVisible();
  });

  test('an entry the library does not have is "page not found"', async ({ page }) => {
    await page.goto(`${LIBRARY_PATH}/no-such-entry`);
    await expect(page.getByTestId('page-not-found')).toBeVisible();
  });
});
