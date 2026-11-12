/**
 * Closed shapes and parallel rows (T257): a path closed on its first point is smooth all the way
 * round, its tables go round it spread evenly, the seam's gap like every other; and several rows
 * stand beside a path, each an aisle from the last, table to table. The numbers are a 6 ft
 * table's, 1830 by 760 mm, positions to 0.5 mm and separations to 0.05 mm unless a case says its
 * own. A circle is centred on (0, 0) and drawn from (r, 0) through growing angles, clockwise on
 * the screen, so its right is its inside.
 */
import { describe, expect, it } from 'vitest';
import {
  measureRun,
  offsetRuns,
  placeAlongRuns,
  placeRows,
  separation,
  smoothRuns,
  spreadEvenly,
  tableCorners,
  type PathPose,
  type PointMm,
  type RowSide,
  type Run,
} from '@/components/layout/layoutGeometry';

const TABLE = { widthMm: 1830, depthMm: 760 };
const p = (xMm: number, yMm: number): PointMm => ({ xMm, yMm });
const onArc = (degrees: number, radius: number): PointMm => {
  const turn = (degrees * Math.PI) / 180;
  return p(radius * Math.cos(turn), radius * Math.sin(turn));
};
const radiusOf = (point: PointMm) => Math.hypot(point.xMm, point.yMm);
const cornersAt = (pose: { xMm: number; yMm: number; rotation: number }) =>
  tableCorners(pose, TABLE);

/** Points clicked evenly round a whole circle. */
const clicksRound = (radius: number, count: number) =>
  Array.from({ length: count }, (_, i) => onArc((360 * i) / count, radius));

/** An arc of a radius from (r, 0), as one run with a point every 40 mm or so. */
function arcOf(radius: number, sweep: number): Run {
  const count = Math.max(8, Math.ceil((sweep * radius) / 57.3 / 40));
  return Array.from({ length: count }, (_, i) => onArc((sweep * i) / (count - 1), radius));
}

/** The separation of each table from the next, the last from the first when `round`. */
function neighbourGaps(poses: PathPose[], round = false): number[] {
  const shapes = poses.map(cornersAt);
  const gaps: number[] = [];
  for (let i = 0; i + 1 < shapes.length; i += 1) gaps.push(separation(shapes[i], shapes[i + 1]));
  if (round && shapes.length > 1) gaps.push(separation(shapes[shapes.length - 1], shapes[0]));
  return gaps;
}

function leastSeparation(poses: PathPose[]): number {
  const shapes = poses.map(cornersAt);
  let least = Infinity;
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      least = Math.min(least, separation(shapes[i], shapes[j]));
    }
  }
  return least;
}

/** The least separation between any table of one row and any of another. */
function between(rowA: PathPose[], rowB: PathPose[]): number {
  let least = Infinity;
  for (const a of rowA) {
    for (const b of rowB) least = Math.min(least, separation(cornersAt(a), cornersAt(b)));
  }
  return least;
}

const spread = (min: number[]) => Math.max(...min) - Math.min(...min);

