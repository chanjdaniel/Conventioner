/**
 * The All view opens on "Assigned to me", with the "Assigned to" filter (E38/F07/S04).
 *
 * With reviewers chosen, a labelled combobox beside the status filter narrows the rows to a
 * reviewer's share: "Me" for a chosen reviewer, "Anyone", or another reviewer found by typing, kept
 * in the address as `reviewer`. With none in the address a chosen reviewer lands on their own share
 * and anyone else on every application; with no reviewers chosen the filter is not there at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { applicationsAllSeed } from '@/utils/vendorExport';
import { answersRefusing } from './support/servedAnswers';

const ANA = 'ana@example.com';
const SAM = 'sam@example.com';

const fetchMarketApplications = vi.fn();
/** Reactive, as the router's own route is, so a change of address re-filters the rows. */
const route = reactive({ query: {} as Record<string, string> });
const replace = vi.hoisted(() => vi.fn());
const signedIn = vi.hoisted(() => ({ email: 'ana@example.com' }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useRoute: () => route,
}));
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => signedIn.email }));

function application(id: string, status: ApplicationStatus, reviewer: string | null): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@vendor.test`,
    status,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    reviewer: reviewer ? { userId: reviewer, email: reviewer } : null,
  } as unknown as Application;
}

/** A market in the review, with Ana and Sam chosen or nobody. */
function market({ chosen = true } = {}): Market {
  return {
    id: 'm1',
    phase: 'applications',
    roles: {},
    applicationForm: { fields: [] },
    reviewTeam: {
      reviewers: chosen
        ? [
            { email: ANA, able: true },
            { email: SAM, able: true },
          ]
        : [],
    },
    actionRefusals: {
      ...answersRefusing(),
      [MarketAction.GiveVerdicts]: null,
      [MarketAction.ChangeVerdicts]: null,
      [MarketAction.ExportCsv]: null,
    },
  } as unknown as Market;
}

const ROWS = [
  application('ana-1', ApplicationStatus.Open, ANA),
  application('sam-1', ApplicationStatus.Open, SAM),
  application('ana-2', ApplicationStatus.ReviewerApproved, ANA),
  application('sam-2', ApplicationStatus.Open, SAM),
  application('never-dealt', ApplicationStatus.ReviewerRejected, null),
];

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = {};
  replace.mockReset();
  signedIn.email = ANA;
  fetchMarketApplications.mockReset();
  fetchMarketApplications.mockResolvedValue(ROWS);
});

async function allView(props: { market: Market }) {
  const wrapper = mount(ApplicationsAll, {
    props,
    global: {
      stubs: {
        VendorDrawer: {
          template: '<div><slot name="actions" /></div>',
          methods: { entryFor: () => null, loadNotes: () => undefined },
        },
        ExportVendorsDialog: {
          name: 'ExportVendorsDialog',
          props: ['open', 'seed', 'marketId'],
          template: '<div />',
        },
        FollowUpDialog: true,
        ListFreshness: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type View = Awaited<ReturnType<typeof allView>>;

const picker = (wrapper: View) => wrapper.find('[data-testid="applications-all-assigned-to"]');
const field = (wrapper: View) => wrapper.get('[data-testid="applications-all-assigned-to-input"]');
const value = (wrapper: View) => (field(wrapper).element as HTMLInputElement).value;
const options = (wrapper: View) =>
  wrapper.findAll('[data-testid="applications-all-assigned-to-option"]');
const offered = (wrapper: View) => options(wrapper).map((option) => option.text());
/** The address follows a choice, as the real router's does. */
function followTheAddress() {
  replace.mockImplementation(({ query }: { query: Record<string, string> }) => {
    route.query = query;
  });
}
const rows = (wrapper: View) =>
  wrapper
    .findAll('[data-testid="applications-all-row"]')
    .map((row) => row.find('.all-row-button').attributes('data-application-id'));
const count = (wrapper: View) => wrapper.get('[data-testid="applications-all-count"]').text();

describe('the "Assigned to" filter', () => {
  it('is a combobox labelled "Assigned to": Me and Anyone, then the other reviewer in a group', async () => {
    const wrapper = await allView({ market: market() });

    const input = field(wrapper);
    expect(input.attributes('role')).toBe('combobox');
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Assigned to');
    await input.trigger('click');

    const groups = wrapper.findAll(
      '[data-testid="applications-all-assigned-to-list"] [role="group"]',
    );
    expect(
      groups.map((group) => [
        group.find('.search-picker-group-label').exists()
          ? group.get('.search-picker-group-label').text()
          : null,
        group.findAll('[role="option"]').map((o) => [o.attributes('data-value'), o.text()]),
      ]),
    ).toEqual([
      [
        null,
        [
          ['me', 'Me'],
          ['anyone', 'Anyone'],
        ],
      ],
      ['Reviewers', [[SAM, SAM]]],
    ]);
  });

  it('offers no Me to someone not chosen', async () => {
    signedIn.email = 'owner@example.com';
    const wrapper = await allView({ market: market() });

    await field(wrapper).trigger('click');
    expect(offered(wrapper)).toEqual(['Anyone', ANA, SAM]);
  });

  it('is not there with no reviewers chosen, and every application shows', async () => {
    const wrapper = await allView({ market: market({ chosen: false }) });

    expect(picker(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(5);
    expect(count(wrapper)).toBe('5 of 5');
  });

  it('is not there with no reviewers chosen whatever the address says', async () => {
    route.query = { reviewer: SAM };
    const wrapper = await allView({ market: market({ chosen: false }) });

    expect(picker(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(5);
  });
});

describe('what the All view opens on', () => {
  it('opens a chosen reviewer on their own share, decided ones included, and counts it', async () => {
    const wrapper = await allView({ market: market() });

    expect(value(wrapper)).toBe('Me');
    expect(rows(wrapper)).toEqual(['ana-1', 'ana-2']);
    expect(count(wrapper)).toBe('2 of 5');
  });

  it('opens anyone else, an Admin overseeing the review, on every application', async () => {
    signedIn.email = 'owner@example.com';
    const wrapper = await allView({ market: market() });

    expect(value(wrapper)).toBe('Anyone');
    expect(rows(wrapper)).toHaveLength(5);
    expect(count(wrapper)).toBe('5 of 5');
  });

  it('shows another reviewer’s share, or everyone’s, as the address asks', async () => {
    route.query = { reviewer: SAM };
    const sams = await allView({ market: market() });
    expect(value(sams)).toBe(SAM);
    expect(rows(sams)).toEqual(['sam-1', 'sam-2']);

    route.query = { reviewer: 'anyone' };
    const everyone = await allView({ market: market() });
    expect(rows(everyone)).toHaveLength(5);
  });

  it('reads an address naming nobody chosen as the default', async () => {
    route.query = { reviewer: 'ben@example.com' };
    const wrapper = await allView({ market: market() });

    expect(value(wrapper)).toBe('Me');
    expect(rows(wrapper)).toEqual(['ana-1', 'ana-2']);
  });

  it('narrows with the status filter too', async () => {
    route.query = { reviewer: SAM, status: 'undecided' };
    const wrapper = await allView({ market: market() });

    expect(rows(wrapper)).toEqual(['sam-1', 'sam-2']);
    route.query = { status: 'undecided' };
    const mine = await allView({ market: market() });
    expect(rows(mine)).toEqual(['ana-1']);
    expect(count(mine)).toBe('1 of 5');
  });
});

describe('choosing in the "Assigned to" filter', () => {
  it('writes the choice to the address, beside the status filter, with router.replace', async () => {
    route.query = { status: 'undecided' };
    const wrapper = await allView({ market: market() });

    followTheAddress();
    const take = async (words: string, reviewer: string) => {
      await field(wrapper).setValue(words);
      await field(wrapper).trigger('keydown', { key: 'Enter' });
      expect(replace).toHaveBeenLastCalledWith({ query: { status: 'undecided', reviewer } });
      await flushPromises();
    };

    await take('anyone', 'anyone');
    expect(value(wrapper)).toBe('Anyone');
    await take('sam@', SAM);
    expect(value(wrapper)).toBe(SAM);
    await take('me', 'me');
    expect(value(wrapper)).toBe('Me');
  });

  it('finds one of 12 reviewers by typing part of an address, and writes the query', async () => {
    const twelve = Array.from(
      { length: 12 },
      (_, n) => `reviewer-${String(n + 1).padStart(2, '0')}@example.com`,
    );
    signedIn.email = 'owner@example.com';
    route.query = { status: 'undecided' };
    followTheAddress();
    const wrapper = await allView({
      market: {
        ...market(),
        reviewTeam: { reviewers: twelve.map((email) => ({ email, able: true })) },
      } as Market,
    });

    await field(wrapper).trigger('click');
    expect(offered(wrapper)).toEqual(['Anyone', ...twelve]);

    await field(wrapper).setValue('WER-07');
    expect(offered(wrapper)).toEqual(['reviewer-07@example.com']);
    // The words alone choose no one, so the rows stay what they were.
    expect(replace).not.toHaveBeenCalled();

    await field(wrapper).trigger('keydown', { key: 'Enter' });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(route.query).toEqual({ status: 'undecided', reviewer: 'reviewer-07@example.com' });
    await flushPromises();
    expect(value(wrapper)).toBe('reviewer-07@example.com');
  });

  it('moves through the list by the arrow keys, and Enter takes the row', async () => {
    followTheAddress();
    const wrapper = await allView({ market: market() });

    await field(wrapper).trigger('keydown', { key: 'ArrowDown' });
    expect(offered(wrapper)).toEqual(['Me', 'Anyone', SAM]);
    await field(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await field(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await field(wrapper).trigger('keydown', { key: 'Enter' });

    expect(route.query).toEqual({ reviewer: SAM });
    expect(options(wrapper)).toHaveLength(0);
  });

  it('finds Me by the reader’s own address, which it stands for', async () => {
    route.query = { reviewer: SAM };
    const wrapper = await allView({ market: market() });

    await field(wrapper).setValue(ANA);
    expect(offered(wrapper)).toEqual(['Me']);
  });

  it('leaves the address alone when what it holds is taken again', async () => {
    const wrapper = await allView({ market: market() });

    await field(wrapper).trigger('click');
    await options(wrapper)[0]!.trigger('click');
    expect(value(wrapper)).toBe('Me');
    expect(replace).not.toHaveBeenCalled();
  });

  it('holds the share through words found nowhere, and names it again on Escape', async () => {
    route.query = { reviewer: SAM };
    const wrapper = await allView({ market: market() });

    await field(wrapper).setValue('zzz');
    expect(offered(wrapper)).toEqual([]);
    expect(rows(wrapper)).toEqual(['sam-1', 'sam-2']);

    await field(wrapper).trigger('keydown', { key: 'Escape' });
    expect(value(wrapper)).toBe(SAM);
    expect(replace).not.toHaveBeenCalled();
    expect(rows(wrapper)).toEqual(['sam-1', 'sam-2']);
  });

  it('ticks only what it shows with Select all, and unticks what it hides', async () => {
    route.query = { reviewer: 'anyone' };
    const wrapper = await allView({ market: market() });
    await wrapper.get('[data-testid="applications-all-select-all"]').trigger('click');
    expect(wrapper.get('[data-testid="applications-all-selection"]').text()).toContain(
      '5 applications selected',
    );

    route.query = { reviewer: SAM };
    await flushPromises();
    expect(rows(wrapper)).toEqual(['sam-1', 'sam-2']);
    expect(wrapper.get('[data-testid="applications-all-selection"]').text()).toContain(
      '2 applications selected',
    );

    await wrapper.get('[data-testid="applications-all-selection-clear"]').trigger('click');
    await wrapper.get('[data-testid="applications-all-select-all"]').trigger('click');
    expect(wrapper.get('[data-testid="applications-all-selection"]').text()).toContain(
      '2 applications selected',
    );
  });

  it('leaves the export opening on the status filter and Mine alone', async () => {
    route.query = { reviewer: SAM, status: 'undecided', mine: '1' };
    const wrapper = await allView({ market: market() });

    await wrapper.get('[data-testid="applications-all-export-button"]').trigger('click');
    const dialog = wrapper.findComponent({ name: 'ExportVendorsDialog' });
    expect(dialog.props('seed')).toEqual(applicationsAllSeed({ filter: 'undecided', mine: true }));
  });
});
