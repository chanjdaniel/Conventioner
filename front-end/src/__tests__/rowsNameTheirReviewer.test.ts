/**
 * Rows and cards name their reviewer, and deciding another's carries the warning (E38/F07/S03).
 *
 * With reviewers chosen, the All view's rows and One by one's card say whose share each application
 * is, "you" for the reader's own. The card and the drawer of an undecided application dealt to
 * someone else say so above their verdict buttons, to anyone who may give verdicts; a selection's
 * confirmation counts the ticked rows dealt to others. With no reviewers chosen, nothing shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const ME = 'ana@example.com';
const SAM = 'sam@example.com';
const WARNING = `This application is dealt to ${SAM}. If you decide it, its history will say you decided it for them.`;

const fetchMarketApplications = vi.fn();
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => route,
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => ME }));

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

/** A market in the review, with Ana and Sam chosen or nobody, read by someone who may decide or not. */
function market({ chosen = true, decides = true } = {}): Market {
  return {
    id: 'm1',
    phase: 'applications',
    roles: {},
    applicationForm: { fields: [] },
    reviewTeam: {
      reviewers: chosen
        ? [
            { email: ME, able: true },
            { email: SAM, able: true },
          ]
        : [],
    },
    actionRefusals: {
      ...answersRefusing(),
      [MarketAction.GiveVerdicts]: decides ? null : 'Only an Editor may give verdicts.',
      [MarketAction.ChangeVerdicts]: null,
    },
  } as unknown as Market;
}

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = {};
  for (const call of Object.values(api)) {
    call.mockReset();
    call.mockResolvedValue({ data: {} });
  }
  fetchMarketApplications.mockReset();
});

// --- The All view ----------------------------------------------------------------------------

const ROWS = [
  application('mine', ApplicationStatus.Open, ME),
  application('sams', ApplicationStatus.Open, SAM),
  application('sams-follow-up', ApplicationStatus.NeedsFollowUp, SAM),
  application('never-dealt', ApplicationStatus.Open, null),
];

