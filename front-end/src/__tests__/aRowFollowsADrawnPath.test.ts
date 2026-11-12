/**
 * A row of tables along a drawn path (T257): the smooth path through clicked points, a table's
 * pose beside it, and the march that places a row with no table over another. The numbers are a
 * 6 ft table's, 1830 by 760 mm, positions to 0.5 mm, angles to 0.01° and separations to 0.05 mm.
 * "The arc" is centred on (0, 0) with a radius of 5000, drawn from (5000, 0) through growing
 * angles, clockwise on the screen, so its right is its inside.
 */
import { describe, expect, it } from 'vitest';
import {
  chordEnd,
  measureRun,
  placeAlongRuns,
  roundMm,
  roundTurn,
  pointAtLength,
  poseOnPath,
  separation,
  smoothRuns,
  snapPoint,
  tableCorners,
  type PathPose,
  type PointMm,
  type RowSide,
  type Run,
} from '@/components/layout/layoutGeometry';

const TABLE = { widthMm: 1830, depthMm: 760 };
const p = (xMm: number, yMm: number): PointMm => ({ xMm, yMm });
const onArc = (degrees: number, radius = 5000): PointMm => {
  const turn = (degrees * Math.PI) / 180;
  return p(radius * Math.cos(turn), radius * Math.sin(turn));
};
const radiusOf = (point: PointMm) => Math.hypot(point.xMm, point.yMm);
const lengthOf = (runs: Run[]) => runs.reduce((sum, run) => sum + measureRun(run).length, 0);
const cornersAt = (pose: { xMm: number; yMm: number; rotation: number }) =>
  tableCorners(pose, TABLE);

/** An arc of a radius from (r, 0), clockwise on the screen, as one run with a point every 40 mm
 *  or so: the wall itself, where a test is not about the flattening. */
function arcOf(radius: number, sweep: number): Run {
  const count = Math.max(8, Math.ceil((sweep * radius) / 57.3 / 40));
  return Array.from({ length: count }, (_, i) => onArc((sweep * i) / (count - 1), radius));
}
const halfCircle = (radius: number) => arcOf(radius, 180);

const row = (runs: Run[], side: RowSide, gapMm = 0, more = {}) =>
  placeAlongRuns(runs, { ...TABLE, gapMm, side, ...more });

/** The least separation between any two tables of a row, and between each and the next. */
function separations(poses: PathPose[]) {
  const shapes = poses.map(cornersAt);
  let least = Infinity;
  const neighbours: number[] = [];
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const apart = separation(shapes[i], shapes[j]);
      least = Math.min(least, apart);
      if (j === i + 1) neighbours.push(apart);
    }
  }
  return { least, neighbours };
}

const boxOf = (runs: Run[]) => {
  const all = runs.flat();
  return {
    left: Math.min(...all.map((point) => point.xMm)),
    right: Math.max(...all.map((point) => point.xMm)),
    top: Math.min(...all.map((point) => point.yMm)),
    bottom: Math.max(...all.map((point) => point.yMm)),
  };
};

