import type { APIRequestContext, Locator, Page, PlaywrightWorkerArgs } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { FollowUpDialog } from './pages/FollowUpDialog';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ReviewersPanel } from './pages/ReviewersPanel';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { sweep } from './helpers/contrastSweep';
import { oneByOnePath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { PHONE_AND_DESK, widths } from './helpers/phoneWindow';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import {
  PEOPLE_AT_SCALE_PASSWORD,
  seedPeopleAtScale,
  type PeopleAtScaleSeed,
} from './helpers/seedPeopleAtScale';
import { loginViaApi } from './helpers/seeds';
import { uniqueMarketName } from './helpers/uniqueName';
import { withUser } from './helpers/withUser';

/**
 * People lists and people choosers at 100+ (T204).
 *
 * A market whose organization has 150 members read every person's account one database read at a
 * time, on every market read every screen makes. On the seed of 150 people the market read names
 * them all in one read of the accounts, and Manage market opens with as many requests as on a
 * market of one person. The organizations read, which the Organizations page and Manage
 * organization make, did the same for every admin and member of every organization the reader is
 * in, and now names them all in one read too.
 *
 * "Users with access" drew every one of the 154 people, about 4,900px before Add user at a desk. It
 * is a list frame now: a find field, a count line, 50 rows and "Show N more". Manage organization's
 * Members, all 150 of them, and Admins are too.
 *
 * Every chooser of a person finds them by typing, among however many there are: Choose reviewers,
 * "Who will follow up", the card's "Followed up by", the All view's "Assigned to" and the history's
 * "Who".
 *
 * The Reviewers panel names three of the 12 reviewers and "and 9 more", rather than listing them
 * above the work, and that button opens the Change dialog for the owner and a read-only list for
 * anyone else.
 */

/** A market like the seed's, in an organization whose only person is the seed owner. */
async function seedOnePersonMarket(request: APIRequestContext) {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const org = await request.post(`${BACKEND_URL}/organizations`, {
    data: { name: uniqueMarketName('Example One Person Org') },
  });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  const market = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
    orgId,
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, market.marketId, 'applications');
  for (let n = 1; n <= 5; n++) {
    seedApplicationWithStatus(market.marketId, 'open', `one-person-applicant-${n}@example.com`);
  }
  return { ...market, orgId };
}

/** The Markets page, narrowed to one market, its Manage button ready. */
async function toTheMarket(page: Page, marketName: string) {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await expect(page.getByTestId('market-card-manage-button')).toHaveCount(1);
}

