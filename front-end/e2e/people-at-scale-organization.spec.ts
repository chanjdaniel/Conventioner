import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { OrganizationsPage } from './pages/OrganizationsPage';
import {
  expectLaidOut,
  idsNamed,
  openManageOrganization,
  PAGE,
  readsMade,
  requestsWhile,
  seedOnePersonMarket,
  usersReadsWhile,
} from './helpers/peopleAtScale';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import { seedPeopleAtScale, type PeopleAtScaleSeed } from './helpers/seedPeopleAtScale';

/**
 * Manage organization's people at 100+ (T204).
 *
 * The organizations read, which the Organizations page and Manage organization make, read every
 * admin and member of every organization the reader is in one database read at a time, and now
 * names them all in one read.
 *
 * Manage organization's Members, all 150 of them, is a list frame: a find field, a count line, 50
 * rows and "Show N more"; Admins is too.
 */

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