describe('a path closed on its first point', () => {
  it('is one run that ends where it began, on the circle its points were clicked round', () => {
    const runs = smoothRuns(clicksRound(3000, 8), { closed: true });
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.at(-1)).toEqual(run[0]);
    expect(run[0]).toEqual(onArc(0, 3000));
    for (const point of run) expect(Math.abs(radiusOf(point) - 3000)).toBeLessThan(0.01);
    expect(measureRun(run).length).toBeGreaterThan(2 * Math.PI * 3000 - 5);
    expect(measureRun(run).length).toBeLessThan(2 * Math.PI * 3000);
  });

  it('has no corner at its seam: the path turns there as little as anywhere', () => {
    const [run] = smoothRuns(clicksRound(3000, 8), { closed: true });
    const turnAt = (a: PointMm, b: PointMm, c: PointMm) => {
      const before = Math.atan2(b.yMm - a.yMm, b.xMm - a.xMm);
      const after = Math.atan2(c.yMm - b.yMm, c.xMm - b.xMm);
      let turn = ((after - before) * 180) / Math.PI;
      while (turn > 180) turn -= 360;
      while (turn <= -180) turn += 360;
      return Math.abs(turn);
    };
    let most = 0;
    for (let i = 1; i + 1 < run.length; i += 1) {
      most = Math.max(most, turnAt(run[i - 1], run[i], run[i + 1]));
    }
    expect(turnAt(run[run.length - 2], run[0], run[1])).toBeLessThanOrEqual(most + 0.01);
  });

  it('stays on the circle however unevenly it is clicked round', () => {
    const points = [0, 50, 95, 150, 200, 260, 310].map((degrees) => onArc(degrees, 5000));
    const runs = smoothRuns(points, { closed: true });
    expect(runs).toHaveLength(1);
    for (const point of runs[0]) expect(Math.abs(radiusOf(point) - 5000)).toBeLessThan(0.01);
  });

  it('makes a smooth loop of clicks round an oval, six or more', () => {
    const oval = Array.from({ length: 8 }, (_, i) => {
      const turn = (i * Math.PI) / 4;
      return p(5000 * Math.cos(turn), 4000 * Math.sin(turn));
    });
    const runs = smoothRuns(oval, { closed: true });
    expect(runs).toHaveLength(1);
    expect(runs[0].at(-1)).toEqual(runs[0][0]);
    expect(runs[0].length).toBeGreaterThan(40);
    // Six evenly round a circle turn 60° each: still a curve.
    expect(smoothRuns(clicksRound(3000, 6), { closed: true })).toHaveLength(1);
  });

  it('makes corners of four clicks, wherever they are: each turns too far for a curve', () => {
    // Four points turn 360° between them, so some turn past the 70° a curve may: at the middles
    // of a room's walls as at its corners, four clicks are four straight sides.
    expect(smoothRuns(clicksRound(3000, 4), { closed: true })).toHaveLength(4);
    const middles = [p(4000, 0), p(8000, 3000), p(4000, 6000), p(0, 3000)];
    const runs = smoothRuns(middles, { closed: true });
    expect(runs).toHaveLength(4);
    for (const run of runs) expect(run).toHaveLength(2);
  });

  it('makes a rectangle of four sharp corners: four straight runs, the last back to the first', () => {
    const corners = [p(0, 0), p(8000, 0), p(8000, 5000), p(0, 5000)];
    const runs = smoothRuns(corners, { closed: true });
    expect(runs).toEqual([
      [p(0, 0), p(8000, 0)],
      [p(8000, 0), p(8000, 5000)],
      [p(8000, 5000), p(0, 5000)],
      [p(0, 5000), p(0, 0)],
    ]);
  });

  it('begins with the run its first point is on, where that point is no corner', () => {
    // A D: a straight back from (0, 4000) up to (0, 0), and a bow round through the first point.
    const runs = smoothRuns([p(2000, 4000), p(0, 4000), p(0, 0), p(2000, 0), p(4000, 2000)], {
      closed: true,
    });
    expect(runs.length).toBeGreaterThan(1);
    const first = runs[0];
    expect(first.some((point) => point.xMm === 2000 && point.yMm === 4000)).toBe(true);
    // Run after run round the shape, the last ending where the first began.
    for (let i = 0; i < runs.length; i += 1) {
      expect(runs[(i + 1) % runs.length][0]).toEqual(runs[i].at(-1));
    }
  });

  it('is an open path of fewer than three points', () => {
    expect(smoothRuns([p(0, 0), p(8000, 0)], { closed: true })).toEqual([[p(0, 0), p(8000, 0)]]);
  });

  it('reads a last point clicked on the first as the closing', () => {
    const points = clicksRound(3000, 8);
    expect(smoothRuns([...points, points[0]], { closed: true })).toEqual(
      smoothRuns(points, { closed: true }),
    );
  });
});