async function openManage(page: Page): Promise<ManageMarketPage> {
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

/** Until no request has been in flight for a moment, so a request made late is still counted. */
async function quiet(inFlight: () => number): Promise<void> {
  let stillSince = Date.now();
  await expect
    .poll(
      () => {
        if (inFlight() > 0) stillSince = Date.now();
        return Date.now() - stillSince >= 750;
      },
      { intervals: [100], timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * The API requests the browser makes while `open` runs, each as its method and path, the ids
 * named in `ids` read as their names, so two markets' openings compare.
 */
async function requestsWhile(
  page: Page,
  ids: Record<string, string>,
  open: () => Promise<void>,
): Promise<string[]> {
  const made: string[] = [];
  let inFlight = 0;
  const sent = (request: { url(): string; method(): string }) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    inFlight += 1;
    let path = url.pathname;
    for (const [name, id] of Object.entries(ids)) path = path.replaceAll(id, `<${name}>`);
    made.push(`${request.method()} ${path}`);
  };
  const done = (request: { url(): string }) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) inFlight -= 1;
  };
  page.on('request', sent);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  try {
    await open();
    await quiet(() => inFlight);
  } finally {
    page.off('request', sent);
    page.off('requestfinished', done);
    page.off('requestfailed', done);
  }
  return made.sort();
}

interface ProfiledRead {
  op: string;
  filter: unknown;
}

/**
 * The reads of `users` the database makes while `act` runs, by MongoDB's own profiler, on for
 * that collection alone and turned off however `act` ends. The suite runs one worker, so no other
 * spec reads in between.
 */
async function usersReadsWhile(act: () => Promise<void>): Promise<ProfiledRead[]> {
  try {
    mongoEval(
      'db.setProfilingLevel(0); db.system.profile.drop(); ' +
        'db.setProfilingLevel(2, { filter: { ns: db.getName() + ".users" } })',
    );
    await act();
    return JSON.parse(
      mongoEval(
        'EJSON.stringify(db.system.profile.find({ ns: db.getName() + ".users" }).toArray()' +
          '.map((entry) => ({ op: entry.op, filter: (entry.command || {}).filter ?? (entry.command || {}).q ?? null })))',
      ),
    ) as ProfiledRead[];
  } finally {
    profilerOff();
  }
}

/**
 * The profiler off and its filter unset: a filter, once set, outlives the level and decides
 * which operations the slow-query log writes, in place of `slowms`, until it is unset.
 */
function profilerOff(): void {
  mongoEval("db.setProfilingLevel(0, { filter: 'unset' }); db.system.profile.drop()");
}

/**
 * The reads a screen's opening made, each one a database round trip of its own: a `getmore`, the
 * rest of a cursor's answer past its first batch, is the same read going on. A read per person,
 * whatever its filter (by `id`, `email`, `_id` or `$eq`), shows here as one more per person.
 */
function readsMade(reads: ProfiledRead[]): ProfiledRead[] {
  return reads.filter((read) => read.op !== 'getmore');
}

/**
 * The ids a read's filter names by `id`: alone, or in an `$in`. A `getmore`, the rest of a cursor's
 * answer past its first batch, names none: it is the same read going on.
 */
function idsNamed(read: ProfiledRead): { alone: string | null; batch: string[] } {
  const byId = (read.filter as { id?: unknown } | null)?.id;
  if (typeof byId === 'string') return { alone: byId, batch: [] };
  const batch = (byId as { $in?: unknown } | undefined)?.$in;
  return { alone: null, batch: Array.isArray(batch) ? (batch as string[]) : [] };
}

test.describe('Manage market at 150 people', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(120_000);

  let seed: PeopleAtScaleSeed;
  test.beforeEach(async ({ request }) => {
    seed = await seedPeopleAtScale(request);
  });

  test('names every account in one read of the database', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seededIds = new Set(seed.people.map((person) => person.id));
    const onePerson = await seedOnePersonMarket(request);

    await toTheMarket(page, onePerson.marketName);
    const forOne = await usersReadsWhile(async () => {
      await requestsWhile(page, {}, async () => {
        await openManage(page);
        await expect(page.getByTestId('manage-market-person')).toHaveCount(1);
      });
    });
    await toTheMarket(page, seed.marketName);
    const reads = await usersReadsWhile(async () => {
      await requestsWhile(page, {}, async () => {
        await openManage(page);
        await expect(page.getByTestId('manage-market-access-count')).toHaveText(
          `Showing 50 of ${seed.counts.withAccess}`,
        );
      });
    });

    const alone = reads.map((read) => idsNamed(read).alone).filter((id) => id && seededIds.has(id));
    expect(alone, 'a seeded person read alone').toEqual([]);
    const batches = reads.filter((read) => idsNamed(read).batch.some((id) => seededIds.has(id)));
    expect(batches).toHaveLength(1);
    expect(new Set(idsNamed(batches[0]).batch)).toEqual(seededIds);
    // The one-person market's read names no one but its reader, so the batch is the one read the
    // 150 people add, whatever filter a read per person would use.
    expect(readsMade(reads), 'the reads 153 people add').toHaveLength(readsMade(forOne).length + 1);
  });

  test('opens with as many requests as a market of one person', async ({
    authenticatedPage: page,
    request,
  }) => {
    const onePerson = await seedOnePersonMarket(request);

    await toTheMarket(page, onePerson.marketName);
    const forOne = await requestsWhile(
      page,
      { market: onePerson.marketId, org: onePerson.orgId },
      async () => {
        await openManage(page);
        await expect(page.getByTestId('manage-market-person')).toHaveCount(1);
      },
    );

    await toTheMarket(page, seed.marketName);
    const forMany = await requestsWhile(
      page,
      { market: seed.marketId, org: seed.orgId },
      async () => {
        await openManage(page);
        await expect(page.getByTestId('manage-market-access-count')).toHaveText(
          `Showing 50 of ${seed.counts.withAccess}`,
        );
      },
    );

    expect(forMany).toEqual(forOne);
  });
});

