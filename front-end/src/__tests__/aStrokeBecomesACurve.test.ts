/**
 * A row's line drawn by hand (T257): how a stroke is read (nothing, straight, open or closed, and
 * smoothed) and how its points are chosen, so that the built `smoothRuns` makes of them one smooth
 * path with no corner, near the stroke. The numbers are as at 25 mm to the pixel unless said:
 * step 100, smooth 400, tolerance 300, gap 200, close 600, straight 250 to 600 mm; tables are
 * 6 ft, 1830 by 760 mm. "Sampled" is a true curve with a sample every 250 mm and no hand in it;
 * a "hand" is a seeded stroke over the curve (`helpers/drawnByHand.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  fitStroke,
  measureRun,
  placeRows,
  pointAtLength,
  readStroke,
  separation,
  smoothRuns,
  strokeRuns,
  tableCorners,
  type PathPose,
  type PointMm,
  type Run,
} from '@/components/layout/layoutGeometry';
import {
  SHAPES,
  apart,
  bowed,
  furthestOff,
  hand,
  offLine,
  optionsAt,
  p,
  ringOf,
  sampled,
  seeded,
  truth,
  type Piece,
} from './helpers/drawnByHand';

const TABLE = { widthMm: 1830, depthMm: 760 };
const AT_25 = optionsAt(25);
const HANDS = Array.from({ length: 20 }, (_, i) => i + 1);

const rowOn = (runs: Run[], closed: boolean): PathPose[] =>
  placeRows(runs, {
    ...TABLE,
    gapMm: 0,
    side: 'right',
    rows: 1,
    aisleMm: 1200,
    spread: closed,
  }).flat();

/** A fit, the path the built rules make of it, and the row along that. */
function fitted(samples: readonly PointMm[], options = AT_25) {
  const fit = fitStroke(samples, options);
  const runs = smoothRuns(fit.points, { closed: fit.closed });
  return { ...fit, runs, row: rowOn(runs, fit.closed) };
}

/** The sweep the corner rule reads at each point of a path, in degrees: the greater of the two
 *  beside it on the circle through it and its neighbours; 0 at an open end and in a line. */
function sweeps(points: readonly PointMm[], closed: boolean): number[] {
  const n = points.length;
  return points.map((b, i) => {
    if (!closed && (i === 0 || i === n - 1)) return 0;
    const a = points[(i - 1 + n) % n];
    const c = points[(i + 1) % n];
    const d = 2 * (a.xMm * (b.yMm - c.yMm) + b.xMm * (c.yMm - a.yMm) + c.xMm * (a.yMm - b.yMm));
    const turnsBack = (b.xMm - a.xMm) * (c.xMm - b.xMm) + (b.yMm - a.yMm) * (c.yMm - b.yMm) < 0;
    if (Math.abs(d) < 1e-6) return turnsBack ? 180 : 0;
    const [a2, b2, c2] = [a, b, c].map((q) => q.xMm ** 2 + q.yMm ** 2);
    const centre = p(
      (a2 * (b.yMm - c.yMm) + b2 * (c.yMm - a.yMm) + c2 * (a.yMm - b.yMm)) / d,
      (a2 * (c.xMm - b.xMm) + b2 * (a.xMm - c.xMm) + c2 * (b.xMm - a.xMm)) / d,
    );
    const way = Math.sign((b.xMm - a.xMm) * (c.yMm - b.yMm) - (b.yMm - a.yMm) * (c.xMm - b.xMm));
    const sweep = (from: PointMm, to: PointMm) => {
      const turn =
        (Math.atan2(to.yMm - centre.yMm, to.xMm - centre.xMm) -
          Math.atan2(from.yMm - centre.yMm, from.xMm - centre.xMm)) *
        way;
      return ((((turn * 180) / Math.PI) % 360) + 360) % 360;
    };
    return Math.max(sweep(a, b), sweep(b, c));
  });
}
const sharpest = (fit: { points: PointMm[]; closed: boolean }) =>
  Math.max(...sweeps(fit.points, fit.closed));

/** A true curve as the line a closed stroke should come back along. */
const closedCurve = (curve: readonly PointMm[]) => [...curve, curve[0]];

/** How far each table of a row stands from the next, round a closed one. */
function neighbourGaps(row: readonly PathPose[], closed: boolean): number[] {
  const shapes = row.map((pose) => tableCorners(pose, TABLE));
  const count = closed ? shapes.length : shapes.length - 1;
  return Array.from({ length: count }, (_, i) =>
    separation(shapes[i], shapes[(i + 1) % shapes.length]),
  );
}

