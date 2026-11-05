import { expect, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL, TEST_USER } from '../fixtures';
import { planSetupObject, seedApplicantMarket } from './seedApplicantMarket';
import { transitionMarket } from './seedPhaseMarket';

/** The reserved domain of every applicant here, so no address is anyone's. */
export const MARKET_AT_SCALE_DOMAIN = 'market-at-scale.test';

const APPLICATIONS = 120;
const REJECTED = 10;
const DATE = '2099-08-01';
const TIERS = ['Gold', 'Silver'];
const SECTIONS = [
  { name: 'Example Gold Hall', tier: 0, count: 31 },
  { name: 'Example Silver Hall', tier: 1, count: 28 },
];

/** Made-up family names, ten of them, so words find a family's twelve across every page. */
const FAMILIES = [
  'Ashgrove',
  'Birchwell',
  'Copperfen',
  'Dunmarrow',
  'Eldermoor',
  'Fernhollow',
  'Greywick',
  'Hazelmere',
  'Ironbrook',
  'Juniperly',
];
/** How often an applicant also gave the name they go by, which their row then calls them. */
const PREFERRED_EVERY = 10;
/** What a table costs with `pays`, in the tiers' order. */
const PRICING = {
  currency: 'CAD',
  halfTablePercent: 50,
  everyoneElse: [
    { tier: TIERS[0], cents: 3500 },
    { tier: TIERS[1], cents: 3000 },
  ],
};

export interface ApplicantAtScale {
  email: string;
  /** The name on their identification. */
  fullName: string;
  /** The name they go by, on every tenth. */
  preferredName: string | null;
  /** What their row calls them. */
  shownName: string;
  /** What they paid with `pays`: a dollar for each place in the order they came, so none is alike. */
  paysCents: number;
}

export interface MarketAtScaleSeed {
  marketId: string;
  marketName: string;
  /** In arrival order, the order the All view lists them. */
  applicants: ApplicantAtScale[];
  /** Each section's name and table count, on the one date. */
  sections: { name: string; count: number }[];
  counts: {
    applications: number;
    /** Every one but the rejected: still open with `assign: false`, else approved. */
    undecidedOrApproved: number;
    rejected: number;
  };
}

/** The `n`th applicant, from 1. */
function applicantAtScale(n: number): ApplicantAtScale {
  const number = String(n).padStart(3, '0');
  const family = FAMILIES[(n - 1) % FAMILIES.length]!;
  const fullName = `Applicant${number} ${family}`;
  const preferredName = n % PREFERRED_EVERY === 0 ? `Goesby${number}` : null;
  return {
    email: `vendor-${number}@${MARKET_AT_SCALE_DOMAIN}`,
    fullName,
    preferredName,
    shownName: preferredName ?? fullName,
    paysCents: n * 100,
  };
}

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Goes by',
  'Business name',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
];
const MAPPING = {
  submitted_at: 0,
  applicant_email: 1,
  essential_full_name: 2,
  essential_preferred_name: 3,
  business_name: 4,
  essential_available_dates: 5,
  essential_tier_preference: 6,
  essential_table_choice: 7,
  essential_section_ranking: 8,
};

/** One row of the export, each a minute after the last, so the arrival order is theirs. */
function exportRow(applicant: ApplicantAtScale, at: number): string {
  const minutes = String(at % 60).padStart(2, '0');
  const hours = String(9 + Math.floor(at / 60)).padStart(2, '0');
  return [
    `2026/05/02 ${hours}:${minutes}:00`,
    applicant.email,
    applicant.fullName,
    applicant.preferredName ?? '',
    `Stall of ${applicant.fullName}`,
    DATE,
    `"${TIERS.join(', ')}"`,
    'full',
    `"${SECTIONS.map(({ name }) => name).join(', ')}"`,
  ].join(',');
}

interface ListedApplication {
  id: string;
  applicantEmail: string;
  status: string;
  verdictAt?: string | null;
  updatedAt?: string;
}

