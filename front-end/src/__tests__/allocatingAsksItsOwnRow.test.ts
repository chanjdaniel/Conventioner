/**
 * Allocating tables asks the Assignment row alone (E39/F01/S03).
 *
 * A market's owner may set the Assignment row apart from Change Market Setup, so a person may be
 * offered Allocate tables with the rules read only. The press saved the plan before running, and
 * the plan's write asks Change Market Setup: that person was refused, and nothing ran. The plan is
 * sent only by someone who may change it; the rules are read only to anyone else, so there is
 * nothing of theirs to save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import { MarketAction } from '@/utils/marketActions';
import { marketRoute, serveMarket } from './support/marketScreen';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => marketRoute('settings'),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-11-18' }],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
};

function serveTheMarket(refused: MarketAction[]) {
  serveMarket(api.get, {
    id: 'market-1',
    name: 'Riverside',
    phase: 'assignment',
    setupObject: PLAN,
    assignRefusalReason: null,
    actionRefusals: answersRefusing(...refused),
  });
}

async function pressAllocate() {
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        MarketFrame: false,
        MarketAssignmentTab: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  await flushPromises();
  await wrapper.get('[data-testid="market-setup-assign-button"]').trigger('click');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.put.mockReset().mockResolvedValue({ data: {} });
  api.post.mockReset().mockResolvedValue({ data: {} });
});

describe('Allocate tables', () => {
  it('runs for someone the Assignment row allows and Change Market Setup refuses, sending no plan', async () => {
    serveTheMarket([MarketAction.ChangeSetup]);

    const wrapper = await pressAllocate();

    expect(api.post).toHaveBeenCalledWith('/markets/market-1/assignment');
    expect(api.put).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="market-setup-assign-error"]').exists()).toBe(false);
  });

  it('saves the plan first for someone who may change it, then runs', async () => {
    serveTheMarket([]);

    await pressAllocate();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/plan', expect.anything());
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/assignment');
    expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(api.post.mock.invocationCallOrder[0]);
  });
});
