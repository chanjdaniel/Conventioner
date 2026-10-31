import type { APIRequestContext } from '@playwright/test';
import { approvedVendorApplication, insertApplications } from './seedApplication';
import { seedDraftMarket } from './seedDraftMarket';
import { transitionMarket } from './seedPhaseMarket';
import {
  ensureTestOrgAuthenticated,
  loginViaApi,
  marketNameToSlug,
  seedPublishedMarketWithAssignments,
} from './seeds';
import { uniqueMarketName } from './uniqueName';
import { ensureVerifiedUser } from './verifiedUser';

/**
 * The markets the sweeps walk (`screens.ts`): one in every phase, and each as full as a real one.
 *
 * A layout holds on a market of three short names and breaks on a real one, so this is a stress
 * seed: names of about 70 characters, 40 applications in every review state, a review divided
 * between two reviewers, 36 vendors over four dates and three sections, a long question label, long
 * links and settled priority rules. The trial that chose it (T67) found a squeezed date column only
 * once the walk reached a dashboard that remembered a market, so every market here is one a screen
 * can be opened on.
 *
 * Applications are written in one `insertMany` per market: a container round trip each would cost
 * the sweep more than walking the screens it seeds.
 */

export interface SeededMarket {
  marketId: string;
  marketName: string;
  marketSlug: string;
}

export interface TheScreensSeed {
  /** A draft with a 70-character name, a four-date, three-section plan and a long form. */
  draft: SeededMarket;
  /** Taking applications on its own page: 40 applications in every review state. */
  open: SeededMarket;
  /** Its own page no longer taking applications (E38/F04/S02), the same applications. */
  closed: SeededMarket;
  /** A Google Form market in Review, the same applications. */
  review: SeededMarket;
  /**
   * Taking applications with the review divided (E38/F07): the organizer and `reviewer` chosen,
   * the organizer's share all decided and every open application dealt to `reviewer`, so the
   * organizer's One by one reads that their share is done.
   */
  dealt: SeededMarket & { reviewer: string };
  /** In Assignment, with open priority rules and no run yet. */
  assignment: SeededMarket;
  /** Market days: 36 vendors placed over four dates and three sections, results published. */
  big: SeededMarket;
  /** Market days, its priority rules settled. */
  rules: SeededMarket;
  /** Archived, a CSV market. */
  archived: SeededMarket;
  /** A CSV market taking applications, which the import screen serves. */
  csv: SeededMarket;
  /** A CSV draft with no plan yet, which starting from a Google Form's responses serves. */
  csvDraft: SeededMarket;
  /** An applicant of `open`, who signs in to their dashboard (`signIn` in `screens.ts`). */
  applicant: { email: string };
}

export const MARKET_DATES = ['2099-08-01', '2099-08-08', '2099-08-15', '2099-08-22'];
const TIERS = ['Gold', 'Silver', 'Community'];
const INDOORS = 'Indoors - the old cannery warehouse';
const OUTDOORS = 'Outdoors - the courtyard';
const SECTIONS = ['Main Hall', 'Mezzanine and the long gallery by the loading doors', 'Courtyard'];
const CATEGORIES = [
  'Ceramics and pottery',
  'Prints, zines and illustration',
  'Jewellery',
  'Food and drink (pre-packaged only)',
  'Textiles',
];

function plan(dates: string[] = MARKET_DATES) {
  return {
    priority: [],
    marketDates: dates.map((date) => ({ date })),
    tiers: TIERS.map((name, id) => ({ id, name })),
    locations: [{ name: INDOORS }, { name: OUTDOORS }],
    sections: [
      { name: SECTIONS[0], location: { name: INDOORS }, tier: { id: 0, name: 'Gold' }, count: 12 },
      {
        name: SECTIONS[1],
        location: { name: INDOORS },
        tier: { id: 1, name: 'Silver' },
        count: 10,
      },
      {
        name: SECTIONS[2],
        location: { name: OUTDOORS },
        tier: { id: 2, name: 'Community' },
        count: 8,
      },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
    floorplans: [
      {
        tableTypes: ['Full Table', 'Half Table'].map((name) => ({
          name,
          widthMm: 1800,
          heightMm: 800,
          maxCapacity: 2,
        })),
      },
    ],
  };
}

const FIELDS = [
  {
    key: 'business_name',
    label: 'Business name',
    type: 'text',
    required: true,
    options: [],
    order: 0,
  },
  {
    key: 'product_type',
    label:
      'What will you be selling at the market, and roughly what price range do your items fall into?',
    type: 'text',
    required: true,
    options: [],
    order: 1,
  },
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: CATEGORIES,
    order: 2,
  },
  {
    key: 'portfolio',
    label: 'Portfolio or shop link',
    type: 'text',
    required: false,
    options: [],
    order: 3,
  },
];

const BUSINESSES = [
  'Alexandria Montgomery-Featherstonehaugh Ceramics and Handmade Stoneware Studio',
  'Bob Prints',
  'The Very Small Zine Press of East Example Collective',
  'Kiln & Co.',
  'Wildflower Apothecary: Small-batch Soaps, Salves and Botanical Candles',
];