/** Nothing scrolls sideways at the window's width, and the detectors find nothing clipped. */
async function expectLaidOut(page: Page, what: string): Promise<void> {
  const { width } = page.viewportSize()!;
  expect(await widths(page), `${what} keeps the window's width`).toEqual({
    layout: width,
    sideways: 0,
    zoom: 1,
  });
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

for (const size of PHONE_AND_DESK) {
  test.describe(`Users with access at 154 people, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    let seed: PeopleAtScaleSeed;
    let manage: ManageMarketPage;
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    test.beforeEach(async ({ authenticatedPage: page, request }) => {
      seed = await seedPeopleAtScale(request);
      await toTheMarket(page, seed.marketName);
      manage = await openManage(page);
    });

    test('reads a page at a time, and fits', async ({ authenticatedPage: page }) => {
      const whole = seed.counts.withAccess;
      await expect(manage.peopleFind).toHaveAccessibleName('Find in users with access');
      await expect(manage.peopleCount).toHaveText(`Showing 50 of ${whole}`);
      await expect(manage.peopleRows).toHaveCount(50);
      await expectLaidOut(page, 'the first page');

      await expect(manage.peopleMore).toHaveText('Show 50 more');
      await press(manage.peopleMore);
      await expect(manage.peopleCount).toHaveText(`Showing 100 of ${whole}`);
      await press(manage.peopleMore);
      await expect(manage.peopleCount).toHaveText(`Showing 150 of ${whole}`);
      await expect(manage.peopleMore).toHaveText(`Show ${whole - 150} more`);
      await press(manage.peopleMore);
      await expect(manage.peopleCount).toHaveText(`${whole} people`);
      await expect(manage.peopleRows).toHaveCount(whole);
      await expect(manage.peopleMore).toHaveCount(0);

      await manage.peopleFind.fill('zzz');
      await expect(manage.peopleCount).toHaveText('Nothing matches "zzz"');
      await expect(manage.peopleRows).toHaveCount(0);
      await manage.peopleFind.fill('');
      await expect(manage.peopleCount).toHaveText(`Showing 50 of ${whole}`);
      // A passing search: it never reaches the address, which would outlive the dialog.
      await manage.peopleFind.fill('person');
      await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(seed.marketName)}$`));

      if (size.phone) {
        await page.setViewportSize({ width: 320, height: 640 });
        await expectLaidOut(page, 'the first page at 320');
      }
    });

    test('finds one person by part of their address, and their row keeps its place through a role change', async ({
      authenticatedPage: page,
    }) => {
      const { email } = seed.editors[3]!;
      const part = email.slice(2, 10).toUpperCase();
      await manage.peopleFind.fill(part);
      await expect(manage.peopleCount).toHaveText(
        `1 of ${seed.counts.withAccess} matches "${part}"`,
      );
      await expect(manage.peopleRows).toHaveCount(1);
      await expectLaidOut(page, 'one person found');

      const select = manage.person(email).getByTestId('manage-market-role-select');
      await select.focus();
      await select.selectOption('admin');
      await manage.roleChangeConfirmButton.click();
      await expect(manage.roleChangeConfirm).toHaveCount(0);

      await expect(manage.peopleFind).toHaveValue(part);
      await expect(manage.peopleRows).toHaveCount(1);
      await expect(select).toHaveValue('admin');
      await expect(select).toBeFocused();
    });

    test('holds the shown count through a role change and a removal', async () => {
      const whole = seed.counts.withAccess;
      await press(manage.peopleMore);
      await expect(manage.peopleCount).toHaveText(`Showing 100 of ${whole}`);

      const changed = manage.person(seed.editors[0]!.email);
      await changed.getByTestId('manage-market-role-select').selectOption('viewer');
      await manage.roleChangeConfirmButton.click();
      await expect(manage.roleChangeConfirm).toHaveCount(0);
      await expect(manage.peopleCount).toHaveText(`Showing 100 of ${whole}`);
      await expect(manage.peopleRows).toHaveCount(100);

      // A member given Editor: the market role goes, and they stay at the organization's.
      await manage.removeUser(seed.editors[1]!.email);
      await expect(manage.removeConfirm).toHaveCount(0);
      await expect(manage.peopleCount).toHaveText(`Showing 100 of ${whole}`);
      await expect(manage.people).toBeFocused();
    });

    test('shows someone just added as the one row, until the field is cleared', async () => {
      const { email } = seed.members[seed.members.length - 1]!;
      await manage.addUser(email, 'editor');

      await expect(manage.peopleFind).toHaveValue(email);
      await expect(manage.peopleRows).toHaveCount(1);
      await expect(manage.person(email).getByTestId('manage-market-role-select')).toHaveValue(
        'editor',
      );

      await manage.peopleFind.fill('');
      await expect(manage.peopleCount).toHaveText(`Showing 50 of ${seed.counts.withAccess}`);
    });
  });
}

