/**
 * A list that could not be read is not a list of none (E38/F11/S01): the All view's failed read
 * says what happened and offers Try again, and counts nothing, since "0 of 0" would claim the
 * market has no applications.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import type { Market } from '@/assets/types/datatypes';
import { answersRefusing } from './support/servedAnswers';
import { MARKET_ID } from './support/marketScreen';

const fetchMarketApplications = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ name: 'market-applications', params: { marketId: MARKET_ID }, query: {} }),
}));
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return { ...actual, fetchMarketApplications };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'owner@market.test' }));

const MARKET = {
  id: MARKET_ID,
  name: 'Riverside Spring',
  phase: 'applications',
  roles: {},
  setupObject: { marketDates: [], tiers: [], locations: [], sections: [], priority: [] },
  applicationForm: { fields: [] },
  actionRefusals: answersRefusing(),
} as unknown as Market;

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMarketApplications.mockReset();
});

describe('the All view, when its list could not be read', () => {
  it('says so, offers Try again and counts nothing', async () => {
    fetchMarketApplications.mockRejectedValueOnce({ isAxiosError: true, request: {} });
    const wrapper = mount(ApplicationsAll, {
      props: { market: MARKET },
      shallow: true,
      global: { stubs: { ListFrame: false } },
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="applications-all-list-count"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'ReadFailed' }).props('message')).toBe(
      'You seem to be offline. Check the connection and try again.',
    );
  });

  it('says what the list holds once Try again reads it', async () => {
    fetchMarketApplications.mockRejectedValueOnce({ isAxiosError: true, request: {} });
    const wrapper = mount(ApplicationsAll, {
      props: { market: MARKET },
      shallow: true,
      global: { stubs: { ListFrame: false } },
    });
    await flushPromises();

    fetchMarketApplications.mockResolvedValueOnce([]);
    wrapper.findComponent({ name: 'ReadFailed' }).vm.$emit('retry');
    await flushPromises();

    expect(wrapper.get('[data-testid="applications-all-empty"]').text()).toBe(
      'No applications received yet.',
    );
    expect(wrapper.findComponent({ name: 'ReadFailed' }).exists()).toBe(false);
  });
});
