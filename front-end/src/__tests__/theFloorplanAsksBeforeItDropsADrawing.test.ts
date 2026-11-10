/**
 * The floorplan beta asks before it drops a floorplan not yet saved to the market (T271).
 *
 * The upload, the scale, the tables and the sections live in the page until the save, so from the
 * upload on a move off the flow asks first and a reload is asked by the browser. Before an upload
 * there is nothing to lose, and the save sets the floorplan saved before its move to the plan, so
 * that move never asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';

import FloorplanWorkflow from '@/components/floorplan/FloorplanWorkflow.vue';
import FloorplanUploader from '@/components/floorplan/FloorplanUploader.vue';
import ScaleCalibration from '@/components/floorplan/ScaleCalibration.vue';
import SaveFlow from '@/components/floorplan/SaveFlow.vue';
import { useFloorplanStore } from '@/stores/floorplan';
import { answerLeaveQuestion, leaveQuestion } from '@/utils/useUnsavedWork';

type Guard = (to: RouteLocationNormalized, from: RouteLocationNormalized) => unknown;

const guards = vi.hoisted(() => ({ leave: [] as Guard[], update: [] as Guard[] }));

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: Guard) => guards.leave.push(guard),
  onBeforeRouteUpdate: (guard: Guard) => guards.update.push(guard),
}));

const SENTENCE =
  'This floorplan is not saved to the market yet. Leaving drops the upload, the scale, the tables and the sections.';

/** The flow's own address, and Market Setup, where a market tab or the save would go. */
const HERE = { path: '/markets/market-1/floorplan', name: 'market-floorplan' };
const SETUP = { path: '/markets/market-1/setup', name: 'market-setup' };

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  guards.leave.length = 0;
  guards.update.length = 0;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  answerLeaveQuestion(false);
});

/** The flow with its steps stubbed: what each step emits is what moves the flow on. */
async function mountFlow(): Promise<VueWrapper> {
  wrapper = mount(FloorplanWorkflow, {
    props: { marketId: 'market-1' },
    global: {
      stubs: {
        FloorplanUploader: true,
        ScaleCalibration: true,
        TableTypePanel: true,
        AutoPlaceButton: true,
        FloorplanEditor: true,
        WallEditor: true,
        SectionGrouping: true,
        SaveFlow: true,
        TemplatePanel: true,
        ExportButton: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

async function upload(flow: VueWrapper) {
  flow
    .findComponent(FloorplanUploader)
    .vm.$emit('uploaded', { gridfs_id: 'plan-1', width: 1200, height: 800 });
  await flushPromises();
}

const next = async (flow: VueWrapper) => {
  await flow.get('[data-testid="floorplan-workflow-next-btn"]').trigger('click');
  await flushPromises();
};

/** From an upload to the save step: calibrated, tables placed, a section drawn. */
async function toTheSaveStep(flow: VueWrapper) {
  const store = useFloorplanStore();
  await upload(flow);
  await next(flow);
  flow.findComponent(ScaleCalibration).vm.$emit('calibrated', {
    pxPerMm: 0.04,
    pixelDistance: 400,
    lengthMm: 10000,
    unit: 'm',
  });
  await flushPromises();
  store.setPlacedTables([{ id: 't1' } as never]);
  await flushPromises();
  await next(flow);
  store.setSections([{ id: 's1', name: 'Main', locationName: 'Main Hall', tableIds: ['t1'] }]);
  await flushPromises();
  await next(flow);
  expect(flow.findComponent(SaveFlow).exists()).toBe(true);
}

/** Try each of the flow's guards with a move to Market Setup, and read whether it asked. */
async function asksOnAMove(): Promise<boolean> {
  expect(guards.leave).toHaveLength(1);
  expect(guards.update).toHaveLength(1);
  const asked: boolean[] = [];
  for (const guard of [guards.leave[0], guards.update[0]]) {
    const answer = guard(SETUP as RouteLocationNormalized, HERE as RouteLocationNormalized);
    await flushPromises();
    const question = leaveQuestion.value;
    asked.push(question !== null);
    if (question) {
      expect(question.sentence).toBe(SENTENCE);
      answerLeaveQuestion(false);
      expect(await answer).toBe(false);
    } else {
      expect(await answer).toBe(true);
    }
  }
  expect(asked[0]).toBe(asked[1]);
  return asked[0];
}

/** Whether a reload now is asked by the browser. */
function asksOnUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the floorplan not yet saved to the market', () => {
  it('asks nothing before an upload', async () => {
    await mountFlow();
    expect(await asksOnAMove()).toBe(false);
    expect(asksOnUnload()).toBe(false);
  });

  it('asks in the floorplan’s words from the upload on, on a move and on a reload', async () => {
    const flow = await mountFlow();
    await upload(flow);
    expect(await asksOnAMove()).toBe(true);
    expect(asksOnUnload()).toBe(true);

    // Every step after it still holds the floorplan.
    await toTheSaveStep(flow);
    expect(await asksOnAMove()).toBe(true);
    expect(asksOnUnload()).toBe(true);
  });

  it('asks nothing once saved, so the save’s move to the plan goes', async () => {
    const flow = await mountFlow();
    await toTheSaveStep(flow);
    flow.findComponent(SaveFlow).vm.$emit('saved', { market_id: 'market-1' });
    await flushPromises();

    expect(flow.emitted('saved')).toEqual([[{ market_id: 'market-1' }]]);
    expect(await asksOnAMove()).toBe(false);
    expect(asksOnUnload()).toBe(false);
  });

  it('asks nothing once the flow is gone', async () => {
    const flow = await mountFlow();
    await upload(flow);
    flow.unmount();
    wrapper = null;
    expect(asksOnUnload()).toBe(false);
  });
});
