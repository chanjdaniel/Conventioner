/**
 * The All view's verdicts offer the same Undo as One by one's (E38/F10/S01): a row's, in its drawer
 * while it is open, and a selection's on its done line, which then says what the undo skipped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';
import { isDecided } from '@/utils/verdicts';

const ME = 'ana@example.com';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const fetchMarketApplications = vi.fn();

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
  return { ...actual, fetchMarketApplications: (id: string) => fetchMarketApplications(id) };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => ME }));

function application(id: string, status: ApplicationStatus, extra = {}): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@vendor.test`,
    status,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    ...extra,
  } as unknown as Application;
}

const MARKET = {
  id: 'm1',
  phase: 'applications',
  roles: {},
  applicationForm: { fields: [] },
  actionRefusals: {
    ...answersRefusing(),
    [MarketAction.GiveVerdicts]: null,
    [MarketAction.ChangeVerdicts]: null,
  },
} as unknown as Market;

/** The server's applications, as each write leaves them. */
let stored: Application[] = [];
const VERDICT_AT = '2026-11-01T10:00:00+00:00';

function setStatus(id: string, status: string, verdictAt: string | null) {
  stored = stored.map((app) =>
    app.id === id ? ({ ...app, status, verdictAt } as Application) : app,
  );
  return stored.find((app) => app.id === id)!;
}

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = {};
  stored = [
    application('jo', ApplicationStatus.Open, { formData: { essential_full_name: 'Jo Lee' } }),
    application('al', ApplicationStatus.Open),
    application('decided', ApplicationStatus.ReviewerRejected, { verdictAt: VERDICT_AT }),
  ];
  fetchMarketApplications.mockReset().mockImplementation(async () => stored.map((a) => ({ ...a })));
  for (const call of Object.values(api)) call.mockReset().mockResolvedValue({ data: {} });
  // The server offers an undo only of a verdict on an application awaiting one, as it keeps what
  // that was; a verdict that changed one answers no window.
  const awaiting = (id: string) => !isDecided(stored.find((app) => app.id === id)!);
  api.put.mockImplementation(async (url: string, body: { status: string }) => {
    const id = url.split('/applications/')[1]!.split('/')[0]!;
    const window = awaiting(id) ? { undoSeconds: 120 } : {};
    return { data: { application: setStatus(id, body.status, VERDICT_AT), ...window } };
  });
  api.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith('/applications/verdicts')) {
      const ids = (body.applications as { id: string }[]).map((a) => a.id);
      const window = ids.every(awaiting) ? { undoSeconds: 120 } : {};
      ids.forEach((id) => setStatus(id, body.status as string, VERDICT_AT));
      return { data: { written: ids, skipped: [], ...window } };
    }
    if (url.endsWith('/verdicts/undo')) {
      const [first, ...rest] = body.applications as { id: string }[];
      setStatus(first!.id, ApplicationStatus.Open, null);
      return {
        data: {
          written: [first!.id],
          skipped: rest.map((a) => ({
            id: a.id,
            email: `${a.id}@vendor.test`,
            reason: 'kai@example.com approved this application since you opened it.',
          })),
        },
      };
    }
    if (url.endsWith('/review/undo')) {
      const id = url.split('/applications/')[1]!.split('/')[0]!;
      return { data: { application: setStatus(id, ApplicationStatus.Open, null) } };
    }
    return { data: {} };
  });
});

