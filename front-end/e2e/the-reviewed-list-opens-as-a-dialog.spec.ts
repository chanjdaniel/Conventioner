import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { expectWholeAddress } from './helpers/addressBreaks';
import { expectLaidOut } from './helpers/componentLibrary';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import { marketScreenPath } from './helpers/marketScreens';
import { insertApplications } from './helpers/seedApplication';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { settle } from './helpers/settle';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * "Show N reviewed" opens a dialog over the card (T217, E38/F10/S01).
 *
 * It used to unfold above the card, a market's every verdict pushing the work down. In a dialog the
 * card never moves, a find field and pages hold the rows, and changing a verdict leaves the reviewer
 * in the dialog, on that row.
 */

const REVIEWED = 160;
const DOMAIN = 'reviewed-list.test';

const address = (n: number) => `vendor-${String(n).padStart(3, '0')}@${DOMAIN}`;

/** Row 1 of the list is the newest verdict, row `REVIEWED` the oldest. */
function reviewedRows(marketId: string) {
  const now = Date.now();
  return Array.from({ length: REVIEWED }, (_, i) => {
    const row = i + 1;
    const at = new Date(now - row * 60_000).toISOString();
    return {
      id: `reviewed-${marketId}-${row}`,
      market_id: marketId,
      applicant_email: address(row),
      form_data: { essential_full_name: `Vendor Number ${row}` },
      status: row % 2 ? 'reviewer_rejected' : 'reviewer_approved',
      verdict_by: { kind: 'person', email: TEST_USER.email },
      verdict_at: at,
      application_type: 'main',
      submitted_at: at,
      updated_at: at,
    };
  });
}

/** A market of its own: a test here changes a verdict, which reorders the others' rows. */
async function aMarket(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', `amy@${DOMAIN}`);
  seedApplicationWithStatus(marketId, 'open', `ben@${DOMAIN}`);
  seedApplicationWithStatus(marketId, 'open', `cleo@${DOMAIN}`);
  insertApplications(reviewedRows(marketId));
  return marketId;
}

async function theCardUp(page: Page, marketId: string): Promise<ApplicationMonitorPage> {
  const monitor = new ApplicationMonitorPage(page);
  await monitor.goto(marketId);
  await monitor.waitForLoaded();
  await expect(monitor.email).toBeVisible({ timeout: 15000 });
  return monitor;
}

