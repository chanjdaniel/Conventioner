import type { APIRequestContext } from '@playwright/test';
import { mongoEval } from './mongo';
import { approvedVendorApplication, insertApplications } from './seedApplication';
import { seedDraftMarket } from './seedDraftMarket';
import { decideReviewSetup } from './decideReviewSetup';
import {
  connectToFakeDiscord,
  fakeDiscordId,
  recordRoleRun,
  type RoleRunOutcome,
} from './fakeDiscord';
import { transitionMarket } from './seedPhaseMarket';
import {
  ensureOrganizationAdmin,
  ensureTestOrgAuthenticated,
  loginViaApi,
  marketNameToSlug,
  seedPublishedMarketWithAssignments,
} from './seeds';
import { uniqueMarketName } from './uniqueName';
import { ensureVerifiedUser } from './verifiedUser';
import { saveApplicationForm } from './saveApplicationForm';

/**
 * The markets the sweeps walk (`screens.ts`): one in every phase, and each as full as a real one.
 *
 * A layout holds on a market of three short names and breaks on a real one, so this is a stress
 * seed: names of about 70 characters, 40 applications in every review state, a review divided
 * between two reviewers, 36 vendors over four dates and three sections, a long question label, long
 * links and settled priority rules. The trial that chose it (T67) found a squeezed date column only
 * once the walk reached a page that remembered a market, so every market here is one a screen can
 * be opened on.
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
  /**
   * Market days: 36 vendors placed over four dates and three sections, results published, and
   * `SCREENS_EDITOR` an Editor on it, so Update info shows them the answers the assignment reads
   * locked (`signIn`'s `'editor'` in `screens.ts`).
   */
  big: SeededMarket;
  /**
   * Market days, its priority rules settled, and priced (T180), so Payments draws the market's money
   * and its tables by tier and by date; half its first day's vendors checked in (T201), so Stats
   * draws every section and its strip counts that day.
   */
  rules: SeededMarket;
  /**
   * In Assignment, run, its first section past the Assignments page's fold of 20 tables (T223), so a
   * section can unfold.
   */
  longSection: SeededMarket;
  /**
   * Market days, connected to Discord with a long last run on record (T217), in a market of its own
   * since a connection changes the Vendors page and the Tools tab the other markets are walked on.
   */
  roleReport: SeededMarket;
  /** Archived, a CSV market. */
  archived: SeededMarket;
  /** A CSV market taking applications, which the import screen serves. */
  csv: SeededMarket;
  /** A CSV draft with no plan yet, which starting from a Google Form's responses serves. */
  csvDraft: SeededMarket;
  /**
   * A CSV draft with its plan and form, `DEALT_REVIEWER` a Viewer on it, so its first import's
   * preview offers the reviewers (E38/F07/S02).
   */
  csvFirst: SeededMarket;
  /** An applicant of `open`, who signs in to their dashboard (`signIn` in `screens.ts`). */
  applicant: { email: string };
  /**
   * An organization of the organizer's own, its name long and its admin's and member's addresses
   * long (T148), so Manage organization draws its people.
   */
  organization: { name: string };
  /**
   * A draft in `organization`, made anew on each run, its admin also given Editor on it
   * (E38/F12/S01), so Manage market draws an organization's people and a market role that adds
   * nothing.
   */
  organizationMarket: SeededMarket;
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
  organizationId?: string,
): Promise<SeededMarket> {
  const orgId = organizationId ?? (await ensureTestOrgAuthenticated(api, backend));
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
  await saveApplicationForm(api, backend, marketId, { fields: FIELDS });
  // And its review setup decided (T206): Review waits on it.
  await decideReviewSetup(api, backend, marketId);
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

/**
 * An Editor on `big` and nothing else, who reads in Update info the answers the assignment reads
 * locked, since updating those is an Admin's (E41/F01/S02); fixture data.
 */
export const SCREENS_EDITOR = {
  email: 'e2e-screens-editor@example.com',
  password: 'e2epassword123',
};

/** The other reviewer of `dealt`, a Viewer on that market only; fixture data. */
const DEALT_REVIEWER = 'e2e-screens-reviewer@example.com';
const DEALT_REVIEWER_PASSWORD = 'e2epassword123';
const UNDECIDED = ['open', 'under_review'];

/** A person as the server stores one on an application: their user's id and their address. */
interface Person {
  user_id: string;
  email: string;
}

/** A verified user's id, read from their stored account, as the server reads it to store them. */
function personOf(email: string): Person {
  const id = mongoEval(`print(db.users.findOne({ email: ${JSON.stringify(email)} }).id)`);
  if (!id || id === 'undefined') throw new Error(`No user id stored for ${email}`);
  return { user_id: id, email };
}

/**
 * A market whose review is divided between `organizer` and `DEALT_REVIEWER`: chosen in the draft,
 * so no deal runs, and its applications go in already dealt, every open one to the other reviewer
 * and the decided ones alternately, so both shares have rows and the organizer's has nothing to
 * hand out. Each reviewer, verdict giver and follow-up owner is written with their user's id, as
 * the server writes them.
 */
async function dealtMarket(
  api: APIRequestContext,
  backend: string,
  organizer: Person,
  dates: string[],
): Promise<SeededMarket & { reviewer: string }> {
  const { email } = organizer;
  ensureVerifiedUser(DEALT_REVIEWER, DEALT_REVIEWER_PASSWORD);
  const other = personOf(DEALT_REVIEWER);
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
    applicationsInEveryState(market.marketId, organizer, dates).map((application, i) => ({
      ...application,
      reviewer: UNDECIDED.includes(application.status) || i % 2 ? other : organizer,
    })),
  );
  await walk(api, backend, email, market.marketId, ['applications']);
  return { ...market, reviewer: DEALT_REVIEWER };
}

