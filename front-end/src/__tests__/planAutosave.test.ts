/**
 * The plan saves itself as it is edited.
 *
 * It used to be saved by the wizard's Back and Next, which were the only routine writes of the
 * plan to the server - every other edit touched localStorage alone. The plan is one page now
 * (E10/F02/S01) and those buttons are gone, so without this an organizer could plan a market,
 * open applications, and have a plan that existed on their machine and nowhere else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import { marketRoute, serveMarket } from './support/marketScreen';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The market's id and the open tab both live in the URL (E10/F03/S01, E21/F02/S02).
  useRoute: () => marketRoute(),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-08-01' }],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
};

function serveTheMarket() {
  serveMarket(api.get, { id: 'market-1', name: 'Riverside', phase: 'draft', setupObject: PLAN });
}

/** Mount the plan, and let the store receive the market it is routed to. */
async function mountPlan() {
  const wrapper = mount(MarketSetupView, {
    shallow: true,
    global: {
      stubs: {
        // The frame renders the bar and the tabs' content in its slots (E21/F04/S01).
        MarketFrame: false,
        // The plan tab owns the cards since E18/F02/S01, and the setting container renders the
        // slot each editor lives in - both have to be real or there is nothing to emit an edit from.
        MarketPlanTab: false,
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  serveTheMarket();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function edit(
  wrapper: Awaited<ReturnType<typeof mountPlan>>,
  plan: Record<string, unknown> = PLAN,
) {
  wrapper.findComponent(ElementMarketDates).vm.$emit('update:setupObject', plan);
  await wrapper.vm.$nextTick();
}

describe('the plan saves itself', () => {
  it('writes only the plan, never the whole market', async () => {
    const wrapper = await mountPlan();

    await edit(wrapper);
    await vi.advanceTimersByTimeAsync(1000);

    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/markets/market-1/plan');
    expect(Object.keys(body).sort()).toEqual(['intakeMode', 'setupObject']);
  });

  it('writes an edit to the server', async () => {
    const wrapper = await mountPlan();

    await edit(wrapper);
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/plan', expect.anything());
  });

  it('waits, so a name typed one letter at a time is one save and not eleven', async () => {
    const wrapper = await mountPlan();

    for (let keystroke = 0; keystroke < 'Riverside 1'.length; keystroke += 1) {
      await edit(wrapper);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('says it saved, and stops saying so', async () => {
    const wrapper = await mountPlan();

    await edit(wrapper);
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('[data-testid="market-setup-plan-saved"]').exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(2500);
    expect(wrapper.find('[data-testid="market-setup-plan-saved"]').exists()).toBe(false);
  });

  it('says so when a save fails, rather than reporting a plan that is not there', async () => {
    api.put.mockRejectedValue(new Error('offline'));
    const wrapper = await mountPlan();

    await edit(wrapper);
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.find('[data-testid="market-setup-plan-save-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="market-setup-plan-saved"]').exists()).toBe(false);
  });

  it('sends a pending edit when the organizer leaves before it fires', async () => {
    const wrapper = await mountPlan();

    await edit(wrapper);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.put).not.toHaveBeenCalled();

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/plan', expect.anything());
  });
});