/** The rows a list frame draws before "Show N more". */
const PAGE = 50;

/**
 * Manage organization opened from its address, as Manage market's "Manage organization" opens it:
 * the Organizations page reads the reader's organizations, then opens the one named.
 */
async function openManageOrganization(
  page: Page,
  orgId: string,
  people: { admins: number; members: number },
): Promise<OrganizationsPage> {
  await page.goto(`/organizations?manage=${encodeURIComponent(orgId)}`);
  const orgs = new OrganizationsPage(page);
  await expect(orgs.manageWindow).toBeVisible();
  await expect(orgs.adminEmails).toHaveCount(Math.min(people.admins, PAGE));
  await expect(orgs.memberEmails).toHaveCount(Math.min(people.members, PAGE));
  return orgs;
}

test.describe('Manage organization at 150 people', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(120_000);

  let seed: PeopleAtScaleSeed;
  test.beforeEach(async ({ request }) => {
    seed = await seedPeopleAtScale(request);
  });

  test('names every admin and member in one read of the database', async ({
    authenticatedPage: page,
  }) => {
    const seededIds = new Set(seed.people.map((person) => person.id));

    const reads = await usersReadsWhile(async () => {
      await requestsWhile(page, {}, async () => {
        await openManageOrganization(page, seed.orgId, seed.counts);
      });
    });

    const alone = reads.map((read) => idsNamed(read).alone).filter((id) => id && seededIds.has(id));
    expect(alone, 'a seeded person read alone').toEqual([]);
    const batches = reads.filter((read) => idsNamed(read).batch.some((id) => seededIds.has(id)));
    expect(batches).toHaveLength(1);
    // The seed owner is in other organizations too, whose people the same read names.
    const batch = new Set(idsNamed(batches[0]).batch);
    expect([...seededIds].filter((id) => !batch.has(id))).toEqual([]);
    // A one-person organization's opening reads every organization the seed owner is in as well,
    // so it is no measure here: the opening's reads are the session's account and the one batch,
    // a handful, where a read per person, whatever its filter, makes one per admin and member.
    expect(readsMade(reads).length, 'the reads the opening made').toBeLessThan(10);
  });

  test('opens with as many requests as an organization of one person', async ({
    authenticatedPage: page,
    request,
  }) => {
    const onePerson = await seedOnePersonMarket(request);

    const forOne = await requestsWhile(page, { org: onePerson.orgId }, async () => {
      await openManageOrganization(page, onePerson.orgId, { admins: 0, members: 0 });
    });
    const forMany = await requestsWhile(page, { org: seed.orgId }, async () => {
      await openManageOrganization(page, seed.orgId, seed.counts);
    });

    expect(forMany).toEqual(forOne);
  });
});

