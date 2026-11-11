/**
 * The layout by keyboard (T257 ticket 06), its pure parts: where a table added by Enter goes, the
 * view following a table the keys are on, the table the focus falls to when its own is removed,
 * and the sentences the live region says of each change.
 */
import { describe, expect, it } from 'vitest';
import type { FloorplanTable, SectionObject } from '@/assets/types/datatypes';
import {
  AT_THE_EDGE,
  saidAdded,
  saidDropped,
  saidMoved,
  saidPickedUp,
  saidPutBack,
  saidRemoved,
  saidTurned,
  saidArranged,
  saidSectioned,
  saidRetyped,
  useAnnouncements,
} from '@/components/layout/layoutAnnouncements';
import { layoutSections } from '@/components/layout/layoutDrawing';
import {
  DUPLICATE_GAP_MM,
  cameraShowing,
  clearPlace,
  nearestTo,
  tableCorners,
} from '@/components/layout/layoutGeometry';

const SIX_FOOT = { widthMm: 1830, depthMm: 760 };
const HALL = { widthMm: 30_000, heightMm: 22_500 };
const shapeAt = (xMm: number, yMm: number, rotation = 0) =>
  tableCorners({ xMm, yMm, rotation }, SIX_FOOT);

describe('a table added by Enter', () => {
  it("goes to the middle of the view where nothing stands, held inside the floorplan's edge", () => {
    expect(clearPlace({ xMm: 9000, yMm: 7000 }, SIX_FOOT, [], HALL)).toEqual({
      xMm: 9000,
      yMm: 7000,
    });
    expect(clearPlace({ xMm: -500, yMm: 40_000 }, SIX_FOOT, [], HALL)).toEqual({
      xMm: 0,
      yMm: 22_500,
    });
  });

  it('goes beside what stands there: under it, then on to the right', () => {
    const down = SIX_FOOT.depthMm + DUPLICATE_GAP_MM;
    const first = shapeAt(9000, 7000);
    expect(clearPlace({ xMm: 9000, yMm: 7000 }, SIX_FOOT, [first], HALL)).toEqual({
      xMm: 9000,
      yMm: 7000 + down,
    });
    const second = shapeAt(9000, 7000 + down);
    expect(clearPlace({ xMm: 9000, yMm: 7000 }, SIX_FOOT, [first, second], HALL)).toEqual({
      xMm: 9000 + SIX_FOOT.widthMm + DUPLICATE_GAP_MM,
      yMm: 7000,
    });
  });

  it('stands clear of a turned table whose box, but not whose shape, it would touch', () => {
    // A table turned 45° beside the middle: its box reaches the new table's, its shape does not.
    const turned = shapeAt(10_800, 8200, 45);
    expect(clearPlace({ xMm: 9000, yMm: 7000 }, SIX_FOOT, [turned], HALL)).toEqual({
      xMm: 9000,
      yMm: 7000,
    });
  });
});

describe('the view following the keys', () => {
  // A stage of 1,000 by 600 px at 1 px to 20 mm shows 20 m by 12 m about (10 m, 6 m).
  const camera = { xMm: 10_000, yMm: 6000, pxPerMm: 0.05 };
  const box = (left: number, top: number) => ({
    left,
    top,
    right: left + 1830,
    bottom: top + 760,
  });

  it('holds still for a table in view', () => {
    expect(cameraShowing(camera, 1000, 600, box(5000, 5000), 24)).toBe(camera);
  });

  it('moves the least that shows a table past an edge, with room round it', () => {
    // Past the right edge at 20 m: the view moves right until the table's right edge is 24 px in.
    const right = cameraShowing(camera, 1000, 600, box(21_000, 5000), 24);
    expect(right.xMm).toBeCloseTo(21_000 + 1830 + 24 / 0.05 - 10_000);
    expect(right.yMm).toBe(6000);
    expect(right.pxPerMm).toBe(0.05);
    // Past the top edge at 0: up, the same way.
    const up = cameraShowing(camera, 1000, 600, box(5000, -2000), 24);
    expect(up.xMm).toBe(10_000);
    expect(up.yMm).toBeCloseTo(-2000 - 24 / 0.05 + 6000);
  });

  it('shows the top-left corner of what is larger than the stage', () => {
    const large = { left: -5000, top: -5000, right: 40_000, bottom: 40_000 };
    const shown = cameraShowing(camera, 1000, 600, large);
    expect(shown.xMm).toBe(5000);
    expect(shown.yMm).toBe(1000);
  });

  it('holds still from one key to the next over what is longer than the stage', () => {
    // 20.5 m long in a view of 20 m: its left end is shown, and shown again, never its right.
    const long = { left: 1000, top: 5000, right: 21_500, bottom: 5760 };
    const first = cameraShowing(camera, 1000, 600, long, 24);
    expect(first.xMm).toBeCloseTo(1000 - 24 / 0.05 + 10_000);
    expect(cameraShowing(first, 1000, 600, long, 24)).toBe(first);
  });
});