async function allView(props: { market: Market }) {
  const wrapper = mount(ApplicationsAll, {
    props,
    global: {
      stubs: {
        VendorDrawer: {
          template: '<div><slot name="actions" /></div>',
          methods: { entryFor: () => null, loadNotes: () => undefined },
        },
        ExportVendorsDialog: true,
        FollowUpDialog: true,
        ListFreshness: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function reviewerOf(wrapper: Awaited<ReturnType<typeof allView>>, id: string) {
  const row = wrapper
    .findAll('[data-testid="applications-all-row"]')
    .find((r) => r.text().includes(`${id}@vendor.test`));
  return row?.find('[data-testid="applications-all-reviewer"]');
}

describe('the All view’s rows', () => {
  beforeEach(() => fetchMarketApplications.mockResolvedValue(ROWS));

  it('name the reviewer, "you" for the reader’s own, and nothing on one never dealt', async () => {
    const wrapper = await allView({ market: market() });

    expect(reviewerOf(wrapper, 'mine')?.text()).toBe('Reviewer: you');
    expect(reviewerOf(wrapper, 'sams')?.text()).toBe(`Reviewer: ${SAM}`);
    expect(reviewerOf(wrapper, 'never-dealt')?.exists()).toBe(false);
  });

  it('name nobody with no reviewers chosen', async () => {
    const wrapper = await allView({ market: market({ chosen: false }) });

    expect(wrapper.findAll('[data-testid="applications-all-reviewer"]')).toHaveLength(0);
  });
});

describe('the All view’s drawer', () => {
  beforeEach(() => fetchMarketApplications.mockResolvedValue(ROWS));

  async function drawerOf(id: string, options = {}) {
    route.query = { vendor: `${id}@vendor.test` };
    return allView({ market: market(options) });
  }

  it('warns above the verdict buttons on an application dealt to someone else', async () => {
    const wrapper = await drawerOf('sams');

    const verdict = wrapper.get('[data-testid="applications-all-drawer-verdict"]');
    expect(verdict.get('[data-testid="applications-all-drawer-reviewer"]').text()).toBe(
      `Reviewer: ${SAM}`,
    );
    const warning = verdict.get('[data-testid="applications-all-drawer-dealt-warning"]');
    expect(warning.text()).toBe(WARNING);
    // Above the buttons, which are still there: a warning, not a lock.
    const html = verdict.html();
    expect(html.indexOf('dealt-warning')).toBeLessThan(html.indexOf('applications-all-approve'));
  });

  it('warns on a follow-up dealt to someone else too', async () => {
    const wrapper = await drawerOf('sams-follow-up');

    expect(wrapper.find('[data-testid="applications-all-drawer-dealt-warning"]').exists()).toBe(
      true,
    );
  });

  it('does not warn on the reader’s own', async () => {
    const wrapper = await drawerOf('mine');

    expect(wrapper.get('[data-testid="applications-all-drawer-reviewer"]').text()).toBe(
      'Reviewer: you',
    );
    expect(wrapper.find('[data-testid="applications-all-drawer-dealt-warning"]').exists()).toBe(
      false,
    );
  });

  it('shows a reader who decides nothing the reviewer’s name only', async () => {
    const wrapper = await drawerOf('sams', { decides: false });

    expect(wrapper.get('[data-testid="applications-all-drawer-reviewer"]').text()).toBe(
      `Reviewer: ${SAM}`,
    );
    expect(wrapper.find('[data-testid="applications-all-drawer-dealt-warning"]').exists()).toBe(
      false,
    );
  });

  it('shows nothing with no reviewers chosen', async () => {
    const wrapper = await drawerOf('sams', { chosen: false });

    expect(wrapper.find('[data-testid="applications-all-drawer-reviewer"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="applications-all-drawer-dealt-warning"]').exists()).toBe(
      false,
    );
  });
});

describe('a selection’s confirmation', () => {
  beforeEach(() => fetchMarketApplications.mockResolvedValue(ROWS));

  async function confirming(ids: string[], options = {}) {
    const wrapper = await allView({ market: market(options) });
    for (const row of wrapper.findAll('[data-testid="applications-all-row"]')) {
      if (ids.some((id) => row.text().includes(`${id}@vendor.test`))) {
        await row.get('[data-testid="applications-all-tick"]').setValue(true);
      }
    }
    await wrapper.get('[data-testid="applications-all-selection-approve"]').trigger('click');
    await flushPromises();
    return wrapper.find('[data-testid="applications-all-confirm-window"]').element ?? null;
  }

  it('says one of them is dealt to another reviewer', async () => {
    const dialog = await confirming(['mine', 'never-dealt', 'sams']);

    expect(
      dialog?.querySelector('[data-testid="applications-all-confirm-dealt"]')?.textContent,
    ).toBe('1 of them is dealt to another reviewer; its history will say you decided it.');
  });

  it('counts each ticked row dealt to others, a follow-up among them', async () => {
    const dialog = await confirming(['sams', 'sams-follow-up']);

    expect(
      dialog?.querySelector('[data-testid="applications-all-confirm-dealt"]')?.textContent,
    ).toBe('2 of them are dealt to other reviewers; their history will say you decided them.');
  });

  it('reads as today with none dealt to others', async () => {
    const dialog = await confirming(['mine', 'never-dealt']);

    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('[data-testid="applications-all-confirm-dealt"]')).toBeNull();
  });
});

// --- One by one ------------------------------------------------------------------------------

async function cardOf(app: Application, options = {}) {
  fetchMarketApplications.mockResolvedValue([app]);
  // The hand-out answers the one card, as the server would.
  api.post.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('/review/next') ? { application: app } : {} }),
  );
  const wrapper = mount(ApplicationMonitor, {
    props: reactive({ market: market(options), visible: true }),
  });
  await flushPromises();
  return wrapper;
}

describe('One by one’s card', () => {
  it('names the reviewer and warns above the verdict buttons on someone else’s', async () => {
    const wrapper = await cardOf(application('sams', ApplicationStatus.Open, SAM));

    const card = wrapper.get('[data-testid="app-monitor-card"]');
    expect(card.get('[data-testid="app-monitor-reviewer"]').text()).toBe(`Reviewer: ${SAM}`);
    expect(card.get('[data-testid="app-monitor-dealt-warning"]').text()).toBe(WARNING);
    const html = card.html();
    expect(html.indexOf('app-monitor-dealt-warning')).toBeLessThan(
      html.indexOf('app-monitor-approve-button'),
    );
  });

  it('says "you" on the reader’s own, without a warning', async () => {
    const wrapper = await cardOf(application('mine', ApplicationStatus.Open, ME));

    expect(wrapper.get('[data-testid="app-monitor-reviewer"]').text()).toBe('Reviewer: you');
    expect(wrapper.find('[data-testid="app-monitor-dealt-warning"]').exists()).toBe(false);
  });

  it('shows a reader who decides nothing the reviewer’s name only', async () => {
    const wrapper = await cardOf(application('sams', ApplicationStatus.Open, SAM), {
      decides: false,
    });

    expect(wrapper.get('[data-testid="app-monitor-reviewer"]').text()).toBe(`Reviewer: ${SAM}`);
    expect(wrapper.find('[data-testid="app-monitor-dealt-warning"]').exists()).toBe(false);
  });

  it('shows nothing with no reviewers chosen', async () => {
    const wrapper = await cardOf(application('sams', ApplicationStatus.Open, SAM), {
      chosen: false,
    });

    expect(wrapper.find('[data-testid="app-monitor-reviewer"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="app-monitor-dealt-warning"]').exists()).toBe(false);
  });
});
