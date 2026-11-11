/**
 * The Row of tables tool's model (T257 ticket 07): the path being drawn is never in the layout,
 * the row shown is the row placed, and a placed row is ordinary tables, numbered on in the order
 * drawn, selected, and one step of undo. With the sentences the live region says of it, and the
 * quick straight row that goes on from a table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FloorplanObject, FloorplanTable, SectionObject } from '@/assets/types/datatypes';
import LayoutPanelSelection from '@/components/layout/LayoutPanelSelection.vue';
import {
  ROW_DROPPED,
  saidCrosshair,
  saidPoint,
  saidPointTaken,
  saidRowAdded,
  saidSide,
} from '@/components/layout/layoutAnnouncements';
import { layoutSections } from '@/components/layout/layoutDrawing';
import { separation, tableCorners } from '@/components/layout/layoutGeometry';
import {
  MAX_LAYOUT_TABLES,
  ROW_CHOICES_AT_FIRST,
  gapMmOf,
  rowChoices,
  rowOnFrom,
  standingShapes,
  strokeOptions,
  useRowTool,
} from '@/components/layout/layoutRow';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };
const SQUARE = { id: 'square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 };
const TYPES = [SIX_FOOT, SQUARE];
const p = (xMm: number, yMm: number) => ({ xMm, yMm });
/** How a drag is read at 100% zoom, 25 mm to the pixel, with Shift up. */
const STROKE = strokeOptions(0.04, false);

function table(id: string, sectionId: string | null, number: number | null, x = 5000, y = 5000) {
  return { id, sectionId, number, tableTypeId: 'six-foot', xMm: x, yMm: y, rotation: 0 };
}

/** A hall 30 m by 22.5 m. */
function aLayout(tables: FloorplanTable[], zones: FloorplanObject['zones'] = []): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables,
    zones,
    sectionStyles: [],
    startingCounts: [],
  };
}

function aTool(tables: FloorplanTable[] = [], zones: FloorplanObject['zones'] = []) {
  const sent: FloorplanObject[] = [];
  const save = vi.fn((layout: FloorplanObject): Promise<SavedLayout> => {
    sent.push(layout);
    return Promise.resolve({
      floorplan: { ...layout, revision: layout.revision + 1 },
      sections: [],
    });
  });
  let id = 0;
  const editor = useLayoutEditor({
    save,
    tableTypes: () => TYPES,
    newId: () => `new-${(id += 1)}`,
  });
  editor.adopt(aLayout(tables, zones));
  const chosen = { sectionId: 'gold' as string | null, tableTypeId: 'six-foot' };
  const row = useRowTool({
    editor,
    tableTypes: () => TYPES,
    sectionId: () => chosen.sectionId,
    tableTypeId: () => chosen.tableTypeId,
  });
  return { editor, row, sent, chosen, tables: () => editor.layout.value!.tables };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(rowChoices, ROW_CHOICES_AT_FIRST);
});
afterEach(() => vi.useRealTimers());

