import { randomUUID } from 'node:crypto';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import {
  approvedVendorApplication,
  insertApplications,
  seedApplication,
  seedApprovedVendor,
} from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { ensureTestOrg, SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { rowLayout } from './helpers/barLedger';
import { withUser } from './helpers/withUser';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { StatsPage } from './pages/StatsPage';
import { saveApplicationForm } from './helpers/saveApplicationForm';

/**
 * The Stats tab (E45/F01/S01): the last tab on the market bar, open in every phase and to anyone who
 * reads the market, starting with who applied - a column a day from the opening to today (T201), and
 * the review as one bar split by status, counted as the Applications tab counts them - then the room,
 * each day's and tier's tables asked against the plan's (T201), then how full each section is each
 * day once an assignment is stored (T201), then a chart per choice question of the form, narrowed to the approved or the assigned (E45/F01/S02).
 */
const VIEWER = { email: 'e2e-stats-viewer@example.com', password: 'e2estatsviewer1' };

/** An application as it was stored on the day it arrived, straight into Mongo. */
function seedApplied(marketId: string, email: string, status: string, submittedAt: string) {
  seedApplication(
    marketId,
    email,
    { name: 'Stats Vendor', category: 'Crafts' },
    {
      status,
      submittedAt,
    },
  );
}

/** When the market's record says applications opened, so the chart starts on a known day. */
function openedOn(marketId: string, enteredAt: string) {
  mongoEval(
    `db.markets.updateOne({id: ${JSON.stringify(marketId)}}, ` +
      `{$set: {"phaseHistory.$[opening].enteredAt": ${JSON.stringify(enteredAt)}}}, ` +
      `{arrayFilters: [{"opening.phase": "applications"}]})`,
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
  // Opened on Monday Aug 31 in Vancouver, and read on Saturday Sep 5 there.
  openedOn(marketId, '2026-08-31T16:00:00Z');
  await page.clock.setFixedTime(new Date('2026-09-05T12:00:00-07:00'));
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

  // A column a day from the opening to today, the quiet days kept, the walk-in on none of them:
  // one image, named by its sentence.
  await expect(stats.overTimePlot).toHaveAttribute(
    'aria-label',
    '6 applications from Aug 31 to Sep 5, 2026, most on Sep 3: 3',
  );
  await expect(stats.overTimePlot).toHaveAttribute('role', 'img');
  await expect(stats.overTimeColumns).toHaveCount(6);
  await expect(stats.overTimeAxis).toHaveText(/Aug 31\s*Sep 5/);
  await expect(stats.overTimeMost).toHaveText('3');

  // Its numbers, every day, behind the disclosure.
  await expect(stats.overTimeRows.first()).toBeHidden();
  await stats.overTimeNumbers.getByText('Numbers by day').click();
  await expect(stats.overTimeRows).toHaveText([
    /Mon, Aug 31, 2026\s*0/,
    /Tue, Sep 1, 2026\s*2/,
    /Wed, Sep 2, 2026\s*1/,
    /Thu, Sep 3, 2026\s*3/,
    /Fri, Sep 4, 2026\s*0/,
    /Sat, Sep 5, 2026\s*0/,
  ]);

  // The review as one bar, its legend the text: each status counted as the All view filters it.
  const expected: Record<string, number> = {
    undecided: 2,
    needs_follow_up: 1,
    reviewer_approved: 3,
    reviewer_rejected: 1,
  };
  await expect(stats.statusBar).toHaveAttribute('aria-hidden', 'true');
  await expect(stats.statusBarParts).toHaveCount(4);
  await expect(stats.status('undecided')).toHaveText('Open: 2, 29% of applications');
  for (const [value, count] of Object.entries(expected)) {
    await expect(stats.statusCount(value)).toHaveText(String(count));
  }

  // The Applications tab's All view lists the same count under each status, and its line opens it.
  const all = new ApplicationsAllPage(page);
  for (const [value, count] of Object.entries(expected)) {
    await stats.goto(marketId);
    await stats.status(value).click();
    await expect(page).toHaveURL(new RegExp(`/applications\\?.*status=${value}`));
    await expect(all.count).toHaveText(`${count} of 7 applications`);
    await expect(all.rows).toHaveCount(count);
  }

  // A Viewer reads all of it.
  await withUser(browser, VIEWER.email, VIEWER.password, async (viewer) => {
    const theirs = new StatsPage(viewer);
    await theirs.goto(marketId);
    await expect(theirs.total).toHaveText('7 applications in all, 1 of them added by hand', {
      timeout: 15000,
    });
    await expect(theirs.overTimePlot).toHaveAttribute('aria-label', /^6 applications from Aug 31/);
    await expect(theirs.statusCount('reviewer_approved')).toHaveText('3');
  });
});

test('a review status with nobody in it is told, and not linked', async ({
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
  seedApplied(marketId, 'nadia@ember.test', 'open', new Date().toISOString());

  const stats = new StatsPage(page);
  await stats.goto(marketId);
  await expect(stats.statusCount('undecided')).toHaveText('1', { timeout: 15000 });
  await expect(stats.status('undecided')).toHaveRole('link');
  await expect(stats.statusBarParts).toHaveCount(1);
  for (const empty of ['needs_follow_up', 'reviewer_approved', 'reviewer_rejected']) {
    await expect(stats.statusCount(empty)).toHaveText('0');
    await expect(stats.status(empty).locator('xpath=self::a')).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: /^Approved/ })).toHaveCount(0);
  // Applied today, so the chart is that one day.
  await expect(stats.overTimeColumns).toHaveCount(1);
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

  // The room alone, so a draft already shows its capacity: the plan's tables, no bar, and no tier
  // card for a plan of one tier.
  await expect(stats.roomRows('days')).toHaveText(['Friday, May 1, 2099: 5 tables']);
  await expect(stats.roomCard('days').getByTestId('stats-room-row-bar')).toHaveCount(0);
  await expect(stats.roomCard('tiers')).toHaveCount(0);
});

