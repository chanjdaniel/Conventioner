/**
 * The layout page and the saves that did not land (T257's first review): a phase move from the
 * page waits for the layout's save and stops when it did not land, as Market Setup's does for the
 * plan; and once the market leaves Draft or is archived elsewhere, a change the server refused is
 * dropped and the server's layout shown, as Market Setup forgets a plan it may no longer send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { enableAutoUnmount, shallowMount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import LayoutView from '@/components/layout/LayoutView.vue';
import LayoutEditor from '@/components/layout/LayoutEditor.vue';
import type { LayoutEditor as Editor } from '@/components/layout/useLayoutEditor';
import { ROW_CHOICES_AT_FIRST, rowChoices } from '@/components/layout/layoutRow';
import { useMarketStore } from '@/stores/market';
import { MARKET_ID, marketRouter } from './support/marketScreen';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
const routing = vi.hoisted(() => ({ router: null as unknown, route: null as unknown }));

vi.mock('vue-router', () => ({
  useRouter: () => routing.router,
  useRoute: () => routing.route,
  onBeforeRouteLeave: () => {},
  onBeforeRouteUpdate: () => {},
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SETTLED = 'The setup settled when the market left draft.';
const UPPER = { id: 'loc-upper', name: 'Upper Hall' };

function table(id: string, number: number, xMm: number) {
  return {
    id,
    sectionId: 'sec-gold',
    number,
    tableTypeId: 'tt-six',
    xMm,
    yMm: 2000,
    rotation: 0,
  };
}

const STORED = {
  id: 'fp-upper',
  locationId: UPPER.id,
  revision: 3,
  imageGridfsId: 'img-1',
  imageWidth: 800,
  imageHeight: 600,
  scalePxPerUnit: 800 / 30_000,
  tables: [table('g-1', 1, 4000), table('g-2', 2, 6000)],
  zones: [],
  sectionStyles: [],
  startingCounts: [],
};

function served(overrides: Record<string, unknown> = {}) {
  return {
    id: MARKET_ID,
    name: 'Riverside',
    phase: 'draft',
    actionRefusals: answersRefusing(),
    setupObject: {
      priority: [],
      marketDates: [{ date: '2099-08-01' }],
      tiers: [],
      locations: [UPPER],
      sections: [{ id: 'sec-gold', name: 'Gold row', count: 2, location: UPPER }],
      assignmentOptions: {},
      tableTypes: [{ id: 'tt-six', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 }],
      floorplans: [STORED],
    },
    ...overrides,
  };
}

let market: Record<string, unknown> = served();

function aRefusal(status: number, error: string) {
  return Object.assign(new Error(error), {
    isAxiosError: true,
    response: { status, data: { error } },
  });
}

async function mountPage(): Promise<VueWrapper> {
  const wrapper = shallowMount(LayoutView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        // The frame stands as itself would, its page in its slot, its props read by the test.
        MarketFrame: {
          name: 'MarketFrame',
          props: ['market', 'beforeTransition'],
          template: '<div><slot /></div>',
        },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

function editorOf(wrapper: VueWrapper): Editor {
  return wrapper.findComponent(LayoutEditor).props('editor') as Editor;
}

async function moveATable(wrapper: VueWrapper) {
  editorOf(wrapper).moveTables(['g-1'], 1000, 0);
  await vi.advanceTimersByTimeAsync(700);
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  routing.router = marketRouter();
  routing.route = reactive({
    name: 'market-layout',
    params: { marketId: 'market-1', locationId: 'loc-upper' },
    query: {},
    matched: [],
  });
  market = served();
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url: string) =>
    url === `/markets/${MARKET_ID}`
      ? Promise.resolve({ data: { market } })
      : Promise.resolve({ data: new Blob() }),
  );
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(rowChoices, ROW_CHOICES_AT_FIRST);
});

describe('a phase move from the layout page', () => {
  it("stops when the layout's save did not land, and says why", async () => {
    api.post.mockRejectedValue(aRefusal(500, 'Server error'));
    const wrapper = await mountPage();
    await moveATable(wrapper);

    const why = await wrapper.findComponent({ name: 'MarketFrame' }).props('beforeTransition')!();

    const said = editorOf(wrapper).saveMessage.value;
    expect(said).not.toBe('');
    expect(why).toBe(`The market did not move, because the layout did not save. ${said}`);
  });

  it("goes ahead once the layout's save landed", async () => {
    api.post.mockImplementation(async (_url: string, body: { floorplan: typeof STORED }) => ({
      data: { floorplan: { ...body.floorplan, revision: 4 }, sections: [] },
    }));
    const wrapper = await mountPage();
    editorOf(wrapper).moveTables(['g-1'], 1000, 0);

    const why = await wrapper.findComponent({ name: 'MarketFrame' }).props('beforeTransition')!();

    expect(why).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('a refused change once the market is settled elsewhere', () => {
  it("is dropped, and the server's layout drawn", async () => {
    api.post.mockRejectedValue(aRefusal(409, SETTLED));
    const wrapper = await mountPage();
    const editor = editorOf(wrapper);
    await moveATable(wrapper);
    expect(editor.pending()).toBe(true);

    market = served({ phase: 'applications', setupLockReason: SETTLED });
    await useMarketStore().refresh();
    await vi.advanceTimersByTimeAsync(0);

    const shown = wrapper.findComponent({ name: 'LayoutMap' });
    expect(shown.exists()).toBe(true);
    expect(shown.props('layout').tables).toEqual(STORED.tables);
    expect(editor.pending()).toBe(false);
    expect(editor.saveState.value).not.toBe('failed');
  });
});

describe('a recalibration that would leave tables outside the floorplan', () => {
  it('is refused in the page with how many, and writes nothing', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="layout-recalibrate"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    const calibration = wrapper.findComponent({ name: 'LayoutCalibration' });

    // 800 px across is now 5 m, 3.75 m deep: of the tables at 4 m and 6 m, the second is outside.
    calibration.vm.$emit('set', { start: [0, 0], end: [800, 0], lengthMm: 5000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'LayoutCalibration' }).props('refusal')).toBe(
      'At this scale 1 table would stand outside the floorplan. Draw the line again, or move it in first.',
    );
  });
});

describe("a recalibration's refusal", () => {
  it('is not carried to another location', async () => {
    const lower = { id: 'loc-lower', name: 'Lower Hall' };
    const uncalibrated = {
      ...STORED,
      id: 'fp-lower',
      locationId: lower.id,
      imageGridfsId: 'img-2',
      scalePxPerUnit: null,
      tables: [],
    };
    const setup = served().setupObject;
    market = served({
      setupObject: {
        ...setup,
        locations: [UPPER, lower],
        floorplans: [STORED, uncalibrated],
      },
    });
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="layout-recalibrate"]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    wrapper
      .findComponent({ name: 'LayoutCalibration' })
      .vm.$emit('set', { start: [0, 0], end: [800, 0], lengthMm: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.findComponent({ name: 'LayoutCalibration' }).props('refusal')).not.toBe('');

    (routing.route as { params: Record<string, string> }).params.locationId = lower.id;
    await vi.advanceTimersByTimeAsync(0);

    const calibration = wrapper.findComponent({ name: 'LayoutCalibration' });
    expect(calibration.props('locationName')).toBe('Lower Hall');
    expect(calibration.props('refusal')).toBe('');
  });
});

describe('"Row of N…" with a gap that is no length', () => {
  it('lays nothing and says what the gap takes, as the row tool does', async () => {
    const wrapper = await mountPage();
    const editor = editorOf(wrapper);
    editor.select(['g-1']);
    await vi.advanceTimersByTimeAsync(0);
    rowChoices.gapCm = '-5';

    wrapper.findComponent({ name: 'LayoutPanelSelection' }).vm.$emit('row', 3);
    await vi.advanceTimersByTimeAsync(0);

    expect(editor.layout.value!.tables).toHaveLength(2);
    expect(wrapper.get('[data-testid="layout-announcement"]').text()).toBe(
      "Type the gap's width in centimetres, 0 to 1,000.",
    );

    rowChoices.gapCm = '0';
    wrapper.findComponent({ name: 'LayoutPanelSelection' }).vm.$emit('row', 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.layout.value!.tables.length).toBeGreaterThan(2);
  });
});
