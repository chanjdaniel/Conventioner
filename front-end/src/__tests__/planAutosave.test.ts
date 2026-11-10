/**
 * The plan saves itself as it is edited.
 *
 * It used to be saved by the wizard's Back and Next, which were the only routine writes of the
 * plan to the server - every other edit touched localStorage alone. The plan is one page now
 * (E10/F02/S01) and those buttons are gone, so without this an organizer could plan a market,
 * open applications, and have a plan that existed on their machine and nowhere else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketSetupView from '@/views/MarketSetupView.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import { marketRoute, marketRouter, serveMarket } from './support/marketScreen';
import { answersRefusing } from './support/servedAnswers';
import { useMarketStore } from '@/stores/market';
import PhaseRail from '@/components/PhaseRail.vue';
import MarketAssignmentTab from '@/components/market/MarketAssignmentTab.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
const routing = vi.hoisted(() => ({ page: 'setup', router: null as unknown }));

vi.mock('vue-router', () => ({
  useRouter: () => routing.router,
  // The market's id and the open tab both live in the URL (E10/F03/S01, E21/F02/S02).
  useRoute: () => reactive(marketRoute(routing.page)),
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
        // The status line, and Settings, which draws its failed and refused lines (T271).
        PlanSaveStatus: false,
        MarketAssignmentTab: false,
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
  routing.page = 'setup';
  routing.router = marketRouter();
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  api.put.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: {} });
  serveTheMarket();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A request the server answered with `status`, as axios rejects it. */
function answered(status: number, error?: string) {
  return { isAxiosError: true, response: { status, data: error ? { error } : {} } };
}

/** A request that never reached the server. */
const noAnswer = { isAxiosError: true, response: undefined };

const OFFLINE = 'You seem to be offline. Check the connection and try again.';