describe('the smooth path through clicked points', () => {
  it('is nothing of one point, and one straight run of two', () => {
    expect(smoothRuns([p(0, 0)])).toEqual([]);
    expect(smoothRuns([p(0, 0), p(8000, 0)])).toEqual([[p(0, 0), p(8000, 0)]]);
  });

  it('follows a circular wall exactly through three points', () => {
    const runs = smoothRuns([onArc(0), onArc(45), onArc(90)]);
    expect(runs).toHaveLength(1);
    for (const point of runs[0]) expect(Math.abs(radiusOf(point) - 5000)).toBeLessThan(0.01);
    expect(Math.abs(lengthOf(runs) - 7853.2)).toBeLessThan(1);
  });

  it('stays on the circle however unevenly it is clicked', () => {
    const runs = smoothRuns([onArc(0), onArc(10), onArc(55), onArc(90)]);
    expect(runs).toHaveLength(1);
    for (const point of runs[0]) expect(Math.abs(radiusOf(point) - 5000)).toBeLessThan(0.01);
  });

  it('keeps three points over 140° one arc, and makes a corner of three over a half circle', () => {
    expect(smoothRuns([onArc(0), onArc(70), onArc(140)])).toHaveLength(1);
    const half = smoothRuns([onArc(0), onArc(90), onArc(180)]);
    expect(half).toHaveLength(2);
    expect(half[0].at(-1)).toEqual(onArc(90));
    expect(half[1][0]).toEqual(onArc(90));
  });

  it('follows a half circle through four points', () => {
    const runs = smoothRuns([onArc(0), onArc(60), onArc(120), onArc(180)]);
    expect(runs).toHaveLength(1);
    for (const point of runs[0]) expect(Math.abs(radiusOf(point) - 5000)).toBeLessThan(0.01);
  });

  it('makes two straight runs of an L, with no bulge', () => {
    const runs = smoothRuns([p(0, 0), p(8000, 0), p(8000, 8000)]);
    expect(runs).toEqual([
      [p(0, 0), p(8000, 0)],
      [p(8000, 0), p(8000, 8000)],
    ]);
    expect(lengthOf(runs)).toBe(16000);
  });

  it('makes three straight runs of a U', () => {
    const runs = smoothRuns([p(0, 0), p(5000, 0), p(5000, 3000), p(0, 3000)]);
    expect(runs).toHaveLength(3);
    expect(boxOf(runs)).toEqual({ left: 0, right: 5000, top: 0, bottom: 3000 });
  });

  it('draws points all but in a line as a line, on no giant circle', () => {
    const runs = smoothRuns([p(0, 0), p(5000, 3), p(10000, 0)]);
    expect(runs).toHaveLength(1);
    expect(Math.abs(lengthOf(runs) - 10000)).toBeLessThan(0.1);
  });

  it('never balloons where the path doubles back', () => {
    const runs = smoothRuns([p(0, 0), p(6000, 0), p(1000, 500)]);
    expect(runs).toHaveLength(2);
    const box = boxOf(runs);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(6000);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(500);
  });

  it('leaves a straight wall along it where the wall goes into a curve', () => {
    const runs = smoothRuns([p(0, 0), p(5000, 0), p(10000, 0), p(13000, 3000)]);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    // The first stretch, between two points in a line with the third, is the wall itself.
    expect(run[1]).toEqual(p(5000, 0));
    // The next leaves (5000, 0) along the wall, with no kink there, and bends toward the turn.
    const leaving = run[2];
    const turn = (Math.atan2(leaving.yMm, leaving.xMm - 5000) * 180) / Math.PI;
    expect(Math.abs(turn)).toBeLessThan(2);
    const bow = Math.max(
      ...run.filter((point) => point.xMm <= 10000).map((point) => Math.abs(point.yMm)),
    );
    // It bows 320 mm off the wall before the turn, where the circle alone bowed 541.
    expect(bow).toBeLessThan(350);
  });

  it('turns straight back on a line as a corner', () => {
    expect(smoothRuns([p(0, 0), p(6000, 0), p(1000, 0)])).toHaveLength(2);
  });

  it('reads a point clicked twice as one', () => {
    expect(smoothRuns([p(0, 0), p(0, 0), p(8000, 0), p(8000, 0)])).toEqual([[p(0, 0), p(8000, 0)]]);
  });
});

describe('a place along a run', () => {
  const straight = measureRun([p(0, 0), p(10000, 0)]);
  const arc = measureRun(arcOf(5000, 90));

  it('is measured along the run, and held to its ends', () => {
    expect(straight.length).toBe(10000);
    expect(pointAtLength(straight, 2500)).toEqual(p(2500, 0));
    expect(pointAtLength(straight, -5)).toEqual(p(0, 0));
    expect(pointAtLength(straight, 20000)).toEqual(p(10000, 0));
  });

  it('finds where a chord of a length ends: further along a line by that length', () => {
    expect(chordEnd(straight, 1000, 1830)).toBeCloseTo(2830, 6);
  });

  it('finds it further along an arc than the chord is long', () => {
    const expected = 5000 * 2 * Math.asin(0.183);
    expect(Math.abs(chordEnd(arc, 0, 1830)! - expected)).toBeLessThan(0.5);
  });

  it('finds none past the end of the run', () => {
    expect(chordEnd(straight, straight.length - 1000, 1830)).toBeNull();
  });
});

