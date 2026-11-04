import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { mongoEval } from './helpers/mongo';
import { PHONE_AND_DESK, widths } from './helpers/phoneWindow';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedPeopleAtScale, type PeopleAtScaleSeed } from './helpers/seedPeopleAtScale';
import { loginViaApi } from './helpers/seeds';
import { uniqueMarketName } from './helpers/uniqueName';

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