function shownDates(wrapper: Awaited<ReturnType<typeof mountPlan>>) {
  return wrapper.findComponent(ElementMarketDates).props('setupObject').marketDates;
}

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

  it('takes a card reporting the re-read after a save for an echo, not an edit', async () => {
    // Every plan card deep-watches the working copy and reports any change to it. Adopting the
    // re-read after a save replaces the working copy, so each card reported it back, and that
    // report scheduled the next save: one edit saved every 625 ms until the page was left
    // (E26/F04/S01, bug 25).
    let stored: Record<string, unknown> = PLAN;
    api.put.mockImplementation((_url: string, body: { setupObject: Record<string, unknown> }) => {
      stored = JSON.parse(JSON.stringify(body.setupObject));
      return Promise.resolve({ data: {} });
    });
    serveMarket(api.get, { id: 'market-1', name: 'Riverside', phase: 'draft', setupObject: PLAN });
    api.get.mockImplementation(() =>
      Promise.resolve({
        data: {
          market: {
            id: 'market-1',
            name: 'Riverside',
            phase: 'draft',
            setupObject: stored,
            actionRefusals: answersRefusing(),
          },
        },
      }),
    );
    const wrapper = await mountPlan();

    await edit(wrapper, { ...PLAN, marketDates: [{ date: '2026-08-02' }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.put).toHaveBeenCalledTimes(1);

    const card = wrapper.findComponent(ElementMarketDates);
    card.vm.$emit('update:setupObject', card.props('setupObject'));
    await wrapper.vm.$nextTick();
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('keeps the last edit when a slow first save answers after the one sent behind it', async () => {
    // Answers are not promised in order. The page used to send a save at every pause whether or
    // not one was still out, so a slow first save reaching the server last stored the older plan,
    // and the re-read after it put that plan back on screen beside "Plan saved" (T271).
    let stored: Record<string, unknown> = PLAN;
    const out: { body: Record<string, unknown>; answer: () => void }[] = [];
    api.put.mockImplementation(
      (_url: string, body: { setupObject: Record<string, unknown> }) =>
        new Promise((resolve) => {
          const copy = JSON.parse(JSON.stringify(body.setupObject));
          out.push({
            body: copy,
            answer: () => {
              stored = copy;
              resolve({ data: {} });
            },
          });
        }),
    );
    api.get.mockImplementation(() =>
      Promise.resolve({
        data: {
          market: {
            id: 'market-1',
            name: 'Riverside',
            phase: 'draft',
            setupObject: stored,
            actionRefusals: answersRefusing(),
          },
        },
      }),
    );
    const wrapper = await mountPlan();
    const first = { ...PLAN, marketDates: [{ date: '2026-08-01' }, { date: '2026-08-08' }] };
    const last = {
      ...PLAN,
      marketDates: [{ date: '2026-08-01' }, { date: '2026-08-08' }, { date: '2026-08-15' }],
    };

    await edit(wrapper, first);
    await vi.advanceTimersByTimeAsync(600);
    await edit(wrapper, last);
    await vi.advanceTimersByTimeAsync(600);
    // Every save out answers newest first, the slow first one last, until none is left.
    while (out.length) {
      out.pop()!.answer();
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(wrapper.find('[data-testid="market-setup-plan-saved"]').exists()).toBe(true);
    expect(stored.marketDates).toEqual(last.marketDates);
    const shown = wrapper.findComponent(ElementMarketDates).props('setupObject');
    expect(shown.marketDates).toEqual(last.marketDates);
    // Nothing is left to send.
    const sent = api.put.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.put).toHaveBeenCalledTimes(sent);
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

describe('a save that did not land', () => {
  const ADDED = { ...PLAN, marketDates: [{ date: '2026-08-01' }, { date: '2026-08-08' }] };

  it('puts the plan back as the server holds it when the server refuses, and says why', async () => {
    api.put.mockRejectedValue(answered(400, 'The setup is settled.'));
    const wrapper = await mountPlan();

    await edit(wrapper, ADDED);
    await vi.advanceTimersByTimeAsync(1000);

    const line = wrapper.find('[data-testid="market-setup-plan-refused"]');
    expect(line.text()).toBe('The setup is settled. The plan is back as it was last saved.');
    expect(wrapper.find('[data-testid="market-setup-plan-retry-button"]').exists()).toBe(false);
    expect(shownDates(wrapper)).toEqual(PLAN.marketDates);
    // Nothing of the refused plan is left to send.
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('puts the plan back even when the re-read hands back the market it already had', async () => {
    api.put.mockRejectedValue(answered(400, 'The setup is settled.'));
    const wrapper = await mountPlan();
    // The re-read fails on the wire, so the store keeps the very market the page holds.
    api.get.mockRejectedValue(noAnswer);

    await edit(wrapper, ADDED);
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.find('[data-testid="market-setup-plan-refused"]').exists()).toBe(true);
    expect(shownDates(wrapper)).toEqual(PLAN.marketDates);
  });

  it('lets later re-reads reach the screen after a refusal', async () => {
    api.put.mockRejectedValue(answered(400, 'The setup is settled.'));
    const wrapper = await mountPlan();
    await edit(wrapper, ADDED);
    await vi.advanceTimersByTimeAsync(1000);

    const moved = { ...PLAN, marketDates: [{ date: '2026-09-05' }] };
    serveMarket(api.get, { id: 'market-1', name: 'Riverside', phase: 'draft', setupObject: moved });
    await useMarketStore().refresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(shownDates(wrapper)).toEqual(moved.marketDates);
  });

  it('keeps the edit when the save fails, says so, and Retry sends the whole plan again', async () => {
    api.put.mockRejectedValueOnce(noAnswer);
    const wrapper = await mountPlan();

    await edit(wrapper, ADDED);
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.find('[data-testid="market-setup-plan-save-error"]').text()).toBe(OFFLINE);
    expect(shownDates(wrapper)).toEqual(ADDED.marketDates);
    // Nothing tries again by itself.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.put).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-testid="market-setup-plan-retry-button"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put.mock.calls[1][1].setupObject.marketDates).toEqual(ADDED.marketDates);
    expect(wrapper.find('[data-testid="market-setup-plan-saved"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="market-setup-plan-save-error"]').exists()).toBe(false);
  });

  it.each([
    ['failed', () => noAnswer, 'market-setup-plan-save-error'],
    ['refused', () => answered(400, 'The rules are settled.'), 'market-setup-plan-refused'],
  ])('shows the %s line on Settings, where a rule edit is the same save', async (_k, err, id) => {
    routing.page = 'settings';
    api.put.mockRejectedValue(err());
    const wrapper = await mountPlan();

    wrapper.findComponent(MarketAssignmentTab).vm.$emit('update:setupObject', ADDED);
    await wrapper.vm.$nextTick();
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(true);
  });

  it('stops a phase move over a plan that did not save, and says why', async () => {
    api.put.mockRejectedValue(noAnswer);
    const wrapper = await mountPlan();
    await edit(wrapper, ADDED);

    const why = await wrapper.findComponent(PhaseRail).props('beforeTransition')!();

    expect(why).toBe(`The market did not move, because the plan did not save. ${OFFLINE}`);
  });

  it('lets a move go when the plan saved', async () => {
    const wrapper = await mountPlan();
    await edit(wrapper, ADDED);

    const why = await wrapper.findComponent(PhaseRail).props('beforeTransition')!();

    expect(why).toBeNull();
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('stops Allocate tables over a plan that did not save, and posts no run', async () => {
    routing.page = 'settings';
    // Tables are allocated in the assignment phase.
    serveMarket(api.get, {
      id: 'market-1',
      name: 'Riverside',
      phase: 'assignment',
      setupObject: PLAN,
    });
    api.put.mockRejectedValue(noAnswer);
    const wrapper = await mountPlan();
    const tab = wrapper.findComponent(MarketAssignmentTab);
    tab.vm.$emit('update:setupObject', ADDED);
    await wrapper.vm.$nextTick();

    tab.vm.$emit('assign');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.findComponent(MarketAssignmentTab).props('assignError')).toBe(OFFLINE);
  });

  it('keeps Start from a CSV on the page when the plan did not save', async () => {
    api.put.mockRejectedValue(noAnswer);
    const wrapper = await mountPlan();
    await edit(wrapper, ADDED);

    wrapper.findComponent({ name: 'MarketPlanTab' }).vm.$emit('startFromCsv');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.put).toHaveBeenCalledTimes(1);
    expect((routing.router as ReturnType<typeof marketRouter>).push).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="market-setup-plan-save-error"]').text()).toBe(OFFLINE);
  });

  it('goes to Start from a CSV once the plan saved', async () => {
    const wrapper = await mountPlan();
    await edit(wrapper, ADDED);

    wrapper.findComponent({ name: 'MarketPlanTab' }).vm.$emit('startFromCsv');
    await vi.advanceTimersByTimeAsync(0);

    expect((routing.router as ReturnType<typeof marketRouter>).push).toHaveBeenCalledWith(
      '/markets/market-1/start-from-csv',
    );
  });
});
