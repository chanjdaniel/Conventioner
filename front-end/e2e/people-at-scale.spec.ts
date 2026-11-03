import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { mongoEval } from './helpers/mongo';
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
        await expect(page.getByTestId('manage-market-person')).toHaveCount(seed.counts.withAccess);
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
        await expect(page.getByTestId('manage-market-person')).toHaveCount(seed.counts.withAccess);
      },
    );

    expect(forMany).toEqual(forOne);
  });
});

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
  await expect(orgs.adminEmails).toHaveCount(people.admins);
  await expect(orgs.memberEmails).toHaveCount(people.members);
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
