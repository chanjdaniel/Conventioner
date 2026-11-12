/**
 * True curves and a hand's strokes over them, for the tests of a row's line drawn by hand (T257).
 * No real hand drew any of it: a "hand" is a seeded stroke over a true curve, a sample every 6 to
 * 14 px, off the curve by a slow drift, a wobble and a tremor of 4, 2 and 1 px over 150, 60 and
 * 25 px of stroke, on whole pixels, its press and its release on the curve.
 */
import type { PointMm, StrokeOptions } from '@/components/layout/layoutGeometry';

export const p = (xMm: number, yMm: number): PointMm => ({ xMm, yMm });
export const apart = (a: PointMm, b: PointMm) => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);

/** A seeded source of numbers from 0 to 1 (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A piece of a true curve: a stretch of a length and a curvature (1/mm, over 0 turning clockwise
 *  on the screen), or a sharp turn in degrees. */
export type Piece = { len: number; k: number } | { turn: number };

/** A true curve from its pieces, a point every 5 mm. */
export function truth(pieces: readonly Piece[], start: [number, number] = [0, 0], heading = 0) {
  let [x, y] = start;
  let facing = heading;
  const out = [p(x, y)];
  for (const piece of pieces) {
    if ('turn' in piece) {
      facing += (piece.turn * Math.PI) / 180;
      continue;
    }
    const steps = Math.max(1, Math.round(piece.len / 5));
    const step = piece.len / steps;
    for (let i = 0; i < steps; i += 1) {
      facing += (piece.k * step) / 2;
      x += Math.cos(facing) * step;
      y += Math.sin(facing) * step;
      facing += (piece.k * step) / 2;
      out.push(p(x, y));
    }
  }
  return out;
}

/** A true curve as a stroke with no hand in it: a sample every so many millimetres, and both its
 *  ends. */
export function sampled(curve: readonly PointMm[], everyMm: number): PointMm[] {
  const out: PointMm[] = [];
  let since = 0;
  curve.forEach((point, i) => {
    if (i === 0 || i === curve.length - 1 || (since += 5) >= everyMm) {
      out.push(point);
      if (i) since = 0;
    }
  });
  return out;
}

/** A hand's stroke over a true curve, as the pointer reports it at `mmPerPx`; `shake` scales how
 *  far the hand strays. */
export function hand(curve: readonly PointMm[], mmPerPx: number, seed: number, shake = 1) {
  const next = seeded(seed);
  const phase = [next() * 6.28, next() * 6.28, next() * 6.28];
  const along = [0];
  for (let i = 1; i < curve.length; i += 1)
    along.push(along[i - 1] + apart(curve[i - 1], curve[i]));
  const length = along[along.length - 1];
  const out: PointMm[] = [];
  let s = 0;
  let j = 0;
  for (;;) {
    while (j < along.length - 2 && along[j + 1] < s) j += 1;
    const a = curve[j];
    const b = curve[j + 1];
    const t = (s - along[j]) / (along[j + 1] - along[j] || 1);
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    const l = Math.hypot(dx, dy) || 1;
    const px = s / mmPerPx;
    const strays = s === 0 || s === length ? 0 : 1;
    const off =
      strays *
      shake *
      (4 * Math.sin((6.28 * px) / 150 + phase[0]) +
        2 * Math.sin((6.28 * px) / 60 + phase[1]) +
        Math.sin((6.28 * px) / 25 + phase[2]));
    const x = (a.xMm + dx * t) / mmPerPx - (dy / l) * off;
    const y = (a.yMm + dy * t) / mmPerPx + (dx / l) * off;
    out.push(p(Math.round(x) * mmPerPx, Math.round(y) * mmPerPx));
    if (s >= length) break;
    s = Math.min(length, s + (6 + 8 * next()) * mmPerPx);
  }
  return out;
}