/** The form's own answers for the i-th applicant: some long, some short, some links. */
function answers(i: number) {
  return {
    business_name: BUSINESSES[i % BUSINESSES.length] + (i >= BUSINESSES.length ? ` ${i}` : ''),
    product_type:
      i % 3 === 0
        ? 'Wheel-thrown mugs, bowls and planters in speckled glazes, priced between twenty and one hundred and twenty dollars'
        : 'Prints',
    category: CATEGORIES[i % CATEGORIES.length],
    portfolio:
      i % 2 === 0 ? `https://www.instagram.com/vendor_${i}_with_a_rather_long_handle_name` : '',
  };
}

/** A name about 70 characters long, still unique: a market's name is its public address. */
function longName(prefix: string): string {
  const unique = uniqueMarketName('');
  return prefix.slice(0, 70 - unique.length) + unique;
}

async function createMarket(
  api: APIRequestContext,
  backend: string,
  email: string,
  name: string,
  setupObject: Record<string, unknown>,
  intakeMode: 'csv' | 'form' = 'form',
): Promise<SeededMarket> {
  const orgId = await ensureTestOrgAuthenticated(api, backend, email);
  const res = await api.post(`${backend}/markets`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      name,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
      intakeMode,
      setupObject,
    },
  });
  if (!res.ok()) throw new Error(`Market creation failed: ${res.status()} ${await res.text()}`);
  const { market_id: marketId } = (await res.json()) as { market_id: string };
  const form = await api.put(`${backend}/markets/${marketId}/application-form`, {
    headers: { 'Content-Type': 'application/json' },
    data: { fields: FIELDS },
  });
  if (!form.ok()) throw new Error(`Form save failed: ${form.status()} ${await form.text()}`);
  return { marketId, marketName: name, marketSlug: marketNameToSlug(name) };
}

async function walk(
  api: APIRequestContext,
  backend: string,
  email: string,
  marketId: string,
  phases: string[],
): Promise<void> {
  for (const phase of phases) await transitionMarket(api, backend, email, marketId, phase);
}

const UP_TO_ASSIGNMENT = ['applications', 'assignment'];

/** The other reviewer of `dealt`, a Viewer on that market only; fixture data. */
const DEALT_REVIEWER = 'e2e-screens-reviewer@example.com';
const DEALT_REVIEWER_PASSWORD = 'e2epassword123';
const UNDECIDED = ['open', 'under_review'];

/**
 * A market whose review is divided between `email` and `DEALT_REVIEWER`: chosen in the draft, so
 * no deal runs, and its applications go in already dealt, every open one to the other reviewer and
 * the decided ones alternately, so both shares have rows and the organizer's has nothing to hand
 * out.
 */
async function dealtMarket(
  api: APIRequestContext,
  backend: string,
  email: string,
  dates: string[],
): Promise<SeededMarket & { reviewer: string }> {
  ensureVerifiedUser(DEALT_REVIEWER, DEALT_REVIEWER_PASSWORD);
  const market = await createMarket(
    api,
    backend,
    email,
    uniqueMarketName('Harbour Divided Market'),
    plan(dates),
  );
  const at = `${backend}/markets/${market.marketId}`;
  const role = await api.post(`${at}/roles`, {
    data: { user_email: DEALT_REVIEWER, role: 'viewer' },
  });
  if (!role.ok()) throw new Error(`Role failed: ${role.status()} ${await role.text()}`);
  const chosen = await api.put(`${at}/reviewers`, {
    data: { reviewers: [email, DEALT_REVIEWER] },
  });
  if (!chosen.ok()) throw new Error(`Choosing failed: ${chosen.status()} ${await chosen.text()}`);
  insertApplications(
    applicationsInEveryState(market.marketId, email, dates).map((application, i) => ({
      ...application,
      reviewer: {
        user_id: null,
        email: UNDECIDED.includes(application.status) || i % 2 ? DEALT_REVIEWER : email,
      },
    })),
  );
  await walk(api, backend, email, market.marketId, ['applications']);
  return { ...market, reviewer: DEALT_REVIEWER };
}

/** 40 applications, in every review state, with a verdict's giver where a reviewer gave one. */
function applicationsInEveryState(marketId: string, reviewer: string, dates: string[]) {
  const statuses = [
    'open',
    'open',
    'under_review',
    'needs_follow_up',
    'reviewer_approved',
    'reviewer_rejected',
  ];
  const now = new Date().toISOString();
  return Array.from({ length: 40 }, (_, i) => {
    const status = statuses[i % statuses.length];
    const base = approvedVendorApplication(marketId, `applicant${i}@example.com`, {
      dates,
      tiers: ['Gold', 'Silver'],
      sections: SECTIONS,
      fullName: `Applicant Number ${i} Featherstonehaugh-Montgomery`,
      extra: answers(i),
    });
    const by = { kind: 'person', user_id: null, email: reviewer };
    const marked = ['needs_follow_up', 'reviewer_approved', 'reviewer_rejected'].includes(status);
    return {
      ...base,
      status,
      ...(marked ? { verdict_by: by, verdict_at: now } : {}),
      ...(status === 'needs_follow_up'
        ? { follow_up_owner: { user_id: null, email: reviewer } }
        : {}),
    };
  });
}