async function give(
  request: APIRequestContext,
  marketId: string,
  applications: ListedApplication[],
  status: string,
): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/applications/verdicts`, {
    data: {
      status,
      applications: applications.map((application) => ({
        id: application.id,
        seen: {
          status: application.status,
          verdictAt: application.verdictAt ?? null,
          updatedAt: application.updatedAt,
        },
      })),
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { written, skipped } = (await res.json()) as { written: string[]; skipped: unknown[] };
  expect(skipped, `a verdict of ${status} was skipped`).toEqual([]);
  expect(written).toHaveLength(applications.length);
}

/**
 * One market of a real size (T223), for the specs of long lists: 120 applications of a Google Form
 * market, read in through the real import, the last 10 rejected as a reviewer rejects a selection,
 * then, unless `assign` is false, the other 110 approved and an assignment run by the real solver
 * over a section of 31 tables and one of 28, on one date. With `assign: false` the review is still
 * open and those 110 are undecided, which is the market a spec of giving verdicts wants. With `pays`
 * the plan sets prices and every applicant has recorded a payment, so the Payments page lists all
 * 120, whether or not they hold a table.
 *
 * Under the signed-in seed owner, whose session `request` carries afterwards; fixture values only. A
 * spec asserts against what this answers, never a number typed twice.
 */
export async function seedMarketAtScale(
  request: APIRequestContext,
  { assign = true, pays = false }: { assign?: boolean; pays?: boolean } = {},
): Promise<MarketAtScaleSeed> {
  const seed = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    {
      intakeMode: 'csv',
      setupObject: {
        ...planSetupObject([DATE]),
        tiers: TIERS.map((name, id) => ({ id, name })),
        sections: SECTIONS.map(({ name, tier, count }) => ({
          name,
          location: { name: 'Indoors' },
          tier: { id: tier, name: TIERS[tier] },
          count,
        })),
        ...(pays ? { pricing: PRICING } : {}),
      },
      fields: [
        {
          key: 'business_name',
          label: 'Business name',
          type: 'text',
          required: true,
          options: [],
          order: 0,
        },
      ],
    },
  );
  const { marketId } = seed;

  const applicants = Array.from({ length: APPLICATIONS }, (_, at) => applicantAtScale(at + 1));
  const imported = await request.post(`${BACKEND_URL}/markets/${marketId}/applications/import`, {
    data: {
      csvContent: [HEADERS.join(','), ...applicants.map(exportRow)].join('\n'),
      mapping: MAPPING,
    },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const { created, failures } = (await imported.json()) as {
    created: number;
    failures: unknown[];
  };
  expect(failures, 'the import refused a row').toEqual([]);
  expect(created).toBe(APPLICATIONS);

  const listed = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
  expect(listed.ok(), await listed.text()).toBeTruthy();
  const { applications } = (await listed.json()) as { applications: ListedApplication[] };
  const byAddress = new Map(applications.map((one) => [one.applicantEmail, one]));
  const inOrder = applicants.map(({ email }) => byAddress.get(email)!);
  const kept = inOrder.slice(0, APPLICATIONS - REJECTED);
  await give(request, marketId, inOrder.slice(APPLICATIONS - REJECTED), 'reviewer_rejected');

  if (assign) {
    await give(request, marketId, kept, 'reviewer_approved');
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'assignment');
    const ran = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
    expect(ran.ok(), await ran.text()).toBeTruthy();
  }

  if (pays) {
    for (const { email, paysCents } of applicants) {
      const paid = await request.post(`${BACKEND_URL}/markets/${marketId}/payments/${email}`, {
        data: { cents: paysCents, method: 'e-transfer', paidOn: '2026-05-03', note: '' },
      });
      expect(paid.ok(), await paid.text()).toBeTruthy();
    }
  }

  return {
    marketId,
    marketName: seed.marketName,
    applicants,
    sections: SECTIONS.map(({ name, count }) => ({ name, count })),
    counts: {
      applications: APPLICATIONS,
      undecidedOrApproved: kept.length,
      rejected: REJECTED,
    },
  };
}
