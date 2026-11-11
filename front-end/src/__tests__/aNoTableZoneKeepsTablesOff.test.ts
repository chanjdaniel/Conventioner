/**
 * No-table zones (T257 ticket 10): a zone marked over a box of the hall, named and removed, each
 * one step of undo that saves; and a table put down on a zone, by a drag, a click or a drop, pushed
 * off it to the nearest clear place, as a snap takes it, while one carried by keyboard crosses a
 * zone freely until it is dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { FloorplanObject, FloorplanTable, FloorplanZone } from '@/assets/types/datatypes';
import LayoutPanelZones from '@/components/layout/LayoutPanelZones.vue';
import { saidZoneAdded, saidZoneRemoved } from '@/components/layout/layoutAnnouncements';
import {
  cornersOf,
  offZones,
  shapesOverlap,
  tableCorners,
  zoneBounds,
  type Bounds,
} from '@/components/layout/layoutGeometry';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { MAX_ZONES, useLayoutEditor } from '@/components/layout/useLayoutEditor';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };

/** A stage, 10 m by 4 m, from 20 m across and 10 m down. */
const STAGE: FloorplanZone = {
  id: 'zone-stage',
  label: 'Stage',
  xMm: 20_000,
  yMm: 10_000,
  widthMm: 10_000,
  depthMm: 4_000,
};

function table(id: string, xMm: number, yMm: number, rotation = 0): FloorplanTable {
  return { id, sectionId: 'gold', number: 1, tableTypeId: 'six-foot', xMm, yMm, rotation };
}

/** A hall 60 m by 45 m. */
function aLayout(tables: FloorplanTable[], zones: FloorplanZone[] = [STAGE]): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 60_000,
    tables,
    zones,
    sectionStyles: [],
    startingCounts: [],
  };
}

function anEditor(tables: FloorplanTable[], zones?: FloorplanZone[]) {
  let n = 0;
  const sent: FloorplanObject[] = [];
  let revision = 3;
  const editor = useLayoutEditor({
    save: (layout): Promise<SavedLayout> => {
      sent.push(layout);
      revision += 1;
      return Promise.resolve({ floorplan: { ...layout, revision }, sections: [] });
    },
    newId: () => `new-${(n += 1)}`,
    tableTypes: () => [SIX_FOOT],
    sectionIds: () => ['gold'],
  });
  editor.adopt(aLayout(tables, zones));
  const byId = (id: string) => editor.layout.value!.tables.find((one) => one.id === id)!;
  const zonesNow = () => editor.layout.value!.zones;
  return { editor, sent, byId, zonesNow };
}