/** Two days, and two tiers of sections: 3 Gold tables and 4 Silver ones, every day. */
const SAT = '2099-08-01';
const SUN = '2099-08-02';
const TWO_TIERS = {
  priority: [],
  marketDates: [{ date: SAT }, { date: SUN }],
  tiers: [
    { id: 1, name: 'Gold' },
    { id: 2, name: 'Silver' },
  ],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'Hall A', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count: 3 },
    { name: 'Hall B', location: { name: 'Main Hall' }, tier: { id: 2, name: 'Silver' }, count: 4 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

test('the room reads each day and tier as the tables asked against the plan, past them in the attention fill', async ({
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
  mongoEval(
    `db.markets.updateOne({id: ${JSON.stringify(marketId)}}, ` +
      `{$set: {setupObject: ${JSON.stringify(TWO_TIERS)}}})`,
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const vendor = (n: number, answers: Parameters<typeof approvedVendorApplication>[2]) =>
    approvedVendorApplication(marketId, `room-${n}@vendor.test`, answers);
  insertApplications([
    // Six whole tables at Gold, both days.
    ...[1, 2, 3, 4, 5, 6].map((n) => vendor(n, { dates: [SAT, SUN], tiers: ['Gold'] })),
    // Three halves on Saturday, at either tier: half a table each, in both tiers.
    ...[7, 8, 9].map((n) =>
      vendor(n, { dates: [SAT], tiers: ['Gold', 'Silver'], tableChoice: 'half' }),
    ),
    // Either size on Sunday, at Silver: a whole table.
    vendor(10, { dates: [SUN], tiers: ['Silver'], tableChoice: 'either' }),
    // Rejected: asks for nothing.
    { ...vendor(11, { dates: [SAT, SUN], tiers: ['Gold'] }), status: 'reviewer_rejected' },
  ]);

  const stats = new StatsPage(page);
  await stats.goto(marketId);

  await expect(stats.roomRows('days')).toHaveText(
    [
      'Saturday, August 1, 2099: 7.5 asking, 7 tables',
      'Sunday, August 2, 2099: 7 asking, 7 tables',
    ],
    { timeout: 15000 },
  );
  await expect(stats.roomCard('days')).toContainText(
    'A ceiling: someone available three days who wants at most two counts on all three.',
  );
  // Each tier's table-days over both dates: a half counted in each tier it accepts.
  await expect(stats.roomRows('tiers')).toHaveText([
    'Gold: 13.5 asking, 6 table-days',
    'Silver: 2.5 asking, 8 table-days',
  ]);
  await expect(stats.roomCard('tiers')).toContainText(
    'A vendor who accepts two tiers on a day counts in both.',
  );

  // Saturday asks past its tables, Sunday fills them; Gold asks past its, Silver does not.
  const past = (id: 'days' | 'tiers', n: number) =>
    stats.roomRows(id).nth(n).getByTestId('stats-room-row-past');
  await expect(past('days', 0)).toBeVisible();
  await expect(past('days', 1)).toHaveCount(0);
  await expect(past('tiers', 0)).toBeVisible();
  await expect(past('tiers', 1)).toHaveCount(0);
  // The bar is the words' picture, hidden from a screen reader.
  await expect(stats.roomRows('days').first().getByTestId('stats-room-row-bar')).toHaveAttribute(
    'aria-hidden',
    'true',
  );

  // At a desk the two cards stand side by side.
  await page.setViewportSize({ width: 1280, height: 900 });
  const [days, tiers] = await Promise.all([
    stats.roomCard('days').boundingBox(),
    stats.roomCard('tiers').boundingBox(),
  ]);
  expect(Math.abs(days!.y - tiers!.y)).toBeLessThan(1);
  expect(tiers!.x).toBeGreaterThan(days!.x + days!.width);
});

/** Eight market days, more than a phone's width holds, of two sections: five tables a day. */
const EIGHT_DAYS = Array.from({ length: 8 }, (_, i) => `2099-05-${String(1 + i).padStart(2, '0')}`);
const FILL_PLAN = {
  priority: [],
  marketDates: EIGHT_DAYS.map((date) => ({ date })),
  tiers: [
    { id: 1, name: 'Gold' },
    { id: 2, name: 'Silver' },
  ],
  locations: [{ name: 'Main Hall' }],
  sections: [
    {
      name: 'North Wing',
      location: { name: 'Main Hall' },
      tier: { id: 1, name: 'Gold' },
      count: 3,
    },
    { name: 'Landing', location: { name: 'Main Hall' }, tier: { id: 2, name: 'Silver' }, count: 2 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
};

test('how full reads each section on each day as its tables used, totalled, and scrolls in its own box on a phone', async ({
  authenticatedPage: page,
  request,
}) => {
  const [first, second] = EIGHT_DAYS as [string, string];
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: EIGHT_DAYS },
  );
  for (const email of ['carol@example.com', 'dan@example.com']) {
    seedApprovedVendor(marketId, email, { dates: EIGHT_DAYS, tiers: ['Gold'] });
  }
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, FILL_PLAN);
  const stats = new StatsPage(page);
  // Nothing stored yet: no How full.
  await stats.goto(marketId);
  await expect(stats.total).toBeVisible({ timeout: 15000 });
  await expect(stats.fill).toHaveCount(0);

  for (const toPhase of ['applications', 'assignment']) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, toPhase);
  }
  // The first day: North Wing full, Carol on half a table; Landing one of two. The second: one of
  // North Wing's three.
  for (const [email, date, table, choice] of [
    ['alice@example.com', first, 'North Wing 1', 'Full Table'],
    ['carol@example.com', first, 'North Wing 2', 'Half Table (Left)'],
    ['dan@example.com', first, 'North Wing 3', 'Full Table'],
    ['bob@example.com', first, 'Landing 1', 'Full Table'],
    ['alice@example.com', second, 'North Wing 1', 'Full Table'],
  ]) {
    const res = await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
      data: { email, date, table_code: table, table_choice: choice },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await stats.goto(marketId);
  await expect(stats.fill).toBeVisible({ timeout: 15000 });
  const grid = stats.fill.getByRole('table', {
    name: "Tables used of each section's tables, each day",
  });
  await expect(grid.getByRole('columnheader')).toHaveText([
    'Section',
    ...EIGHT_DAYS.map((date) => `May ${Number(date.slice(-2))}, 2099`),
  ]);
  await expect(grid.getByRole('rowheader')).toHaveText([
    'North Wing, Gold',
    'Landing, Silver',
    'All sections',
  ]);
  const idle = Array(6).fill(['0/3', 'none']);
  expect(await stats.fillCells('North Wing')).toEqual([['3/3', 'full'], ['1/3', 'third'], ...idle]);
  expect(await stats.fillCells('Landing')).toEqual([
    ['1/2', 'two-thirds'],
    ['0/2', 'none'],
    ...Array(6).fill(['0/2', 'none']),
  ]);
  expect(await stats.fillCells('total')).toEqual([
    ['4/5', 'nearly'],
    ['1/5', 'third'],
    ...Array(6).fill(['0/5', 'none']),
  ]);
  // Each cell's step is said in words, so the shade carries nothing alone.
  await expect(grid.getByRole('cell').first()).toHaveAccessibleName(/3 of 3 used, full/);
  // The cells add up to the headline's table-days used, half a table held counted.
  await expect(stats.headline('used')).toHaveText('5 of 40 table-days used');

  // On a phone the page stays inside the window, and the table scrolls in its box, the section
  // names held at the left.
  await page.setViewportSize({ width: 390, height: 844 });
  const scroller = page.getByTestId('stats-fill-scroller');
  await expect
    .poll(() => scroller.evaluate((box) => box.scrollWidth - box.clientWidth))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  const name = grid.getByRole('rowheader').first();
  const before = (await name.boundingBox())!.x;
  const firstDay = grid.getByRole('columnheader').nth(1);
  const dayBefore = (await firstDay.boundingBox())!.x;
  await scroller.evaluate((box) => box.scrollTo({ left: box.scrollWidth }));
  await expect.poll(async () => (await firstDay.boundingBox())!.x).toBeLessThan(dayBefore);
  expect(Math.abs((await name.boundingBox())!.x - before)).toBeLessThan(1);
});

test('the bar holds seven tabs beside a 60-character name at 1280, and scrolls them on a phone', async ({
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
  await expect(tabs).toHaveCount(7);
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
  expect(bar.lines, 'a tab label wrapped').toEqual([1, 1, 1, 1, 1, 1, 1]);
  expect(bar.nameEllipsed, 'the name, not the tabs, gives way').toBe(true);
  await expect(page.getByTestId('market-bar-tab-stats')).toBeInViewport({ ratio: 1 });

  // On a phone, which Stats fits as the door does (T180), the tabs scroll inside the bar, never
  // the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(marketScreenPath(marketId, 'stats'));
  const stats = page.getByTestId('market-bar-tab-stats');
  await expect(stats).toBeAttached({ timeout: 15000 });
  const phone = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="market-bar-tabs"]') as HTMLElement;
    return {
      navScrolls: nav.scrollWidth > nav.clientWidth,
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(phone.navScrolls, 'seven tabs fit a phone, so nothing here was measured').toBe(true);
  expect(phone.pageScrolls, 'the page scrolls sideways on a phone').toBe(false);
  await stats.scrollIntoViewIfNeeded();
  await expect(stats).toBeInViewport({ ratio: 1 });
});

const SELLING = 'What will you sell at the fair?';

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
  await saveApplicationForm(request, BACKEND_URL, marketId, {
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
  });
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
  // applicant, so Omar's two count once. Most chosen first, a tie in the form's order.
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
    /^Other.*2.*40%/,
    /^Jewelry.*1.*20%/,
    /^Ceramics.*0.*0%/,
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

/** A question of twelve kinds of goods, in the form's order, the first chosen least. */
const GOODS = [
  'Candles',
  'Soap',
  'Zines',
  'Pins',
  'Patches',
  'Tote bags',
  'Mugs',
  'Planters',
  'Earrings',
  'Prints',
  'Stickers',
  'Ceramics',
];
const GOODS_QUESTION = 'What goods will you bring?';

test('a question of more than eight answers folds past eight, most chosen first, each one line at a desk', async ({
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
  await saveApplicationForm(request, BACKEND_URL, marketId, {
    fields: [
      { key: 'goods', label: GOODS_QUESTION, type: 'multi_select', options: GOODS, order: 0 },
    ],
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  // The nth applicant ticks the last n goods, so each good is chosen as often as its place.
  insertApplications(
    GOODS.map((_, at) =>
      approvedVendorApplication(marketId, `goods-${at + 1}@example.com`, {
        dates: [SEED_MARKET_DATE],
        tiers: ['Gold'],
        extra: { goods: GOODS.slice(GOODS.length - 1 - at) },
      }),
    ),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  const stats = new StatsPage(page);
  await stats.goto(marketId);
  const rows = stats.answerRows('goods');
  const byCount = [...GOODS].reverse();
  await expect(rows).toHaveCount(8, { timeout: 15000 });
  await expect(rows).toHaveText(
    byCount.slice(0, 8).map((good, at) => new RegExp(`^${good}.*${12 - at}`)),
  );
  const fold = stats.question('goods').getByTestId('stats-answer-fold');
  await expect(fold).toHaveText(`4 more answers to ${GOODS_QUESTION}`);

  // A lone card is half the page, so no bar runs the frame, and each answer is one line.
  const section = (await stats.answers.boundingBox())!;
  const card = (await stats.question('goods').boundingBox())!;
  expect(card.width, 'the lone card is half the page').toBeLessThanOrEqual(section.width / 2);
  for (const row of await rows.all()) {
    expect(await rowLayout(row), await row.innerText()).toBe('one line');
    const bar = (await row.getByTestId('stats-answer-bar').boundingBox())!;
    expect(bar.width, 'a bar is shorter than half the page').toBeLessThan(section.width / 2);
  }

  // The rest unfold in place, still most chosen first, and fold away again.
  await fold.click();
  await expect(rows).toHaveCount(12);
  await expect(rows).toHaveText(byCount.map((good, at) => new RegExp(`^${good}.*${12 - at}`)));
  await expect(fold).toHaveText(`Show fewer answers to ${GOODS_QUESTION}`);
  await fold.click();
  await expect(rows).toHaveCount(8);
  await expect(fold).toBeFocused();
});