test.describe('The reviewed applications, in a dialog', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('it opens over the card, which does not move, with 50 rows of 160', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    await expect(monitor.decidedOpen).toHaveText(`Show ${REVIEWED} reviewed`);
    await expect(monitor.decidedOpen).not.toHaveAttribute('aria-expanded');
    const approve = await monitor.approveButton.boundingBox();

    await monitor.openDecided();

    await expect(monitor.decidedDialog).toHaveAttribute('aria-label', 'Reviewed applications');
    await expect(monitor.decidedOpen).toHaveText(`Show ${REVIEWED} reviewed`);
    expect(await monitor.approveButton.boundingBox()).toEqual(approve);

    await expect(monitor.decidedCount).toHaveText(`Showing 50 of ${REVIEWED}`);
    await expect(monitor.decidedRows).toHaveCount(50);
    await expect(monitor.decidedEmails.first()).toHaveText(address(1));
    await expect(monitor.decidedFind).toBeFocused();

    // Each row's change stands at the row's end, whatever the length of its giver's line.
    const rightEdges = new Set<number>();
    for (const verdict of ['approve', 'reject'] as const) {
      const box = await monitor.changeButton(verdict).first().boundingBox();
      rightEdges.add(Math.round(box!.x + box!.width));
    }
    expect(rightEdges.size).toBe(1);
    // And the verdict over it is a chip of its own width, ending where the change ends.
    const chip = (await monitor.decidedStatusOf(address(1)).boundingBox())!;
    const change = (await monitor.changeButton('approve', address(1)).boundingBox())!;
    expect(chip.width).toBeLessThan(change.width);
    expect(Math.round(chip.x + chip.width)).toBe(Math.round(change.x + change.width));

    // At most 80% of the window, its title and close held while its body scrolls.
    const box = (await monitor.decidedDialog.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(800 * 0.8 + 1);
    const title = monitor.decidedDialog.getByRole('heading', { level: 2 });
    const titleAt = await title.boundingBox();
    await expect(page.getByTestId('app-monitor-decided-shade-bottom')).toBeVisible();
    await page.getByTestId('app-monitor-decided-body').hover();
    await page.mouse.wheel(0, 600);
    await expect(page.getByTestId('app-monitor-decided-shade-top')).toBeVisible();
    expect(await title.boundingBox()).toEqual(titleAt);

    await monitor.decidedMore.click();
    await expect(monitor.decidedRows).toHaveCount(100);
    await expect(page.getByTestId('app-monitor-decided-list-row').nth(50)).toBeFocused();
  });

  test('it finds by name and by address, past the first page, and forgets on closing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    await monitor.openDecided();
    await expect(monitor.decidedRow(address(120))).toHaveCount(0);
    const fieldAt = await monitor.decidedFind.boundingBox();

    await monitor.decidedFind.fill('Number 120');
    await expect(monitor.decidedEmails).toHaveText([address(120)]);
    await expect(monitor.decidedCount).toHaveText(`1 of ${REVIEWED} matches "Number 120"`);
    // The rows going leave the dialog shorter, with the field still under the caret.
    await settle(page);
    expect(await monitor.decidedFind.boundingBox()).toEqual(fieldAt);

    await monitor.decidedFind.fill(address(121).toUpperCase());
    await expect(monitor.decidedEmails).toHaveText([address(121)]);

    // Enter in the field does nothing: there is nothing to submit, and the list is still open.
    await page.keyboard.press('Enter');
    await expect(monitor.decidedDialog).toBeVisible();

    await monitor.closeDecided();
    await monitor.openDecided();
    await expect(monitor.decidedFind).toHaveValue('');
    await expect(monitor.decidedRows).toHaveCount(50);
  });

  test('changing a verdict holds the dialog, the rows shown and the focus, never on the page', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    const up = ((await monitor.email.textContent()) ?? '').trim();
    await monitor.openDecided();
    await monitor.decidedMore.click();
    await expect(monitor.decidedRows).toHaveCount(100);

    // Every frame from here to the answer: where focus stands.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { focusSeen: string[] }).focusSeen = seen;
      const look = () => {
        seen.push(document.activeElement?.tagName ?? 'none');
        requestAnimationFrame(look);
      };
      look();
    });

    // The answer held, so the moment the button is disabled is long enough to be seen.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route('**/applications/*/review', async (route) => {
      await answered;
      await route.continue();
    });

    const row = address(81);
    const rejected = monitor.changeButton('approve', row);
    await rejected.click();
    await expect(monitor.changeButton('approve', address(83))).toBeDisabled();
    await settle(page);
    answer();

    const nowApproved = monitor.changeButton('reject', row);
    await expect(nowApproved).toBeFocused();
    await expect(nowApproved).toBeInViewport();
    await expect(monitor.decidedStatusOf(row)).toHaveText('Approved');
    await page.unroute('**/applications/*/review');

    const frames = await page.evaluate(
      () => (window as unknown as { focusSeen: string[] }).focusSeen,
    );
    expect(frames.length).toBeGreaterThan(5);
    expect(frames).not.toContain('BODY');

    await expect(monitor.decidedDialog).toBeVisible();
    await expect(monitor.decidedRows).toHaveCount(100);
    await expect(monitor.decidedEmails.nth(80)).toHaveText(row);

    // Tab goes on from that row, to the next row's change.
    await page.keyboard.press('Tab');
    await expect(monitor.decidedRows.nth(81).getByRole('button')).toBeFocused();

    await monitor.closeDecided();
    await expect(monitor.email).toHaveText(up);
  });

  test('a changed row keeps its place while the dialog is open, and leads the list once it reopens', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    const firstFive = () =>
      monitor.decidedEmails.evaluateAll((emails) =>
        emails.slice(0, 5).map((email) => email.textContent?.trim()),
      );
    await monitor.openDecided();
    expect(await firstFive()).toEqual([1, 2, 3, 4, 5].map(address));

    // Row 3 was rejected and row 2 approved: each change is the newest verdict, and neither moves.
    await monitor.changeButton('approve', address(3)).click();
    await expect(monitor.decidedStatusOf(address(3))).toHaveText('Approved');
    expect(await firstFive()).toEqual([1, 2, 3, 4, 5].map(address));
    await monitor.changeButton('reject', address(2)).click();
    await expect(monitor.decidedStatusOf(address(2))).toHaveText('Rejected');
    expect(await firstFive()).toEqual([1, 2, 3, 4, 5].map(address));
    await expect(monitor.changeButton('reject', address(3))).toBeEnabled();

    await monitor.closeDecided();
    await monitor.openDecided();
    expect(await firstFive()).toEqual([2, 3, 1, 4, 5].map(address));
  });

  test('a change the server refuses is said in the dialog, and the card stays', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    const up = ((await monitor.email.textContent()) ?? '').trim();
    await monitor.openDecided();
    await page.route('**/applications/*/review', (route) =>
      route.fulfill({ status: 403, json: { error: 'That is not yours to change.' } }),
    );

    await monitor.changeButton('approve', address(1)).click();

    await expect(page.getByTestId('app-monitor-decided-error')).toContainText(
      'That is not yours to change.',
    );
    await expect(monitor.changeButton('approve', address(1))).toBeFocused();
    await monitor.closeDecided();
    await expect(monitor.email).toHaveText(up);
    await expect(page.getByTestId('app-monitor-card')).not.toContainText(
      'That is not yours to change.',
    );
  });

  test('A, R, S, N and Z do nothing to the card, from a row or from its window', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    // A verdict first, so Z has one to undo.
    await monitor.approveButton.click();
    await expect(monitor.undoLine).toBeVisible();
    await expect(monitor.approveButton).toBeEnabled();
    const up = ((await monitor.email.textContent()) ?? '').trim();
    await monitor.openDecided();

    // A verdict, an undo, a follow-up or a hand-out; a key may renew the claim, which moves nothing.
    const moved: string[] = [];
    page.on('request', (sent) => {
      if (/\/review(\/next|\/undo)?$|\/verdicts|\/follow-up/.test(new URL(sent.url()).pathname)) {
        moved.push(sent.url());
      }
    });

    for (const focused of [monitor.changeButton('approve').first(), monitor.decidedDialog]) {
      await focused.focus();
      for (const key of ['a', 'r', 's', 'n', 'z']) await page.keyboard.press(key);
    }
    await settle(page);

    expect(moved).toEqual([]);
    await expect(monitor.decidedDialog).toBeVisible();
    await expect(page.getByTestId('follow-up-window')).toHaveCount(0);

    await monitor.closeDecided();
    await expect(monitor.email).toHaveText(up);
    await expect(monitor.undoLine).toBeVisible();

    // And it was the dialog that held them: with it closed, the same key is a verdict.
    await page.keyboard.press('a');
    await expect(monitor.email).not.toHaveText(up);
  });

  test('the close, Escape and the backdrop each give focus back, the same card up', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    const up = ((await monitor.email.textContent()) ?? '').trim();
    const ways: [string, () => Promise<void>][] = [
      ['the close', () => page.getByTestId('app-monitor-decided-close-button').click()],
      ['Escape', () => page.keyboard.press('Escape')],
      [
        'the backdrop',
        () =>
          page.getByTestId('app-monitor-decided-background').click({ position: { x: 4, y: 4 } }),
      ],
    ];
    for (const [how, close] of ways) {
      await monitor.openDecided();
      await close();
      await expect(monitor.decidedDialog, how).toHaveCount(0);
      await expect(monitor.decidedOpen, how).toBeFocused();
      await expect(monitor.email, how).toHaveText(up);
    }
  });

  test('a link naming a reviewed application past row 50 opens on it, marked', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await aMarket(request);
    const named = `reviewed-${marketId}-140`;
    await page.goto(`${marketScreenPath(marketId, 'applications')}?application=${named}`);

    const monitor = new ApplicationMonitorPage(page);
    await expect(monitor.decidedDialog).toBeVisible({ timeout: 15000 });
    await expect(monitor.decidedFind).toHaveValue(address(140));
    await expect(monitor.decidedEmails).toHaveText([address(140)]);
    await expect(monitor.decidedRow(address(140))).toHaveClass(/named/);
    await expect(monitor.decidedRow(address(140))).toBeInViewport();

    // Behind it, a card is up as on any opening of the review.
    await expect(monitor.email).toBeAttached();

    // Closing clears the words and gives focus to the button, which nothing pressed.
    await page.keyboard.press('Escape');
    await expect(monitor.decidedDialog).toHaveCount(0);
    await expect(monitor.decidedOpen).toBeFocused();
    await monitor.openDecided();
    await expect(monitor.decidedFind).toHaveValue('');
    await expect(monitor.decidedRows).toHaveCount(50);
  });
});