/**
 * The Google Form export the first import of `csvFirst` reads, by `screens.ts`: three rows of
 * fixture data in the market's own dates, tiers, sections and categories, so the preview is clean,
 * and the mapping that takes each header to its question.
 */
export const FIRST_IMPORT = (() => {
  const columns: [string, string | null][] = [
    ['Timestamp', null],
    ['Email Address', null],
    ['Full Legal Name', 'essential_full_name'],
    ['Which days can you attend?', 'essential_available_dates'],
    ['How many days do you want?', 'essential_max_dates'],
    ['Which tiers will you accept?', 'essential_tier_preference'],
    ['Full or half table?', 'essential_table_choice'],
    ['Rank the sections', 'essential_section_ranking'],
    ['Business name', 'business_name'],
    [FIELDS[1].label, 'product_type'],
    ['Category', 'category'],
  ];
  const quoted = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
  const rows = [0, 1, 2].map((i) =>
    [
      `2026/05/0${i + 1} 9:1${i}:00`,
      `first-import${i}@example.com`,
      `Applicant Number ${i} Featherstonehaugh-Montgomery`,
      MARKET_DATES[0],
      '1',
      TIERS[i % TIERS.length],
      i % 2 ? 'half' : 'full',
      SECTIONS.join(', '),
      ...Object.values(answers(i)).slice(0, 3),
    ]
      .map(quoted)
      .join(','),
  );
  const headers = columns.map(([header]) => header);
  return {
    headers,
    mapping: Object.fromEntries(
      columns.flatMap(([header, key]) => (key ? [[header, key] as const] : [])),
    ) as Record<string, string>,
    csv: [headers.map(quoted).join(','), ...rows].join('\n'),
  };
})();

/**
 * A later Google Form export of `csv`, by `screens.ts`, which the mapping its last import saved
 * reads: every required question served, one new column, and a value on a column and a grid's day
 * headings that the market does not offer, so Map columns opens with values waiting.
 */
export const LATER_IMPORT = (() => {
  const grid = ['Tiers [The first Saturday]', 'Tiers [The second Saturday]'];
  const saved: Record<string, string[]> = {
    applicant_email: ['Email Address'],
    submitted_at: ['Timestamp'],
    essential_full_name: ['Full Legal Name'],
    essential_available_dates: ['Which days can you attend?'],
    essential_max_dates: ['How many days do you want?'],
    essential_tier_preference: grid,
    essential_table_choice: ['Full or half table?'],
    essential_section_ranking: ['Rank the sections'],
    business_name: ['Business name'],
    product_type: [FIELDS[1].label],
    category: ['Category'],
  };
  const headers = [...Object.values(saved).flat(), 'A column new since the last import'];
  const quoted = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
  const row = [
    'later-import@example.com',
    '2026/05/04 9:10:00',
    'Applicant Number 3 Featherstonehaugh-Montgomery',
    'A day the plan never had',
    '1',
    TIERS[0]!,
    TIERS[1]!,
    'full',
    SECTIONS.join(', '),
    ...Object.values(answers(3)).slice(0, 2),
    'A category the form never had',
    'Anything',
  ];
  return {
    saved: { targets: saved, headers: headers.slice(0, -1), resolutions: {} },
    csv: [headers.map(quoted).join(','), row.map(quoted).join(',')].join('\n'),
  };
})();