const R5 = 1 / 5000;
/** A chord of a length bowed by a sagitta: an arc from (0, 0) to (chord, 0). */
export function bowed(chordMm: number, sagittaMm: number): PointMm[] {
  const radius = (chordMm * chordMm) / (8 * sagittaMm) + sagittaMm / 2;
  const half = Math.asin(chordMm / 2 / radius);
  return truth([{ len: 2 * half * radius, k: 1 / radius }], [0, 0], -half);
}
/** A ring of a radius from (0, 0), centred on (0, radius), let go `shortMm` short of its start
 *  (under 0: past it). */
export const ringOf = (radiusMm: number, shortMm: number) =>
  truth([{ len: 2 * Math.PI * radiusMm - shortMm, k: 1 / radiusMm }]);

/** The shapes of `curves.md` section 9, each a true curve. */
export const SHAPES = {
  /** An S of 20 m: two arcs of 5 m radius, 10 m each. */
  s: truth([
    { len: 10_000, k: R5 },
    { len: 10_000, k: -R5 },
  ]),
  /** A ring 10 m across, let go 300 mm short of its start. */
  ring: ringOf(5000, 300),
  /** A ring round a 3 m stage, 1.9 m in radius, let go 200 mm short. */
  stageRing: ringOf(1900, 200),
  /** 90° of 8 m radius. */
  arc90: truth([{ len: (Math.PI / 2) * 8000, k: 1 / 8000 }]),
  /** 200° of 4 m radius. */
  arc200: truth([{ len: ((200 * Math.PI) / 180) * 4000, k: 1 / 4000 }]),
  /** A wall of 12 m into a quarter bend of 2 m radius. */
  wallIntoBend: truth([
    { len: 12_000, k: 0 },
    { len: (Math.PI / 2) * 2000, k: 1 / 2000 },
  ]),
  /** An oval 12 m by 6 m, let go 100 mm short. */
  oval: truth([
    { len: 6000 - 100, k: 0 },
    { len: Math.PI * 3000, k: 1 / 3000 },
    { len: 6000, k: 0 },
    { len: Math.PI * 3000, k: 1 / 3000 },
  ]),
  /** An L of two 8 m walls, in one stroke. */
  l: truth([{ len: 8000, k: 0 }, { turn: 90 }, { len: 8000, k: 0 }]),
  /** 6 m out, a turn of 0.3 m radius, 4 m back. */
  hairpin: truth([
    { len: 6000, k: 0 },
    { len: Math.PI * 300, k: 1 / 300 },
    { len: 4000, k: 0 },
  ]),
  line: truth([{ len: 20_000, k: 0 }]),
  /** 96 m of sixteen 6 m bends of 3 m radius, 1.4 m to each side of its line. */
  snake: truth(Array.from({ length: 16 }, (_, i) => ({ len: 6000, k: (i % 2 ? -1 : 1) / 3000 }))),
} as const;

/** The stroke's numbers in screen pixels (`STROKE_PX`), as millimetres at a zoom. */
export const optionsAt = (mmPerPx: number, straight = false): StrokeOptions => ({
  stepMm: 4 * mmPerPx,
  smoothMm: 16 * mmPerPx,
  toleranceMm: 12 * mmPerPx,
  gapMm: 8 * mmPerPx,
  closeWithinMm: 24 * mmPerPx,
  straightWithinMm: 10 * mmPerPx,
  straightMostMm: 24 * mmPerPx,
  straight,
});

/** How far a point is from a polyline. */
export function offLine(point: PointMm, line: readonly PointMm[]): number {
  let least = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    const l2 = dx * dx + dy * dy;
    const t = Math.max(
      0,
      Math.min(1, l2 ? ((point.xMm - a.xMm) * dx + (point.yMm - a.yMm) * dy) / l2 : 0),
    );
    least = Math.min(least, Math.hypot(point.xMm - a.xMm - t * dx, point.yMm - a.yMm - t * dy));
  }
  return least;
}

/** How far the points of some lines stand off another line, at most. */
export const furthestOff = (lines: readonly (readonly PointMm[])[], from: readonly PointMm[]) =>
  Math.max(0, ...lines.flatMap((line) => line.map((point) => offLine(point, from))));
