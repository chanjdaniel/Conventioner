import { expect, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL, TEST_USER } from '../fixtures';
import { runBackendScript } from './backendScript';
import { loginViaApi } from './seeds';
import { grantMarketRole } from './grantMarketRole';
import { seedApplicationWithStatus, seedPhaseMarket, transitionMarket } from './seedPhaseMarket';
import { uniqueMarketName } from './uniqueName';

/** The fixture domain of the seeded people: reserved for tests, so no address is anyone's. */
export const PEOPLE_AT_SCALE_DOMAIN = 'people-at-scale.test';
/** Every seeded person's password, for a spec that signs one of them in. */
export const PEOPLE_AT_SCALE_PASSWORD = 'e2epeopleatscale123';

const PEOPLE = 153;
const ADMINS = 3;
const EDITORS = 20;
const REVIEWERS = 12;
const APPLICATIONS = 5;

export interface SeededPerson {
  id: string;
  email: string;
}

export interface PeopleAtScaleSeed {
  marketId: string;
  marketName: string;
  orgId: string;
  orgName: string;
  /** The seed owner, `TEST_USER`: the organization's owner and the market's. */
  owner: SeededPerson;
  /** Every seeded person, 001 to 153, in order. */
  people: SeededPerson[];
  /** The organization's admins, 001 to 003. */
  admins: SeededPerson[];
  /** The organization's members, 004 to 153, in the order they were added. */
  members: SeededPerson[];
  /** The members given Editor on the market, the first 20. */
  editors: SeededPerson[];
  /** The chosen reviewers, the first 12 editors. */
  reviewers: SeededPerson[];
  counts: {
    /** "Users with access": the owner, the admins and the members. */
    withAccess: number;
    admins: number;
    members: number;
    reviewers: number;
    applications: number;
  };
}

/** `person-001@people-at-scale.test` and on. */
export function personAtScale(n: number): string {
  return `person-${String(n).padStart(3, '0')}@${PEOPLE_AT_SCALE_DOMAIN}`;
}

/**
 * Make the verified accounts with one run of `create_test_user.py --bulk`, the one maker of a
 * login-ready account, and answer each one's id from what it printed: "created <email> <id>" or
 * "exists <email> <id>", so a second run finds the first run's accounts.
 */
function ensureVerifiedPeople(emails: string[], password: string): SeededPerson[] {
  const output = runBackendScript('create_test_user.py', '--bulk', password, ...emails);
  const ids = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [outcome, email, id] = line.trim().split(' ');
    if ((outcome === 'created' || outcome === 'exists') && email && id) ids.set(email, id);
  }
  return emails.map((email) => {
    const id = ids.get(email);
    if (!id) {
      throw new Error(`create_test_user.py --bulk did not answer ${email}.\nOutput:\n${output}`);
    }
    return { id, email };
  });
}

/**
 * A market whose organization has 150 people (T204): the case every people list and chooser must
 * hold, made under the signed-in seed owner, whose session `request` carries afterwards.
 *
 * 153 accounts at `people-at-scale.test`; an organization of its own, owned by the seed owner,
 * with persons 001 to 003 its admins and 004 to 153 its 150 members, added through its endpoints
 * as Manage organization adds them; a market in it in Applications, review open, with 5
 * applications; Editor on the market for the first 20 members; and the first 12 of those chosen
 * as its reviewers, through the endpoint Choose reviewers saves to, which deals the applications
 * among them. A spec asserts against the ids, addresses and counts this answers, never a number
 * typed twice.
 */
export async function seedPeopleAtScale(request: APIRequestContext): Promise<PeopleAtScaleSeed> {
  const people = ensureVerifiedPeople(
    Array.from({ length: PEOPLE }, (_, i) => personAtScale(i + 1)),
    PEOPLE_AT_SCALE_PASSWORD,
  );
  const admins = people.slice(0, ADMINS);
  const members = people.slice(ADMINS);
  const editors = members.slice(0, EDITORS);
  const reviewers = editors.slice(0, REVIEWERS);

  // The seed owner signed in, so the organization below is theirs.
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgName = uniqueMarketName('Example People Org');
  const org = await request.post(`${BACKEND_URL}/organizations`, { data: { name: orgName } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  // One at a time, so the organization holds them in the order above.
  for (const [place, placed] of [
    ['admins', admins],
    ['members', members],
  ] as const) {
    for (const person of placed) {
      const added = await request.post(`${BACKEND_URL}/organizations/${orgId}/${place}`, {
        data: { user_email: person.email },
      });
      expect(added.ok(), await added.text()).toBeTruthy();
    }
  }

  const market = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
    orgId,
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, market.marketId, 'applications');
  for (let n = 1; n <= APPLICATIONS; n++) {
    seedApplicationWithStatus(
      market.marketId,
      'open',
      `people-at-scale-applicant-${n}@example.com`,
    );
  }
  for (const editor of editors) {
    await grantMarketRole(request, market.marketId, editor, 'editor');
  }
  const chosen = await request.put(`${BACKEND_URL}/markets/${market.marketId}/reviewers`, {
    data: { reviewers: reviewers.map((person) => person.email) },
  });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();

  return {
    marketId: market.marketId,
    marketName: market.marketName,
    orgId,
    orgName,
    owner: { id: market.userId, email: TEST_USER.email },
    people,
    admins,
    members,
    editors,
    reviewers,
    counts: {
      withAccess: 1 + admins.length + members.length,
      admins: admins.length,
      members: members.length,
      reviewers: reviewers.length,
      applications: APPLICATIONS,
    },
  };
}