/**
 * A CSV draft whose first import is still to come, `DEALT_REVIEWER` a Viewer on it, so the
 * import's preview offers the organizer and them as reviewers.
 */
async function firstImportMarket(
  api: APIRequestContext,
  backend: string,
  email: string,
  dates: string[],
): Promise<SeededMarket> {
  ensureVerifiedUser(DEALT_REVIEWER, DEALT_REVIEWER_PASSWORD);
  const market = await createMarket(
    api,
    backend,
    email,
    uniqueMarketName('First Import Market'),
    plan(dates),
    'csv',
  );
  const role = await api.post(`${backend}/markets/${market.marketId}/roles`, {
    data: { user_email: DEALT_REVIEWER, role: 'viewer' },
  });
  if (!role.ok()) throw new Error(`Role failed: ${role.status()} ${await role.text()}`);
  return market;
}

/** The screens' own organization (T148), fixture data. */
const ORGANIZATION_NAME =
  'The Harbour Makers and Artisans Collective of the Old Cannery Waterfront';
const ORGANIZATION_MEMBER = 'e2e-screens-organization-member@example.com';
const ORGANIZATION_MEMBER_PASSWORD = 'e2epassword123';

/**
 * An organization `email` owns, with `DEALT_REVIEWER` its admin and `ORGANIZATION_MEMBER` its
 * member, found by name on a later run. It is not the organization the other markets are made in,
 * which would make its admin an Admin on every one of them and change their people in every other
 * state.
 */
async function organizationWithPeople(
  api: APIRequestContext,
  backend: string,
): Promise<{ id: string; name: string }> {
  ensureVerifiedUser(DEALT_REVIEWER, DEALT_REVIEWER_PASSWORD);
  ensureVerifiedUser(ORGANIZATION_MEMBER, ORGANIZATION_MEMBER_PASSWORD);
  type Listed = {
    id: string;
    name: string;
    userRole?: string;
    memberPeople?: { email: string }[];
  };
  const mine = async () => {
    const res = await api.get(`${backend}/organizations`);
    if (!res.ok()) throw new Error(`Organization list failed: ${res.status()} ${await res.text()}`);
    const { organizations = [] } = (await res.json()) as { organizations?: Listed[] };
    return organizations.find((o) => o.name === ORGANIZATION_NAME && o.userRole === 'owner');
  };
  let org = await mine();
  if (!org) {
    const made = await api.post(`${backend}/organizations`, { data: { name: ORGANIZATION_NAME } });
    if (!made.ok()) throw new Error(`Organization failed: ${made.status()} ${await made.text()}`);
    org = (await mine())!;
  }
  await ensureOrganizationAdmin(api, backend, org.id, DEALT_REVIEWER);
  if (!org.memberPeople?.some((member) => member.email === ORGANIZATION_MEMBER)) {
    const member = await api.post(`${backend}/organizations/${org.id}/members`, {
      data: { user_email: ORGANIZATION_MEMBER },
    });
    if (!member.ok()) throw new Error(`Member failed: ${member.status()} ${await member.text()}`);
  }
  return { id: org.id, name: ORGANIZATION_NAME };
}

/**
 * A draft in `organization`, the walk's case (E38/F12/S01): its admin, `DEALT_REVIEWER`, also
 * given Editor on it. It is made anew on each run under a unique name, so a reused stack's
 * organization holds one more draft per run, and the state opens it by its own name. Its one
 * date is the latest of any seeded market, so a list sorted by date keeps it after every market
 * another state opens first.
 */
