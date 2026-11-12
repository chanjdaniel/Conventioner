/**
 * Reading a layout (T257 ticket 12): at a phone's width the layout page only reads, its map's
 * table tapped read in the card under it, with the sections and the hint saying how; at a desk a
 * read-only page reads the table pressed or focused the same way. And the card itself: a table's
 * code, its section's tier and its type, or how to read one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { enableAutoUnmount, mount, shallowMount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import LayoutView from '@/components/layout/LayoutView.vue';
import LayoutPanelTable from '@/components/layout/LayoutPanelTable.vue';
import { layoutSections } from '@/components/layout/layoutDrawing';
import type { FloorplanTable, SectionObject } from '@/assets/types/datatypes';
import { MARKET_ID, marketRouter } from './support/marketScreen';
import { VIEWER_ANSWERS, answersRefusing } from './support/servedAnswers';

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

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const LOWER = { id: 'loc-lower', name: 'Lower Hall' };
const SILVER = { id: 2, name: 'Silver' };
const SIX = { id: 'tt-six', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };

function table(id: string, sectionId: string | null, number: number | null): FloorplanTable {
  return { id, sectionId, number, tableTypeId: SIX.id, xMm: 4000, yMm: 2000, rotation: 0 };
}

const SECTIONS: SectionObject[] = [
  { id: 'sec-gold', name: 'Gold row', count: 1, location: UPPER, tier: null },
  { id: 'sec-silver', name: 'Silver aisle', count: 1, location: UPPER, tier: SILVER },
];

const STORED = {
  id: 'fp-upper',
  locationId: UPPER.id,
  revision: 3,
  imageGridfsId: 'img-1',
  imageWidth: 800,
  imageHeight: 600,
  scalePxPerUnit: 800 / 30_000,
  tables: [table('g-1', 'sec-gold', 1), table('s-5', 'sec-silver', 1)],
  zones: [],
  sectionStyles: [],
  startingCounts: [],
};

function served(overrides: Record<string, unknown> = {}, floorplans: unknown[] = [STORED]) {
  return {
    id: MARKET_ID,
    name: 'Riverside',
    phase: 'draft',
    actionRefusals: answersRefusing(),
    setupObject: {
      priority: [],
      marketDates: [{ date: '2099-08-01' }],
      tiers: [SILVER],
      locations: [UPPER, LOWER],
      sections: SECTIONS,
      assignmentOptions: {},
      tableTypes: [SIX],
      floorplans,
    },
    ...overrides,
  };
}

let market: Record<string, unknown> = served();
/** Whether the window is a phone's, 640px and below. */
let phone = false;