test.describe('The reviewed applications on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the dialog holds its top and runs to the gutter, and a row reads inside it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    await monitor.decidedOpen.tap();
    await expect(monitor.decidedDialog).toBeVisible();
    await settle(page);

    const box = (await monitor.decidedDialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    // An anchored dialog: 48px above it for the top it holds, the 24px gutter below.
    expect(box.height).toBeCloseTo(844 - 48 - 24, 0);

    const row = (await monitor.decidedRows.first().boundingBox())!;
    expect(row.x).toBeGreaterThanOrEqual(box.x);
    expect(row.x + row.width).toBeLessThanOrEqual(box.x + box.width);
    const change = (await monitor.changeButton('approve').first().boundingBox())!;
    expect(change.height).toBeGreaterThanOrEqual(44);
    const body = page.getByTestId('app-monitor-decided-body');
    const sideways = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sideways).toBe(0);
  });

  test('a reviewed row\'s address breaks only before its "@" or a dot, in the dialog', async ({
    authenticatedPage: page,
    request,
  }) => {
    const monitor = await theCardUp(page, await aMarket(request));
    await monitor.decidedOpen.tap();
    await expect(monitor.decidedDialog).toBeVisible();
    await settle(page);

    // Row 1 is the newest verdict: vendor-001, the address a phone broke mid-word.
    const email = monitor.decidedEmails.first();
    await expect(email).toHaveText(address(1));
    await expectWholeAddress(email, address(1));
    await expectWholeAddress(email, address(1), true);
  });

  for (const { what, giver } of [
    // 60 characters with no hyphen, so plain text has nowhere to break.
    { what: 'with no hyphen', giver: `${'giver'.repeat(10)}@fern.test` },
    { what: 'with hyphens', giver: `a-very-long-giver-address-for-a-narrow-row@${DOMAIN}` },
  ]) {
    test(`who gave a verdict, a long address ${what}, stays in the row and breaks only before its "@" or a dot`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const marketId = await aMarket(request);
      const applicant = `given-by-long@${DOMAIN}`;
      const at = new Date().toISOString();
      insertApplications([
        {
          id: `reviewed-${marketId}-long-giver`,
          market_id: marketId,
          applicant_email: applicant,
          form_data: { essential_full_name: 'Vendor Long Giver' },
          status: 'reviewer_rejected',
          verdict_by: { kind: 'person', email: giver },
          verdict_at: at,
          application_type: 'main',
          submitted_at: at,
          updated_at: at,
        },
      ]);
      const monitor = await theCardUp(page, marketId);
      await monitor.decidedOpen.tap();
      await expect(monitor.decidedDialog).toBeVisible();
      await settle(page);

      const line = monitor.decidedGiverOf(applicant);
      await expect(line).toContainText(`Rejected by ${giver}, `);
      const { text, row } = await line.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          text: range.getBoundingClientRect().right,
          row: el.closest('[data-testid="app-monitor-decided-row"]')!.getBoundingClientRect().right,
        };
      });
      expect(text).toBeLessThanOrEqual(row);
      const body = page.getByTestId('app-monitor-decided-body');
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

      await expectWholeAddress(line, giver);
      await expectWholeAddress(line, giver, true);
    });
  }

  const THE_PHONE = PHONE_AND_DESK.find((size) => size.name === 'on a phone')!;

  /** An address with nothing to break at, leading the list, as the row the change is on. */
  const UNBROKEN = `${'applicant'.repeat(8)}@${DOMAIN}`;

  function anUnbrokenRow(marketId: string) {
    const at = new Date().toISOString();
    insertApplications([
      {
        id: `reviewed-${marketId}-unbroken`,
        market_id: marketId,
        applicant_email: UNBROKEN,
        form_data: { essential_full_name: 'Vendor Unbroken' },
        status: 'reviewer_rejected',
        verdict_by: { kind: 'person', email: TEST_USER.email },
        verdict_at: at,
        application_type: 'main',
        submitted_at: at,
        updated_at: at,
      },
    ]);
  }

  /** Press the change on the unbroken row, close with the answer held, then let it be refused. */
  async function aChangeRefusedAfterClosing(page: Page, monitor: ApplicationMonitorPage) {
    await page.unroute('**/applications/*/review');
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route('**/applications/*/review', async (route) => {
      await answered;
      await route.fulfill({ status: 403, json: { error: 'That is not yours to change.' } });
    });
    await monitor.decidedOpen.tap();
    await monitor.changeButton('approve', UNBROKEN).tap();
    await page.getByTestId('app-monitor-decided-close-button').tap();
    await expect(monitor.decidedDialog).toBeHidden();
    answer();
  }

  /** The line, read in full by its `Range`, inside its box, and the page no wider than the window. */
  async function expectTheLineFits(page: Page, testid: string) {
    const line = page.getByTestId(testid);
    await expect(line).toContainText('was not changed: That is not yours to change.');
    await settle(page);
    const { text, box } = await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        text: range.getBoundingClientRect().right,
        box: el.getBoundingClientRect().right,
      };
    });
    expect(text).toBeLessThanOrEqual(box);
    expect(box).toBeLessThanOrEqual(390);
    await expectLaidOut(page, THE_PHONE, testid);
  }

  test('a long address on the card line, after a change refused with the dialog closed, stays on the phone', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await aMarket(request);
    anUnbrokenRow(marketId);
    const monitor = await theCardUp(page, marketId);

    await aChangeRefusedAfterClosing(page, monitor);

    await expectTheLineFits(page, 'app-monitor-error');
  });

  /** An open application leading the queue, with an address that has to break on a phone. */
  function aLongCardFirst(marketId: string, applicant: string) {
    const at = '2026-01-01T00:00:00.000Z';
    insertApplications([
      {
        id: `open-${marketId}-long-card`,
        market_id: marketId,
        applicant_email: applicant,
        form_data: { essential_full_name: 'Vendor Long Card' },
        status: 'open',
        application_type: 'main',
        submitted_at: at,
        updated_at: at,
      },
    ]);
  }

  test('the card\'s own long address breaks only before its "@" or a dot', async ({
    authenticatedPage: page,
    request,
  }) => {
    const applicant = `a-very-long-applicant-address-on-the-card@${DOMAIN}`;
    const marketId = await aMarket(request);
    aLongCardFirst(marketId, applicant);
    const monitor = await theCardUp(page, marketId);
    await expect(monitor.email).toHaveText(applicant);
    await settle(page);

    await expectWholeAddress(monitor.email, applicant);
    await expectWholeAddress(monitor.email, applicant, true);
  });

  test('a refused card names who decided it first, a long address breaking only before its "@" or a dot, with room under the line', async ({
    authenticatedPage: page,
    request,
  }) => {
    const giver = `a-very-long-giver-address-for-a-narrow-row@${DOMAIN}`;
    const marketId = await aMarket(request);
    const monitor = await theCardUp(page, marketId);
    const up = ((await monitor.email.textContent()) ?? '').trim();
    await page.route('**/applications/*/review', (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: 'Someone approved this application since you opened it.',
          application: {
            id: route.request().url().split('/').at(-2),
            status: 'reviewer_approved',
            applicantEmail: up,
            verdictBy: { kind: 'person', email: giver },
            verdictAt: new Date().toISOString(),
          },
        },
      }),
    );
    await monitor.rejectButton.tap();
    const changed = page.getByTestId('app-monitor-changed');
    await expect(changed).toBeVisible();
    await settle(page);

    // The band's margin keeps it off the answers below, which have none above them.
    const { margin, gap } = await changed.evaluate((el) => ({
      margin: getComputedStyle(el).marginBottom,
      gap: el.nextElementSibling!.getBoundingClientRect().top - el.getBoundingClientRect().bottom,
    }));
    expect(margin).toBe('12px');
    expect(gap).toBeGreaterThanOrEqual(12);

    const line = page.getByTestId('app-monitor-changed-giver');
    await expect(line).toContainText(`Approved by ${giver}, `);
    await expectWholeAddress(line, giver);
    await expectWholeAddress(line, giver, true);
  });

  test('a long address on a refused card, beside who decided it first, stays on the phone', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await aMarket(request);
    anUnbrokenRow(marketId);
    const monitor = await theCardUp(page, marketId);
    const up = ((await monitor.email.textContent()) ?? '').trim();
    await page.route('**/applications/*/review', (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: `${TEST_USER.email} approved this application since you opened it.`,
          application: {
            id: route.request().url().split('/').at(-2),
            status: 'reviewer_approved',
            applicantEmail: up,
            verdictBy: { kind: 'person', email: TEST_USER.email },
            verdictAt: new Date().toISOString(),
          },
        },
      }),
    );
    await monitor.rejectButton.tap();
    await expect(page.getByTestId('app-monitor-changed')).toBeVisible();

    await aChangeRefusedAfterClosing(page, monitor);

    await expectTheLineFits(page, 'app-monitor-changed');
  });
});