describe('a row round a closed run', () => {
  const ring = (radius: number, count = 8) =>
    smoothRuns(clicksRound(radius, count), { closed: true });

  it('goes on across the seam, and stops clear of its own first table', () => {
    // Open, a whole circle of 3 m holds 10 outside with room left at its end; closed, the last
    // table may stand across the seam.
    for (const side of ['right', 'left'] as const) {
      const poses = placeAlongRuns(ring(3000), { ...TABLE, gapMm: 0, side });
      expect(leastSeparation(poses)).toBeGreaterThanOrEqual(-0.05);
      const gaps = neighbourGaps(poses);
      for (const gap of gaps) expect(Math.abs(gap)).toBeLessThanOrEqual(0.05);
    }
    expect(placeAlongRuns(ring(3000), { ...TABLE, gapMm: 0, side: 'left' })).toHaveLength(10);
    expect(placeAlongRuns(ring(3000), { ...TABLE, gapMm: 0, side: 'right' })).toHaveLength(7);
  });

  it('spreads eight clicks round a 3 m stage into a ring: on the circle, no table over another, every gap the same', () => {
    for (const side of ['right', 'left'] as const) {
      const poses = spreadEvenly(ring(3000), { ...TABLE, gapMm: 0, side });
      expect(poses).toHaveLength(side === 'left' ? 10 : 7);
      expect(leastSeparation(poses)).toBeGreaterThanOrEqual(-0.05);
      const gaps = neighbourGaps(poses, true);
      expect(gaps).toHaveLength(poses.length);
      expect(spread(gaps)).toBeLessThan(1);
      for (const pose of poses) {
        const corners = cornersAt(pose);
        const radii = corners.map(radiusOf);
        if (side === 'left') {
          // Outside: the nearest of the table to the middle is its back edge, on the circle.
          const back = Math.min(
            ...corners.map((corner, i) => {
              const next = corners[(i + 1) % corners.length];
              const along = { x: next.xMm - corner.xMm, y: next.yMm - corner.yMm };
              const length = Math.hypot(along.x, along.y);
              const t = Math.max(
                0,
                Math.min(1, -(corner.xMm * along.x + corner.yMm * along.y) / (length * length)),
              );
              return Math.hypot(corner.xMm + along.x * t, corner.yMm + along.y * t);
            }),
          );
          expect(Math.abs(back - 3000)).toBeLessThan(1);
        } else {
          // Inside: its two back corners are on the circle, the rest within it.
          const onCircle = radii.filter((radius) => Math.abs(radius - 3000) < 1);
          expect(onCircle).toHaveLength(2);
          expect(Math.max(...radii)).toBeLessThan(3001);
        }
      }
    }
  });

  it('never spreads to less than the gap asked', () => {
    const asked = placeAlongRuns(ring(3000), { ...TABLE, gapMm: 300, side: 'left' });
    const poses = spreadEvenly(ring(3000), { ...TABLE, gapMm: 300, side: 'left' });
    expect(poses).toHaveLength(asked.length);
    const gaps = neighbourGaps(poses, true);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(299.95);
    expect(spread(gaps)).toBeLessThan(1);
  });

  it('numbers from the first point clicked, in the direction drawn', () => {
    const poses = spreadEvenly(ring(3000), { ...TABLE, gapMm: 0, side: 'left' });
    const angleOf = (pose: PathPose) => {
      const angle = (Math.atan2(pose.yMm, pose.xMm) * 180) / Math.PI;
      return angle < 0 ? angle + 360 : angle;
    };
    const angles = poses.map(angleOf);
    expect(angles[0]).toBeGreaterThan(0);
    expect(angles[0]).toBeLessThan(40);
    for (let i = 1; i < angles.length; i += 1) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
  });

  it('spreads each side of a rectangle of corners to its end', () => {
    const runs = smoothRuns([p(0, 0), p(20_000, 0), p(20_000, 12_000), p(0, 12_000)], {
      closed: true,
    });
    // Outside, where no side's tables stand in the next side's way.
    const poses = spreadEvenly(runs, { ...TABLE, gapMm: 0, side: 'left' });
    const top = poses.filter((pose) => pose.yMm < 0);
    expect(top).toHaveLength(10);
    expect(top[0].xMm).toBeCloseTo(915, 1);
    expect(top[9].xMm).toBeCloseTo(20_000 - 915, 1);
    expect(leastSeparation(poses)).toBeGreaterThanOrEqual(-0.05);
  });
});

describe('a ring of two tables', () => {
  it('stands them opposite each other, not touching on one side with the room on the other', () => {
    const runs = smoothRuns(clicksRound(1500, 8), { closed: true });
    const poses = spreadEvenly(runs, { ...TABLE, gapMm: 0, side: 'right' });
    expect(poses).toHaveLength(2);
    const [first, second] = poses;
    // Unspread they touch; spread they stand the widest gap apart the ring gives two tables,
    // as far from each other the one way round as the other: a wider gap holds one alone.
    const apart = separation(cornersAt(first), cornersAt(second));
    expect(apart).toBeGreaterThan(800);
    expect(placeAlongRuns(runs, { ...TABLE, gapMm: apart - 0.5, side: 'right' })).toHaveLength(2);
    expect(placeAlongRuns(runs, { ...TABLE, gapMm: apart + 0.5, side: 'right' })).toHaveLength(1);
    const round = measureRun(runs[0]).length;
    expect(Math.abs(second.startS - first.endS - (round - second.endS))).toBeLessThan(100);
  });
});

