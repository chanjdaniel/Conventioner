import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * A verdict given by mistake is undone at once, and a past one is easy to find (E38/F10/S01).
 *
 * An Editor, who may not change a verdict once given, rejects by key, reads what they decided above
 * the next card and undoes it from that line: the application is up again as the card, open. The
 * reviewed list's toggle sits beside the counts, above the card without a scroll at 1440x900, and
 * the list is newest verdict first, each row naming the applicant.
 */
const EDITOR = { email: 'e2e-undo-editor@example.com', password: 'e2epassword123' } as const;

let marketId = '';

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  // Decided before the review kept a verdict's time: last in the reviewed list.
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'cleo@fern.test', {
    essential_full_name: 'Cleo Fern',
  });
  seedApplicationWithStatus(marketId, 'open', 'ben@ember.test', {
    essential_full_name: 'Ben Okafor',
  });
  seedApplicationWithStatus(marketId, 'open', 'ana@thistle.test', {
    essential_full_name: 'Ana Rivera',
  });
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: EDITOR.email, role: 'editor' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
});

test.use({ viewport: { width: 1440, height: 900 } });

test('an Editor rejects by key, undoes from the line, and finds an earlier verdict at the top', async ({
  browser,
}) => {
  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    const review = new ApplicationMonitorPage(page);
    await review.goto(marketId);
    await review.waitForLoaded();

    // An earlier verdict, by click.
    await review.approve('ben@ember.test');

    // Then a slip, by key: the line above the next card says what was decided.
    await review.advanceTo('ana@thistle.test');
    await expect(review.name).toHaveText('Ana Rivera');
    await page.keyboard.press('r');
    await expect(review.undoLine).toContainText('Rejected Ana Rivera (ana@thistle.test).');
    await expect(review.undoLine).toHaveAttribute('role', 'status');

    // Undo puts the application back up as the card, open again.
    await review.undoButton.click();
    await expect(review.undoLine).toHaveCount(0);
    await expect(review.email).toHaveText('ana@thistle.test');
    await expect(review.status).toHaveText('Open');

    // The toggle is beside the counts, above the card, in view without a scroll.
    await expect(review.decidedToggle).toBeInViewport();
    const toggle = await review.decidedToggle.boundingBox();
    const card = await review.card.boundingBox();
    expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(card!.y);

    // Newest verdict first: Ben's, then the one decided before verdicts kept a time.
    await review.openDecided();
    await expect(review.decidedNames).toHaveText(['Ben Okafor', 'Cleo Fern']);
    await expect(review.decidedEmails).toHaveText(['ben@ember.test', 'cleo@fern.test']);
  });
});