describe('reading a stroke', () => {
  it('reads nothing of one sample, or of two within a millimetre', () => {
    expect(readStroke([], AT_25).kind).toBe('none');
    expect(readStroke([p(100, 100)], AT_25).kind).toBe('none');
    expect(readStroke([p(100, 100), p(100.5, 100.5)], AT_25).kind).toBe('none');
    expect(strokeRuns({ kind: 'none' })).toEqual([]);
    expect(fitStroke([p(100, 100)], AT_25)).toEqual({ points: [], closed: false });
  });

  it('reads a 20 m line drawn by 20 hands as straight, its ends the first and last samples', () => {
    for (const seed of HANDS) {
      const stroke = hand(SHAPES.line, 25, seed);
      const read = readStroke(stroke, AT_25);
      expect(read).toEqual({ kind: 'straight', ends: [stroke[0], stroke.at(-1)] });
      expect(strokeRuns(read)).toEqual([[stroke[0], stroke.at(-1)]]);
      expect(fitStroke(stroke, AT_25)).toEqual({
        points: [stroke[0], stroke.at(-1)],
        closed: false,
      });
    }
  });

  it.each([
    [20_000, 500, 'straight'],
    [20_000, 700, 'open'],
    [3000, 90, 'straight'],
    [3000, 300, 'open'],
    // A drag bowed 8 px over 400 px, at the 50 mm to the pixel of the E2E's window.
    [20_000, 400, 'straight'],
  ])('reads a %i mm chord bowed %i mm as %s', (chord, sagitta, kind) => {
    expect(readStroke(sampled(bowed(chord, sagitta), 250), AT_25).kind).toBe(kind);
  });

  it('does not read a 96 m snake as straight, though it stays near its line', () => {
    expect(readStroke(sampled(SHAPES.snake, 250), AT_25).kind).toBe('open');
    expect(readStroke(hand(SHAPES.snake, 25, 1), AT_25).kind).toBe('open');
  });

  it('does not read a drag out and back along its own line as straight', () => {
    const out = Array.from({ length: 41 }, (_, i) => p(i * 250, 0));
    const back = Array.from({ length: 30 }, (_, i) => p(10_000 - (i + 1) * 250, 25));
    expect(readStroke([...out, ...back], AT_25).kind).toBe('open');
  });

  it('reads any stroke as its two ends while `straight` is set, a ring let go at its start too', () => {
    const straight = optionsAt(25, true);
    const s = sampled(SHAPES.s, 250);
    expect(readStroke(s, straight)).toEqual({ kind: 'straight', ends: [s[0], s.at(-1)] });
    const ring = sampled(ringOf(5000, 300), 250);
    expect(readStroke(ring, straight)).toEqual({ kind: 'straight', ends: [ring[0], ring.at(-1)] });
    expect(fitStroke(ring, straight)).toEqual({ points: [ring[0], ring.at(-1)], closed: false });
  });

  it.each([
    [500, 'closed'],
    [-500, 'closed'],
    [750, 'open'],
    [-750, 'open'],
  ])('reads a ring of 5 m radius let go %i mm short of its start as %s', (short, kind) => {
    expect(readStroke(sampled(ringOf(5000, short), 250), AT_25).kind).toBe(kind);
  });

  it('does not close a loop 400 mm across, which was never twice the closing reach away', () => {
    expect(readStroke(sampled(ringOf(200, 20), 50), AT_25).kind).not.toBe('closed');
  });

  it("keeps an open stroke's first and last samples as its smoothed line's ends", () => {
    for (const curve of [SHAPES.s, SHAPES.arc90, SHAPES.l, SHAPES.hairpin]) {
      const stroke = hand(curve, 25, 4);
      const read = readStroke(stroke, AT_25);
      if (read.kind !== 'open') throw new Error(`read as ${read.kind}`);
      expect(read.line[0]).toEqual(stroke[0]);
      expect(read.line.at(-1)).toEqual(stroke.at(-1));
      expect(read.stepMm).toBeCloseTo(100, -1);
      expect(strokeRuns(read)).toEqual([read.line]);
    }
  });

  it('smooths a ring to within 25 mm of its circle, and 20 hands to within 150 mm', () => {
    const offCircle = (line: readonly PointMm[]) =>
      Math.max(...line.map((q) => Math.abs(Math.hypot(q.xMm, q.yMm - 5000) - 5000)));
    const read = readStroke(sampled(SHAPES.ring, 250), AT_25);
    if (read.kind !== 'closed') throw new Error(`read as ${read.kind}`);
    expect(offCircle(read.line)).toBeLessThan(25);
    // A closed line's run comes back to its first point.
    const [run] = strokeRuns(read);
    expect(run).toHaveLength(read.line.length + 1);
    expect(run.at(-1)).toEqual(run[0]);
    for (const seed of HANDS) {
      const drawn = readStroke(hand(SHAPES.ring, 25, seed), AT_25);
      if (drawn.kind !== 'closed') throw new Error(`hand ${seed} read as ${drawn.kind}`);
      expect(offCircle(drawn.line)).toBeLessThan(150);
    }
  });

  it('holds the line already drawn still while the stroke grows', () => {
    const stroke = hand(SHAPES.s, 25, 3);
    let before: PointMm[] | null = null;
    let moved = 0;
    let reads = 0;
    for (let count = 2; count <= stroke.length; count += 1) {
      const read = readStroke(stroke.slice(0, count), AT_25);
      if (read.kind !== 'open') {
        before = null;
        continue;
      }
      if (before) {
        // All of the last read's line but its last 1.6 m, which the smoothing still reaches.
        const run = measureRun(before);
        for (let s = 0; s < run.length - 1600; s += 100) {
          moved = Math.max(moved, offLine(pointAtLength(run, s), read.line));
        }
        reads += 1;
      }
      before = read.line;
    }
    expect(reads).toBeGreaterThan(50);
    expect(moved).toBeLessThanOrEqual(2.5);
  });

  it('resamples a very long stroke to 1,000 points at most, the step grown', () => {
    const read = readStroke(sampled(SHAPES.snake, 250), optionsAt(12));
    if (read.kind !== 'open') throw new Error(`read as ${read.kind}`);
    expect(read.line).toHaveLength(1001);
    expect(read.stepMm).toBeGreaterThan(48);
  });
});