describe('a row spread evenly to the ends of an open path', () => {
  it('ends its last table at the end of a straight 20 m, the gaps equal', () => {
    const line = [[p(1000, 1000), p(21_000, 1000)]];
    const poses = spreadEvenly(line, { ...TABLE, gapMm: 0, side: 'right' });
    expect(poses).toHaveLength(10);
    expect(poses[0].xMm).toBeCloseTo(1915, 3);
    expect(poses[9].xMm).toBeCloseTo(21_000 - 915, 1);
    const gaps = neighbourGaps(poses);
    expect(gaps[0]).toBeCloseTo((20_000 - 18_300) / 9, 1);
    expect(spread(gaps)).toBeLessThan(0.1);
  });

  it('ends it at the end of a curved one, inside and outside the bend', () => {
    const arc = arcOf(10_000, 115);
    const length = measureRun(arc).length;
    for (const side of ['right', 'left'] as const) {
      const asked = placeAlongRuns([arc], { ...TABLE, gapMm: 100, side });
      const poses = spreadEvenly([arc], { ...TABLE, gapMm: 100, side });
      expect(poses).toHaveLength(asked.length);
      expect(length - poses.at(-1)!.endS).toBeLessThan(0.5);
      expect(length - poses.at(-1)!.endS).toBeGreaterThanOrEqual(0);
      const gaps = neighbourGaps(poses);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(99.95);
      expect(spread(gaps)).toBeLessThan(0.2);
    }
  });

  it('leaves one table, and a row that fills its path already, as they are', () => {
    const short = [[p(0, 0), p(3000, 0)]];
    expect(spreadEvenly(short, { ...TABLE, gapMm: 0, side: 'right' })).toEqual(
      placeAlongRuns(short, { ...TABLE, gapMm: 0, side: 'right' }),
    );
    const exact = [[p(0, 0), p(18_300, 0)]];
    expect(spreadEvenly(exact, { ...TABLE, gapMm: 0, side: 'right' })).toHaveLength(10);
  });

  it('spreads each run of a path with a corner to that run’s end', () => {
    const runs = smoothRuns([p(0, 0), p(8000, 0), p(8000, 8000)]);
    const poses = spreadEvenly(runs, { ...TABLE, gapMm: 0, side: 'left' });
    expect(poses).toHaveLength(8);
    expect(poses[3].xMm).toBeCloseTo(8000 - 915, 1);
    expect(poses[7].yMm).toBeCloseTo(8000 - 915, 1);
  });

  it('leaves a run as it is whose last table is held by what stands in the way, and comes back at once', () => {
    // The last table stands at the first clear place past a table in the way: no gap moves
    // it, and the spread once sought one without end (the review's first finding).
    const runs = smoothRuns([
      p(-4101.98409948498, 10228.623165283352),
      p(-5979.716180823743, 1234.1053616255524),
      p(1024.105819873512, -1154.1116894222794),
    ]);
    const inTheWay = [
      p(-4851.277368706258, 3034.9453241631813),
      p(-4444.916888239796, 1250.6328067170177),
      p(-3703.890924710242, 1419.3945363096466),
      p(-4110.251405176703, 3203.7070537558106),
    ];
    const options = { ...TABLE, gapMm: 0, side: 'right' as const, obstacles: [inTheWay] };
    const start = performance.now();
    const poses = spreadEvenly(runs, options);
    expect(performance.now() - start).toBeLessThan(500);
    expect(poses.length).toBeGreaterThan(0);
    expect(leastSeparation(poses)).toBeGreaterThanOrEqual(-0.05);
    for (const pose of poses) {
      expect(separation(cornersAt(pose), inTheWay)).toBeGreaterThanOrEqual(-0.05);
    }
  });

  it('comes back at once along 60 m with 400 tables standing across it', () => {
    const points = [p(5000, 20_000), p(22_000, 12_000), p(40_000, 22_000), p(62_000, 14_000)];
    const across = Array.from({ length: 400 }, (_, i) =>
      cornersAt({
        xMm: 3000 + (i % 40) * 1600,
        yMm: 9000 + Math.floor(i / 40) * 1500,
        rotation: 0,
      }),
    );
    for (const side of ['left', 'right'] as const) {
      const start = performance.now();
      const poses = spreadEvenly(smoothRuns(points), {
        ...TABLE,
        gapMm: 0,
        side,
        obstacles: across,
      });
      expect(performance.now() - start).toBeLessThan(500);
      for (const pose of poses) {
        for (const shape of across) {
          expect(separation(cornersAt(pose), shape)).toBeGreaterThanOrEqual(-0.05);
        }
      }
    }
  });

  it('keeps clear of what stands on the line, and places no more than it is allowed', () => {
    const line = [[p(0, 0), p(20_000, 0)]];
    const pillar = [p(5000, -500), p(6000, -500), p(6000, 500), p(5000, 500)];
    const poses = spreadEvenly(line, { ...TABLE, gapMm: 0, side: 'right', obstacles: [pillar] });
    for (const pose of poses) {
      expect(separation(cornersAt(pose), pillar)).toBeGreaterThanOrEqual(-0.05);
    }
    expect(leastSeparation(poses)).toBeGreaterThanOrEqual(-0.05);
    expect(spreadEvenly(line, { ...TABLE, gapMm: 0, side: 'right', maxCount: 3 })).toEqual(
      placeAlongRuns(line, { ...TABLE, gapMm: 0, side: 'right', maxCount: 3 }),
    );
  });
});