async function allView() {
  const wrapper = mount(ApplicationsAll, {
    props: { market: MARKET },
    global: {
      stubs: {
        VendorDrawer: {
          template: '<div><slot name="actions" /></div>',
          methods: { entryFor: () => null, loadNotes: () => undefined },
        },
        AppDialog: {
          props: ['open'],
          emits: ['submit'],
          template:
            '<div v-if="open"><button data-testid="confirm" @click="$emit(\'submit\')" /></div>',
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

describe('a row’s verdict', () => {
  it('offers its Undo in the drawer, which returns it to open', async () => {
    route.query = { vendor: 'jo@vendor.test' };
    const wrapper = await allView();

    await wrapper.get('[data-testid="applications-all-reject"]').trigger('click');
    await flushPromises();

    const line = wrapper.get('[data-testid="applications-all-drawer-undo"]');
    expect(line.text()).toContain('Rejected Jo Lee (jo@vendor.test).');
    await line.get('button').trigger('click');
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith('/markets/m1/applications/jo/review/undo', {
      seen: expect.objectContaining({ status: 'reviewer_rejected', verdictAt: VERDICT_AT }),
    });
    expect(wrapper.find('[data-testid="applications-all-drawer-undo"]').exists()).toBe(false);
    expect(stored.find((a) => a.id === 'jo')!.status).toBe('open');
  });

  it('offers none for a verdict that changed one', async () => {
    route.query = { vendor: 'decided@vendor.test' };
    const wrapper = await allView();

    await wrapper.get('[data-testid="applications-all-approve"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="applications-all-drawer-undo"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="applications-all-undo"]').exists()).toBe(false);
  });
});

describe('a selection’s verdict', () => {
  async function approveTicked(ids: string[]) {
    const wrapper = await allView();
    for (const row of wrapper.findAll('[data-testid="applications-all-row"]')) {
      if (ids.some((id) => row.text().includes(`${id}@vendor.test`))) {
        await row.get('[data-testid="applications-all-tick"]').setValue(true);
      }
    }
    await wrapper.get('[data-testid="applications-all-selection-approve"]').trigger('click');
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();
    return wrapper;
  }

  it('offers Undo on its done line, and says what the undo skipped and why', async () => {
    const wrapper = await approveTicked(['jo', 'al']);
    expect(wrapper.get('[data-testid="applications-all-result"]').text()).toContain(
      '2 applications approved.',
    );

    await wrapper.get('[data-testid="applications-all-result-undo"]').trigger('click');
    await flushPromises();

    const undone = api.post.mock.calls.find(([url]) => url.endsWith('/verdicts/undo'))!;
    expect(undone[1]).toEqual({
      applications: [
        { id: 'jo', seen: expect.objectContaining({ status: 'reviewer_approved' }) },
        { id: 'al', seen: expect.objectContaining({ status: 'reviewer_approved' }) },
      ],
    });
    const result = wrapper.get('[data-testid="applications-all-result"]');
    expect(result.text()).toContain('1 application undone; 1 skipped:');
    expect(wrapper.get('[data-testid="applications-all-skipped"]').text()).toBe(
      'al@vendor.test: kai@example.com approved this application since you opened it.',
    );
    expect(wrapper.find('[data-testid="applications-all-result-undo"]').exists()).toBe(false);
  });

  it('offers none when it changed a verdict already given', async () => {
    const wrapper = await approveTicked(['jo', 'decided']);

    expect(wrapper.find('[data-testid="applications-all-result-undo"]').exists()).toBe(false);
  });

  it('gives its Undo up at the next verdict, a row’s: the screen offers the last one only', async () => {
    route.query = { vendor: 'al@vendor.test' };
    const wrapper = await approveTicked(['jo']);
    expect(wrapper.find('[data-testid="applications-all-result-undo"]').exists()).toBe(true);

    await wrapper.get('[data-testid="applications-all-reject"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="applications-all-result-undo"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="applications-all-drawer-undo"]').text()).toContain(
      'Rejected al@vendor.test.',
    );
  });

  it('takes its answer away at a row’s verdict, so the screen reads the last action only', async () => {
    route.query = { vendor: 'al@vendor.test' };
    const wrapper = await approveTicked(['jo']);
    await wrapper.get('[data-testid="applications-all-result-undo"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="applications-all-result"]').text()).toContain(
      '1 application undone.',
    );

    await wrapper.get('[data-testid="applications-all-reject"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="applications-all-result"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="applications-all-drawer-undo"]').text()).toContain(
      'Rejected al@vendor.test.',
    );
  });
});
