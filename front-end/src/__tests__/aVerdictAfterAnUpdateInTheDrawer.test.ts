/**
 * An organizer's update of an answer moves the answers' version (T270), and a verdict is written only
 * on the version its giver saw (E34/F03/S01). The All view's drawer gives a verdict on the update
 * just saved, before the list is read again: the row takes the application as saved at once.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

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
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'ana@example.com' }));

const OPENED = '2026-09-15T14:20:18+00:00';
const UPDATED = '2026-11-10T09:00:00+00:00';

const JO = {
  id: 'jo',
  marketId: 'm1',
  applicantEmail: 'jo@vendor.test',
  status: ApplicationStatus.Open,
  formData: { business_name: 'Ember Ceramcs' },
  submittedAt: OPENED,
  updatedAt: OPENED,
  verdictAt: null,
} as unknown as Application;

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

beforeEach(() => {
  setActivePinia(createPinia());
  route.query = { vendor: 'jo@vendor.test' };
  for (const call of Object.values(api)) call.mockReset().mockResolvedValue({ data: {} });
  fetchMarketApplications.mockReset().mockResolvedValue([{ ...JO }]);
});

it('a verdict given before the list is read again carries the version the update answered', async () => {
  const wrapper = mount(ApplicationsAll, {
    props: { market: MARKET },
    global: {
      stubs: {
        VendorDrawer: {
          name: 'VendorDrawer',
          emits: ['infoUpdated'],
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
  // The list's read after the update has not answered yet.
  fetchMarketApplications.mockReturnValue(new Promise(() => {}));

  const saved = { ...JO, formData: { business_name: 'Ember Ceramics' }, updatedAt: UPDATED };
  wrapper.findComponent({ name: 'VendorDrawer' }).vm.$emit('infoUpdated', saved);
  await flushPromises();
  api.put.mockResolvedValue({
    data: { application: { ...saved, status: ApplicationStatus.ReviewerApproved } },
  });
  await wrapper.get('[data-testid="applications-all-approve"]').trigger('click');
  await flushPromises();

  expect(api.put).toHaveBeenCalledWith('/markets/m1/applications/jo/review', {
    status: ApplicationStatus.ReviewerApproved,
    seen: { status: ApplicationStatus.Open, verdictAt: null, updatedAt: UPDATED },
  });
  wrapper.unmount();
});