describe('the table the focus falls to', () => {
  const at = (id: string, xMm: number, yMm: number) => ({ id, xMm, yMm });

  it('is the nearest to where the removed one stood, the earlier of two as near', () => {
    const left = [at('a', 0, 0), at('b', 4000, 0), at('c', 2000, 3000)];
    expect(nearestTo({ xMm: 3500, yMm: 500 }, left)?.id).toBe('b');
    expect(nearestTo({ xMm: 2000, yMm: 0 }, left)?.id).toBe('a');
  });

  it('is none when no table is left', () => {
    expect(nearestTo({ xMm: 0, yMm: 0 }, [])).toBeNull();
  });
});

describe('what the live region says', () => {
  const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
  const SECTIONS: SectionObject[] = [
    { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: null, count: 0 },
  ];
  const table = (
    id: string,
    sectionId: string | null,
    number: number | null,
    xMm = 12_440,
    yMm = 6060,
    rotation = 0,
  ): FloorplanTable => ({ id, sectionId, number, tableTypeId: 'type-6ft', xMm, yMm, rotation });
  const five = table('g5', 'sec-gold', 5);
  const six = table('g6', 'sec-gold', 6, 14_300);
  const loose = table('loose', null, null, 3000, 2000);
  const sections = layoutSections(
    { locationId: UPPER.id, tables: [five, six, loose], sectionStyles: [] },
    SECTIONS,
  );

  it("says what the selection's card did to the tables it lined up, put in a section or retyped", () => {
    expect(saidArranged([five, six], 'left')).toBe('Aligned 2 tables left');
    expect(saidArranged([five, six], 'middle')).toBe('Aligned 2 tables middle');
    expect(saidArranged([five, six, loose], 'across')).toBe('Spaced 3 tables evenly across');
    expect(saidArranged([five, six, loose], 'down')).toBe('Spaced 3 tables evenly down');
    expect(saidSectioned([five], 'Silver aisle', sections)).toBe('Put Gold row 5 in Silver aisle');
    expect(saidSectioned([five, loose], null, sections)).toBe('Put 2 tables in no section');
    expect(saidRetyped([loose], 'Square 4 ft', sections)).toBe(
      'Made a table in no section Square 4 ft',
    );
    expect(saidRetyped([five, six], 'Square 4 ft', sections)).toBe('Made 2 tables Square 4 ft');
  });

  it('names one table by its code and its place in metres to one decimal', () => {
    expect(saidMoved([five], five, sections)).toBe('Gold row 5 moved to 12.4 m, 6.1 m');
    expect(saidDropped([five], five, sections)).toBe('Gold row 5 dropped at 12.4 m, 6.1 m');
    expect(saidPutBack([five], five, sections)).toBe('Gold row 5 put back at 12.4 m, 6.1 m');
    expect(saidTurned([{ ...five, rotation: 90 }], 90, sections)).toBe('Gold row 5 turned to 90°');
    expect(saidTurned([{ ...five, rotation: 22.5 }], 15, sections)).toBe(
      'Gold row 5 turned to 22.5°',
    );
    expect(saidAdded([five], sections)).toBe('Added Gold row 5');
    expect(saidRemoved([five], sections)).toBe('Removed Gold row 5');
    expect(saidPickedUp([five], sections)).toBe(
      'Gold row 5 picked up: the arrow keys move it, R turns it, Enter drops it, Escape puts it back',
    );
  });

  it('counts several, and says where the one the keys are on stands', () => {
    expect(saidMoved([five, six], six, sections)).toBe(
      '2 tables moved, Gold row 6 to 14.3 m, 6.1 m',
    );
    expect(saidDropped([five, six], five, sections)).toBe(
      '2 tables dropped, Gold row 5 at 12.4 m, 6.1 m',
    );
    expect(saidTurned([five, six], 90, sections)).toBe('2 tables turned by 90°');
    // The handle turns either way: past a half turn is the short way round, said so.
    expect(saidTurned([five, six], 345, sections)).toBe('2 tables turned by 15° anticlockwise');
    expect(saidAdded([five, six], sections)).toBe('Added 2 tables');
    expect(saidRemoved([five, six, loose], sections)).toBe('Removed 3 tables');
    expect(saidPickedUp([five, six], sections)).toBe(
      '2 tables picked up: the arrow keys move them, R turns them, Enter drops them, Escape puts them back',
    );
  });

  it('names a table in no section as one', () => {
    expect(saidMoved([loose], loose, sections)).toBe('Table in no section moved to 3.0 m, 2.0 m');
    expect(saidAdded([loose], sections)).toBe('Added a table in no section');
    expect(saidRemoved([loose], sections)).toBe('Removed a table in no section');
    expect(saidMoved([five, loose], loose, sections)).toBe(
      '2 tables moved, Table in no section to 3.0 m, 2.0 m',
    );
  });

  it('tells the same words said twice running apart, so they are read again', () => {
    const { said, say } = useAnnouncements();
    say(AT_THE_EDGE);
    expect(said.value).toBe(AT_THE_EDGE);
    say(AT_THE_EDGE);
    expect(said.value).not.toBe(AT_THE_EDGE);
    expect(said.value.trim()).toBe(AT_THE_EDGE);
    say(AT_THE_EDGE);
    expect(said.value).toBe(AT_THE_EDGE);
  });
});