describe('how far apart two tables stand', () => {
  const at = (x: number, y: number, rotation = 0) => cornersAt({ xMm: x, yMm: y, rotation });

  it('is nothing touching, the gap apart, and less than nothing overlapping', () => {
    expect(separation(at(0, 0), at(1830, 0))).toBeCloseTo(0, 9);
    expect(separation(at(0, 0), at(2130, 0))).toBeCloseTo(300, 9);
    expect(separation(at(0, 0), at(1730, 0))).toBeCloseTo(-100, 9);
  });

  it('is measured between the corners of tables apart both ways', () => {
    expect(separation(at(0, 0), at(2130, 1160))).toBeCloseTo(500, 6);
  });

  it('is less than nothing of a table against itself turned', () => {
    expect(separation(at(0, 0), at(0, 0, 45))).toBeLessThan(0);
  });
});

describe("a table's pose on a path", () => {
  const line = measureRun([p(1000, 1000), p(21000, 1000)]);
  const back = measureRun([p(21000, 1000), p(1000, 1000)]);
  const arc = measureRun(arcOf(5000, 90));
  const pose = (run: typeof line, side: RowSide) =>
    poseOnPath(run, 0, TABLE.widthMm, TABLE.depthMm, side)!;

  it('stands beside a straight line on the side asked, or centred on it', () => {
    expect(pose(line, 'right')).toMatchObject({ xMm: 1915, yMm: 1380, rotation: 0 });
    expect(pose(line, 'left')).toMatchObject({ xMm: 1915, yMm: 620, rotation: 0 });
    expect(pose(line, 'centre')).toMatchObject({ xMm: 1915, yMm: 1000, rotation: 0 });
  });

  it('is never turned upside down by a line drawn backward', () => {
    const drawn = pose(back, 'right');
    expect(drawn.xMm).toBeCloseTo(20085, 6);
    expect(drawn.yMm).toBeCloseTo(620, 6);
    expect(drawn.rotation).toBeCloseTo(0, 9);
  });

  it('says where along the run it begins and ends', () => {
    expect(pose(line, 'right')).toMatchObject({ startS: 0, endS: 1830 });
  });

  it('has its back corners on the line inside a bend', () => {
    const inside = pose(arc, 'right');
    expect(Math.abs(inside.xMm - 4458.97)).toBeLessThan(0.5);
    expect(Math.abs(inside.yMm - 830.01)).toBeLessThan(0.5);
    expect(Math.abs(inside.rotation - -79.455)).toBeLessThan(0.01);
    const furthest = cornersAt(inside)
      .map(radiusOf)
      .sort((a, b) => b - a);
    expect(Math.abs(furthest[0] - 5000)).toBeLessThan(0.05);
    expect(Math.abs(furthest[1] - 5000)).toBeLessThan(0.05);
  });

  it('touches the line with the middle of its back outside a bend, and never crosses it', () => {
    const outside = pose(arc, 'left');
    expect(Math.abs(outside.xMm - 5289.15)).toBeLessThan(0.5);
    expect(Math.abs(outside.yMm - 984.54)).toBeLessThan(0.5);
    expect(Math.abs(outside.rotation - -79.455)).toBeLessThan(0.01);
    const corners = cornersAt(outside);
    // The nearest any point of the table comes to the centre: along its edges, not only corners.
    let nearest = Infinity;
    for (let i = 0; i < 4; i += 1) {
      for (let t = 0; t <= 1; t += 0.01) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        nearest = Math.min(
          nearest,
          radiusOf(p(a.xMm + (b.xMm - a.xMm) * t, a.yMm + (b.yMm - a.yMm) * t)),
        );
      }
    }
    expect(nearest).toBeGreaterThan(5000 - 0.1);
  });

  it('is none where the table does not fit before the end of the run', () => {
    expect(poseOnPath(line, line.length - 1000, 1830, 760, 'right')).toBeNull();
  });
});