describe('a run offset to one side', () => {
  const quarter = arcOf(5000, 90);

  it('is the same arc on a smaller circle to its right, a larger to its left', () => {
    const [inside, ...more] = offsetRuns([quarter], 1000);
    expect(more).toEqual([]);
    expect(inside.length).toBeGreaterThan(8);
    for (const point of inside) expect(Math.abs(radiusOf(point) - 4000)).toBeLessThan(0.05);
    const [outside] = offsetRuns([quarter], -1000);
    for (const point of outside) expect(Math.abs(radiusOf(point) - 6000)).toBeLessThan(0.05);
    // Each end stands square off the wall's last stretch, 4 mm past the quarter.
    expect(Math.abs(measureRun(inside).length - (Math.PI / 2) * 4000)).toBeLessThan(10);
  });

  it('is nothing past the middle of the bend', () => {
    expect(offsetRuns([quarter], 6000)).toEqual([]);
  });

  it('is a straight run moved sideways by exactly the distance', () => {
    expect(offsetRuns([[p(0, 0), p(10_000, 0)]], 1960)).toEqual([[p(0, 1960), p(10_000, 1960)]]);
    expect(offsetRuns([[p(0, 0), p(10_000, 0)]], -1960)).toEqual([[p(0, -1960), p(10_000, -1960)]]);
    expect(offsetRuns([[p(0, 0), p(10_000, 0)]], 0)).toEqual([[p(0, 0), p(10_000, 0)]]);
  });

  it('stops short of the other wall inside a corner, and reaches its own end outside one', () => {
    const walls = smoothRuns([p(0, 0), p(8000, 0), p(8000, 8000)]);
    // Inside the L: each offset wall ends where it comes within the distance of the other.
    const inside = offsetRuns(walls, 2000);
    expect(inside).toHaveLength(2);
    expect(inside[0][0]).toEqual(p(0, 2000));
    expect(inside[0].at(-1)!.xMm).toBeCloseTo(6000, 0);
    expect(inside[0].at(-1)!.yMm).toBeCloseTo(2000, 6);
    expect(inside[1][0].xMm).toBeCloseTo(6000, 6);
    expect(inside[1][0].yMm).toBeCloseTo(2000, 0);
    expect(inside[1].at(-1)).toEqual(p(6000, 8000));
    // Outside it: each as long as its wall.
    const outside = offsetRuns(walls, -2000);
    expect(outside).toEqual([
      [p(0, -2000), p(8000, -2000)],
      [p(10_000, 0), p(10_000, 8000)],
    ]);
  });

  it('drops the stretch a tight bend swallows, as two runs', () => {
    // A wall along the top, a bend of 500 mm radius, and a wall down: offset 1 m to the inside,
    // nothing of the bend is left, and each wall's offset stops where it meets the other's.
    const bend: Run = [
      p(0, 0),
      p(8000, 0),
      ...Array.from({ length: 15 }, (_, i) => {
        const turn = (-90 + (90 * (i + 1)) / 16) * (Math.PI / 180);
        return p(8000 + 500 * Math.cos(turn), 500 + 500 * Math.sin(turn));
      }),
      p(8500, 500),
      p(8500, 8500),
    ];
    const inside = offsetRuns([bend], 1000);
    expect(inside).toHaveLength(2);
    expect(inside[0][0]).toEqual(p(0, 1000));
    expect(inside[0].at(-1)!.xMm).toBeCloseTo(7500, 0);
    expect(inside[1][0].yMm).toBeCloseTo(1000, 0);
    expect(inside[1].at(-1)).toEqual(p(7500, 8500));
    // A hairpin 1 m wide, offset 2 m to its inside: each straight's offset lies past the other.
    const hairpin: Run = [
      p(0, 0),
      p(8000, 0),
      ...Array.from({ length: 31 }, (_, i) => {
        const turn = (-90 + (180 * (i + 1)) / 32) * (Math.PI / 180);
        return p(8000 + 500 * Math.cos(turn), 500 + 500 * Math.sin(turn));
      }),
      p(8000, 1000),
      p(0, 1000),
    ];
    expect(offsetRuns([hairpin], 2000)).toEqual([]);
  });

  it('is a closed run again of a closed run', () => {
    const [ring] = smoothRuns(clicksRound(5000, 8), { closed: true });
    const [inner] = offsetRuns([ring], 1960);
    expect(inner.at(-1)).toEqual(inner[0]);
    // The offset of the flattened circle, which stands up to 2 mm inside the true one.
    for (const point of inner) expect(Math.abs(radiusOf(point) - 3040)).toBeLessThan(1);
  });
});