async function organizationMarket(
  api: APIRequestContext,
  backend: string,
  email: string,
  organizationId: string,
): Promise<SeededMarket> {
  const market = await createMarket(
    api,
    backend,
    email,
    uniqueMarketName('Waterfront Market'),
    plan(['2099-12-31']),
    'form',
    organizationId,
  );
  const given = await api.post(`${backend}/markets/${market.marketId}/roles`, {
    data: { user_email: DEALT_REVIEWER, role: 'editor' },
  });
  if (!given.ok()) throw new Error(`Role failed: ${given.status()} ${await given.text()}`);
  return market;
}

/**
 * 40 applications, in every review state, with a verdict's giver where a reviewer gave one, and a
 * follow-up's owner, both `reviewer`.
 */
function applicationsInEveryState(marketId: string, reviewer: Person, dates: string[]) {
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
    const by = { kind: 'person', ...reviewer };
    const marked = ['needs_follow_up', 'reviewer_approved', 'reviewer_rejected'].includes(status);
    return {
      ...base,
      status,
      ...(marked ? { verdict_by: by, verdict_at: now } : {}),
      ...(status === 'needs_follow_up' ? { follow_up_owner: reviewer } : {}),
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

/**
 * Applications spread over 19 days ending today, for the Stats tab's chart over time (T201):
 * most in a late rush over the last four days, the rest earlier with two quiet days between, so the
 * sweep draws the chart at size, columns, gaps and all, not as one column of a day.
 */
function appliedOverDays<T extends { submitted_at: string; updated_at: string }>(
  applications: T[],
): T[] {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  return applications.map((application, i) => {
    const daysBack = i < applications.length * 0.6 ? i % 4 : 6 + ((i * 5) % 13);
    const at = new Date(noon.getTime() - daysBack * 86_400_000).toISOString();
    return { ...application, submitted_at: at, updated_at: at };
  });
}

const RULES = [
  { id: 1, target: 'category', ordering: CATEGORIES, direction: null },
  { id: 2, target: 'application.submitted_at', ordering: [], direction: 'ascending' },
];

/** Every group the role report has, with long words, and one vendor the page no longer lists. */
function roleRunOf(applicationIds: string[]): RoleRunOutcome[] {
  const held =
    'Conventioner ran out of its time with Discord before it reached these vendors. Run it again ' +
    'to give them the role.';
  const refused =
    'Conventioner’s role is below this one, or may not manage roles. In Discord, open Server ' +
    'Settings, then Roles, and drag the Conventioner role above it.';
  const outcomes: Pick<RoleRunOutcome, 'outcome' | 'reason'>[] = [
    { outcome: 'given', reason: null },
    { outcome: 'already_had', reason: null },
    { outcome: 'not_found', reason: null },
    { outcome: 'no_username', reason: null },
    { outcome: 'not_yet', reason: held },
    { outcome: 'failed', reason: refused },
  ];
  return [...applicationIds, 'an-application-since-removed'].map((applicationId, i) => ({
    applicationId,
    ...outcomes[i % outcomes.length],
  }));
}

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

/**
 * Half of the first market day's vendors checked in at the door (T201), so Stats draws its
 * check-in rows and its strip counts that day with some in and some not yet.
 */
async function checkInHalfOfTheFirstDay(
  api: APIRequestContext,
  backend: string,
  marketId: string,
): Promise<void> {
  const res = await api.get(`${backend}/markets/${marketId}/attendance`);
  if (!res.ok()) throw new Error(`Roster failed: ${res.status()} ${await res.text()}`);
  const { dates, roster } = (await res.json()) as {
    dates: string[];
    roster: { date: string; vendorEmail: string }[];
  };
  const firstDay = roster.filter((row) => row.date === dates[0]);
  for (const row of firstDay.slice(0, Math.ceil(firstDay.length / 2))) {
    const done = await api.post(`${backend}/markets/${marketId}/attendance`, {
      data: { vendorEmail: row.vendorEmail, date: row.date },
    });
    if (!done.ok()) throw new Error(`Check-in failed: ${done.status()} ${await done.text()}`);
  }
}

export async function seedTheScreens(
  api: APIRequestContext,
  backend: string,
  email: string,
  password: string,
): Promise<TheScreensSeed> {
  const organizer = { user_id: await loginViaApi(api, backend, email, password), email };
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
    insertApplications(applicationsInEveryState(market.marketId, organizer, two));
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
  // Its cards lead with two answers and fold the rest behind "N more answers" (E19/F03/S01).
  const highlights = await api.put(`${backend}/markets/${review.marketId}/review-highlights`, {
    data: { keys: ['business_name', 'category'] },
  });
  if (!highlights.ok()) {
    throw new Error(`Marking highlights failed: ${highlights.status()} ${await highlights.text()}`);
  }
  const dealt = await dealtMarket(api, backend, organizer, two);

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
  insertApplications(appliedOverDays(manyVendors(big.marketId, 'vendor', 36, MARKET_DATES)));
  await walk(api, backend, email, big.marketId, UP_TO_ASSIGNMENT);
  await assignAndPublish(api, backend, email, big.marketId);
  ensureVerifiedUser(SCREENS_EDITOR.email, SCREENS_EDITOR.password);
  const editor = await api.post(`${backend}/markets/${big.marketId}/roles`, {
    data: { user_email: SCREENS_EDITOR.email, role: 'editor' },
  });
  if (!editor.ok()) throw new Error(`Role failed: ${editor.status()} ${await editor.text()}`);

  const rules = await createMarket(api, backend, email, uniqueMarketName('Spring Rules'), {
    ...plan(two),
    priority: RULES,
    pricing: {
      currency: 'CAD',
      halfTablePercent: 50,
      everyoneElse: [
        { tier: 'Gold', cents: 12500 },
        { tier: 'Silver', cents: 9000 },
        { tier: 'Community', cents: 4000 },
      ],
    },
  });
  insertApplications(appliedOverDays(manyVendors(rules.marketId, 'rules', 8, two)));
  await walk(api, backend, email, rules.marketId, UP_TO_ASSIGNMENT);
  await assignAndPublish(api, backend, email, rules.marketId);
  await checkInHalfOfTheFirstDay(api, backend, rules.marketId);

  const planned = plan(two);
  const longSection = await createMarket(api, backend, email, uniqueMarketName('Long Section'), {
    ...planned,
    sections: planned.sections.map((section, at) =>
      at === 0 ? { ...section, count: 24 } : section,
    ),
  });
  insertApplications(manyVendors(longSection.marketId, 'longsection', 30, two));
  await walk(api, backend, email, longSection.marketId, UP_TO_ASSIGNMENT);
  const ran = await api.post(`${backend}/markets/${longSection.marketId}/assignment`);
  if (!ran.ok()) throw new Error(`Assign failed: ${ran.status()} ${await ran.text()}`);

  const roleReport = await createMarket(
    api,
    backend,
    email,
    uniqueMarketName('Role Report'),
    plan(two),
  );
  const reported = manyVendors(roleReport.marketId, 'reported', 30, two);
  insertApplications(reported);
  await walk(api, backend, email, roleReport.marketId, UP_TO_ASSIGNMENT);
  await assignAndPublish(api, backend, email, roleReport.marketId);
  const roleName = 'Vendor at the Fall Makers Fair in the Old Cannery Warehouse District, 2026';
  connectToFakeDiscord(roleReport.marketId, {
    guildId: fakeDiscordId(),
    guildName: 'Riverside Makers',
    roleId: fakeDiscordId(),
    roleName,
  });
  recordRoleRun(roleReport.marketId, roleName, roleRunOf(reported.map(({ id }) => id)));

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
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(csv.marketId)} }, { $set: { importMapping: ${JSON.stringify(
      LATER_IMPORT.saved,
    )} } })`,
  );
  const { marketId, marketName } = await seedDraftMarket(api, backend, email, password, {
    intakeMode: 'csv',
  });
  const csvDraft = { marketId, marketName, marketSlug: marketNameToSlug(marketName) };
  const csvFirst = await firstImportMarket(api, backend, email, two);

  // The first applicant of `open`; each sign-in plants its own code, since a code is used once.
  const applicant = { email: 'applicant0@example.com' };
  const { id: organizationId, ...organization } = await organizationWithPeople(api, backend);
  const ofTheOrganization = await organizationMarket(api, backend, email, organizationId);

  return {
    draft,
    open,
    closed,
    review,
    dealt,
    assignment,
    big,
    rules,
    longSection,
    roleReport,
    archived,
    csv,
    csvDraft,
    csvFirst,
    applicant,
    organization,
    organizationMarket: ofTheOrganization,
  };
}
