/**
 * Tables as shapes, for a spec that reads a stored layout (T257): a turned table's corners and
 * how far apart two shapes stand, reckoned here on their own, so a spec judges what the editor
 * placed by arithmetic that is not the editor's.
 */
export interface PointMm {
  xMm: number;
  yMm: number;
}

/** A table's four corners as it stands turned, clockwise about its centre. */
export function cornersOf(
  table: PointMm & { rotation: number },
  size: { widthMm: number; depthMm: number },
): PointMm[] {
  const turn = (table.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const corner = (dx: number, dy: number): PointMm => ({
    xMm: table.xMm + dx * cos - dy * sin,
    yMm: table.yMm + dx * sin + dy * cos,
  });
  const [w, d] = [size.widthMm / 2, size.depthMm / 2];
  return [corner(-w, -d), corner(w, -d), corner(w, d), corner(-w, d)];
}

function toSegment(point: PointMm, a: PointMm, b: PointMm): number {
  const [dx, dy] = [b.xMm - a.xMm, b.yMm - a.yMm];
  const along = ((point.xMm - a.xMm) * dx + (point.yMm - a.yMm) * dy) / (dx * dx + dy * dy || 1);
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(point.xMm - (a.xMm + dx * t), point.yMm - (a.yMm + dy * t));
}

/**
 * How far apart two convex shapes stand, each its corners in order: their distance where they are
 * apart, 0 where they touch, and less than nothing, by how deep one is in the other, where they
 * overlap.
 */
export function apart(a: PointMm[], b: PointMm[]): number {
  let widest = -Infinity;
  for (const shape of [a, b]) {
    shape.forEach((from, i) => {
      const to = shape[(i + 1) % shape.length];
      const length = Math.hypot(to.xMm - from.xMm, to.yMm - from.yMm);
      if (!length) return;
      // The line across this edge: how far the shapes' shadows on it are from each other.
      const axis = { x: (to.yMm - from.yMm) / length, y: (from.xMm - to.xMm) / length };
      const shadow = (corners: PointMm[]) => {
        const on = corners.map((corner) => corner.xMm * axis.x + corner.yMm * axis.y);
        return [Math.min(...on), Math.max(...on)];
      };
      const [aNear, aFar] = shadow(a);
      const [bNear, bFar] = shadow(b);
      widest = Math.max(widest, bNear - aFar, aNear - bFar);
    });
  }
  if (widest <= 0) return widest;
  let least = Infinity;
  for (const [shape, other] of [
    [a, b],
    [b, a],
  ]) {
    for (const corner of shape) {
      other.forEach((from, i) => {
        least = Math.min(least, toSegment(corner, from, other[(i + 1) % other.length]));
      });
    }
  }
  return least;
}