async function mountPage(): Promise<VueWrapper> {
  const wrapper = shallowMount(LayoutView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
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

const map = (wrapper: VueWrapper) => wrapper.findComponent({ name: 'LayoutMap' });
const card = (wrapper: VueWrapper) => wrapper.findComponent(LayoutPanelTable);

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  routing.router = marketRouter();
  routing.route = reactive({
    name: 'market-layout',
    params: { marketId: 'market-1', locationId: UPPER.id },
    query: {},
    matched: [],
  });
  market = served();
  phone = false;
  api.get.mockReset();
  api.get.mockImplementation((url: string) =>
    url === `/markets/${MARKET_ID}`
      ? Promise.resolve({ data: { market } })
      : Promise.resolve({ data: new Blob() }),
  );
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: phone,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('on a phone', () => {
  beforeEach(() => {
    phone = true;
  });

  it('only reads, for an organizer who may edit at a desk', async () => {
    const wrapper = await mountPage();

    expect(map(wrapper).props('mode')).toBe('read');
    for (const name of [
      'LayoutEditor',
      'LayoutPanelSelection',
      'LayoutPanelTypes',
      'LayoutPanelZones',
      'LayoutPanelKeyboard',
    ]) {
      expect(wrapper.findComponent({ name }).exists(), name).toBe(false);
    }
    expect(wrapper.findComponent({ name: 'LayoutPanelSections' }).props('editable')).toBe(false);
    expect(wrapper.find('[data-testid="layout-panel-floorplan"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="layout-save-state"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="layout-announcement"]').exists()).toBe(false);
  });

  it('reads the table tapped in the card under the map, and says how', async () => {
    const wrapper = await mountPage();
    expect(card(wrapper).props('phone')).toBe(true);
    expect(card(wrapper).props('table')).toBeNull();

    map(wrapper).vm.$emit('activate', 's-5');
    await vi.advanceTimersByTimeAsync(0);
    expect(card(wrapper).props('table')).toMatchObject({ id: 's-5' });
    // The map outlines the table read.
    expect(map(wrapper).props('selection')).toEqual(['s-5']);

    expect(wrapper.get('[data-testid="layout-phone-hint"]').text()).toBe(
      'Pinch to zoom, drag to look around, tap a table to read it. The layout is edited at a desk.',
    );
    // The card first in the panel, the sections after it, the hint last.
    const panel = wrapper.get('aside').element.children;
    expect(panel[0].tagName.toLowerCase()).toBe('layout-panel-table-stub');
    expect(panel[1].tagName.toLowerCase()).toBe('layout-panel-sections-stub');
    expect(panel[panel.length - 1].getAttribute('data-testid')).toBe('layout-phone-hint');
  });

  it('offers no upload where a location has no layout', async () => {
    market = served({}, []);
    const wrapper = await mountPage();

    expect(wrapper.findComponent({ name: 'FloorplanUploader' }).exists()).toBe(false);
    expect(wrapper.get('[data-testid="layout-panel-start"]').text()).toBe(
      'Upper Hall has no layout yet.',
    );
  });

  it('offers no calibration where a layout has no scale, and shows its image', async () => {
    market = served({}, [{ ...STORED, scalePxPerUnit: undefined }]);
    const wrapper = await mountPage();

    expect(wrapper.findComponent({ name: 'LayoutCalibration' }).exists()).toBe(false);
    expect(wrapper.find('[data-testid="layout-phone-hint"]').exists()).toBe(false);
    expect(card(wrapper).exists()).toBe(false);
  });
});

describe('at a desk, read only', () => {
  it('reads the table focused, then the one pressed, as a Viewer', async () => {
    market = served({ actionRefusals: VIEWER_ANSWERS });
    const wrapper = await mountPage();
    expect(card(wrapper).props('phone')).toBe(false);

    map(wrapper).vm.$emit('focused', 'g-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(card(wrapper).props('table')).toMatchObject({ id: 'g-1' });
    map(wrapper).vm.$emit('activate', 's-5');
    await vi.advanceTimersByTimeAsync(0);
    expect(card(wrapper).props('table')).toMatchObject({ id: 's-5' });
    // The Floorplan card stays at a desk, with nothing that edits.
    expect(wrapper.find('[data-testid="layout-panel-floorplan"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="layout-phone-hint"]').exists()).toBe(false);
  });

  it('forgets the table read when another location is opened', async () => {
    market = served({ actionRefusals: VIEWER_ANSWERS });
    const wrapper = await mountPage();
    map(wrapper).vm.$emit('activate', 's-5');
    await vi.advanceTimersByTimeAsync(0);

    (routing.route as { params: Record<string, string> }).params.locationId = LOWER.id;
    await vi.advanceTimersByTimeAsync(0);
    (routing.route as { params: Record<string, string> }).params.locationId = UPPER.id;
    await vi.advanceTimersByTimeAsync(0);
    expect(card(wrapper).props('table')).toBeNull();
  });

  it('has no card of a table read for the editor, which has its selection', async () => {
    const wrapper = await mountPage();
    expect(wrapper.findComponent({ name: 'LayoutEditor' }).exists()).toBe(true);
    expect(card(wrapper).exists()).toBe(false);
  });
});

describe('the card of the table read', () => {
  const sections = layoutSections(STORED, SECTIONS);
  const read = (tableRead: FloorplanTable | null, onAPhone = true) =>
    mount(LayoutPanelTable, {
      props: { table: tableRead, sections, tableTypes: [SIX], phone: onAPhone },
    });

  it("reads a table's code over its tier and its type with its size", () => {
    const card = read(STORED.tables[1]);
    expect(card.get('[data-testid="layout-table-read-title"]').text()).toBe('Silver aisle 1');
    expect(card.get('[data-testid="layout-table-read-facts"]').text()).toBe(
      'Silver tier · Standard 6 ft (183 x 76 cm)',
    );
  });

  it('says a section of no tier has none', () => {
    const card = read(STORED.tables[0]);
    expect(card.get('[data-testid="layout-table-read-facts"]').text()).toBe(
      'No tier · Standard 6 ft (183 x 76 cm)',
    );
  });

  it('says a table in no section is, with its type', () => {
    const card = read(table('loose', null, null));
    expect(card.get('[data-testid="layout-table-read-title"]').text()).toBe('Table in no section');
    expect(card.get('[data-testid="layout-table-read-facts"]').text()).toBe(
      'Standard 6 ft (183 x 76 cm)',
    );
  });

  it('says how to read a table, on a phone and at a desk', () => {
    expect(read(null).get('[data-testid="layout-table-read-empty"]').text()).toBe(
      'Tap a table to read it.',
    );
    expect(read(null, false).get('[data-testid="layout-table-read-empty"]').text()).toBe(
      'Press a table, or move to it with the arrow keys, to read it.',
    );
  });
});