const onTheStage = (t: FloorplanTable) =>
  shapesOverlap(tableCorners(t, SIX_FOOT), cornersOf(zoneBounds(STAGE)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle() {
  await vi.advanceTimersByTimeAsync(600);
}

// ── The push ─────────────────────────────────────────────────────────────────

describe('the way off the no-table zones', () => {
  const zones: Bounds[] = [zoneBounds(STAGE)];
  const shapeAt = (xMm: number, yMm: number, rotation = 0) =>
    tableCorners({ xMm, yMm, rotation }, SIX_FOOT);
  const hall = { widthMm: 60_000, heightMm: 45_000 };

  it('is no move for tables standing clear, or touching a zone', () => {
    expect(offZones([shapeAt(5000, 5000)], zones, hall)).toEqual({ dxMm: 0, dyMm: 0 });
    // Its bottom edge on the stage's top edge.
    expect(offZones([shapeAt(25_000, 10_000 - 380)], zones, hall)).toEqual({ dxMm: 0, dyMm: 0 });
  });

  it('is past the nearest edge of the zone', () => {
    // 0.5 m into the stage from its top: pushed up, just past the edge.
    const by = offZones([shapeAt(25_000, 10_500)], zones, hall);
    expect(by.dxMm).toBe(0);
    expect(by.dyMm).toBeCloseTo(-880, 0);
    // Near its left edge: pushed left.
    const left = offZones([shapeAt(20_200, 12_000)], zones, hall);
    expect(left.dyMm).toBe(0);
    expect(left.dxMm).toBeCloseTo(-(200 + 915), 0);
  });

  it('reads a turned table by its own corners', () => {
    // Turned a quarter, it is 76 cm wide and 183 cm deep: 0.5 m into the left edge needs 0.88 m.
    const by = offZones([shapeAt(20_000 + 500 - 380, 12_000, 90)], zones, hall);
    expect(by.dyMm).toBe(0);
    expect(by.dxMm).toBeCloseTo(-500, 0);
  });

  it('moves several tables together, by what frees the last of them', () => {
    const by = offZones([shapeAt(25_000, 10_500), shapeAt(25_000, 11_500)], zones, hall);
    expect(by.dxMm).toBe(0);
    expect(by.dyMm).toBeCloseTo(-1880, 0);
  });

  it('goes on past a zone the first way lands on', () => {
    // A pillar against the stage's top: up is through the pillar, so the nearest way is another.
    const pillar = { left: 24_000, top: 9_000, right: 26_000, bottom: 10_000 };
    const by = offZones([shapeAt(25_000, 10_300)], [zones[0], pillar], hall);
    const moved = shapeAt(25_000 + by.dxMm, 10_300 + by.dyMm);
    expect([zones[0], pillar].some((zone) => shapesOverlap(moved, cornersOf(zone)))).toBe(false);
    expect(Math.hypot(by.dxMm, by.dyMm)).toBeLessThan(2000);
  });

  it('never takes a centre out of the hall', () => {
    const wall = { left: 0, top: 0, right: 3000, bottom: 45_000 };
    const by = offZones([shapeAt(200, 5000)], [wall], hall);
    expect(by.dxMm).toBeCloseTo(3000 - 200 + 915, 0);
  });
});

// ── The model ────────────────────────────────────────────────────────────────

describe('a no-table zone in the model', () => {
  it('is marked over a box, held inside the hall, as one step that saves', async () => {
    const { editor, sent, zonesNow } = anEditor([], []);
    const id = editor.addZone({ left: -2000, top: 1000, right: 4000, bottom: 4000 }, ' Exit ');

    expect(id).toBe('new-1');
    expect(zonesNow()).toEqual([
      { id: 'new-1', label: 'Exit', xMm: 0, yMm: 1000, widthMm: 4000, depthMm: 3000 },
    ]);
    expect(editor.canUndo.value).toBe(true);
    await settle();
    expect(sent.at(-1)!.zones).toHaveLength(1);
  });

  it('is not marked over a box too small, or past the bound', () => {
    const { editor, zonesNow } = anEditor([], []);
    expect(editor.addZone({ left: 0, top: 0, right: 50, bottom: 3000 })).toBeNull();
    expect(zonesNow()).toEqual([]);

    const many = Array.from({ length: MAX_ZONES }, (_, n) => ({
      ...STAGE,
      id: `z-${n}`,
      widthMm: 100,
    }));
    const full = anEditor([], many);
    expect(full.editor.addZone({ left: 0, top: 0, right: 1000, bottom: 1000 })).toBeNull();
  });

  it('is named and removed, each one step of undo', () => {
    const { editor, zonesNow } = anEditor([]);
    editor.setZoneLabel('zone-stage', '  Main stage ');
    expect(zonesNow()[0].label).toBe('Main stage');

    editor.removeZone('zone-stage');
    expect(zonesNow()).toEqual([]);

    editor.undo();
    expect(zonesNow()[0].label).toBe('Main stage');
    editor.undo();
    expect(zonesNow()[0].label).toBe('Stage');
    editor.redo();
    editor.redo();
    expect(zonesNow()).toEqual([]);
  });

  it('naming a zone what it is named already is no change', () => {
    const { editor } = anEditor([]);
    editor.setZoneLabel('zone-stage', 'Stage ');
    expect(editor.canUndo.value).toBe(false);
  });

  it('keeps zones drawn while a save was out', async () => {
    let answer: (saved: SavedLayout) => void = () => {};
    const editor = useLayoutEditor({
      save: (layout) =>
        new Promise((resolve) => {
          answer = () => resolve({ floorplan: { ...layout, revision: 4 }, sections: [] });
        }),
      newId: () => 'zone-new',
    });
    editor.adopt(aLayout([], []));
    editor.addZone({ left: 0, top: 0, right: 2000, bottom: 2000 });
    await vi.advanceTimersByTimeAsync(600);
    editor.setZoneLabel('zone-new', 'Bar');
    answer({} as SavedLayout);
    await flushPromises();
    expect(editor.layout.value!.zones[0].label).toBe('Bar');
  });
});

describe('a table put down on a zone', () => {
  it('is pushed off it by a drag, frame by frame, as a snap', () => {
    const { editor, byId } = anEditor([table('a', 25_000, 5000)]);
    editor.begin();
    editor.moveTables(['a'], 0, 5500);
    expect(onTheStage(byId('a'))).toBe(false);
    expect(byId('a').yMm).toBeCloseTo(10_000 - 380, 0);
    editor.end();
    expect(byId('a').xMm).toBe(25_000);
  });

  it('is pushed off it when it is placed there', () => {
    const { editor, byId } = anEditor([]);
    const [id] = editor.addTables([
      { sectionId: 'gold', tableTypeId: 'six-foot', xMm: 21_000, yMm: 12_000 },
    ]);
    expect(onTheStage(byId(id))).toBe(false);
    expect(byId(id).xMm).toBeCloseTo(20_000 - 915, 0);
  });

  it('is pushed off it when a turn takes it there', () => {
    const { editor, byId } = anEditor([table('a', 25_000, 9_400)]);
    editor.turnTables(['a'], 90);
    expect(onTheStage(byId('a'))).toBe(false);
  });

  it('is carried across it by keyboard, and pushed off only where it is dropped', () => {
    const { editor, byId } = anEditor([table('a', 25_000, 9_000)]);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 0, 2000);
    expect(byId('a').yMm).toBe(11_000);
    expect(onTheStage(byId('a'))).toBe(true);

    expect(editor.drop()).toBe(true);
    expect(onTheStage(byId('a'))).toBe(false);
    expect(byId('a').yMm).toBeCloseTo(10_000 - 380, 0);
    editor.undo();
    expect(byId('a').yMm).toBe(9_000);
  });
});

// ── The card ─────────────────────────────────────────────────────────────────

describe('the No-table zones card', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('says how to draw one when there is none', () => {
    const wrapper = mount(LayoutPanelZones, { props: { zones: [] } });
    expect(wrapper.find('[data-testid="layout-panel-no-zones"]').exists()).toBe(true);
  });

  it("lists each zone's name in its field, with its size", () => {
    const wrapper = mount(LayoutPanelZones, { props: { zones: [STAGE] } });
    const field = wrapper.get<HTMLInputElement>('[data-testid="layout-zone-label"]');
    expect(field.element.value).toBe('Stage');
    expect(wrapper.get('label').text()).toContain('Name of zone 1');
    expect(wrapper.get('[data-testid="layout-zone-size"]').text()).toBe('10.0 m by 4.0 m');
    expect(wrapper.get('[data-testid="layout-zone-remove"]').attributes('aria-label')).toBe(
      'Remove Stage',
    );
  });

  it('names a zone when its field is left or Enter is pressed', async () => {
    const wrapper = mount(LayoutPanelZones, { props: { zones: [STAGE] } });
    const field = wrapper.get<HTMLInputElement>('[data-testid="layout-zone-label"]');
    field.element.value = 'Main stage';
    await field.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('label')).toEqual([['zone-stage', 'Main stage']]);
  });

  it('gives a zone just drawn the focus, and the next one when it is removed', async () => {
    const pillar = { ...STAGE, id: 'zone-pillar', label: '' };
    const wrapper = mount(LayoutPanelZones, {
      props: { zones: [STAGE, pillar] },
      attachTo: document.body,
    });
    await wrapper.vm.focusZone('zone-pillar');
    expect((document.activeElement as HTMLElement).dataset.zoneId).toBe('zone-pillar');
    expect(wrapper.findAll('[data-testid="layout-zone-remove"]')[1].attributes('aria-label')).toBe(
      'Remove Zone 2',
    );

    await wrapper.findAll('[data-testid="layout-zone-remove"]')[0].trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['zone-stage']]);
    expect((document.activeElement as HTMLElement).dataset.zoneId).toBe('zone-pillar');
    wrapper.unmount();
  });

  it('says what was drawn and removed', () => {
    expect(saidZoneAdded({ left: 0, top: 0, right: 4000, bottom: 3000 })).toBe(
      'Added a no-table zone 4.0 m by 3.0 m. Name it in the panel.',
    );
    expect(saidZoneRemoved('Stage')).toBe('Removed the no-table zone Stage');
    expect(saidZoneRemoved(' ')).toBe('Removed a no-table zone');
  });
});
