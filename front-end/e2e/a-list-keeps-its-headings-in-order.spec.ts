import AxeBuilder from '@axe-core/playwright';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { MarketsPage } from './pages/MarketsPage';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * A list's cards are headed one level under the page's title, so a screen reader's outline of the
 * page skips no level: Markets and Organizations are each an `h1` over one `h2` per card. axe's
 * `heading-order` is a best practice rather than WCAG, so the suite-wide check leaves it out, and
 * this holds it for the two lists.
 */
async function headingsOutOfOrder(page: import('@playwright/test').Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'rule', values: ['heading-order'] } })
    .analyze();
  return violations.flatMap((v) => v.nodes.map((node) => node.target.join(' ')));
}

/** axe's outline rules: no skipped level, and a title for a screen reader to land on. */
async function outlineViolations(page: import('@playwright/test').Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .options({ runOnly: { type: 'rule', values: ['heading-order', 'page-has-heading-one'] } })
    .analyze();
  return violations.map((v) => v.id);
}

/**
 * The words of every heading inside a link or a button. axe judges neither, but a control is named
 * by its words, and a heading inside one makes the control part of the page's outline.
 */
async function headingsInsideControls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(':is(a, button) :is(h1, h2, h3, h4, h5, h6)')).map((h) =>
      (h.textContent ?? '').trim(),
    ),
  );
}

test('Markets heads each card one level under its title', async ({ authenticatedPage: page }) => {
  await new MarketsPage(page).goto();
  await expect(page.getByTestId('market-card').first()).toBeVisible();

  expect(await headingsOutOfOrder(page)).toEqual([]);
});

test('Organizations heads each card one level under its title', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/organizations');
  await expect(page.getByTestId('organization-card').first()).toBeVisible();

  expect(await headingsOutOfOrder(page)).toEqual([]);
});

/**
 * Markets has one title for a screen reader to land on, and "Previously opened" adds no heading:
 * the remembered market's name is words on a control, and each card's name one level under the title.
 */
test('Markets opens with its title, the remembered market adding no heading', async ({
  authenticatedPage: page,
  request,
}) => {
  // Beside the one the fixture seeds: one market gets no line.
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  try {
    await new MarketsPage(page).goto();
    const card = page.getByTestId('market-card').first();
    const name = (await card.getByTestId('market-card-name').innerText()).trim();
    await card.getByTestId('market-card-name').getByRole('button').click();
    await expect(page.getByTestId('market-bar-title')).toHaveText(name, { timeout: 15000 });

    await page.goto('/markets');
    await expect(page.getByTestId('markets-previously-opened')).toContainText(name);

    expect(await outlineViolations(page)).toEqual([]);
    expect(await headingsInsideControls(page)).toEqual([]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markets');
    await expect(page.getByTestId('markets-previously-opened').getByRole('heading')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: name })).toHaveCount(1);
  } finally {
    const deleted = await request.delete(`${BACKEND_URL}/markets/${marketId}`);
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  }
});

/** The Assignments page heads a section one level under its date, folded or not (T223). */
test('the Assignments page heads each section under its date, folded and unfolded', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { tables: 21 },
  );
  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(page.getByTestId('tables-show-all')).toHaveText('Show all 21 tables');
  const group = page.getByTestId('tables-date-group');
  await expect(group.getByRole('heading', { level: 2 })).toHaveCount(1);
  await expect(group.getByRole('heading', { level: 3 })).toHaveCount(1);
  expect(await outlineViolations(page)).toEqual([]);
  expect(await headingsInsideControls(page)).toEqual([]);

  await page.getByTestId('tables-show-all').click();
  await expect(page.getByTestId('tables-table-row')).toHaveCount(21);
  expect(await outlineViolations(page)).toEqual([]);
  expect(await headingsInsideControls(page)).toEqual([]);
});

/** The sheet's links are named by their words, and it adds no heading to the page's outline. */
test('the sheet heads none of its links', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await new MarketsPage(page).goto();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const sheet = page.getByTestId('app-bar-sheet');
  await expect(sheet.getByRole('link', { name: 'Organizations' })).toBeVisible();

  expect(await outlineViolations(page)).toEqual([]);
  expect(await headingsInsideControls(page)).toEqual([]);
  await expect(sheet.getByRole('heading')).toHaveCount(0);
});

/** The heading just before the one named, as `h<level> <words>`: what an outline files it under. */
async function headingBefore(
  page: import('@playwright/test').Page,
  words: string,
): Promise<string | undefined> {
  return page.evaluate((named) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
      (h) => (h as HTMLElement).offsetParent !== null,
    );
    const at = headings.findIndex((h) => (h.textContent ?? '').trim() === named);
    const before = headings[at - 1];
    return before ? `${before.tagName.toLowerCase()} ${(before.textContent ?? '').trim()}` : '';
  }, words);
}

/**
 * A vendor's notes are labelled by third-level headings, so wherever they show, a second-level
 * heading names the vendor just above them: the card's name line on One by one, the drawer's title
 * from the All view (T95 note 6). An archived market has no Reviewers panel, whose heading was the
 * only `h2` above the card.
 */
test('the review heads a vendor just before their notes, open, in the drawer and archived', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const applicant = 'e2e-heading-order@example.com';
  seedApplicationWithStatus(marketId, 'open', applicant, {
    essential_full_name: 'Ada Lane',
    category: 'Crafts',
  });
  const noted = await request.put(
    `${BACKEND_URL}/markets/${marketId}/vendor-notes/${encodeURIComponent(applicant)}`,
    { data: { note: 'Asked for a corner table' } },
  );
  expect(noted.ok(), await noted.text()).toBeTruthy();

  const monitor = new ApplicationMonitorPage(page);
  const notesUnderTheCard = async () => {
    await expect(monitor.email).toHaveText(applicant, { timeout: 15000 });
    await monitor.openNotes();
    await expect(monitor.notes.getByRole('heading', { level: 3, name: 'Your note' })).toBeVisible();
    expect(await headingsOutOfOrder(page)).toEqual([]);
    await expect(monitor.heading).toHaveText('Ada Lane');
    expect(await headingBefore(page, 'Your note')).toBe('h2 Ada Lane');
  };

  await monitor.goto(marketId);
  await notesUnderTheCard();

  const all = new ApplicationsAllPage(page);
  await all.switchTo();
  await all.open(applicant);
  await expect(all.drawer.getByRole('heading', { level: 3, name: 'Your note' })).toBeVisible();
  expect(await headingsOutOfOrder(page)).toEqual([]);
  expect(await headingBefore(page, 'Your note')).toBe('h2 Ada Lane');

  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'archived');
  await monitor.goto(marketId);
  await notesUnderTheCard();
});
