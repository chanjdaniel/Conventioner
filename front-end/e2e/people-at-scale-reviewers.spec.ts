import type { Locator, Page, Route } from '@playwright/test';
import { test, expect, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { FollowUpDialog } from './pages/FollowUpDialog';
import { ReviewersPanel } from './pages/ReviewersPanel';
import { disabledWithoutLine, sweep } from './helpers/contrastSweep';
import { oneByOnePath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { expectLaidOut, PAGE } from './helpers/peopleAtScale';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import {
  PEOPLE_AT_SCALE_PASSWORD,
  seedPeopleAtScale,
  type PeopleAtScaleSeed,
} from './helpers/seedPeopleAtScale';
import { withUser } from './helpers/withUser';

/**
 * The choosers of the review among 150 people (T204).
 *
 * Every chooser of a person finds them by typing, among however many there are: Choose reviewers,
 * "Who will follow up", the card's "Followed up by" and the All view's "Assigned to".
 *
 * The Reviewers panel names three of the 12 reviewers and "and 9 more", rather than listing them
 * above the work, and that button opens the Change dialog for the owner and a read-only list for
 * anyone else.
 */

for (const size of PHONE_AND_DESK) {
  test.describe(`Choose reviewers among 150 people, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    let seed: PeopleAtScaleSeed;
    let reviewers: ReviewersPanel;
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    test.beforeEach(async ({ authenticatedPage: page, request }) => {
      seed = await seedPeopleAtScale(request);
      await new ApplicationsAllPage(page).goto(seed.marketId);
      reviewers = new ReviewersPanel(page);
      await press(reviewers.change);
      await expect(reviewers.dialog).toBeVisible();
    });

    test('opens with the team as chips, finds one by part of an address, and fits', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      await expect(chooser.field).toBeFocused();
      await expect(chooser.field).toHaveAccessibleName('Reviewers');
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expectLaidOut(page, 'the dialog with its chips');

      await press(chooser.field);
      await expect(chooser.options).toHaveCount(PAGE);
      await expect(chooser.list.getByRole('option', { selected: true })).toHaveCount(
        seed.counts.reviewers,
      );
      await expect(chooser.options.first()).toHaveAttribute('aria-selected', 'true');
      await expectLaidOut(page, 'the list open');

      const newcome = seed.members.at(-1)!.email;
      await chooser.field.fill(newcome.split('@')[0]!);
      await expect(chooser.options).toHaveCount(1);
      await expect(chooser.options.first()).toHaveAttribute('data-value', newcome);
      await expectLaidOut(page, 'one person found');

      await page.keyboard.press('Escape');
      await expect(chooser.list).toBeHidden();
      await expect(reviewers.dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(reviewers.dialog).toBeHidden();
    });

    test('adds one found by part of the address, removes another by its chip, and saves', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      const added = seed.members.at(-1)!.email;
      const removed = seed.reviewers[0]!.email;

      await chooser.field.fill(added.split('@')[0]!);
      await press(chooser.option(added));
      await expect(chooser.chip(added)).toBeVisible();

      await press(chooser.removeButton(removed));
      await expect(chooser.chip(removed)).toHaveCount(0);
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expectLaidOut(page, 'the chips changed, the list open');

      // The list is still open: the press on Save lands all the same.
      await expect(chooser.list).toBeVisible();
      await press(reviewers.save);
      await expect(reviewers.dialog).toBeHidden();

      await expect(reviewers.line).toContainText(`${seed.counts.reviewers} reviewers: `);
      await press(reviewers.more);
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
    });

    test("waits for the save's re-read, so a press in it cannot bring back the old team", async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      const added = seed.members.at(-1)!.email;
      const removed = seed.reviewers[0]!.email;

      await chooser.field.fill(added.split('@')[0]!);
      await press(chooser.option(added));
      await press(chooser.removeButton(removed));
      // One in and one out: the line's count says the same before and after the re-read.
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);

      const box = (await reviewers.more.boundingBox())!;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      const read = /\/markets\/[^/]+$/;
      const held: Route[] = [];
      await page.route(read, (route) => {
        held.push(route);
      });
      const written = page.waitForResponse(
        (response) =>
          response.url().endsWith('/reviewers') && response.request().method() === 'PUT',
      );
      await press(reviewers.save);
      expect((await written).ok()).toBe(true);
      await expect.poll(() => held.length).toBeGreaterThan(0);

      // A real press where "and 9 more" stands, on whatever lies over it by now.
      if (size.phone) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(reviewers.dialog).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
      await expect(chooser.chip(added)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(reviewers.dialog).toBeVisible();
      await expect(reviewers.save).toBeDisabled();
      await expect(reviewers.save).toHaveText('Saving…');
      await expect(reviewers.closeControl).toBeDisabled();
      await expect(reviewers.cancel).toBeDisabled();
      expect(await disabledWithoutLine(page), 'the hold draws the one disabled state').toEqual([]);
      expect((await sweep(page)).failures, 'the hold has text below AA').toEqual([]);

      // In this order: taking the route away first answers what it holds for it.
      await Promise.all(held.map((route) => route.continue()));
      await page.unroute(read);
      await expect(reviewers.dialog).toBeHidden();
      await expect(reviewers.line).not.toContainText(removed);

      await press(reviewers.more);
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
    });

    /** One in and one out, ready to save: the line's count says the same before and after. */
    async function swapOne() {
      const { chooser } = reviewers;
      const added = seed.members.at(-1)!.email;
      const removed = seed.reviewers[0]!.email;
      await chooser.field.fill(added.split('@')[0]!);
      await press(chooser.option(added));
      await press(chooser.removeButton(removed));
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      return { added, removed };
    }
    const marketRead = /\/markets\/[^/]+$/;
    const isTheWrite = (url: string, method: string) =>
      url.endsWith('/reviewers') && method === 'PUT';

    test('after a re-read that fails, the dialog opens on the team saved, and saves it', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      const { added, removed } = await swapOne();
      await page.route(marketRead, (route) => route.abort());

      await press(reviewers.save);
      await expect(reviewers.dialog).toBeHidden();
      await press(reviewers.more);
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);

      const written = page.waitForRequest((request) => isTheWrite(request.url(), request.method()));
      await press(reviewers.save);
      const team = ((await written).postDataJSON() as { reviewers: string[] }).reviewers;
      expect(team).toContain(added);
      expect(team).not.toContain(removed);
      await expect(reviewers.dialog).toBeHidden();

      await page.unroute(marketRead);
      await new ApplicationsAllPage(page).goto(seed.marketId);
      await expect(reviewers.line).not.toContainText(removed);
    });

    test('after a re-read that fails, a tab switch keeps the team saved', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      const { added, removed } = await swapOne();
      await page.route(marketRead, (route) => route.abort());
      await press(reviewers.save);
      await expect(reviewers.dialog).toBeHidden();

      // Each tab's read fails too, so the market from before the save is still the one held.
      await press(page.getByTestId('market-bar-tab-tools'));
      await expect(reviewers.panel).toHaveCount(0);
      await press(page.getByTestId('market-bar-tab-applications'));
      await press(reviewers.more);
      await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
    });

    test('a read overtaking the re-read leaves nothing to open on the team before', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      const { added, removed } = await swapOne();
      const held: Route[] = [];
      await page.route(marketRead, (route) => {
        held.push(route);
      });
      const written = page.waitForResponse((response) =>
        isTheWrite(response.url(), response.request().method()),
      );
      await press(reviewers.save);
      expect((await written).ok()).toBe(true);
      await expect.poll(() => held.length).toBe(1);

      // The tab coming back into view reads the market again, and the first answer is dropped.
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect.poll(() => held.length).toBe(2);
      await held[0]!.continue();
      await expect(reviewers.dialog).toBeHidden();

      await press(reviewers.more);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(reviewers.dialog).toBeHidden();

      // In this order: taking the route away first answers what it holds for it.
      await held[1]!.continue();
      await page.unroute(marketRead);
      await expect(reviewers.line).not.toContainText(removed);
    });

    test('Back and Forward during an unanswered write bring the dialog back held on it', async ({
      authenticatedPage: page,
    }) => {
      const { chooser } = reviewers;
      // Arrive from Tools, so that Back has a market tab to go to.
      await press(reviewers.cancel);
      await press(page.getByTestId('market-bar-tab-tools'));
      await expect(reviewers.panel).toHaveCount(0);
      await press(page.getByTestId('market-bar-tab-applications'));
      await press(reviewers.more);
      const { added, removed } = await swapOne();

      const write = /\/reviewers$/;
      const held: Route[] = [];
      await page.route(write, (route) => {
        held.push(route);
      });
      await press(reviewers.save);
      await expect.poll(() => held.length).toBe(1);

      await page.goBack();
      await expect(reviewers.panel).toHaveCount(0);
      await page.goForward();
      await expect(reviewers.dialog).toBeVisible();
      await expect(reviewers.save).toBeDisabled();
      await expect(reviewers.save).toHaveText('Saving…');
      await expect(reviewers.closeControl).toBeDisabled();
      await expect(reviewers.cancel).toBeDisabled();
      await expect(chooser.chip(removed)).toHaveCount(0);
      await expect(chooser.chip(added)).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName))
        .not.toBe('BODY');
      expect(held, 'the second panel writes nothing of its own').toHaveLength(1);

      // In this order: taking the route away first answers what it holds for it.
      await held[0]!.continue();
      await page.unroute(write);
      await expect(reviewers.dialog).toBeHidden();
      await expect(reviewers.line).not.toContainText(removed);
      await expect(reviewers.change).toBeFocused();

      await press(reviewers.more);
      await expect(chooser.chip(added)).toBeVisible();
      await expect(chooser.chip(removed)).toHaveCount(0);
    });

    if (size.phone) {
      test('fits 320 wide, with nothing scrolling sideways or clipped', async ({
        authenticatedPage: page,
      }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        const { chooser } = reviewers;
        await expect(chooser.chips).toHaveCount(seed.counts.reviewers);
        await expectLaidOut(page, 'the dialog at 320');

        await press(chooser.field);
        await expect(chooser.options).toHaveCount(PAGE);
        await expectLaidOut(page, 'the list open at 320');
      });
    }
  });
}

for (const size of PHONE_AND_DESK) {
  test.describe(`The Reviewers panel's line on 12 reviewers, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    let seed: PeopleAtScaleSeed;
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());
    /** The widths the line and its dialogs must fit: the window's, and on a phone 320 too. */
    const fitWidths = size.phone ? [390, 320] : [size.use.viewport.width];
    /** Each width in turn; sizing the window closes nothing here, since each state opens after. */
    async function atEachWidth(page: Page, check: (width: number) => Promise<void>) {
      for (const width of fitWidths) {
        await page.setViewportSize({ width, height: size.use.viewport.height });
        await check(width);
      }
    }

    test.beforeEach(async ({ request }) => {
      seed = await seedPeopleAtScale(request);
    });

    test('names three and "and 9 more", which opens Change reviewers for the owner', async ({
      authenticatedPage: page,
    }) => {
      await new ApplicationsAllPage(page).goto(seed.marketId);
      const reviewers = new ReviewersPanel(page);
      const [first, second, third] = seed.reviewers;
      await expect(reviewers.line).toHaveText(
        `12 reviewers: ${first!.email}, ${second!.email}, ${third!.email} and 9 more reviewers`,
      );
      await expect(reviewers.more).toHaveAccessibleName('and 9 more reviewers');

      await atEachWidth(page, async (width) => {
        await expectLaidOut(page, `the line at ${width}`);
        await press(reviewers.more);
        await expect(reviewers.dialog).toBeVisible();
        await expect(reviewers.all).toHaveCount(0);
        await expect(reviewers.chooser.chips).toHaveCount(seed.counts.reviewers);
        await expect(reviewers.chooser.field).toBeFocused();
        await expectLaidOut(page, `Change reviewers at ${width}`);
        await page.keyboard.press('Escape');
        await expect(reviewers.dialog).toBeHidden();
        await expect(reviewers.more).toBeFocused();
      });
    });

    test('a save down to three takes the button, and focus goes to Change reviewers', async ({
      authenticatedPage: page,
    }) => {
      await new ApplicationsAllPage(page).goto(seed.marketId);
      const reviewers = new ReviewersPanel(page);
      await press(reviewers.more);
      await expect(reviewers.dialog).toBeVisible();
      for (const reviewer of seed.reviewers.slice(3)) {
        await press(reviewers.chooser.removeButton(reviewer.email));
      }
      await press(reviewers.save);
      await expect(reviewers.dialog).toBeHidden();

      const [first, second, third] = seed.reviewers;
      await expect(reviewers.line).toHaveText(
        `3 reviewers: ${first!.email}, ${second!.email} and ${third!.email}`,
      );
      await expect(reviewers.more).toHaveCount(0);
      await expect(reviewers.change).toBeFocused();
    });

    test('opens a read-only list of 12 for a member who may not choose', async ({ browser }) => {
      const reader = seed.reviewers[1]!;
      await withUser(
        browser,
        reader.email,
        PEOPLE_AT_SCALE_PASSWORD,
        async (page) => {
          await new ApplicationsAllPage(page).goto(seed.marketId);
          const reviewers = new ReviewersPanel(page);
          await expect(reviewers.change).toHaveCount(0);
          await expect(reviewers.line).toContainText(`${reader.email} (you)`);

          await atEachWidth(page, async (width) => {
            await expectLaidOut(page, `the line at ${width}`);
            await press(reviewers.more);
            await expect(reviewers.all).toBeVisible();
            await expect(reviewers.dialog).toHaveCount(0);
            await expect(reviewers.allPeople).toHaveCount(seed.counts.reviewers);
            await expect(reviewers.allPeople.nth(1)).toHaveText(`${reader.email} (you)`);
            await expect(reviewers.all.getByRole('button')).toHaveCount(1);
            await expect(reviewers.allClose).toHaveAccessibleName('Close');
            await expectLaidOut(page, `the read-only list at ${width}`);
            expect((await sweep(page)).failures, 'the list has text below AA').toEqual([]);

            await press(reviewers.allClose);
            await expect(reviewers.all).toHaveCount(0);
            await expect(reviewers.more).toBeFocused();

            await press(reviewers.more);
            await expect(reviewers.all).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(reviewers.all).toHaveCount(0);
            await expect(reviewers.more).toBeFocused();
          });
        },
        size.use,
      );
    });

    test('names who can no longer review first, and says how many more are folded', async ({
      authenticatedPage: page,
      request,
    }) => {
      const taken = seed.reviewers.slice(-5);
      // No role of their own on the market, and none through its organization.
      for (const reviewer of taken) {
        for (const path of [
          `markets/${seed.marketId}/roles/${reviewer.id}`,
          `organizations/${seed.orgId}/users/${reviewer.id}`,
        ]) {
          const removed = await request.delete(`${BACKEND_URL}/${path}`);
          expect(removed.ok(), await removed.text()).toBeTruthy();
        }
      }
      await new ApplicationsAllPage(page).goto(seed.marketId);
      const reviewers = new ReviewersPanel(page);
      const [first, second, third] = taken;
      const chip = 'Can no longer review here';
      await expect(reviewers.line).toHaveText(
        `12 reviewers: ${first!.email} ${chip}, ${second!.email} ${chip}, ${third!.email} ${chip} and 9 more reviewers, 2 more can no longer review here`,
      );
      await expect(reviewers.unable).toHaveCount(3);
      await expect(reviewers.unableFolded).toHaveText('2 more can no longer review here');

      await atEachWidth(page, async (width) => {
        await expectLaidOut(page, `the line with its marks at ${width}`);
        expect((await sweep(page)).failures, 'the line has text below AA').toEqual([]);
      });

      // The owner, who must remove them, reads which they are, the folded two among them.
      await reviewers.more.click();
      await expect(reviewers.dialog).toBeVisible();
      await expect(
        reviewers.chooser.chips.filter({ hasText: 'can no longer review here' }),
      ).toHaveCount(taken.length);
      for (const { email } of taken) {
        await expect(reviewers.chooser.chip(email)).toContainText('can no longer review here');
      }
      await atEachWidth(page, async (width) => {
        await expectLaidOut(page, `the marked chips at ${width}`);
        expect((await sweep(page)).failures, 'the marked chips have text below AA').toEqual([]);
      });
    });
  });
}