describe('fitting a stroke with no hand in it', () => {
  it.each([
    // name, closed, points, how near the true curve (mm), the row
    ['s', false, 6, 200, 10],
    ['ring', true, 8, 25, 14],
    ['stageRing', true, 8, 60, 3],
    ['arc90', false, 3, 15, 6],
    ['arc200', false, 6, 30, 6],
    ['wallIntoBend', false, 5, 320, 7],
    ['l', false, 7, 220, 7],
    ['oval', true, 12, 160, 14],
  ] as const)(
    'fits %s: closed %s, %i points, one run within %i mm of it',
    (name, closed, count, within, tables) => {
      const curve = SHAPES[name];
      const stroke = sampled(curve, 250);
      const fit = fitted(stroke);
      expect(fit.closed).toBe(closed);
      expect(fit.points).toHaveLength(count);
      expect(fit.runs).toHaveLength(1);
      expect(furthestOff(fit.runs, closed ? closedCurve(curve) : curve)).toBeLessThan(within);
      // No point the corner rule would be near making a corner of.
      expect(sharpest(fit)).toBeLessThanOrEqual(60);
      expect(fit.row).toHaveLength(tables);
      if (closed) {
        // One run that loops.
        expect(fit.runs[0].at(-1)).toEqual(fit.runs[0][0]);
      } else {
        expect(fit.points[0]).toEqual(stroke[0]);
        expect(fit.points.at(-1)).toEqual(stroke.at(-1));
      }
      // Every smoothed point stands within the tolerance of the path.
      const read = readStroke(stroke, AT_25);
      if (read.kind === 'none' || read.kind === 'straight') throw new Error(read.kind);
      for (const point of read.line) {
        expect(Math.min(...fit.runs.map((run) => offLine(point, run)))).toBeLessThanOrEqual(300);
      }
      // However fast the hand moved: a sample every 50 mm and every 750 mm.
      expect(fitStroke(sampled(curve, 50), AT_25).points).toHaveLength(count);
      expect(fitStroke(sampled(curve, 750), AT_25).points).toHaveLength(count);
    },
  );

  it('measures the S and the rings as the design pinned them', () => {
    const s = fitted(sampled(SHAPES.s, 250));
    expect(furthestOff(s.runs, SHAPES.s)).toBeCloseTo(165, 0);
    expect(sharpest(s)).toBeCloseTo(57.1, 1);
    const ring = fitted(sampled(SHAPES.ring, 250));
    expect(furthestOff(ring.runs, closedCurve(SHAPES.ring))).toBeCloseTo(16.7, 1);
    const stage = fitted(sampled(SHAPES.stageRing, 250));
    expect(furthestOff(stage.runs, closedCurve(SHAPES.stageRing))).toBeCloseTo(43.7, 1);
  });

  it.each([
    [10, 3, 8, 7],
    [50, 3, 8, 6],
  ])(
    'at %i mm to the pixel fits the arc to %i points, the ring to %i and the S to %i',
    (mm, arc, ring, s) => {
      const options = optionsAt(mm);
      const every = 10 * mm;
      expect(fitStroke(sampled(SHAPES.arc90, every), options).points).toHaveLength(arc);
      const round = fitStroke(sampled(ringOf(5000, 100), every), options);
      expect(round.closed).toBe(true);
      expect(round.points).toHaveLength(ring);
      expect(fitStroke(sampled(SHAPES.s, every), options).points).toHaveLength(s);
    },
  );

  it('fits the quarter of a 5 m circle the E2E draws, at 50 mm to the pixel, to 3 points and a row of 3', () => {
    const quarter = truth([{ len: (Math.PI / 2) * 5000, k: 1 / 5000 }]);
    const fit = fitted(sampled(quarter, 200), optionsAt(50));
    expect(fit.points).toHaveLength(3);
    expect(fit.closed).toBe(false);
    expect(fit.row).toHaveLength(3);
  });
});

