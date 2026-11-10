import type { APIRequestContext, Locator, Page, PlaywrightWorkerArgs } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { mongoEval } from './helpers/mongo';
import {
  expectLaidOut,
  idsNamed,
  openManage,
  readsMade,
  requestsWhile,
  seedOnePersonMarket,
  toTheMarket,
  usersReadsWhile,
} from './helpers/peopleAtScale';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import {
  PEOPLE_AT_SCALE_PASSWORD,
  seedPeopleAtScale,
  type PeopleAtScaleSeed,
} from './helpers/seedPeopleAtScale';
import { loginViaApi } from './helpers/seeds';

/**
 * Manage market's people at 100+ (T204).
 *
 * A market whose organization has 150 members read every person's account one database read at a
 * time, on every market read every screen makes. On the seed of 150 people the market read names
 * them all in one read of the accounts, and Manage market opens with as many requests as on a
 * market of one person.
 *
 * "Users with access" drew every one of the 154 people, about 4,900px before Add user at a desk. It
 * is a list frame now: a find field, a count line, 50 rows and "Show N more".
 *
 * The history's "Who" finds a person by typing, among however many there are.
 */

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
              // Manage market scrolls only its body, so a place in it is the body's scroll too.
              const scroller = element.closest('[data-testid="manage-market-body"]')!;
              const { x, y } = element.getBoundingClientRect();
              return { x, y: y + scroller.scrollTop };
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
