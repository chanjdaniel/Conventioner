import { randomUUID } from 'node:crypto';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { ensureTestOrg, SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { StatsPage } from './pages/StatsPage';

/**
 * The Stats tab (E45/F01/S01): a sixth tab on the market bar, open in every phase and to anyone who
 * reads the market, starting with who applied - by status and by the day each applied - counted as
 * the Applications tab counts them; then a chart per choice question of the form, narrowed to the
 * approved or the assigned (E45/F01/S02).
 */
const VIEWER = { email: 'e2e-stats-viewer@example.com', password: 'e2estatsviewer1' };

/** An application as it was stored on the day it arrived, straight into Mongo. */
function seedApplied(marketId: string, email: string, status: string, submittedAt: string) {
  mongoEval(
    `db.applications.insertOne(${JSON.stringify({
      id: randomUUID(),
      market_id: marketId,
      applicant_email: email,
      form_data: { name: 'Stats Vendor', category: 'Crafts' },
      status,
      application_type: 'main',
      submitted_at: submittedAt,
      updated_at: submittedAt,
    })})`,
  );
}

/** A vendor who never applied, recorded by an organizer: approved by the adding. */
function seedAddedByHand(marketId: string, email: string) {
  const now = new Date().toISOString();
  mongoEval(
    `db.applications.insertOne(${JSON.stringify({
      id: randomUUID(),
      market_id: marketId,
      applicant_email: email,
      form_data: { full_name: 'Walk-in Wares' },
      status: 'reviewer_approved',
      application_type: 'main',
      verdict_by: { kind: 'person', email: TEST_USER.email },
      verdict_at: now,
      added_by: { email: TEST_USER.email },
      added_at: now,
      submitted_at: now,
      updated_at: now,
    })})`,
  );
}

// Noon in UTC is the same calendar day in Vancouver, where the browser reads it.
test.use({ timezoneId: 'America/Vancouver' });

test('the Stats tab counts who applied as the Applications tab does, for anyone who reads it', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplied(marketId, 'nadia@ember.test', 'open', '2026-09-01T12:00:00Z');
  seedApplied(marketId, 'theo@thistle.test', 'open', '2026-09-01T19:00:00Z');
  seedApplied(marketId, 'ines@loom.test', 'needs_follow_up', '2026-09-02T12:00:00Z');
  seedApplied(marketId, 'omar@kiln.test', 'reviewer_approved', '2026-09-03T12:00:00Z');
  seedApplied(marketId, 'priya@weft.test', 'reviewer_approved', '2026-09-03T15:00:00Z');
  seedApplied(marketId, 'lena@forge.test', 'reviewer_rejected', '2026-09-03T18:00:00Z');
  seedAddedByHand(marketId, 'walk.in@example.com');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: VIEWER.email, role: 'viewer' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  // Reached from the bar, at its own address.
  const stats = new StatsPage(page);
  await page.goto(marketScreenPath(marketId, 'applications'));
  await page.getByTestId('market-bar-tab-stats').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/stats$`));
  await expect(page.getByTestId('market-bar-tab-stats')).toHaveClass(/active/);
  await expect(stats.total).toHaveText('7 applications in all, 1 of them added by hand');

  const expected: Record<string, number> = {
    undecided: 2,
    needs_follow_up: 1,
    reviewer_approved: 3,
    reviewer_rejected: 1,
  };
  for (const [value, count] of Object.entries(expected)) {
    await expect(stats.statusCount(value)).toHaveText(String(count));
  }

  // Each day someone applied, the walk-in on none of them.
  await expect(stats.days).toHaveCount(3);
  await expect(stats.days.nth(0)).toContainText('Sep 1, 2026');
  await expect(stats.dayCount(0)).toHaveText('2');
  await expect(stats.days.nth(1)).toContainText('Sep 2, 2026');
  await expect(stats.dayCount(1)).toHaveText('1');
  await expect(stats.days.nth(2)).toContainText('Sep 3, 2026');
  await expect(stats.dayCount(2)).toHaveText('3');

  // The Applications tab's All view lists the same count under each status, and a row opens it.
  const all = new ApplicationsAllPage(page);
  for (const [value, count] of Object.entries(expected)) {
    await stats.goto(marketId);
    await stats.status(value).click();
    await expect(page).toHaveURL(new RegExp(`/applications\\?.*status=${value}`));
    await expect(page.getByTestId('applications-all-count')).toHaveText(`${count} of 7`);
    await expect(all.rows).toHaveCount(count);
  }

  // A Viewer reads all of it.
  await withUser(browser, VIEWER.email, VIEWER.password, async (viewer) => {
    const theirs = new StatsPage(viewer);
    await theirs.goto(marketId);
    await expect(theirs.total).toHaveText('7 applications in all, 1 of them added by hand', {
      timeout: 15000,
    });
    await expect(theirs.days).toHaveCount(3);
  });
});

test('a market nobody has applied to says so, in draft', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const stats = new StatsPage(page);
  await stats.goto(marketId);
  await expect(stats.none).toHaveText('Nobody has applied yet.', { timeout: 15000 });
});

test('the bar holds six tabs beside a 60-character name at 1280, and scrolls them on a phone', async ({
  authenticatedPage: page,
  request,
}) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const unique = String(Date.now());
  const name = `${'The Riverside Night Market of Handmade Goods and Small Batch Makers'.slice(
    0,
    59 - unique.length,
  )} ${unique}`;
  expect(name).toHaveLength(60);
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    // The form path's bar is the widest: its form tab reads "Application Form", not "Questions".
    { name, intakeMode: 'form' },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(marketScreenPath(marketId, 'stats'));
  const title = page.getByTestId('market-bar-title');
  await expect(title).toHaveAttribute('title', name, { timeout: 15000 });
  const tabs = page.locator('[data-testid^="market-bar-tab-"]');
  await expect(tabs).toHaveCount(6);
  await expect(page.getByTestId('market-bar-tab-form')).toHaveText('Application Form');

  const bar = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="market-bar"]') as HTMLElement;
    const name = root.querySelector('[data-testid="market-bar-title"]') as HTMLElement;
    const tabs = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid^="market-bar-tab-"]'),
    ).map((tab) => {
      const box = tab.getBoundingClientRect();
      const label = tab.firstElementChild!.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(tab).lineHeight);
      return { top: Math.round(box.top), lines: Math.round(label.height / lineHeight) };
    });
    return {
      fits: root.scrollWidth <= root.clientWidth,
      nameEllipsed: name.scrollWidth > name.clientWidth,
      tops: new Set(tabs.map((tab) => tab.top)).size,
      lines: tabs.map((tab) => tab.lines),
    };
  });
  expect(bar.fits, 'the name pushed the tabs out of the bar').toBe(true);
  expect(bar.tops, 'the tabs broke onto two rows').toBe(1);
  expect(bar.lines, 'a tab label wrapped').toEqual([1, 1, 1, 1, 1, 1]);
  expect(bar.nameEllipsed, 'the name, not the tabs, gives way').toBe(true);
  await expect(page.getByTestId('market-bar-tab-stats')).toBeInViewport({ ratio: 1 });

  // On a phone, which only the door reaches, the tabs scroll inside the bar, never the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(marketScreenPath(marketId, 'attendance'));
  const stats = page.getByTestId('market-bar-tab-stats');
  await expect(stats).toBeAttached({ timeout: 15000 });
  const phone = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="market-bar-tabs"]') as HTMLElement;
    return {
      navScrolls: nav.scrollWidth > nav.clientWidth,
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(phone.navScrolls, 'six tabs fit a phone, so nothing here was measured').toBe(true);
  expect(phone.pageScrolls, 'the page scrolls sideways on a phone').toBe(false);
  await stats.scrollIntoViewIfNeeded();
  await expect(stats).toBeInViewport({ ratio: 1 });
});

const SELLING = 'What will you be selling at the event?';

test('a chart per choice question counts each option, groups "Other", and narrows to the approved and the assigned', async ({
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
  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    data: {
      fields: [
        { key: 'business', label: 'Business name', type: 'text', options: [], order: 0 },
        {
          key: 'selling',
          label: SELLING,
          type: 'multi_select',
          options: ['Prints', 'Stickers', 'Jewelry', 'Ceramics'],
          order: 1,
        },
        {
          key: 'first_market',
          label: 'Is this your first market with us?',
          type: 'select',
          options: ['Yes', 'No'],
          order: 2,
        },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');

  // Each answered on a Google Form, where "Other" is written in by hand.
  const applicant = (email: string, status: string, selling: string[], firstMarket: string) => ({
    ...approvedVendorApplication(marketId, email, {
      dates: [SEED_MARKET_DATE],
      tiers: ['Gold'],
      extra: { business: email.split('@')[0], selling, first_market: firstMarket },
    }),
    status,
  });
  insertApplications([
    applicant('nadia@ember.test', 'reviewer_rejected', ['Prints', 'Stickers'], 'Yes'),
    applicant('theo@thistle.test', 'reviewer_approved', ['Prints', 'Hand-bound zines'], 'No'),
    applicant('omar@kiln.test', 'reviewer_approved', ['Jewelry', 'Candles', 'Soap'], 'Yes'),
    applicant('priya@weft.test', 'reviewer_approved', ['Prints'], 'No'),
    applicant('lena@forge.test', 'reviewer_rejected', ['Stickers'], 'Yes'),
  ]);
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'assignment');
  const stats = new StatsPage(page);

  // Before anyone has a table, Assigned says so rather than charting noughts.
  await page.goto(`${marketScreenPath(marketId, 'stats')}?among=assigned`);
  await expect(page.getByTestId('stats-among-nobody')).toHaveText('Nobody is assigned yet.', {
    timeout: 15000,
  });
  await expect(stats.amongCount).toHaveText('0 of 5');
  await expect(stats.questions).toHaveCount(0);

  // The run seats the three approved; Priya's seat is freed and given by hand to Lena, rejected.
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(run.ok(), await run.text()).toBeTruthy();
  const seats = ((await run.json()).assignmentObject.vendorAssignments ?? []) as {
    email: string;
    tableCode: string;
  }[];
  const priyas = seats.find((seat) => seat.email === 'priya@weft.test');
  expect(priyas, 'the run did not seat Priya').toBeTruthy();
  const freed = await request.delete(`${BACKEND_URL}/markets/${marketId}/placements`, {
    data: { email: 'priya@weft.test', date: SEED_MARKET_DATE },
  });
  expect(freed.ok(), await freed.text()).toBeTruthy();
  const placed = await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
    data: {
      email: 'lena@forge.test',
      date: SEED_MARKET_DATE,
      table_code: priyas!.tableCode,
      table_choice: 'Full Table',
    },
  });
  expect(placed.ok(), await placed.text()).toBeTruthy();

  await stats.goto(marketId);

  // The choice questions only, in the form's order: the business name is words, not choices.
  await expect(stats.questions).toHaveCount(2, { timeout: 15000 });
  await expect(stats.question('selling').getByRole('heading')).toHaveText(SELLING);
  await expect(stats.question('business')).toHaveCount(0);
  await expect(stats.amongCount).toHaveText('5 of 5');
  await expect(stats.among('all')).toHaveAttribute('aria-pressed', 'true');

  const expectCounts = async (key: string, counts: [string, number][]) => {
    await expect(stats.answerRows(key)).toHaveCount(counts.length);
    for (const [answer, count] of counts) {
      await expect(stats.answerCount(key, answer)).toHaveText(String(count));
    }
  };

  // Every option, even one nobody chose; the three written in are one "Other", counted per
  // applicant, so Omar's two count once.
  await expectCounts('selling', [
    ['Prints', 3],
    ['Stickers', 2],
    ['Jewelry', 1],
    ['Ceramics', 0],
    ['other', 2],
  ]);
  await expect(stats.answerRows('selling')).toHaveText([
    /^Prints.*3.*60%/,
    /^Stickers.*2.*40%/,
    /^Jewelry.*1.*20%/,
    /^Ceramics.*0.*0%/,
    /^Other.*2.*40%/,
  ]);
  await expectCounts('first_market', [
    ['Yes', 3],
    ['No', 2],
  ]);
  // A bar leads nowhere: the All view cannot filter by an answer.
  await expect(stats.answerRows('selling').first()).not.toHaveAttribute('href');

  // Approved narrows every chart, and says so in the address.
  await stats.among('approved').click();
  await expect(page).toHaveURL(/[?&]among=approved/);
  await expect(stats.amongCount).toHaveText('3 of 5');
  await expectCounts('selling', [
    ['Prints', 2],
    ['Stickers', 0],
    ['Jewelry', 1],
    ['Ceramics', 0],
    ['other', 2],
  ]);
  await expectCounts('first_market', [
    ['Yes', 1],
    ['No', 2],
  ]);

  // Assigned is whoever has a table, Lena among them though rejected, Priya not though approved.
  await stats.among('assigned').click();
  await expect(page).toHaveURL(/[?&]among=assigned/);
  await expect(stats.amongCount).toHaveText('3 of 5');
  await expectCounts('selling', [
    ['Prints', 1],
    ['Stickers', 1],
    ['Jewelry', 1],
    ['Ceramics', 0],
    ['other', 2],
  ]);
  await expectCounts('first_market', [
    ['Yes', 2],
    ['No', 1],
  ]);

  // The address keeps it: a reload, or a link shared, opens on the same group.
  await page.reload();
  await expect(stats.among('assigned')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect(stats.answerCount('selling', 'Stickers')).toHaveText('1');
  await stats.among('all').click();
  await expect(page).not.toHaveURL(/among=/);
  await expect(stats.answerCount('selling', 'Prints')).toHaveText('3');
});
