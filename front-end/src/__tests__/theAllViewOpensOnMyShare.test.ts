/**
 * The All view opens on "Assigned to me", with the "Assigned to" filter (E38/F07/S04).
 *
 * With reviewers chosen, a labelled select beside the status filter narrows the rows to a
 * reviewer's share: "Me" for a chosen reviewer, "Anyone", or another reviewer by address, kept in
 * the address as `reviewer`. With none in the address a chosen reviewer lands on their own share and
 * anyone else on every application; with no reviewers chosen the select is not there at all.
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

const select = (wrapper: View) => wrapper.find('[data-testid="applications-all-assigned-to"]');
const rows = (wrapper: View) =>
  wrapper
    .findAll('[data-testid="applications-all-row"]')
    .map((row) => row.find('.all-row-button').attributes('data-application-id'));
const count = (wrapper: View) => wrapper.get('[data-testid="applications-all-count"]').text();

describe('the "Assigned to" filter', () => {
  it('is a select labelled "Assigned to", offering Me, Anyone and the other reviewer', async () => {
    const wrapper = await allView({ market: market() });

    const field = select(wrapper);
    expect(field.element.tagName).toBe('SELECT');
    expect(wrapper.get('label.all-assigned').text()).toContain('Assigned to');
    expect(field.findAll('option').map((o) => [o.attributes('value'), o.text()])).toEqual([
      ['me', 'Me'],
      ['anyone', 'Anyone'],
      [SAM, SAM],
    ]);
  });

  it('offers no Me to someone not chosen', async () => {
    signedIn.email = 'owner@example.com';
    const wrapper = await allView({ market: market() });

    expect(
      select(wrapper)
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['Anyone', ANA, SAM]);
  });

  it('is not there with no reviewers chosen, and every application shows', async () => {
    const wrapper = await allView({ market: market({ chosen: false }) });

    expect(select(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(5);
    expect(count(wrapper)).toBe('5 of 5');
  });

  it('is not there with no reviewers chosen whatever the address says', async () => {
    route.query = { reviewer: SAM };
    const wrapper = await allView({ market: market({ chosen: false }) });

    expect(select(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(5);
  });
});

describe('what the All view opens on', () => {
  it('opens a chosen reviewer on their own share, decided ones included, and counts it', async () => {
    const wrapper = await allView({ market: market() });

    expect((select(wrapper).element as HTMLSelectElement).value).toBe('me');
    expect(rows(wrapper)).toEqual(['ana-1', 'ana-2']);
    expect(count(wrapper)).toBe('2 of 5');
  });

  it('opens anyone else, an Admin overseeing the review, on every application', async () => {
    signedIn.email = 'owner@example.com';
    const wrapper = await allView({ market: market() });

    expect((select(wrapper).element as HTMLSelectElement).value).toBe('anyone');
    expect(rows(wrapper)).toHaveLength(5);
    expect(count(wrapper)).toBe('5 of 5');
  });

  it('shows another reviewer’s share, or everyone’s, as the address asks', async () => {
    route.query = { reviewer: SAM };
    const sams = await allView({ market: market() });
    expect((select(sams).element as HTMLSelectElement).value).toBe(SAM);
    expect(rows(sams)).toEqual(['sam-1', 'sam-2']);

    route.query = { reviewer: 'anyone' };
    const everyone = await allView({ market: market() });
    expect(rows(everyone)).toHaveLength(5);
  });

  it('reads an address naming nobody chosen as the default', async () => {
    route.query = { reviewer: 'ben@example.com' };
    const wrapper = await allView({ market: market() });

    expect((select(wrapper).element as HTMLSelectElement).value).toBe('me');
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

    await select(wrapper).setValue('anyone');
    expect(replace).toHaveBeenLastCalledWith({
      query: { status: 'undecided', reviewer: 'anyone' },
    });
    await select(wrapper).setValue(SAM);
    expect(replace).toHaveBeenLastCalledWith({ query: { status: 'undecided', reviewer: SAM } });
    await select(wrapper).setValue('me');
    expect(replace).toHaveBeenLastCalledWith({ query: { status: 'undecided', reviewer: 'me' } });
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