describe('rows beside a path, an aisle apart', () => {
  const rows = (
    runs: Run[],
    side: RowSide,
    count: number,
    aisleMm = 1200,
    more: Partial<Parameters<typeof placeRows>[1]> = {},
  ) => placeRows(runs, { ...TABLE, gapMm: 0, side, rows: count, aisleMm, ...more });
  const counts = (placed: PathPose[][]) => placed.map((row) => row.length);

  it('is the one row of placeAlongRuns where one is asked', () => {
    const arc = [arcOf(10_000, 120)];
    expect(rows(arc, 'right', 1)).toEqual([
      placeAlongRuns(arc, { ...TABLE, gapMm: 0, side: 'right' }),
    ]);
  });

  it('places 10, 8 and 6 inside 120° of a 10 m arc, each an aisle from the last table to table', () => {
    const placed = rows([arcOf(10_000, 120)], 'right', 3);
    expect(counts(placed)).toEqual([10, 8, 6]);
    for (let i = 1; i < placed.length; i += 1) {
      const aisle = between(placed[i - 1], placed[i]);
      expect(aisle).toBeGreaterThanOrEqual(1199);
      expect(aisle).toBeLessThanOrEqual(1215);
    }
  });

  it('places 11, 13 and 16 outside it, the same aisle', () => {
    const placed = rows([arcOf(10_000, 120)], 'left', 3);
    expect(counts(placed)).toEqual([11, 13, 16]);
    for (let i = 1; i < placed.length; i += 1) {
      const aisle = between(placed[i - 1], placed[i]);
      expect(aisle).toBeGreaterThanOrEqual(1199);
      expect(aisle).toBeLessThanOrEqual(1215);
    }
  });

  it('drops the rows a tight curve has no room for', () => {
    expect(counts(rows([arcOf(4000, 180)], 'right', 6))).toEqual([5, 2, 0, 0, 0, 0]);
  });

  it('places two straight rows of ten, the second exactly a depth and the aisle from the first', () => {
    const placed = rows([[p(1000, 1000), p(21_000, 1000)]], 'right', 2);
    expect(counts(placed)).toEqual([10, 10]);
    placed[0].forEach((pose, i) => {
      expect(placed[1][i].xMm).toBeCloseTo(pose.xMm, 6);
      expect(placed[1][i].yMm - pose.yMm).toBeCloseTo(1960, 6);
    });
  });

  it('stands rows back to back at an aisle of nothing', () => {
    const placed = rows([[p(0, 0), p(20_000, 0)]], 'left', 2, 0);
    expect(placed[1][0].yMm - placed[0][0].yMm).toBeCloseTo(-760, 6);
    expect(between(placed[0], placed[1])).toBeCloseTo(0, 6);
  });

  it('offsets rows centred on the line to its right', () => {
    const placed = rows([[p(0, 0), p(20_000, 0)]], 'centre', 2);
    expect(placed[0][0].yMm).toBeCloseTo(0, 6);
    expect(placed[1][0].yMm).toBeCloseTo(1960, 6);
  });

  it('places rings within rings round a closed shape, each spread evenly', () => {
    const ring = smoothRuns(clicksRound(6000, 8), { closed: true });
    const placed = rows(ring, 'right', 3, 1200, { spread: true });
    expect(placed).toHaveLength(3);
    expect(placed[0].length).toBeGreaterThan(placed[1].length);
    expect(placed[1].length).toBeGreaterThan(placed[2].length);
    for (const row of placed) {
      expect(spread(neighbourGaps(row, true))).toBeLessThan(1);
      expect(leastSeparation(row)).toBeGreaterThanOrEqual(-0.05);
    }
    for (let i = 1; i < placed.length; i += 1) {
      const aisle = between(placed[i - 1], placed[i]);
      expect(aisle).toBeGreaterThanOrEqual(1199);
      expect(aisle).toBeLessThanOrEqual(1215);
    }
  });

  it('keeps the aisle round the inside of a corner', () => {
    const walls = smoothRuns([p(0, 0), p(12_000, 0), p(12_000, 12_000)]);
    const placed = rows(walls, 'right', 2);
    expect(placed[1].length).toBeGreaterThan(0);
    expect(between(placed[0], placed[1])).toBeGreaterThanOrEqual(1199);
    expect(leastSeparation(placed.flat())).toBeGreaterThanOrEqual(-0.05);
  });

  it('never leaves an aisle narrower than asked, round a sharp corner as anywhere', () => {
    // A closed triangle whose rows close on each other at its sharp corners (the review's
    // fifth finding: 861 mm of an aisle of 1000).
    const triangle = smoothRuns([p(8145, -3108), p(639, 882), p(10_668, 5316)], { closed: true });
    for (const side of ['left', 'right'] as const) {
      const placed = rows(triangle, side, 3, 1000, { gapMm: 600 });
      for (let i = 1; i < placed.length; i += 1) {
        expect(between(placed[i - 1], placed[i])).toBeGreaterThanOrEqual(999.5);
      }
    }
    const open = smoothRuns([p(4788, 3489), p(10_296, -3913), p(13_781, 658)]);
    const placed = rows(open, 'right', 3, 1000, { gapMm: 600 });
    for (let i = 1; i < placed.length; i += 1) {
      expect(between(placed[i - 1], placed[i])).toBeGreaterThanOrEqual(999.5);
    }
  });

  it('places no more than it is allowed across all its rows, the first row whole first', () => {
    const placed = rows([[p(0, 0), p(20_000, 0)]], 'right', 3, 1200, { maxCount: 14 });
    expect(counts(placed)).toEqual([10, 4, 0]);
  });

  it('places four rows along 60 m among 400 standing tables well inside a frame', () => {
    // An S through a hall 70 m across, as the preview reckons it on every move of the pointer.
    const points = [p(5000, 20_000), p(22_000, 12_000), p(40_000, 22_000), p(62_000, 14_000)];
    const obstacles = Array.from({ length: 400 }, (_, i) =>
      cornersAt({
        xMm: 3000 + (i % 40) * 1600,
        yMm: 30_000 + Math.floor(i / 40) * 900,
        rotation: 0,
      }),
    );
    const runs = smoothRuns(points);
    const once = () => rows(runs, 'right', 4, 1200, { obstacles });
    once();
    const times: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const start = performance.now();
      once();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(counts(once()).every((count) => count > 25)).toBe(true);
    // A frame is 16 ms; a loaded CI machine is given room. The build note has the measure.
    expect(times[4]).toBeLessThan(50);
  });
});