describe('a path being drawn', () => {
  it('is no path until it has two places, and then shows the row it would place', () => {
    const { row } = aTool();
    expect(row.pending.value).toBe(false);
    row.addPoint(p(2000, 3000));
    expect(row.pending.value).toBe(true);
    expect(row.poses.value).toEqual([]);
    row.addPoint(p(22_000, 3000));
    expect(row.poses.value).toHaveLength(10);
    expect(row.countAt.value).toEqual(p(22_000, 3000));
  });

  it('follows the pointer past the last point, and the points alone once it has left', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.hoverAt(p(7600, 3000));
    expect(row.poses.value).toHaveLength(3);
    expect(row.countAt.value).toEqual(p(7600, 3000));
    row.hoverAt(null);
    expect(row.poses.value).toEqual([]);
  });

  it('shows a straight stroke from its press to where it is', () => {
    const { row } = aTool();
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.pending.value).toBe(true);
    expect(row.poses.value).toHaveLength(10);
    row.strokeTo(null);
    expect(row.pending.value).toBe(false);
  });

  it('holds the gap typed, in centimetres', () => {
    const { row } = aTool();
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    rowChoices.gapCm = '30';
    expect(row.poses.value).toHaveLength(9);
    expect(row.poses.value[1].xMm - row.poses.value[0].xMm).toBeCloseTo(2130, 3);
  });

  it('reads a gap that is no length as none', () => {
    expect(gapMmOf('30')).toBe(300);
    expect(gapMmOf('2,5')).toBe(25);
    expect(gapMmOf('')).toBe(0);
    expect(gapMmOf('-4')).toBe(0);
    expect(gapMmOf('wide')).toBe(0);
  });

  it('stands its tables on the right of the line drawn, the left once flipped, or on it', () => {
    const { row } = aTool();
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.poses.value[0].yMm).toBeCloseTo(3380, 6);
    row.flip();
    expect(row.side.value).toBe('left');
    expect(row.poses.value[0].yMm).toBeCloseTo(2620, 6);
    rowChoices.centred = true;
    expect(row.side.value).toBe('centre');
    expect(row.poses.value[0].yMm).toBeCloseTo(3000, 6);
  });

  it('takes the size of the type chosen', () => {
    const { row, chosen } = aTool();
    chosen.tableTypeId = 'square';
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.size.value).toMatchObject({ widthMm: 1220, depthMm: 1220 });
    expect(row.poses.value).toHaveLength(16);
  });

  it('leaves the tables and the no-table zones that stand clear', () => {
    const standing = table('a', 'gold', 1, 8000, 3380);
    const stage = { id: 'z', label: 'Stage', xMm: 14_000, yMm: 2000, widthMm: 2000, depthMm: 3000 };
    const { row, editor } = aTool([standing], [stage]);
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    const shapes = standingShapes(editor.layout.value!, () => SIX_FOOT);
    expect(row.poses.value.length).toBeGreaterThan(0);
    for (const pose of row.poses.value) {
      for (const shape of shapes) {
        expect(separation(tableCorners(pose, SIX_FOOT), shape)).toBeGreaterThanOrEqual(-0.011);
      }
    }
    expect(row.poses.value).toHaveLength(7);
  });

  it('leaves out what would stand outside the floorplan', () => {
    const { row } = aTool();
    row.strokeTo([p(20_000, 3000), p(40_000, 3000)], STROKE);
    expect(row.poses.value).toHaveLength(5);
  });

  it('never shows more tables than the layout may still hold', () => {
    const full = Array.from({ length: MAX_LAYOUT_TABLES - 2 }, (_, i) =>
      table(`t${i}`, null, null, 100 + (i % 100) * 10, 20_000),
    );
    const { row } = aTool(full);
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.poses.value).toHaveLength(2);
  });

  it('takes its last point back, moves a point, and finds the point under a press', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.addPoint(p(8000, 3000));
    expect(row.pointNear(p(8100, 3050), 300)).toBe(1);
    expect(row.pointNear(p(9000, 3000), 300)).toBeNull();
    row.movePoint(1, p(22_000, 3000));
    expect(row.poses.value).toHaveLength(10);
    expect(row.takePoint()).toBe(true);
    expect(row.points.value).toEqual([p(2000, 3000)]);
    expect(row.takePoint()).toBe(true);
    expect(row.takePoint()).toBe(false);
  });

  it('snaps a point to the corner of a table near it', () => {
    const { row } = aTool([table('a', 'gold', 1, 5000, 5000)]);
    expect(row.snapped(p(5930, 5400), 100)).toEqual(p(5915, 5380));
    expect(row.snapped(p(9000, 9000), 100)).toEqual(p(9000, 9000));
  });

  it('is the points laid once the keys have it, wherever the pointer was left', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.hoverAt(p(22_000, 3000));
    row.moveCrosshair(p(4000, 4000));
    expect(row.crosshair.value).toEqual(p(4000, 4000));
    expect(row.poses.value).toEqual([]);
  });

  it('is never in the layout: dropped, nothing was changed, saved or made a step of undo', async () => {
    const { row, editor, sent } = aTool([table('a', 'gold', 1)]);
    const before = editor.layout.value;
    row.addPoint(p(2000, 3000));
    row.addPoint(p(22_000, 3000));
    await vi.advanceTimersByTimeAsync(2000);
    expect(row.drop()).toBe(true);
    expect(row.drop()).toBe(false);
    expect(row.pending.value).toBe(false);
    expect(editor.layout.value).toBe(before);
    expect(editor.canUndo.value).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('a row placed', () => {
  it('adds the row shown, numbered on in its section in the order drawn, and selects it', () => {
    const { row, editor, tables } = aTool([table('a', 'gold', 1), table('b', 'gold', 2, 9000)]);
    row.strokeTo([p(22_000, 3000), p(2000, 3000)], STROKE);
    const shown = row.poses.value;
    const added = row.place();
    expect(added).toHaveLength(10);
    expect(added.map((one) => one.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Drawn from the right: the first of the row is the furthest right.
    expect(added[0].xMm).toBeGreaterThan(added[9].xMm);
    added.forEach((one, index) => {
      expect(one).toMatchObject({ sectionId: 'gold', tableTypeId: 'six-foot' });
      expect(one.xMm).toBeCloseTo(shown[index].xMm, 2);
      expect(one.yMm).toBeCloseTo(shown[index].yMm, 2);
    });
    expect(editor.selection.value).toEqual(added.map((one) => one.id));
    expect(tables()).toHaveLength(12);
    expect(row.pending.value).toBe(false);
  });

  it('is one step of undo and one save', async () => {
    const { row, editor, sent, tables } = aTool([table('a', 'gold', 1)]);
    row.addPoint(p(2000, 3000));
    row.addPoint(p(22_000, 3000));
    row.place();
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toHaveLength(1);
    expect(sent[0].tables).toHaveLength(11);
    editor.undo();
    expect(tables().map((one) => one.id)).toEqual(['a']);
    expect(editor.canUndo.value).toBe(false);
    expect(editor.selection.value).toEqual([]);
  });

  it('keeps tables that touch along a curve from overlapping as they are kept', () => {
    const { row } = aTool();
    const onArc = (degrees: number) => {
      const turn = (degrees * Math.PI) / 180;
      return p(8000 + 5000 * Math.cos(turn), 8000 + 5000 * Math.sin(turn));
    };
    [0, 45, 90].forEach((degrees) => row.addPoint(onArc(degrees)));
    const added = row.place();
    expect(added.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < added.length; i += 1) {
      for (let j = i + 1; j < added.length; j += 1) {
        const apart = separation(
          tableCorners(added[i], SIX_FOOT),
          tableCorners(added[j], SIX_FOOT),
        );
        expect(apart).toBeGreaterThanOrEqual(-0.05);
      }
    }
  });

  it('puts tables of no section in none, numberless', () => {
    const { row, chosen } = aTool();
    chosen.sectionId = null;
    row.strokeTo([p(2000, 3000), p(8000, 3000)], STROKE);
    expect(row.place().map((one) => [one.sectionId, one.number])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it('adds nothing where no table fits, and the path is gone', () => {
    const { row, editor } = aTool();
    row.strokeTo([p(2000, 3000), p(3000, 3000)], STROKE);
    expect(row.place()).toEqual([]);
    expect(row.pending.value).toBe(false);
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('the quick row that goes on from a table', () => {
  const from = { xMm: 5000, yMm: 5000, rotation: 0 };
  const hall = { widthMm: 30_000, heightMm: 22_500 };

  it('lays as many tables as asked along the line the table is turned to, touching', () => {
    const poses = rowOnFrom(from, SIX_FOOT, 3, { gapMm: 0, obstacles: [], hall });
    expect(poses.map((pose) => [pose.xMm, pose.yMm, pose.rotation])).toEqual([
      [6830, 5000, 0],
      [8660, 5000, 0],
      [10_490, 5000, 0],
    ]);
  });

  it('holds the gap from the table and between its own', () => {
    const poses = rowOnFrom(from, SIX_FOOT, 2, { gapMm: 300, obstacles: [], hall });
    expect(poses.map((pose) => pose.xMm)).toEqual([7130, 9260]);
  });

  it('goes the way a turned table points', () => {
    const [first] = rowOnFrom({ ...from, rotation: 90 }, SIX_FOOT, 1, {
      gapMm: 0,
      obstacles: [],
      hall,
    });
    expect(first.xMm).toBeCloseTo(5000, 6);
    expect(first.yMm).toBeCloseTo(6830, 6);
    expect(first.rotation).toBeCloseTo(90, 6);
  });

  it('goes from its other end where the end it is turned to is taken and the other is free', () => {
    // The last table of a row that runs to its right: the free place is to its left.
    const next = tableCorners({ ...from, xMm: 6830 }, SIX_FOOT);
    const poses = rowOnFrom(from, SIX_FOOT, 2, {
      gapMm: 0,
      obstacles: [tableCorners(from, SIX_FOOT), next],
      hall,
    });
    expect(poses.map((pose) => Math.round(pose.xMm))).toEqual([3170, 1340]);
  });

  it('goes on past what stands in the way, and stops at the floorplan', () => {
    const standing = [tableCorners(from, SIX_FOOT), tableCorners({ ...from, xMm: 8660 }, SIX_FOOT)];
    const poses = rowOnFrom(from, SIX_FOOT, 3, { gapMm: 0, obstacles: standing, hall });
    expect(poses.map((pose) => Math.round(pose.xMm))).toEqual([6830, 10_490, 12_320]);
    const far = rowOnFrom({ ...from, xMm: 27_000 }, SIX_FOOT, 5, { gapMm: 0, obstacles: [], hall });
    expect(far).toHaveLength(1);
  });
});

describe('what the live region says of a row', () => {
  const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
  const SECTIONS: SectionObject[] = [
    { id: 'gold', name: 'Gold row', location: UPPER, tier: null, count: 0 },
  ];
  const row = [10, 11, 12].map((number) => table(`g${number}`, 'gold', number));
  const loose = [table('l1', null, null), table('l2', null, null)];
  const sections = layoutSections(
    { locationId: UPPER.id, tables: [...row, ...loose], sectionStyles: [] },
    SECTIONS,
  );

  it('names a placed row by its first and last numbers', () => {
    expect(saidRowAdded(row, sections)).toBe('Added Gold row 10 to 12.');
    expect(saidRowAdded(row.slice(0, 1), sections)).toBe('Added Gold row 10.');
    expect(saidRowAdded(loose, sections)).toBe('Added 2 tables in no section.');
  });

  it('says each point with its place and what the path holds', () => {
    expect(saidPoint(3, p(12_440, 6060), 14)).toBe('Point 3 at 12.4 m, 6.1 m. 14 tables.');
    expect(saidPoint(2, p(12_440, 6060), 1)).toBe('Point 2 at 12.4 m, 6.1 m. 1 table.');
    expect(saidPoint(1, p(2000, 3000), 0)).toBe('Point 1 at 2.0 m, 3.0 m. No tables yet.');
  });

  it('says a point taken back, the crosshair, the side and a dropped path', () => {
    expect(saidPointTaken(3, 9)).toBe('Point 3 taken back. 9 tables.');
    expect(saidPointTaken(1, 0)).toBe('Point 1 taken back. No points left.');
    expect(saidCrosshair(p(12_440, 6060))).toBe('Crosshair at 12.4 m, 6.1 m');
    expect(saidSide('left', 12)).toBe('Tables on the left of the line. 12 tables.');
    expect(saidSide('right', null)).toBe('Tables on the right of the line.');
    expect(ROW_DROPPED).toBe('Row dropped. No table was added.');
  });
});

describe('"Row of N…" in the selection card', () => {
  const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
  const SECTIONS: SectionObject[] = [
    { id: 'gold', name: 'Gold row', location: UPPER, tier: null, count: 0 },
  ];
  const one = table('g1', 'gold', 1);
  const two = table('g2', 'gold', 2, 9000);
  const card = (tables: FloorplanTable[]) =>
    mount(LayoutPanelSelection, {
      props: {
        tables,
        sections: layoutSections({ ...aLayout([one, two]), locationId: UPPER.id }, SECTIONS),
        tableTypes: TYPES,
      },
    });
  const get = (wrapper: ReturnType<typeof card>, id: string) =>
    wrapper.get(`[data-testid="${id}"]`);

  it('is offered for one table, folded away until asked for', async () => {
    const wrapper = card([one]);
    const button = get(wrapper, 'layout-selection-row');
    expect(button.text()).toBe('Row of N…');
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(get(wrapper, 'layout-selection-row-form').attributes('style')).toContain(
      'display: none',
    );
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('true');
    expect(get(wrapper, 'layout-selection-row-form').attributes('style') ?? '').not.toContain(
      'display: none',
    );
    expect(button.attributes('aria-controls')).toBe(
      get(wrapper, 'layout-selection-row-form').attributes('id'),
    );
  });

  it('asks for the count typed, by its button or by Enter in its field', async () => {
    const wrapper = card([one]);
    await get(wrapper, 'layout-selection-row').trigger('click');
    await get(wrapper, 'layout-selection-row-count').setValue('8');
    await get(wrapper, 'layout-selection-row-form').trigger('submit');
    expect(wrapper.emitted('row')).toEqual([[8]]);
  });

  it('offers no row of a count that is no whole number from 1 to 100', async () => {
    const wrapper = card([one]);
    await get(wrapper, 'layout-selection-row').trigger('click');
    for (const typed of ['0', '2.5', 'many', '', '101']) {
      await get(wrapper, 'layout-selection-row-count').setValue(typed);
      expect(get(wrapper, 'layout-selection-row-add').attributes('disabled')).toBeDefined();
      await get(wrapper, 'layout-selection-row-form').trigger('submit');
    }
    expect(wrapper.emitted('row')).toBeUndefined();
  });

  it('is not offered for several tables, and is folded away again when one is selected', async () => {
    const wrapper = card([one]);
    await get(wrapper, 'layout-selection-row').trigger('click');
    await wrapper.setProps({ tables: [one, two] });
    expect(wrapper.find('[data-testid="layout-selection-row"]').exists()).toBe(false);
    await wrapper.setProps({ tables: [two] });
    expect(get(wrapper, 'layout-selection-row').attributes('aria-expanded')).toBe('false');
  });
});

describe('a row placed beside a no-table zone (the first review)', () => {
  const zone = { id: 'z', label: 'Stage', xMm: 14_000, yMm: 10_000, widthMm: 2000, depthMm: 2000 };

  /** How many tables the row showed, each placed where it was shown. */
  function placedAsShown(lay: (row: ReturnType<typeof aTool>['row']) => void): number {
    const { row, tables } = aTool([], [zone]);
    lay(row);
    const shown = row.poses.value.map((pose) => ({ ...pose }));
    if (!shown.length) return 0;
    row.place();
    const placed = tables();
    expect(placed).toHaveLength(shown.length);
    placed.forEach((table, i) => {
      expect(Math.abs(table.xMm - shown[i].xMm)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(table.yMm - shown[i].yMm)).toBeLessThanOrEqual(0.01);
    });
    return shown.length;
  }

  it('is placed where it was shown when its line crosses the zone', () => {
    const shown = placedAsShown((row) => {
      row.addPoint(p(2000, 11_000));
      row.addPoint(p(28_000, 11_000));
    });
    expect(shown).toBeGreaterThan(0);
  });

  it('is placed where it was shown as a ring that runs close round the zone', () => {
    let rings = 0;
    for (const side of ['left', 'right'] as const) {
      for (const radius of [1600, 1800, 2000, 2200, 2500, 3000]) {
        rowChoices.side = side;
        rings += placedAsShown((row) => {
          for (let i = 0; i < 8; i += 1) {
            const turn = (i * Math.PI) / 4;
            row.addPoint(p(15_000 + radius * Math.cos(turn), 11_000 + radius * Math.sin(turn)));
          }
          row.close();
        })
          ? 1
          : 0;
      }
    }
    expect(rings).toBeGreaterThan(6);
  });
});
