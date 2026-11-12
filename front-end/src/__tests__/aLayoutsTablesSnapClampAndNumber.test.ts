/**
 * The editor's geometry (T257 ticket 04): hit tests, every snap axis, the clamp that keeps a
 * table's centre inside the floorplan, turning, numbering and the view's pan and zoom.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM_PX_PER_MM,
  MIN_ZOOM_PX_PER_MM,
  PX_PER_MM_AT_100,
  angleFrom,
  clampMove,
  clampToHall,
  closeGaps,
  fitCamera,
  nextNumber,
  roundMm,
  shiftInside,
  roundTurn,
  snapAngle,
  snapMove,
  steppedZoom,
  tableBounds,
  tableHit,
  turnedAbout,
  zoomedAbout,
  type Bounds,
} from '@/components/layout/layoutGeometry';

const SIX_FOOT = { widthMm: 1830, depthMm: 760 };
const HALL = { widthMm: 30_000, heightMm: 22_500 };

function box(left: number, top: number, width = 1830, depth = 760): Bounds {
  return { left, top, right: left + width, bottom: top + depth };
}

describe('a press on a table', () => {
  it('hits a table inside its sides and misses outside them', () => {
    const table = { xMm: 5000, yMm: 3000, rotation: 0 };
    expect(tableHit({ xMm: 5900, yMm: 3300 }, table, SIX_FOOT)).toBe(true);
    expect(tableHit({ xMm: 5000, yMm: 3400 }, table, SIX_FOOT)).toBe(false);
  });

  it('follows the table as it is turned', () => {
    const table = { xMm: 5000, yMm: 3000, rotation: 90 };
    // Turned a quarter, the table is long down the page.
    expect(tableHit({ xMm: 5000, yMm: 3800 }, table, SIX_FOOT)).toBe(true);
    expect(tableHit({ xMm: 5800, yMm: 3000 }, table, SIX_FOOT)).toBe(false);
  });

  it('reads a table turned 30° by its own sides, not by its box', () => {
    const table = { xMm: 5000, yMm: 3000, rotation: 30 };
    const bounds = tableBounds(table, SIX_FOOT);
    // The box's corner is floor, not table.
    expect(tableHit({ xMm: bounds.left + 20, yMm: bounds.top + 20 }, table, SIX_FOOT)).toBe(false);
    expect(tableHit({ xMm: 5000, yMm: 3000 }, table, SIX_FOOT)).toBe(true);
  });
});

describe('a table dragged near another snaps', () => {
  const still = [box(10_000, 10_000)];

  it.each([
    ['its left edge to the other left edge', box(10_040, 12_000), 10_000],
    ['its left edge to the other right edge', box(11_800, 12_000), 11_830],
    ['its right edge to the other left edge', box(8200, 12_000), 8170],
    ['its right edge to the other right edge', box(9960, 12_000), 10_000],
  ])('across the page, %s', (_, moving, left) => {
    const snap = snapMove([moving], still, 100);
    expect(moving.left + snap.dxMm).toBeCloseTo(left);
    expect(snap.dyMm).toBe(0);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].x1Mm).toBe(snap.guides[0].x2Mm);
  });

  it('across the page, its centre to the other centre', () => {
    // A narrower box, so only the centres can meet within reach.
    const moving = box(10_500, 12_000, 800, 760);
    const snap = snapMove([moving], still, 30);
    expect(moving.left + snap.dxMm + 400).toBeCloseTo(10_915);
    expect(snap.guides[0].x1Mm).toBeCloseTo(10_915);
  });

  it.each([
    ['its top to the other top', box(13_000, 10_050), 10_000],
    ['its top to the other foot', box(13_000, 10_800), 10_760],
    ['its foot to the other top', box(13_000, 9200), 9240],
    ['its foot to the other foot', box(13_000, 9950), 10_000],
  ])('down the page, %s', (_, moving, top) => {
    const snap = snapMove([moving], still, 100);
    expect(moving.top + snap.dyMm).toBeCloseTo(top);
    expect(snap.dxMm).toBe(0);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0].y1Mm).toBe(snap.guides[0].y2Mm);
  });

  it('down the page, its centre to the other centre', () => {
    const moving = box(13_000, 10_200, 1830, 300);
    const snap = snapMove([moving], still, 30);
    expect(moving.top + snap.dyMm + 150).toBeCloseTo(10_380);
  });

  it('on both axes at once, each guide spanning the two tables where the snaps leave them', () => {
    const moving = box(11_850, 10_030);
    const snap = snapMove([moving], still, 100);
    expect(snap.dxMm).toBeCloseTo(-20);
    expect(snap.dyMm).toBeCloseTo(-30);
    const [down, across] = snap.guides;
    expect([down.y1Mm, down.y2Mm]).toEqual([10_000, 10_760]);
    expect([across.x1Mm, across.x2Mm]).toEqual([10_000, 13_660]);
  });

  it('takes the nearest line of several tables', () => {
    const snap = snapMove([box(10_040, 12_000)], [box(9960, 14_000), ...still], 100);
    expect(snap.dxMm).toBeCloseTo(-40);
  });

  it('leaves a table out of reach where it is, with no guide', () => {
    expect(snapMove([box(15_000, 15_000)], still, 100)).toEqual({ dxMm: 0, dyMm: 0, guides: [] });
  });

  it('snaps only to tables within reach on the other axis, not to one across the hall', () => {
    const far = [box(10_000, 25_000)];
    const moving = box(10_040, 12_000);
    // Lined up within 40 mm of a table 12 m down the hall: with a reach of 5 m it is left alone.
    expect(snapMove([moving], far, 100, 5000)).toEqual({ dxMm: 0, dyMm: 0, guides: [] });
    expect(snapMove([moving], far, 100).dxMm).toBeCloseTo(-40);
    // A table across a 3 m aisle is within reach.
    expect(snapMove([moving], [box(10_000, 15_760)], 100, 5000).dxMm).toBeCloseTo(-40);
  });

  it('snaps a group by whichever of its tables is nearest', () => {
    const snap = snapMove([box(2000, 2000), box(10_030, 12_000)], still, 100);
    expect(snap.dxMm).toBeCloseTo(-30);
  });
});

describe("a table's centre stays inside the floorplan", () => {
  it('holds a point at the nearest edge', () => {
    expect(clampToHall({ xMm: -50, yMm: 23_000 }, HALL)).toEqual({ xMm: 0, yMm: 22_500 });
    expect(clampToHall({ xMm: 500, yMm: 600 }, HALL)).toEqual({ xMm: 500, yMm: 600 });
  });

  it('leaves a point alone where the layout has no hall yet', () => {
    expect(clampToHall({ xMm: -50, yMm: 9 }, null)).toEqual({ xMm: -50, yMm: 9 });
  });

  it('stops a move where the first centre meets an edge, the tables keeping their places', () => {
    const centres = [
      { xMm: 1000, yMm: 1000 },
      { xMm: 29_000, yMm: 5000 },
    ];
    expect(clampMove(centres, { dxMm: 4000, dyMm: -3000 }, HALL)).toEqual({
      dxMm: 1000,
      dyMm: -1000,
    });
    expect(clampMove(centres, { dxMm: -4000, dyMm: 100 }, HALL)).toEqual({
      dxMm: -1000,
      dyMm: 100,
    });
  });

  it('finds the one shift that brings several centres back inside, together', () => {
    const centres = [
      { xMm: -2000, yMm: 3000 },
      { xMm: 2000, yMm: 23_000 },
    ];
    expect(shiftInside(centres, HALL)).toEqual({ dxMm: 2000, dyMm: -500 });
    expect(shiftInside([{ xMm: 5, yMm: 5 }], HALL)).toEqual({ dxMm: 0, dyMm: 0 });
    expect(shiftInside(centres, null)).toEqual({ dxMm: 0, dyMm: 0 });
  });

  it('never pushes a centre already outside further out, and lets it come back', () => {
    const outside = [{ xMm: 30_400, yMm: 100 }];
    expect(clampMove(outside, { dxMm: 500, dyMm: 0 }, HALL).dxMm).toBe(0);
    expect(clampMove(outside, { dxMm: -900, dyMm: 0 }, HALL).dxMm).toBe(-900);
  });
});

describe('turning', () => {
  it('turns a table about its own centre without moving it', () => {
    const table = { xMm: 5000, yMm: 3000, rotation: 350 };
    expect(turnedAbout(table, table, 15)).toEqual({ xMm: 5000, yMm: 3000, rotation: 5 });
  });

  it('carries a table round another centre, clockwise on the page', () => {
    const turned = turnedAbout({ xMm: 6000, yMm: 3000, rotation: 0 }, { xMm: 5000, yMm: 3000 }, 90);
    expect(turned).toEqual({ xMm: 5000, yMm: 4000, rotation: 90 });
  });

  it('holds an angle to 15° steps', () => {
    expect(snapAngle(22, 15)).toBe(15);
    expect(snapAngle(23, 15)).toBe(30);
    expect(snapAngle(-8, 15)).toBe(-15);
  });

  it('reads the angle of a point from a centre, clockwise from the right', () => {
    expect(angleFrom({ xMm: 0, yMm: 0 }, { xMm: 0, yMm: 10 })).toBeCloseTo(90);
    expect(angleFrom({ xMm: 0, yMm: 0 }, { xMm: -10, yMm: 0 })).toBeCloseTo(180);
  });

  it('keeps a length to a hundredth of a millimetre and a turn to a thousandth of a degree', () => {
    expect(roundMm(1234.5678)).toBe(1234.57);
    expect(roundTurn(-90)).toBe(270);
    expect(roundTurn(359.9996)).toBe(0);
    expect(roundTurn(44.9996)).toBe(45);
  });
});

describe('numbers', () => {
  const tables = [
    { id: 'a', sectionId: 'gold', number: 1 },
    { id: 'b', sectionId: 'gold', number: 2 },
    { id: 'c', sectionId: 'silver', number: 1 },
    { id: 'd', sectionId: null, number: null },
  ];

  it('gives a new table the next number of its section', () => {
    expect(nextNumber(tables, 'gold')).toBe(3);
    expect(nextNumber(tables, 'silver')).toBe(2);
    expect(nextNumber(tables, 'bronze')).toBe(1);
  });

  it('closes the gap a removed table left, in each section apart', () => {
    const left = [
      { id: 'a', sectionId: 'gold', number: 1 },
      { id: 'c', sectionId: 'gold', number: 3 },
      { id: 'd', sectionId: 'gold', number: 4 },
      { id: 'e', sectionId: 'silver', number: 2 },
      { id: 'f', sectionId: null, number: null },
    ];
    expect(closeGaps(left).map((table) => [table.id, table.number])).toEqual([
      ['a', 1],
      ['c', 2],
      ['d', 3],
      ['e', 1],
      ['f', null],
    ]);
  });

  it('leaves a table whose number stands as the same object', () => {
    const closed = closeGaps(tables);
    expect(closed.every((table, index) => table === tables[index])).toBe(true);
  });
});

describe("the editor's view", () => {
  it('fits a hall whole in the stage, about its middle', () => {
    const camera = fitCamera({ left: 0, top: 0, right: 30_000, bottom: 22_500 }, 900, 600);
    expect(camera).toEqual({ xMm: 15_000, yMm: 11_250, pxPerMm: 600 / 22_500 });
  });

  it('zooms about the pointer, which keeps the floor under it', () => {
    const camera = { xMm: 15_000, yMm: 11_250, pxPerMm: 0.04 };
    const at = { xPx: 200, yPx: -100 };
    const under = { xMm: camera.xMm + at.xPx / 0.04, yMm: camera.yMm + at.yPx / 0.04 };
    const zoomed = zoomedAbout(camera, 2, at);
    expect(zoomed.pxPerMm).toBeCloseTo(0.08);
    expect(zoomed.xMm + at.xPx / zoomed.pxPerMm).toBeCloseTo(under.xMm);
    expect(zoomed.yMm + at.yPx / zoomed.pxPerMm).toBeCloseTo(under.yMm);
  });

  it('never zooms past 10% or 800%', () => {
    const camera = { xMm: 0, yMm: 0, pxPerMm: 0.04 };
    expect(zoomedAbout(camera, 1000).pxPerMm).toBeCloseTo(MAX_ZOOM_PX_PER_MM);
    expect(zoomedAbout(camera, 0.0001).pxPerMm).toBeCloseTo(MIN_ZOOM_PX_PER_MM);
  });

  it('steps the zoom to the next round percentage', () => {
    const at = (percent: number) => (percent / 100) * PX_PER_MM_AT_100;
    expect(steppedZoom(at(69), 1)).toBeCloseTo(at(75));
    expect(steppedZoom(at(69), -1)).toBeCloseTo(at(50));
    expect(steppedZoom(at(100), 1)).toBeCloseTo(at(150));
    expect(steppedZoom(at(800), 1)).toBeCloseTo(at(800));
    expect(steppedZoom(at(10), -1)).toBeCloseTo(at(10));
  });
});