/** 36 approved vendors over the market's dates and sections, every fifth with a long name. */
function manyVendors(marketId: string, prefix: string, count: number, dates: string[]) {
  return Array.from({ length: count }, (_, i) =>
    approvedVendorApplication(marketId, `${prefix}${i}@example.com`, {
      dates: dates.slice(0, Math.min(dates.length, 2 + (i % 3))),
      tiers: [TIERS[i % TIERS.length]],
      sections: SECTIONS,
      tableChoice: i % 4 === 0 ? 'half' : 'full',
      fullName: i % 5 === 0 ? `Maximilian Alexander Featherstonehaugh-Montgomery ${i}` : undefined,
      extra: answers(i),
    }),
  );
}

const RULES = [
  { id: 1, target: 'category', ordering: CATEGORIES, direction: null },
  { id: 2, target: 'application.submitted_at', ordering: [], direction: 'ascending' },
];

async function assignAndPublish(
  api: APIRequestContext,
  backend: string,
  email: string,
  marketId: string,
): Promise<void> {
  const assign = await api.post(`${backend}/markets/${marketId}/assignment`);
  if (!assign.ok()) throw new Error(`Assign failed: ${assign.status()} ${await assign.text()}`);
  const pub = await api.post(`${backend}/markets/${marketId}/publish-results`);
  if (!pub.ok()) throw new Error(`Publish failed: ${pub.status()} ${await pub.text()}`);
  await transitionMarket(api, backend, email, marketId, 'market_days');
}

export async function seedTheScreens(
  api: APIRequestContext,
  backend: string,
  email: string,
  password: string,
): Promise<TheScreensSeed> {
  await loginViaApi(api, backend, email, password);
  const two = MARKET_DATES.slice(0, 2);

  const draft = await createMarket(
    api,
    backend,
    email,
    longName('The Riverside Twilight Makers and Artisans Night Market'),
    plan(),
  );

  // In the stage where applications arrive and are reviewed (E38/F04/S01). A Google Form market
  // enters it holding its responses, so they go in first.
  const withApplications = async (prefix: string, intakeMode: 'csv' | 'form') => {
    const market = await createMarket(
      api,
      backend,
      email,
      uniqueMarketName(prefix),
      plan(two),
      intakeMode,
    );
    insertApplications(applicationsInEveryState(market.marketId, email, two));
    await walk(api, backend, email, market.marketId, ['applications']);
    return market;
  };
  const open = await withApplications('Harbour Night Market', 'form');
  const closed = await withApplications('Harbour Closed Market', 'form');
  const stop = await api.post(`${backend}/markets/${closed.marketId}/applications-stopped`, {
    data: { stopped: true },
  });
  if (!stop.ok()) throw new Error(`Stopping failed: ${stop.status()} ${await stop.text()}`);
  const review = await withApplications('Harbour Review Market', 'csv');
  const dealt = await dealtMarket(api, backend, email, two);

  const assignment = await createMarket(api, backend, email, uniqueMarketName('Winter Lantern'), {
    ...plan(two),
    priority: RULES,
  });
  insertApplications(manyVendors(assignment.marketId, 'lantern', 12, two));
  await walk(api, backend, email, assignment.marketId, UP_TO_ASSIGNMENT);

  const big = await createMarket(
    api,
    backend,
    email,
    longName('Fall Makers Fair at the Old Cannery Warehouse District'),
    plan(),
  );
  insertApplications(manyVendors(big.marketId, 'vendor', 36, MARKET_DATES));
  await walk(api, backend, email, big.marketId, UP_TO_ASSIGNMENT);
  await assignAndPublish(api, backend, email, big.marketId);

  const rules = await createMarket(api, backend, email, uniqueMarketName('Spring Rules'), {
    ...plan(two),
    priority: RULES,
  });
  insertApplications(manyVendors(rules.marketId, 'rules', 8, two));
  await walk(api, backend, email, rules.marketId, UP_TO_ASSIGNMENT);
  await assignAndPublish(api, backend, email, rules.marketId);

  const archived = await seedPublishedMarketWithAssignments(api, backend, email, password);
  await transitionMarket(api, backend, email, archived.marketId, 'archived');

  const csv = await createMarket(
    api,
    backend,
    email,
    uniqueMarketName('Import Market'),
    plan(two),
    'csv',
  );
  insertApplications(manyVendors(csv.marketId, 'imported', 4, two));
  await walk(api, backend, email, csv.marketId, ['applications']);
  const { marketId, marketName } = await seedDraftMarket(api, backend, email, password, {
    intakeMode: 'csv',
  });
  const csvDraft = { marketId, marketName, marketSlug: marketNameToSlug(marketName) };

  // The first applicant of `open`; each sign-in plants its own code, since a code is used once.
  const applicant = { email: 'applicant0@example.com' };

  return {
    draft,
    open,
    closed,
    review,
    dealt,
    assignment,
    big,
    rules,
    archived,
    csv,
    csvDraft,
    applicant,
  };
}