describe('a row placed along a path', () => {
  const straight: Run[] = [[p(0, 1000), p(20000, 1000)]];

  it('fills a straight 20 m with ten tables touching, or nine 300 mm apart', () => {
    const touching = row(straight, 'right');
    expect(touching).toHaveLength(10);
    touching.slice(1).forEach((pose, i) => {
      expect(pose.xMm - touching[i].xMm).toBeCloseTo(1830, 3);
      expect(pose.yMm).toBe(touching[0].yMm);
    });
    const apart = row(straight, 'right', 300);
    expect(apart).toHaveLength(9);
    apart.slice(1).forEach((pose, i) => expect(pose.xMm - apart[i].xMm).toBeCloseTo(2130, 3));
  });

  it.each([
    [2000, 2, 3],
    [3000, 4, 5],
    [5000, 7, 8],
    [10000, 15, 17],
    [20000, 33, 34],
  ])('lines a half circle of radius %i: %i inside, %i outside, none overlapping', (r, ins, out) => {
    for (const [side, count] of [
      ['right', ins],
      ['left', out],
    ] as const) {
      const poses = row([halfCircle(r)], side);
      expect(poses).toHaveLength(count);
      const { least, neighbours } = separations(poses);
      expect(least).toBeGreaterThanOrEqual(-0.05);
      for (const apart of neighbours) expect(apart).toBeLessThanOrEqual(0.05);
    }
  });

  it.each([2000, 5000, 10000])('holds a 300 mm gap round a half circle of radius %i', (r) => {
    for (const side of ['right', 'left'] as const) {
      const { neighbours } = separations(row([halfCircle(r)], side, 300));
      expect(neighbours.length).toBeGreaterThan(0);
      for (const apart of neighbours) {
        expect(apart).toBeGreaterThanOrEqual(299.95);
        expect(apart).toBeLessThanOrEqual(300.05);
      }
    }
  });

  it('steps each table round the arc by the angle its place on the bend gives', () => {
    const arc = [arcOf(5000, 180)];
    const inside = row(arc, 'right')[1];
    expect(Math.abs(inside.xMm - 3697.97)).toBeLessThan(0.5);
    expect(Math.abs(inside.yMm - 2626.08)).toBeLessThan(0.5);
    expect(Math.abs(inside.rotation - -54.62)).toBeLessThan(0.01);
    expect(Math.abs(row(arc, 'left')[1].rotation - -58.715)).toBeLessThan(0.01);
  });

  it('turns the corner of an L: seven inside, four and four outside', () => {
    const corner = smoothRuns([p(0, 0), p(8000, 0), p(8000, 8000)]);
    const inside = row(corner, 'right');
    expect(inside).toHaveLength(7);
    expect(inside[4].xMm).toBeCloseTo(7620, 1);
    expect(inside[4].yMm).toBeCloseTo(1675, 1);
    expect(inside[4].rotation).toBeCloseTo(90, 6);
    expect(separations(inside).least).toBeGreaterThanOrEqual(-0.05);
    const outside = row(corner, 'left');
    expect(outside).toHaveLength(8);
    expect(outside.map((pose) => pose.rotation)).toEqual([0, 0, 0, 0, 90, 90, 90, 90]);
  });

  it('follows an S on either side and centred, nine tables each, none overlapping', () => {
    const runs = smoothRuns([p(0, 0), p(4000, 2000), p(8000, 0), p(12000, -2000), p(16000, 0)]);
    for (const side of ['right', 'left', 'centre'] as const) {
      const poses = row(runs, side);
      expect(poses).toHaveLength(9);
      expect(separations(poses).least).toBeGreaterThanOrEqual(-0.05);
    }
  });

  it('skips the places of a hairpin that would collide', () => {
    const turn = Array.from({ length: 33 }, (_, i) => {
      const angle = (-90 + (180 * i) / 32) * (Math.PI / 180);
      return p(8000 + 500 * Math.cos(angle), 500 + 500 * Math.sin(angle));
    });
    const hairpin: Run = [p(0, 0), ...turn, p(0, 1000)];
    const poses = row([hairpin], 'right');
    expect(poses).toHaveLength(4);
    expect(separations(poses).least).toBeGreaterThanOrEqual(-0.05);
  });

  it('places no more than it is allowed, the same first tables', () => {
    const all = row([halfCircle(5000)], 'right');
    expect(row([halfCircle(5000)], 'right', 0, { maxCount: 3 })).toEqual(all.slice(0, 3));
  });

  it('leaves what stands on the line clear, and goes on past it', () => {
    const pillar = [p(5000, 500), p(6000, 500), p(6000, 2500), p(5000, 2500)];
    const poses = row(straight, 'right', 0, { obstacles: [pillar] });
    expect(poses).toHaveLength(9);
    expect(poses.slice(0, 2)).toEqual(row(straight, 'right').slice(0, 2));
    expect(Math.abs(poses[2].startS - 6000)).toBeLessThan(0.1);
    for (const pose of poses) {
      expect(separation(cornersAt(pose), pillar)).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves out a table whose centre would stand outside the floorplan', () => {
    const poses = row(straight, 'right', 0, { extent: { widthMm: 10000, depthMm: 10000 } });
    expect(poses).toHaveLength(5);
    expect(poses.every((pose) => pose.xMm <= 10000)).toBe(true);
    expect(poses).toEqual(row(straight, 'right').slice(0, 5));
  });

  it('keeps clear of the tables placed before it', () => {
    const first = row(straight, 'right');
    const crossing: Run[] = [[p(4000, 0), p(4000, 9000)]];
    const second = placeAlongRuns(crossing, { ...TABLE, gapMm: 0, side: 'right' }, first);
    expect(second.length).toBeGreaterThan(0);
    for (const pose of second) {
      for (const before of first) {
        expect(separation(cornersAt(pose), cornersAt(before))).toBeGreaterThanOrEqual(-0.05);
      }
    }
  });

  it('places a 60 m path of 35 tables well inside a frame, among 400 that stand', () => {
    const wall = smoothRuns([p(0, 0), p(20000, 3000), p(40000, 0), p(60000, 3000)]);
    // Rows of tables under the wall, the nearest a table's depth from it: all within its reach.
    const obstacles = Array.from({ length: 400 }, (_, i) =>
      cornersAt({ xMm: (i % 20) * 3000, yMm: 4600 + Math.floor(i / 20) * 400, rotation: 0 }),
    );
    row(wall, 'right', 0, { obstacles });
    const from = performance.now();
    const poses = row(wall, 'right', 0, { obstacles });
    const took = performance.now() - from;
    expect(poses.length).toBeGreaterThanOrEqual(30);
    // A frame is 16 ms; a loaded test machine is given three.
    expect(took).toBeLessThan(48);
  });
});

describe('a row as the editor keeps it', () => {
  it.each([2000, 5000, 20000])('still never overlaps round a radius of %i', (radius) => {
    for (const side of ['right', 'left'] as const) {
      const kept = row([halfCircle(radius)], side).map((pose) => ({
        ...pose,
        xMm: roundMm(pose.xMm),
        yMm: roundMm(pose.yMm),
        rotation: roundTurn(pose.rotation),
      }));
      expect(separations(kept).least).toBeGreaterThanOrEqual(-0.05);
    }
  });
});

describe('a point of a path snaps to the tables near it', () => {
  const table = cornersAt({ xMm: 5000, yMm: 5000, rotation: 0 });

  it('takes a corner within reach', () => {
    expect(snapPoint(p(5930, 5370), [table], 50)).toEqual(p(5915, 5380));
  });

  it('else the nearest place on an edge within reach', () => {
    expect(snapPoint(p(5200, 5400), [table], 50)).toEqual(p(5200, 5380));
  });

  it('or the line of an edge, as far past its end as it is told to reach', () => {
    // 2 m past the table's right end, 20 mm under the line of its lower edge.
    expect(snapPoint(p(7915, 5400), [table], 50)).toEqual(p(7915, 5400));
    expect(snapPoint(p(7915, 5400), [table], 50, 5000)).toEqual(p(7915, 5380));
    expect(snapPoint(p(12_000, 5400), [table], 50, 5000)).toEqual(p(12_000, 5400));
  });

  it('else stays where it is', () => {
    expect(snapPoint(p(5200, 5500), [table], 50)).toEqual(p(5200, 5500));
    expect(snapPoint(p(5200, 5400), [], 50)).toEqual(p(5200, 5400));
  });
});