describe('fitting a stroke 20 hands drew', () => {
  it('fits the S to 6 or 7 points, one run, a row of 10', () => {
    for (const seed of HANDS) {
      const fit = fitted(hand(SHAPES.s, 25, seed));
      expect(fit.closed).toBe(false);
      expect([6, 7]).toContain(fit.points.length);
      expect(fit.runs).toHaveLength(1);
      expect(fit.row).toHaveLength(10);
    }
  });

  it('fits the ring to 8 points, one run, a row of 14 spread evenly round it', () => {
    for (const seed of HANDS) {
      const fit = fitted(hand(SHAPES.ring, 25, seed));
      expect(fit.closed).toBe(true);
      expect(fit.points).toHaveLength(8);
      expect(fit.runs).toHaveLength(1);
      expect(fit.row).toHaveLength(14);
      const gaps = neighbourGaps(fit.row, true);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    }
  });

  it('fits the ring to 8 points for a hand half again as shaky', () => {
    for (const seed of HANDS) {
      expect(fitStroke(hand(SHAPES.ring, 25, seed, 1.5), AT_25).points).toHaveLength(8);
    }
  });

  it('fits a hairpin of 0.3 m radius to one run at 25 mm to the pixel', () => {
    for (const seed of HANDS) {
      expect(fitted(hand(SHAPES.hairpin, 25, seed)).runs).toHaveLength(1);
    }
  });
});

describe('fitting anything a hand can do', () => {
  it('answers 300 random strokes with finite points, 48 at most, and a corner only where one was drawn', () => {
    const next = seeded(99);
    let curved = 0;
    let gentle = 0;
    let cornersAmongGentle = 0;
    for (let i = 0; i < 300; i += 1) {
      // One to eight pieces, a quarter of the joins a sharp turn of up to 170°.
      const pieces: Piece[] = [];
      const count = 1 + Math.floor(next() * 8);
      let sharp = false;
      for (let k = 0; k < count; k += 1) {
        if (k && next() < 0.25) {
          const turn = (next() - 0.5) * 340;
          if (Math.abs(turn) > 100) sharp = true;
          pieces.push({ turn });
        }
        const bend = next() < 0.3 ? 0 : (next() - 0.5) / (300 + next() * 4000);
        if (Math.abs(bend) > 1 / 700) sharp = true;
        pieces.push({ len: 300 + next() * 8000, k: bend });
      }
      const mmPerPx = [10, 25, 50][i % 3];
      const stroke = hand(truth(pieces), mmPerPx, i + 1, 1 + (i % 2) / 2);
      const options = optionsAt(mmPerPx);
      const fit = fitStroke(stroke, options);
      expect(fit.points.length).toBeLessThanOrEqual(48);
      for (const point of fit.points) {
        expect(Number.isFinite(point.xMm) && Number.isFinite(point.yMm)).toBe(true);
      }
      if (readStroke(stroke, options).kind === 'straight') continue;
      curved += 1;
      if (sharp) continue;
      gentle += 1;
      if (sharpest(fit) > 70) cornersAmongGentle += 1;
    }
    // As measured: of the strokes with no turn past 100° and no bend under 0.7 m radius, none
    // came out with a corner.
    expect({ curved, gentle, cornersAmongGentle }).toEqual({
      curved: 264,
      gentle: 174,
      cornersAmongGentle: 0,
    });
  });

  it('stops at 48 points, on a 96 m snake drawn zoomed in', () => {
    const fit = fitStroke(hand(SHAPES.snake, 12, 1), optionsAt(12));
    expect(fit.points).toHaveLength(48);
    expect(fit.closed).toBe(false);
  });

  it('answers what it can of numbers no view gives', () => {
    const ring = sampled(SHAPES.stageRing, 250);
    // A gap wider than the whole stroke leaves a closed line no point to begin on.
    const wide = fitStroke(ring, { ...AT_25, gapMm: 1_000_000 });
    expect(wide.closed).toBe(true);
    expect(wide.points.length).toBeLessThan(3);
    // No smoothing at all is the resampled stroke itself.
    const rough = fitStroke(ring, { ...AT_25, smoothMm: 0 });
    expect(rough.points.length).toBeGreaterThanOrEqual(3);
    expect(apart(rough.points[0], ring[0])).toBeLessThan(1);
  });
});