for (const size of PHONE_AND_DESK) {
  test.describe(`Admins and Members at 150 people, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    let seed: PeopleAtScaleSeed;
    let orgs: OrganizationsPage;
    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    test.beforeEach(async ({ authenticatedPage: page, request }) => {
      seed = await seedPeopleAtScale(request);
      orgs = await openManageOrganization(page, seed.orgId, seed.counts);
    });

    test('Members reads a page at a time, and fits', async ({ authenticatedPage: page }) => {
      const whole = seed.counts.members;
      await expect(orgs.membersFind).toHaveAccessibleName('Find in members');
      await expect(orgs.membersCount).toHaveText(`Showing ${PAGE} of ${whole}`);
      await expect(orgs.memberEmails).toHaveCount(PAGE);
      await expectLaidOut(page, 'the first page of Members');

      await expect(orgs.membersMore).toHaveText(`Show ${PAGE} more`);
      await press(orgs.membersMore);
      await expect(orgs.membersCount).toHaveText(`Showing ${2 * PAGE} of ${whole}`);
      await press(orgs.membersMore);
      await expect(orgs.membersCount).toHaveText(`${whole} members`);
      await expect(orgs.membersMore).toHaveCount(0);

      // A passing search: it never reaches the address, which would outlive the dialog.
      await orgs.membersFind.fill('person');
      await expect(page).not.toHaveURL(/[?&]q=/);

      if (size.phone) {
        await page.setViewportSize({ width: 320, height: 640 });
        await expectLaidOut(page, 'Members at 320');
      }
    });

    test('Admins, three of them, has no find field and reads every row', async () => {
      await expect(orgs.adminEmails).toHaveCount(seed.counts.admins);
      await expect(orgs.adminsFind).toHaveCount(0);
      await expect(orgs.adminsMore).toHaveCount(0);
      await expect(orgs.adminsCount).toHaveText(`${seed.counts.admins} admins`);
    });

    test('finds one member, and Remove asks about that member, keeping the words', async ({
      authenticatedPage: page,
    }) => {
      const whole = seed.counts.members;
      const { email } = seed.members[whole - 1]!;
      const part = email.slice(2, 10).toUpperCase();
      await orgs.membersFind.fill(part);
      await expect(orgs.membersCount).toHaveText(`1 of ${whole} matches "${part}"`);
      await expect(orgs.memberEmails).toHaveText([email]);
      await expectLaidOut(page, 'one member found');

      await press(orgs.removeMemberButtons);
      await expect(orgs.removeConfirm).toHaveAccessibleName(
        `Remove ${email} from ${seed.orgName}?`,
      );
      await press(orgs.removeConfirmButton);
      await expect(orgs.removeConfirm).toHaveCount(0);

      await expect(orgs.membersFind).toHaveValue(part);
      await expect(orgs.membersCount).toHaveText(`Nothing matches "${part}"`);
      await expect(orgs.members).toBeFocused();
    });

    test('holds the shown count through a removal, and finds someone just added', async () => {
      const whole = seed.counts.members;
      await press(orgs.membersMore);
      await expect(orgs.membersCount).toHaveText(`Showing ${2 * PAGE} of ${whole}`);

      const { email } = seed.members[0]!;
      await orgs.memberEmails.filter({ hasText: email }).waitFor();
      await press(orgs.removeMemberButtons.first());
      await press(orgs.removeConfirmButton);
      await expect(orgs.removeConfirm).toHaveCount(0);
      await expect(orgs.membersCount).toHaveText(`Showing ${2 * PAGE} of ${whole - 1}`);
      await expect(orgs.memberEmails).toHaveCount(2 * PAGE);

      await orgs.addMember(email);
      await expect(orgs.membersFind).toHaveValue(email);
      await expect(orgs.memberEmails).toHaveText([email]);

      await orgs.membersFind.fill('');
      await expect(orgs.membersCount).toHaveText(`Showing ${PAGE} of ${whole}`);
    });
  });
}

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

for (const size of PHONE_AND_DESK) {
  test.describe(`The history's "Who" among the people who changed something, ${size.name}`, () => {
    test.use(size.use);
    test.setTimeout(120_000);

    const press = (locator: Locator) => (size.phone ? locator.tap() : locator.click());

    /** The seed, with one of its admins having changed something too, History open. */
    async function openTheHistory(
      page: Page,
      request: APIRequestContext,
      playwright: PlaywrightWorkerArgs['playwright'],
    ): Promise<{ manage: ManageMarketPage; admin: string }> {
      const seed = await seedPeopleAtScale(request);
      const admin = seed.admins[0]!.email;
      const api = await playwright.request.newContext({
        baseURL: BACKEND_URL,
        ignoreHTTPSErrors: true,
      });
      try {
        await loginViaApi(api, BACKEND_URL, admin, PEOPLE_AT_SCALE_PASSWORD);
        const granted = await api.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
          data: { user_email: seed.members.at(-1)!.email, role: 'editor' },
        });
        expect(granted.ok(), await granted.text()).toBeTruthy();
      } finally {
        await api.dispose();
      }
      await toTheMarket(page, seed.marketName);
      const manage = await openManage(page);
      await manage.openHistory();
      await expect(manage.historySentences.first()).toContainText(admin);
      return { manage, admin };
    }

    test('finds one by typing and narrows to them, and Anyone takes it back', async ({
      authenticatedPage: page,
      request,
      playwright,
    }) => {
      const { manage, admin } = await openTheHistory(page, request, playwright);
      const who = manage.historyWho;
      await expect(who.field).toHaveValue('Anyone');
      const everything = await manage.historySentences.count();
      expect(everything).toBeGreaterThan(1);
      await expectLaidOut(page, 'the filters');

      await press(who.field);
      await expect(who.options).toHaveCount(3);
      await expect(who.options.first()).toHaveText('Anyone');
      await expect(who.option(admin)).toBeVisible();
      await expect(who.option(TEST_USER.email)).toContainText('You');
      await expectLaidOut(page, 'the filters, its list open');

      // Words only search: the list narrows, and the history waits for a choice.
      await who.field.fill(admin.split('@')[0]!.toUpperCase());
      await expect(who.options).toHaveText([admin]);
      await expect(manage.historySentences).toHaveCount(everything);
      await expectLaidOut(page, 'one person found');

      await press(who.options.first());
      await expect(who.field).toHaveValue(admin);
      await expect(manage.historySentences).toHaveCount(1);
      await expect(manage.historySentences.first()).toContainText(`${admin} `);

      await manage.narrowHistoryTo('Anyone');
      await expect(who.field).toHaveValue('Anyone');
      await expect(manage.historySentences).toHaveCount(everything);
    });

    test('moves nothing as its list opens, and Escape closes the list before the dialog', async ({
      authenticatedPage: page,
      request,
      playwright,
    }) => {
      const { manage } = await openTheHistory(page, request, playwright);
      const who = manage.historyWho;
      const kind = manage.historyKind;
      const others = [
        kind,
        manage.historyVendor.field,
        page.getByTestId('market-history-from'),
        page.getByTestId('market-history-to'),
        manage.historySentences.first(),
      ];
      const where = () =>
        Promise.all(
          others.map((item) =>
            item.evaluate((element) => {
              const scroller = element.closest('[data-testid="manage-market-window"]');
              const { x, y } = element.getBoundingClientRect();
              return { x, y: y + (scroller?.scrollTop ?? 0) };
            }),
          ),
        );

      // "Who" and "Kind of change" stand as one row of two, one height.
      const whoBox = (await who.field.boundingBox())!;
      const kindBox = (await kind.boundingBox())!;
      expect(whoBox.y).toBeCloseTo(kindBox.y, 0);
      expect(whoBox.height).toBeCloseTo(kindBox.height, 0);
      expect(whoBox.width).toBeCloseTo(kindBox.width, 0);

      const before = await where();
      await press(who.field);
      await expect(who.list).toBeVisible();
      expect(await where()).toEqual(before);

      // Its list is as wide as the two columns, so an address reads on one line.
      const listBox = (await who.list.boundingBox())!;
      expect(listBox.x).toBeCloseTo(whoBox.x, 0);
      expect(listBox.x + listBox.width).toBeCloseTo(kindBox.x + kindBox.width, 0);

      await who.field.press('Escape');
      await expect(who.list).toBeHidden();
      await expect(manage.window).toBeVisible();
      expect(await where()).toEqual(before);

      // The last row lies over the filters below, and a press takes it.
      await press(who.field);
      const last = who.options.last();
      await last.scrollIntoViewIfNeeded();
      await press(last);
      await expect(who.list).toBeHidden();
      await expect(who.field).not.toHaveValue('Anyone');

      await who.field.press('Escape');
      await expect(manage.window).toBeHidden();
    });

    if (size.phone) {
      test('fits 320 wide', async ({ authenticatedPage: page, request, playwright }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        const { manage, admin } = await openTheHistory(page, request, playwright);
        const who = manage.historyWho;
        await expectLaidOut(page, 'the filters at 320');

        await press(who.field);
        await expect(who.options).toHaveCount(3);
        await expectLaidOut(page, 'its list open at 320');

        await who.field.fill(admin);
        await expect(who.options).toHaveText([admin]);
        await expectLaidOut(page, 'one person found at 320');

        await press(who.options.first());
        await expect(who.field).toHaveValue(admin);
        await expectLaidOut(page, 'the filters on one person at 320');
      });
    }
  });
}

test.describe('Counting the reads of accounts', () => {
  /** The profiler's level and, when one is set, its filter. */
  function profilerStatus(): { was: number; filter?: unknown } {
    return JSON.parse(mongoEval('EJSON.stringify(db.getProfilingStatus())'));
  }

  test('leaves the profiler off with no filter, however the screen ends', async () => {
    await usersReadsWhile(async () => {});
    expect(profilerStatus()).toMatchObject({ was: 0 });
    expect(profilerStatus().filter).toBeUndefined();

    await expect(
      usersReadsWhile(async () => {
        throw new Error('the screen failed');
      }),
    ).rejects.toThrow('the screen failed');
    expect(profilerStatus()).toMatchObject({ was: 0 });
    expect(profilerStatus().filter).toBeUndefined();
  });
});