for (const size of PHONE_AND_DESK) {
  test.describe(`A follow-up among 150 people, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());
    const ownerOf = (marketId: string, applicant: string) =>
      mongoEval(
        `db.applications.findOne({ market_id: ${JSON.stringify(marketId)}, ` +
          `applicant_email: ${JSON.stringify(applicant)} }).follow_up_owner.email`,
      );

    test('is handed to one found by typing, then on from the card to another', async ({
      authenticatedPage: page,
      request,
    }) => {
      const seed = await seedPeopleAtScale(request);
      await page.goto(oneByOnePath(seed.marketId));
      const monitor = new ApplicationMonitorPage(page);
      await monitor.waitForLoaded();
      const applicant = ((await monitor.email.textContent()) ?? '').trim();

      // The dialog: the first page of everyone, then the one person the words find.
      await press(monitor.followUpButton);
      const followUp = new FollowUpDialog(page);
      await expect(followUp.owner).toHaveValue(seed.owner.email);
      await press(followUp.owner);
      await expect(followUp.chooser.options).toHaveCount(PAGE);
      await expect(followUp.chooser.more).toHaveText(
        `${seed.counts.withAccess - PAGE} more, type to narrow`,
      );
      await expectLaidOut(page, 'the follow-up dialog, its list open');

      const first = seed.members.at(-1)!.email;
      await followUp.owner.fill(first.split('@')[0]!);
      await expect(followUp.chooser.options).toHaveCount(1);
      await expect(followUp.submit).toBeDisabled();
      await expectLaidOut(page, 'one person found');
      await press(followUp.chooser.option(first));
      await expect(followUp.owner).toHaveValue(first);
      await expect(followUp.submit).toBeEnabled();
      await followUp.confirm();
      expect(ownerOf(seed.marketId, applicant)).toBe(first);

      // The card: its owner is one the first page never draws.
      await page.getByTestId('app-monitor-include-follow-ups').check();
      await monitor.advanceTo(applicant);
      const { followUpOwner } = monitor;
      await expect(followUpOwner.field).toHaveValue(first);
      await expectLaidOut(page, 'the card with its chooser');
      // No sweep walks a card that needs a follow-up: its label on the card's beige is measured here.
      expect((await sweep(page)).failures, 'the card has text below AA').toEqual([]);

      await press(followUpOwner.field);
      await expect(followUpOwner.options).toHaveCount(PAGE);
      await expectLaidOut(page, 'the card, its list open');

      // Words let go leave the owner named, and hand it to no one.
      await followUpOwner.field.fill('person-1');
      await page.keyboard.press('Escape');
      await expect(followUpOwner.list).toBeHidden();
      await expect(followUpOwner.field).toHaveValue(first);

      const second = seed.members.at(-2)!.email;
      const handed = page.waitForResponse((r) => r.url().endsWith('/follow-up-owner'));
      await followUpOwner.field.fill(second.split('@')[0]!);
      await expect(followUpOwner.options).toHaveCount(1);
      await press(followUpOwner.option(second));
      expect((await handed).ok()).toBeTruthy();
      await expect(followUpOwner.field).toHaveValue(second);
      expect(ownerOf(seed.marketId, applicant)).toBe(second);
    });

    if (size.phone) {
      test('fits 320 wide, in the dialog and on the card', async ({
        authenticatedPage: page,
        request,
      }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        const seed = await seedPeopleAtScale(request);
        await page.goto(oneByOnePath(seed.marketId));
        const monitor = new ApplicationMonitorPage(page);
        await monitor.waitForLoaded();
        const applicant = ((await monitor.email.textContent()) ?? '').trim();

        await press(monitor.followUpButton);
        const followUp = new FollowUpDialog(page);
        await expect(followUp.owner).toHaveValue(seed.owner.email);
        await expectLaidOut(page, 'the follow-up dialog at 320');
        await press(followUp.owner);
        await expect(followUp.chooser.options).toHaveCount(PAGE);
        await expectLaidOut(page, 'its list open at 320');
        await page.keyboard.press('Escape');
        await followUp.confirm();

        await page.getByTestId('app-monitor-include-follow-ups').check();
        await monitor.advanceTo(applicant);
        await expect(monitor.followUpOwner.field).toHaveValue(seed.owner.email);
        await expectLaidOut(page, 'the card at 320');
        await press(monitor.followUpOwner.field);
        await expect(monitor.followUpOwner.options).toHaveCount(PAGE);
        await expectLaidOut(page, 'the card, its list open at 320');
      });
    }
  });

  test.describe(`"Assigned to" among the chosen reviewers, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    test('finds one by typing, and a reload keeps the filter and its rows', async ({
      authenticatedPage: page,
      request,
    }) => {
      const seed = await seedPeopleAtScale(request);
      const all = new ApplicationsAllPage(page);
      await all.goto(seed.marketId);
      const { field, options } = all.assignedTo;
      await expect(field).toHaveValue('Anyone');
      await expect(all.count).toHaveText('5 applications');
      await expectLaidOut(page, 'the filter row');

      // The seed owner is no reviewer, so "Anyone" leads and every reviewer follows.
      await press(field);
      await expect(options).toHaveText(['Anyone', ...seed.reviewers.map(({ email }) => email)]);
      await expectLaidOut(page, 'the filter row, its list open');

      // Someone with an application, read off a row: five are dealt among the twelve.
      const dealt = ((await all.rowReviewers.first().textContent()) ?? '').replace(
        'Reviewer: ',
        '',
      );
      await field.fill(dealt.split('@')[0]!);
      await expect(options).toHaveText([dealt]);
      await expect(all.count).toHaveText('5 applications');
      await expectLaidOut(page, 'one reviewer found');

      await press(options.first());
      await expect(field).toHaveValue(dealt);
      await expect.poll(() => new URL(page.url()).searchParams.get('reviewer')).toBe(dealt);
      await expect(all.count).toHaveText('1 of 5 applications');
      await expect(all.rowReviewers).toHaveText([`Reviewer: ${dealt}`]);

      await page.reload();
      await expect(field).toHaveValue(dealt);
      await expect(all.count).toHaveText('1 of 5 applications');
      await expect(all.rowReviewers).toHaveText([`Reviewer: ${dealt}`]);
      await expectLaidOut(page, 'the filter row on a reviewer');
    });

    test('moves nothing beside the field as its list opens, and Export ends the row', async ({
      authenticatedPage: page,
      request,
    }) => {
      const seed = await seedPeopleAtScale(request);
      const all = new ApplicationsAllPage(page);
      await all.goto(seed.marketId);
      await expect(all.exportButton).toBeVisible();

      // The list lies over the rows, so neither the filters nor the rows move.
      const beside = [
        page.getByTestId('applications-all-filter-all'),
        all.mine,
        all.exportButton,
        all.rows.first(),
      ];
      /** Where each stands on the page, since opening the field may scroll to it. */
      const where = () =>
        Promise.all(
          beside.map((item) =>
            item.evaluate((element) => {
              const { x, y } = element.getBoundingClientRect();
              return { x, y: y + window.scrollY };
            }),
          ),
        );
      const before = await where();

      await press(all.assignedTo.field);
      await expect(all.assignedTo.list).toBeVisible();
      expect(await where()).toEqual(before);
      await expectLaidOut(page, 'the list over the rows');

      await all.assignedTo.field.press('Escape');
      await expect(all.assignedTo.list).toBeHidden();
      expect(await where()).toEqual(before);

      // The last row of the list is under no row of the page: a press takes it.
      await press(all.assignedTo.field);
      const last = seed.reviewers.at(-1)!.email;
      await all.assignedTo.option(last).scrollIntoViewIfNeeded();
      await press(all.assignedTo.option(last));
      await expect(all.assignedTo.field).toHaveValue(last);

      const rowEnd = await page
        .locator('.all-filters')
        .evaluate((row) => row.getBoundingClientRect().right);
      const exportEnd = await all.exportButton.evaluate(
        (button) => button.getBoundingClientRect().right,
      );
      expect(exportEnd).toBeCloseTo(rowEnd, 0);
    });

    if (size.phone) {
      test('fits 320 wide', async ({ authenticatedPage: page, request }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        const seed = await seedPeopleAtScale(request);
        const all = new ApplicationsAllPage(page);
        const reviewer = seed.reviewers[0]!.email;
        await all.goto(seed.marketId, reviewer);
        await expect(all.assignedTo.field).toHaveValue(reviewer);
        await expectLaidOut(page, 'the filter row at 320');

        await press(all.assignedTo.field);
        await expect(all.assignedTo.options).toHaveCount(seed.reviewers.length + 1);
        await expectLaidOut(page, 'its list open at 320');

        await all.assignedTo.field.fill(reviewer);
        await expect(all.assignedTo.options).toHaveText([reviewer]);
        await expectLaidOut(page, 'one reviewer found at 320');
      });
    }
  });
}
