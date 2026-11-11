/**
 * A layout's geometry, pure (T257): what the drawing (`LayoutMap.vue`) and, later, the editor
 * compute from a layout's millimetres. Lengths are millimetres from the floorplan image's top-left
 * corner, y downwards; a rotation is degrees clockwise about a table's centre, as the layout is
 * stored.
 */
import type { FloorplanObject, SectionStyle } from '@/assets/types/datatypes';

export interface PointMm {
  xMm: number;
  yMm: number;
}

/** A table type's sides: `widthMm` along the table before it is turned, `depthMm` across. */
export interface SizeMm {
  widthMm: number;
  depthMm: number;
}

/** A box with its sides along the page's, in millimetres. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The hall a layout is drawn in: its floorplan image's extent at the layout's scale. */
export interface Hall {
  widthMm: number;
  heightMm: number;
}

/** The size a table is drawn at when its type is not one of the market's: a 6 ft trestle table. */
export const STANDARD_TABLE: SizeMm = { widthMm: 1830, depthMm: 760 };

/** The hall of a calibrated layout; null before it has an image and a scale. */
export function hallOf(
  floorplan: Pick<FloorplanObject, 'imageWidth' | 'imageHeight' | 'scalePxPerUnit'>,
): Hall | null {
  const { imageWidth, imageHeight, scalePxPerUnit } = floorplan;
  if (!imageWidth || !imageHeight || !scalePxPerUnit) return null;
  return { widthMm: imageWidth / scalePxPerUnit, heightMm: imageHeight / scalePxPerUnit };
}

/** A turned table's four corners, from its top-left as drawn before the turn, clockwise. */
export function tableCorners(
  table: PointMm & { rotation: number },
  size: SizeMm,
): [PointMm, PointMm, PointMm, PointMm] {
  const turn = (table.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const halfWidth = size.widthMm / 2;
  const halfDepth = size.depthMm / 2;
  const corner = (dx: number, dy: number): PointMm => ({
    xMm: table.xMm + dx * cos - dy * sin,
    yMm: table.yMm + dx * sin + dy * cos,
  });
  return [
    corner(-halfWidth, -halfDepth),
    corner(halfWidth, -halfDepth),
    corner(halfWidth, halfDepth),
    corner(-halfWidth, halfDepth),
  ];
}

/** The box a turned table stands in. */
export function tableBounds(table: PointMm & { rotation: number }, size: SizeMm): Bounds {
  const corners = tableCorners(table, size);
  const xs = corners.map((corner) => corner.xMm);
  const ys = corners.map((corner) => corner.yMm);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** The box that holds every one of `boxes`; null for none. */
export function unionOf(boxes: readonly Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  return boxes.reduce((all, box) => ({
    left: Math.min(all.left, box.left),
    top: Math.min(all.top, box.top),
    right: Math.max(all.right, box.right),
    bottom: Math.max(all.bottom, box.bottom),
  }));
}

/** Whether two boxes share any floor; boxes that only touch do not. */
export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// ── The section palette ──────────────────────────────────────────────────────

/** How many colours the section palette holds: `--layout-section-1-…` to `-8-…` in `base.css`. */
export const PALETTE_SIZE = 8;

/**
 * Each section's place in the palette, 1 to 8. A section keeps the colour its style names; one
 * with no style takes the next colour unused in its layout, in the sections' order, and once all
 * eight are used the palette starts again, so a ninth unstyled section takes the first.
 */
export function sectionColors(
  sectionIds: readonly string[],
  styles: readonly Pick<SectionStyle, 'sectionId' | 'color'>[],
): Map<string, number> {
  const chosen = new Map<string, number>();
  for (const { sectionId, color } of styles) {
    if (
      sectionIds.includes(sectionId) &&
      Number.isInteger(color) &&
      color >= 1 &&
      color <= PALETTE_SIZE
    ) {
      chosen.set(sectionId, color);
    }
  }
  const used = new Set(chosen.values());
  const colors = new Map<string, number>();
  for (const sectionId of sectionIds) {
    const own = chosen.get(sectionId);
    if (own !== undefined) {
      colors.set(sectionId, own);
      continue;
    }
    if (used.size >= PALETTE_SIZE) used.clear();
    let next = 1;
    while (used.has(next)) next += 1;
    used.add(next);
    colors.set(sectionId, next);
  }
  return colors;
}

// ── A section's name beside its tables ───────────────────────────────────────

export interface LabelPlacement {
  /** The boxes of the section's own tables. */
  own: readonly Bounds[];
  /** What the label must not cover: every table's box, and the labels already placed. */
  taken: readonly Bounds[];
  /** The hall the label stays inside; null where the layout has none yet. */
  hall: Hall | null;
  /** The label's own size, and the gap it keeps from its tables. */
  widthMm: number;
  heightMm: number;
  gapMm: number;
}

/**
 * Where a section's name goes when its style names no place: its centre, just outside its tables
 * on the longer side of their box, the side toward the hall's centre, at that side's middle. It
 * stands against the section's own tables there, not against the box, so the name of an L-shaped
 * section is beside one of its arms and never out on the floor between them. Where that would
 * cover a table or another label, or leave the hall, it slides along the side, nearest the middle
 * first, then tries the opposite side and the two shorter ones. With nowhere free it stays at the
 * first choice, held inside the hall. Null for a section with no tables.
 */
export function sectionLabelAt(placement: LabelPlacement): PointMm | null {
  const { own, taken, hall, widthMm, heightMm, gapMm } = placement;
  const box = unionOf(own);
  if (!box) return null;
  const middle = { xMm: (box.left + box.right) / 2, yMm: (box.top + box.bottom) / 2 };
  const centre = hall ? { xMm: hall.widthMm / 2, yMm: hall.heightMm / 2 } : middle;
  const wide = box.right - box.left >= box.bottom - box.top;

  type Side = 'top' | 'bottom' | 'left' | 'right';
  const across: [Side, Side] = middle.yMm <= centre.yMm ? ['bottom', 'top'] : ['top', 'bottom'];
  const along: [Side, Side] = middle.xMm <= centre.xMm ? ['right', 'left'] : ['left', 'right'];
  const sides: Side[] = wide ? [...across, ...along] : [...along, ...across];

  const boxAt = (at: PointMm): Bounds => ({
    left: at.xMm - widthMm / 2,
    right: at.xMm + widthMm / 2,
    top: at.yMm - heightMm / 2,
    bottom: at.yMm + heightMm / 2,
  });
  const free = (at: PointMm): boolean => {
    const label = boxAt(at);
    if (
      hall &&
      (label.left < 0 ||
        label.top < 0 ||
        label.right > hall.widthMm ||
        label.bottom > hall.heightMm)
    ) {
      return false;
    }
    return !taken.some((other) => overlaps(label, other));
  };
  /**
   * The label's centre on a side, `slide` along it from the side's middle, against the section's
   * tables that stand level with it there; null where none does.
   */
  const onSide = (side: Side, slide: number): PointMm | null => {
    if (side === 'top' || side === 'bottom') {
      const xMm = middle.xMm + slide;
      const beside = own.filter(
        (table) => table.left < xMm + widthMm / 2 && xMm - widthMm / 2 < table.right,
      );
      if (!beside.length) return null;
      return side === 'top'
        ? { xMm, yMm: Math.min(...beside.map((table) => table.top)) - gapMm - heightMm / 2 }
        : { xMm, yMm: Math.max(...beside.map((table) => table.bottom)) + gapMm + heightMm / 2 };
    }
    const yMm = middle.yMm + slide;
    const beside = own.filter(
      (table) => table.top < yMm + heightMm / 2 && yMm - heightMm / 2 < table.bottom,
    );
    if (!beside.length) return null;
    return side === 'left'
      ? { xMm: Math.min(...beside.map((table) => table.left)) - gapMm - widthMm / 2, yMm }
      : { xMm: Math.max(...beside.map((table) => table.right)) + gapMm + widthMm / 2, yMm };
  };

  let first: PointMm | null = null;
  for (const side of sides) {
    const runsAcross = side === 'top' || side === 'bottom';
    const reach = (runsAcross ? box.right - box.left : box.bottom - box.top) / 2;
    const step = Math.max((runsAcross ? widthMm : heightMm) / 2, 1);
    for (let slide = 0; slide <= reach; slide += step) {
      for (const signed of slide === 0 ? [0] : [slide, -slide]) {
        const at = onSide(side, signed);
        if (!at) continue;
        first ??= at;
        if (free(at)) return at;
      }
    }
  }

  // A section always has a table level with some place on its first side, so `first` is set.
  const fallback = first ?? middle;
  if (!hall) return fallback;
  const hold = (value: number, half: number, length: number) =>
    length < half * 2 ? length / 2 : Math.min(Math.max(value, half), length - half);
  return {
    xMm: hold(fallback.xMm, widthMm / 2, hall.widthMm),
    yMm: hold(fallback.yMm, heightMm / 2, hall.heightMm),
  };
}

// ── The focus, moved by the arrow keys ───────────────────────────────────────

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * The table an arrow key moves the focus to: the nearest centre within 45° of the arrow's
 * direction, the one most in line winning a tie, then the earlier in the list. Null when none
 * stands that way.
 */
export function nearestInDirection<T extends PointMm>(
  from: PointMm,
  others: readonly T[],
  direction: Direction,
): T | null {
  let best: { table: T; distance: number; aside: number } | null = null;
  for (const table of others) {
    const dx = table.xMm - from.xMm;
    const dy = table.yMm - from.yMm;
    const level = direction === 'left' || direction === 'right';
    const ahead = (level ? dx : dy) * (direction === 'left' || direction === 'up' ? -1 : 1);
    const aside = Math.abs(level ? dy : dx);
    // Float error must not drop a table standing exactly on the cone's edge.
    if (ahead <= 0 || aside > ahead + 1e-6) continue;
    const distance = Math.hypot(dx, dy);
    if (
      !best ||
      distance < best.distance - 1e-6 ||
      (Math.abs(distance - best.distance) <= 1e-6 && aside < best.aside - 1e-6)
    ) {
      best = { table, distance, aside };
    }
  }
  return best?.table ?? null;
}

// ── Sizes on the screen ──────────────────────────────────────────────────────

/** The scale 100% zoom draws a layout at, in screen pixels per millimetre: 1 px to 25 mm, at which
 *  a 6 ft table is 73 by 30 px and a 36 m hall 1,440 px across. */
export const PX_PER_MM_AT_100 = 0.04;

/** The zoom a scale is, as a whole percentage of 100%'s. */
export function zoomPercent(pxPerMm: number): number {
  return Math.round((pxPerMm / PX_PER_MM_AT_100) * 100);
}

/** A table's number is never drawn larger than this, in screen pixels (`--text-sm`). */
export const MAX_NUMBER_PX = 14;
/** Nor smaller than this: a number that cannot fit its table at this size is left out. */
export const MIN_NUMBER_PX = 6;

/**
 * The size a table's number is drawn at, in screen pixels: `MAX_NUMBER_PX` wherever the table has
 * the room, so it holds its size as the layout is zoomed in; smaller to fit a table drawn small,
 * within 70% of its depth and 85% of its width; and 0, left out, below `MIN_NUMBER_PX`.
 */
export function numberSizePx(size: SizeMm, digits: number, pxPerMm: number): number {
  // Outfit's digits at weight 600 are about 0.6 of the type size wide.
  const fits = Math.min(
    MAX_NUMBER_PX,
    size.depthMm * pxPerMm * 0.7,
    (size.widthMm * pxPerMm * 0.85) / (0.6 * Math.max(digits, 1)),
  );
  return fits < MIN_NUMBER_PX ? 0 : fits;
}

/** Whether a number turned with its table would read upside down, and so is drawn a half turn
 *  further: a table turned past a quarter, up to three quarters. */
export function readsUpsideDown(rotation: number): boolean {
  const turn = ((rotation % 360) + 360) % 360;
  return turn > 90 && turn <= 270;
}

// ── Rounding ─────────────────────────────────────────────────────────────────

/**
 * A length as the editor keeps it: to a hundredth of a millimetre. Tables that touch along a curve
 * are each turned to their own angle, so a coarser length would lay one a hair over the next.
 */
export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A turn as the editor keeps it: 0 up to 360, to a thousandth of a degree, which is a hundredth
 *  of a millimetre at the end of a table. */
export function roundTurn(degrees: number): number {
  const turn = Math.round((((degrees % 360) + 360) % 360) * 1000) / 1000;
  return turn === 360 ? 0 : turn;
}

/** An angle held to the nearest whole `step`, as the turn handle does in 15° steps. */
export function snapAngle(degrees: number, step: number): number {
  return Math.round(degrees / step) * step;
}

// ── Hit tests ────────────────────────────────────────────────────────────────

/** Whether a point lies on a turned table, its edge included. */
export function tableHit(point: PointMm, table: PointMm & { rotation: number }, size: SizeMm) {
  const turn = (-table.rotation * Math.PI) / 180;
  const dx = point.xMm - table.xMm;
  const dy = point.yMm - table.yMm;
  const along = dx * Math.cos(turn) - dy * Math.sin(turn);
  const across = dx * Math.sin(turn) + dy * Math.cos(turn);
  return Math.abs(along) <= size.widthMm / 2 && Math.abs(across) <= size.depthMm / 2;
}

// ── Snapping ─────────────────────────────────────────────────────────────────

/** A guide the map draws while a snap holds: a line in millimetres. */
export interface Guide {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export interface Snap {
  /** What the snap adds to the move on each axis; 0 where nothing was near. */
  dxMm: number;
  dyMm: number;
  guides: Guide[];
}

/** The three lines of a box a snap reads on an axis: its near edge, its centre, its far edge. */
function linesOf(box: Bounds, axis: 'x' | 'y'): [number, number, number] {
  return axis === 'x'
    ? [box.left, (box.left + box.right) / 2, box.right]
    : [box.top, (box.top + box.bottom) / 2, box.bottom];
}

/**
 * The snap of moving tables against the tables that stand still: each moving box's edges and
 * centre against each still box's, on each axis apart, within `withinMm`; the nearest pair wins
 * its axis, the earlier pair a tie. Only a still table within `reachMm` along the line it would
 * share is read, so a table lines up with its neighbours and those across an aisle, never with one
 * across the hall. The guide runs along the line they now share, across both boxes. `moving` are
 * the boxes where the move alone would put them.
 */
export function snapMove(
  moving: readonly Bounds[],
  still: readonly Bounds[],
  withinMm: number,
  reachMm = Infinity,
): Snap {
  /** How far apart two boxes stand along the line they would share: 0 where they overlap on it. */
  const apart = (a: Bounds, b: Bounds, axis: 'x' | 'y') =>
    axis === 'x'
      ? Math.max(a.top - b.bottom, b.top - a.bottom, 0)
      : Math.max(a.left - b.right, b.left - a.right, 0);
  const nearest = (axis: 'x' | 'y') => {
    let best: { by: number; line: number; mover: Bounds; other: Bounds } | null = null;
    for (const mover of moving) {
      for (const other of still) {
        if (apart(mover, other, axis) > reachMm) continue;
        for (const from of linesOf(mover, axis)) {
          for (const to of linesOf(other, axis)) {
            const by = to - from;
            if (Math.abs(by) > withinMm) continue;
            if (!best || Math.abs(by) < Math.abs(best.by) - 1e-9) {
              best = { by, line: to, mover, other };
            }
          }
        }
      }
    }
    return best;
  };
  const across = nearest('x');
  const down = nearest('y');
  const dxMm = across?.by ?? 0;
  const dyMm = down?.by ?? 0;
  const guides: Guide[] = [];
  // Each guide spans the two boxes it lines up, the moving one where both snaps leave it.
  if (across) {
    guides.push({
      x1Mm: across.line,
      x2Mm: across.line,
      y1Mm: Math.min(across.mover.top + dyMm, across.other.top),
      y2Mm: Math.max(across.mover.bottom + dyMm, across.other.bottom),
    });
  }
  if (down) {
    guides.push({
      y1Mm: down.line,
      y2Mm: down.line,
      x1Mm: Math.min(down.mover.left + dxMm, down.other.left),
      x2Mm: Math.max(down.mover.right + dxMm, down.other.right),
    });
  }
  return { dxMm, dyMm, guides };
}

// ── Inside the image ─────────────────────────────────────────────────────────

/** A point held inside the hall: a table's centre never leaves the floorplan image's extent. */
export function clampToHall(point: PointMm, hall: Hall | null): PointMm {
  if (!hall) return point;
  return {
    xMm: Math.min(Math.max(point.xMm, 0), hall.widthMm),
    yMm: Math.min(Math.max(point.yMm, 0), hall.heightMm),
  };
}

/**
 * A move of several tables held so that every centre stays inside the hall: the tables keep their
 * places beside each other, and the move stops where the first of them meets an edge. Centres
 * already outside are not pushed further out.
 */
export function clampMove(
  centres: readonly PointMm[],
  move: { dxMm: number; dyMm: number },
  hall: Hall | null,
): { dxMm: number; dyMm: number } {
  if (!hall || !centres.length) return move;
  const hold = (values: number[], by: number, length: number) => {
    const least = Math.min(...values);
    const most = Math.max(...values);
    if (by < 0) return Math.max(by, Math.min(0, -least));
    return Math.min(by, Math.max(0, length - most));
  };
  return {
    dxMm: hold(
      centres.map((c) => c.xMm),
      move.dxMm,
      hall.widthMm,
    ),
    dyMm: hold(
      centres.map((c) => c.yMm),
      move.dyMm,
      hall.heightMm,
    ),
  };
}

/**
 * The one shift that brings several centres back inside the hall together, so tables turned about
 * a point near a wall keep their places beside each other. Where they are wider than the hall, the
 * near side is held.
 */
export function shiftInside(
  centres: readonly PointMm[],
  hall: Hall | null,
): { dxMm: number; dyMm: number } {
  if (!hall || !centres.length) return { dxMm: 0, dyMm: 0 };
  const back = (values: number[], length: number) => {
    const least = Math.min(...values);
    if (least < 0) return -least;
    const most = Math.max(...values);
    return most > length ? length - most : 0;
  };
  return {
    dxMm: back(
      centres.map((c) => c.xMm),
      hall.widthMm,
    ),
    dyMm: back(
      centres.map((c) => c.yMm),
      hall.heightMm,
    ),
  };
}

// ── Turning ──────────────────────────────────────────────────────────────────

/** A table turned by `degrees` clockwise about `about`: its centre carried round, its own turn
 *  grown by as much. A table turned about its own centre stays where it is. */
export function turnedAbout<T extends PointMm & { rotation: number }>(
  table: T,
  about: PointMm,
  degrees: number,
): T {
  const turn = (degrees * Math.PI) / 180;
  const dx = table.xMm - about.xMm;
  const dy = table.yMm - about.yMm;
  return {
    ...table,
    xMm: roundMm(about.xMm + dx * Math.cos(turn) - dy * Math.sin(turn)),
    yMm: roundMm(about.yMm + dx * Math.sin(turn) + dy * Math.cos(turn)),
    rotation: roundTurn(table.rotation + degrees),
  };
}

/** The angle of a point seen from a centre, in degrees clockwise from the page's right. */
export function angleFrom(centre: PointMm, point: PointMm): number {
  return (Math.atan2(point.yMm - centre.yMm, point.xMm - centre.xMm) * 180) / Math.PI;
}

// ── Numbers ──────────────────────────────────────────────────────────────────

type Numbered = { sectionId: string | null; number: number | null };

/** The number a new table of a section takes: one past its highest. */
export function nextNumber(tables: readonly Numbered[], sectionId: string): number {
  return (
    tables.reduce(
      (highest, table) =>
        table.sectionId === sectionId && table.number !== null
          ? Math.max(highest, table.number)
          : highest,
      0,
    ) + 1
  );
}

/**
 * The tables with each section numbered 1 to N again, in the order of the numbers they had, so a
 * removal's later neighbours close its gap. A table in no section keeps no number.
 */
export function closeGaps<T extends Numbered>(tables: readonly T[]): T[] {
  const bySection = new Map<string, T[]>();
  for (const table of tables) {
    if (table.sectionId === null || table.number === null) continue;
    bySection.set(table.sectionId, [...(bySection.get(table.sectionId) ?? []), table]);
  }
  const numbers = new Map<T, number>();
  for (const own of bySection.values()) {
    [...own]
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .forEach((table, index) => numbers.set(table, index + 1));
  }
  return tables.map((table) => {
    const number = numbers.get(table);
    return number === undefined || number === table.number ? table : { ...table, number };
  });
}

// ── The view: pan and zoom ───────────────────────────────────────────────────

/** The least and the most a layout is zoomed: 10% to 800%. */
export const MIN_ZOOM_PX_PER_MM = PX_PER_MM_AT_100 * 0.1;
export const MAX_ZOOM_PX_PER_MM = PX_PER_MM_AT_100 * 8;

/** What the editor's stage shows: the hall's point at its middle, and its scale. */
export interface Camera {
  xMm: number;
  yMm: number;
  pxPerMm: number;
}

export function clampZoom(pxPerMm: number): number {
  return Math.min(Math.max(pxPerMm, MIN_ZOOM_PX_PER_MM), MAX_ZOOM_PX_PER_MM);
}

/** The camera that shows a box of the hall whole in a stage of `width` by `height` pixels, with
 *  `marginPx` clear round it. */
export function fitCamera(box: Bounds, width: number, height: number, marginPx = 0): Camera {
  const across = Math.max(box.right - box.left, 1);
  const down = Math.max(box.bottom - box.top, 1);
  const room = (side: number) => Math.max(side - marginPx * 2, 1);
  return {
    xMm: (box.left + box.right) / 2,
    yMm: (box.top + box.bottom) / 2,
    pxPerMm: clampZoom(Math.min(room(width) / across, room(height) / down)),
  };
}

/** The camera zoomed by `factor` about a point of the stage (in pixels from its middle), which
 *  stays under the pointer. */
export function zoomedAbout(
  camera: Camera,
  factor: number,
  at: { xPx: number; yPx: number } = { xPx: 0, yPx: 0 },
): Camera {
  const pxPerMm = clampZoom(camera.pxPerMm * factor);
  const under = {
    xMm: camera.xMm + at.xPx / camera.pxPerMm,
    yMm: camera.yMm + at.yPx / camera.pxPerMm,
  };
  return { xMm: under.xMm - at.xPx / pxPerMm, yMm: under.yMm - at.yPx / pxPerMm, pxPerMm };
}

/** The next zoom a button steps to: the next of the round percentages above or below. */
export const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800];

export function steppedZoom(pxPerMm: number, direction: 1 | -1): number {
  const percent = (pxPerMm / PX_PER_MM_AT_100) * 100;
  const next =
    direction === 1
      ? ZOOM_STEPS.find((step) => step > percent + 0.5)
      : [...ZOOM_STEPS].reverse().find((step) => step < percent - 0.5);
  return next === undefined ? clampZoom(pxPerMm) : (next / 100) * PX_PER_MM_AT_100;
}

// ── Many tables at once ──────────────────────────────────────────────────────

/** The box between two points, whichever corner it was drawn from. */
export function boxBetween(a: PointMm, b: PointMm): Bounds {
  return {
    left: Math.min(a.xMm, b.xMm),
    top: Math.min(a.yMm, b.yMm),
    right: Math.max(a.xMm, b.xMm),
    bottom: Math.max(a.yMm, b.yMm),
  };
}

/** The tables a box drawn on the floor selects: those whose centre is in it, its edge included. */
export function tablesInBox<T extends PointMm & { id: string }>(
  tables: readonly T[],
  box: Bounds,
): string[] {
  return tables
    .filter(
      (table) =>
        table.xMm >= box.left &&
        table.xMm <= box.right &&
        table.yMm >= box.top &&
        table.yMm <= box.bottom,
    )
    .map((table) => table.id);
}

/** A move of one table, in millimetres. */
export interface MoveMm {
  dxMm: number;
  dyMm: number;
}

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * The move that lines each box up with the others: every left edge to the leftmost, right to the
 * rightmost, top to the topmost, bottom to the lowest, or every centre to the middle of the box
 * that holds them all, across (`centre`) or down (`middle`). A turned table is read by the box it
 * stands in.
 */
export function alignMoves(boxes: readonly Bounds[], how: Alignment): MoveMm[] {
  const all = unionOf(boxes);
  if (!all) return [];
  return boxes.map((box) => {
    switch (how) {
      case 'left':
        return { dxMm: all.left - box.left, dyMm: 0 };
      case 'right':
        return { dxMm: all.right - box.right, dyMm: 0 };
      case 'centre':
        return { dxMm: (all.left + all.right) / 2 - (box.left + box.right) / 2, dyMm: 0 };
      case 'top':
        return { dxMm: 0, dyMm: all.top - box.top };
      case 'bottom':
        return { dxMm: 0, dyMm: all.bottom - box.bottom };
      case 'middle':
        return { dxMm: 0, dyMm: (all.top + all.bottom) / 2 - (box.top + box.bottom) / 2 };
    }
  });
}

/**
 * The move that spaces boxes evenly across or down the page: read in the order they stand, the
 * first and the last stay where they are and the others move so the gaps between neighbours are
 * equal. Fewer than three have nothing to space.
 */
export function spreadMoves(boxes: readonly Bounds[], axis: 'across' | 'down'): MoveMm[] {
  const still = boxes.map(() => ({ dxMm: 0, dyMm: 0 }));
  if (boxes.length < 3) return still;
  const near = (box: Bounds) => (axis === 'across' ? box.left : box.top);
  const far = (box: Bounds) => (axis === 'across' ? box.right : box.bottom);
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => near(a.box) + far(a.box) - (near(b.box) + far(b.box)) || a.index - b.index);
  const taken = order.reduce((sum, { box }) => sum + far(box) - near(box), 0);
  const gap = (far(order[order.length - 1].box) - near(order[0].box) - taken) / (order.length - 1);
  let edge = near(order[0].box);
  for (const { box, index } of order) {
    const by = edge - near(box);
    still[index] = axis === 'across' ? { dxMm: by, dyMm: 0 } : { dxMm: 0, dyMm: by };
    edge += far(box) - near(box) + gap;
  }
  // The last is where it was but for a float's width: it stays exactly.
  still[order[order.length - 1].index] = { dxMm: 0, dyMm: 0 };
  return still;
}

/** Whether two convex shapes, each its corners in order, share any floor; shapes that only touch
 *  do not. Turned tables are judged as they stand, not by the boxes round them. */
export function shapesOverlap(a: readonly PointMm[], b: readonly PointMm[]): boolean {
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i += 1) {
      const from = shape[i];
      const to = shape[(i + 1) % shape.length];
      // The line across this edge: the shapes are apart when their shadows on it are.
      const axis = { x: to.yMm - from.yMm, y: from.xMm - to.xMm };
      const length = Math.hypot(axis.x, axis.y);
      if (length === 0) continue;
      const shadow = (shape: readonly PointMm[]) => {
        const along = shape.map((corner) => (corner.xMm * axis.x + corner.yMm * axis.y) / length);
        return [Math.min(...along), Math.max(...along)];
      };
      const [aNear, aFar] = shadow(a);
      const [bNear, bFar] = shadow(b);
      // A thousandth of a millimetre of float error is touching, not sharing.
      if (aFar <= bNear + 1e-3 || bFar <= aNear + 1e-3) return false;
    }
  }
  return true;
}

/** A box's four corners, clockwise from its top-left. */
export function cornersOf(box: Bounds): PointMm[] {
  return [
    { xMm: box.left, yMm: box.top },
    { xMm: box.right, yMm: box.top },
    { xMm: box.right, yMm: box.bottom },
    { xMm: box.left, yMm: box.bottom },
  ];
}

/** How far a duplicate stands clear of its original, beyond a table's depth or the selection. */
export const DUPLICATE_GAP_MM = 300;

/**
 * Where the duplicates of a selection go, as one move from their originals: one table depth and
 * 300 mm down the page; or, where that would put one over a table or a no-table zone (`taken`,
 * the originals among them) or carry a centre out of the hall, the next free place to the right,
 * a selection's width and 300 mm at a time, then to the left, then up the page. With no free place
 * anywhere they go the first of those ways that stays in the hall, over what stands there, for the
 * organizer to move. `shapes` are the selected tables' corners
 * as they stand turned, and a table's centre the middle of its corners.
 */
export function duplicateOffset(
  shapes: readonly (readonly PointMm[])[],
  taken: readonly (readonly PointMm[])[],
  depthMm: number,
  hall: Hall | null,
): MoveMm {
  const down = { dxMm: 0, dyMm: depthMm + DUPLICATE_GAP_MM };
  const xs = shapes.flatMap((shape) => shape.map((corner) => corner.xMm));
  if (!xs.length) return down;
  const middle = (shape: readonly PointMm[]) => ({
    xMm: shape.reduce((sum, corner) => sum + corner.xMm, 0) / shape.length,
    yMm: shape.reduce((sum, corner) => sum + corner.yMm, 0) / shape.length,
  });
  const inside = (by: MoveMm) =>
    !hall ||
    shapes.every((shape) => {
      const centre = middle(shape);
      const x = centre.xMm + by.dxMm;
      const y = centre.yMm + by.dyMm;
      return x >= 0 && x <= hall.widthMm && y >= 0 && y <= hall.heightMm;
    });
  const free = (by: MoveMm) =>
    inside(by) &&
    !shapes.some((shape) => {
      const copy = shape.map((corner) => ({
        xMm: corner.xMm + by.dxMm,
        yMm: corner.yMm + by.dyMm,
      }));
      return taken.some((other) => shapesOverlap(copy, other));
    });
  if (free(down)) return down;
  const step = Math.max(...xs) - Math.min(...xs) + DUPLICATE_GAP_MM;
  // To the right first, then, against the east wall, to the left and up the page. Without a hall
  // to end a search, a hundred places is far enough.
  const ways: MoveMm[] = [
    { dxMm: step, dyMm: 0 },
    { dxMm: -step, dyMm: 0 },
    { dxMm: 0, dyMm: -down.dyMm },
  ];
  for (const way of ways) {
    for (let place = 1; place <= 100; place += 1) {
      const there = { dxMm: way.dxMm * place, dyMm: way.dyMm * place };
      if (!inside(there)) break;
      if (free(there)) return there;
    }
  }
  // Nowhere is free: the first way that stays in the hall, over what stands there, for the
  // organizer to move, and down only where none does.
  return [down, ...ways].find(inside) ?? down;
}

/**
 * Tables in reading order, as Renumber by position numbers a section: in rows from the top of the
 * page, each row from the left. A row is the tables whose centres stand within half a table's
 * depth of the row's first, the highest not yet in a row, so a ragged row is still one row; a
 * turned table's depth is that of the box it stands in. Two on one spot keep the order given.
 */
export function readingOrder<T extends PointMm>(
  tables: readonly T[],
  boundsOf: (table: T) => Bounds,
): T[] {
  const left = tables
    .map((table, index) => ({ table, index }))
    .sort((a, b) => a.table.yMm - b.table.yMm || a.index - b.index);
  const ordered: T[] = [];
  while (left.length) {
    const first = left[0];
    const box = boundsOf(first.table);
    const reach = (box.bottom - box.top) / 2;
    const row = left.filter(({ table }) => table.yMm - first.table.yMm <= reach);
    left.splice(0, row.length);
    row.sort((a, b) => a.table.xMm - b.table.xMm || a.index - b.index);
    ordered.push(...row.map(({ table }) => table));
  }
  return ordered;
}

/**
 * The tables with each one whose section is not among `sectionIds` put in no section, numberless:
 * a section removed on Section Setup, or moved to another location, leaves its tables on the
 * layout. The same array when every table's section stands.
 */
export function inNoSection<T extends Numbered>(
  tables: readonly T[],
  sectionIds: readonly string[],
): readonly T[] {
  const own = new Set(sectionIds);
  const lost = (table: T) => table.sectionId !== null && !own.has(table.sectionId);
  if (!tables.some(lost)) return tables;
  return tables.map((table) => (lost(table) ? { ...table, sectionId: null, number: null } : table));
}

// ── By keyboard ──────────────────────────────────────────────────────────────

/**
 * Where a table added by keyboard goes: `at` (the middle of the view) held inside the hall, or,
 * where a table or a no-table zone stands there (`taken`, as turned shapes), the nearest clear
 * place a duplicate would find (`duplicateOffset`), so one Enter after another lays tables beside
 * each other, never one on another.
 */
export function clearPlace(
  at: PointMm,
  size: SizeMm,
  taken: readonly (readonly PointMm[])[],
  hall: Hall | null,
): PointMm {
  const held = clampToHall(at, hall);
  const shape = tableCorners({ ...held, rotation: 0 }, size);
  if (!taken.some((other) => shapesOverlap(shape, other))) return held;
  const by = duplicateOffset([shape], taken, size.depthMm, hall);
  return { xMm: held.xMm + by.dxMm, yMm: held.yMm + by.dyMm };
}

/**
 * The camera moved the least that brings a box of the hall into a stage of `width` by `height`
 * pixels with `marginPx` clear round it, at the same zoom; the same camera when the box is in view
 * already. Of a box too long for the stage one way, with its margins, the top or the left end is
 * shown, with the margin, wherever the view stood, so the view holds still from one key to the
 * next.
 */
export function cameraShowing(
  camera: Camera,
  width: number,
  height: number,
  box: Bounds,
  marginPx = 0,
): Camera {
  const along = (middle: number, sidePx: number, least: number, most: number) => {
    const half = sidePx / 2 / camera.pxPerMm;
    const margin = marginPx / camera.pxPerMm;
    if (most - least + margin * 2 > half * 2) return least - margin + half;
    if (least - margin < middle - half) return least - margin + half;
    if (most + margin > middle + half) return most + margin - half;
    return middle;
  };
  const xMm = along(camera.xMm, width, box.left, box.right);
  const yMm = along(camera.yMm, height, box.top, box.bottom);
  return xMm === camera.xMm && yMm === camera.yMm ? camera : { ...camera, xMm, yMm };
}

/** The table whose centre is nearest a point, the earlier in the list of two as near; null of none. */
export function nearestTo<T extends PointMm>(point: PointMm, tables: readonly T[]): T | null {
  let best: T | null = null;
  let least = Infinity;
  for (const table of tables) {
    const distance = Math.hypot(table.xMm - point.xMm, table.yMm - point.yMm);
    if (distance < least) {
      best = table;
      least = distance;
    }
  }
  return best;
}

// ── Along a drawn path ───────────────────────────────────────────────────────
//
// A row of tables follows a path drawn through clicked points. The path is flattened to runs, each
// a polyline with no corner inside it, and everything after works on a run: a straight drag, a
// curve, and the two walls of a corner are one code path.

/** A polyline with no corner inside it: a stretch of a path between two of its corners. */
export type Run = PointMm[];

/** Where a row's tables stand: to the right or the left of the direction drawn, as seen on the
 *  screen, or with the path through their centres. */
export type RowSide = 'right' | 'left' | 'centre';

/** A run with the length along it up to each of its points. */
export interface MeasuredRun {
  points: PointMm[];
  cumulative: number[];
  length: number;
}

/** Where a table of a row stands, and the stretch of its run its back edge spans. */
export interface PathPose {
  xMm: number;
  yMm: number;
  /** Degrees clockwise, in (-90, 90], so a number never reads upside down. */
  rotation: number;
  startS: number;
  endS: number;
}

export interface RowOptions {
  widthMm: number;
  depthMm: number;
  gapMm: number;
  side: RowSide;
  /** What a table of the row never overlaps: each a convex shape by its corners, as the tables
   *  that stand already and the no-table zones. */
  obstacles?: readonly (readonly PointMm[])[];
  /** The floorplan: a table whose centre would stand outside it is left out. */
  extent?: SizeMm;
  maxCount?: number;
}

type Vec = readonly [number, number];
const vec = (point: PointMm): Vec => [point.xMm, point.yMm];
const pointOf = (v: Vec): PointMm => ({ xMm: v[0], yMm: v[1] });
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const plus = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const times = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
const between = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mix = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** How far a middle point may stand off the line through its neighbours and still be on it. */
const STRAIGHT_WITHIN_MM = 0.5;
/** Points nearer each other than this are one point. */
const SAME_POINT_MM = 1;

interface Circle {
  centre: Vec;
  radius: number;
  /** +1 where the angle grows from a to c, clockwise on the screen. */
  way: number;
}

/** The circle through three points; null where they stand in a line. */
function circleThrough(a: Vec, b: Vec, c: Vec): Circle | null {
  const chord = between(a, c);
  const sagitta = Math.abs(cross(minus(c, a), minus(b, a))) / (chord || 1);
  if (chord === 0 || sagitta < STRAIGHT_WITHIN_MM) return null;
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = dot(a, a);
  const b2 = dot(b, b);
  const c2 = dot(c, c);
  const centre: Vec = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
  return { centre, radius: between(centre, a), way: Math.sign(cross(minus(b, a), minus(c, b))) };
}

/** The angle a circle's arc sweeps from p to q, the way the circle was drawn; 0 exclusive to a
 *  whole turn. */
function sweepOn(circle: Circle, p: Vec, q: Vec): number {
  const from = Math.atan2(p[1] - circle.centre[1], p[0] - circle.centre[0]);
  const to = Math.atan2(q[1] - circle.centre[1], q[0] - circle.centre[0]);
  let sweep = (to - from) * circle.way;
  while (sweep <= 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  return sweep;
}

/** The arc of a circle from p to q, as a place for each t from 0 to 1. */
function arcOn(circle: Circle, p: Vec, q: Vec): (t: number) => Vec {
  const from = Math.atan2(p[1] - circle.centre[1], p[0] - circle.centre[0]);
  const sweep = sweepOn(circle, p, q);
  return (t) => {
    const angle = from + circle.way * sweep * t;
    return [
      circle.centre[0] + circle.radius * Math.cos(angle),
      circle.centre[1] + circle.radius * Math.sin(angle),
    ];
  };
}

/** A curve from t 0 to 1 as a polyline no further than `toleranceMm` off it, by halving. */
function flattened(curve: (t: number) => Vec, toleranceMm: number): Vec[] {
  const out: Vec[] = [curve(0)];
  const halve = (t0: number, p0: Vec, t1: number, p1: Vec, depth: number) => {
    const tm = (t0 + t1) / 2;
    const pm = curve(tm);
    const chord = between(p0, p1);
    const off =
      chord === 0 ? between(pm, p0) : Math.abs(cross(minus(p1, p0), minus(pm, p0))) / chord;
    if (depth < 12 && (off > toleranceMm || depth < 2)) {
      halve(t0, p0, tm, pm, depth + 1);
      halve(tm, pm, t1, p1, depth + 1);
    } else {
      out.push(p1);
    }
  };
  halve(0, out[0], 1, curve(1), 0);
  return out;
}

/**
 * The smooth path through clicked points, as runs split at its corners. Each span between two
 * points blends the circle through the point before it with the circle through the point after
 * (a circle-blend spline), so points clicked along a circular wall give back the circle exactly,
 * however many or unevenly they are. A point is a corner where either span beside it would sweep
 * more than `cornerDeg` on the circle through it and its two neighbours, or where the path turns
 * straight back: an L-shaped wall is two straight runs, with no bulge. A point in a line with its
 * neighbours carries that line on, so a span from a straight wall into a curve leaves the wall
 * along it and bends toward the curve. Two points are one straight run, and fewer are no path. A
 * span with no curve in it is its two ends alone.
 */
export function smoothRuns(
  points: readonly PointMm[],
  options: { toleranceMm?: number; cornerDeg?: number } = {},
): Run[] {
  const tolerance = options.toleranceMm ?? 2;
  const limit = ((options.cornerDeg ?? 70) * Math.PI) / 180;
  const at: Vec[] = [];
  for (const point of points) {
    const next = vec(point);
    if (!at.length || between(at[at.length - 1], next) >= SAME_POINT_MM) at.push(next);
  }
  if (at.length < 2) return [];

  /** The circle at point i; 'corner' where the path turns too sharply there; 'straight' where its
   *  neighbours stand in a line with it; null at an end, which has one neighbour. */
  const turnAt = (i: number): Circle | 'corner' | 'straight' | null => {
    if (i <= 0 || i >= at.length - 1) return null;
    const [a, b, c] = [at[i - 1], at[i], at[i + 1]];
    const circle = circleThrough(a, b, c);
    if (!circle) return dot(minus(b, a), minus(c, b)) < 0 ? 'corner' : 'straight';
    return Math.max(sweepOn(circle, a, b), sweepOn(circle, b, c)) > limit ? 'corner' : circle;
  };
  const turns = at.map((_, i) => turnAt(i));

  const runs: Vec[][] = [];
  let run: Vec[] = [];
  for (let i = 0; i < at.length - 1; i += 1) {
    const [p, q] = [at[i], at[i + 1]];
    const before = turns[i];
    const after = turns[i + 1];
    if (before === 'corner' && run.length) {
      runs.push(run);
      run = [];
    }
    const line = (t: number) => mix(p, q, t);
    /** How the path leaves or reaches a point: on its circle, along its line, or (null) however
     *  the span's other end has it. */
    const way = (turn: Circle | 'corner' | 'straight' | null) =>
      turn === 'straight' ? line : turn && turn !== 'corner' ? arcOn(turn, p, q) : null;
    const first = way(before);
    const second = way(after);
    const curved = (first && first !== line) || (second && second !== line);
    const span: Vec[] = !curved
      ? [p, q]
      : first && second
        ? flattened((t) => mix(first(t), second(t), t), tolerance)
        : flattened((first ?? second)!, tolerance);
    // The clicked points themselves, not where a cosine put them.
    span[0] = p;
    span[span.length - 1] = q;
    run = run.length ? run.concat(span.slice(1)) : span;
  }
  runs.push(run);
  return runs.map((one) => one.map(pointOf));
}

/** A run with the length along it up to each point. */
export function measureRun(run: Run): MeasuredRun {
  const cumulative = [0];
  for (let i = 1; i < run.length; i += 1) {
    cumulative.push(cumulative[i - 1] + between(vec(run[i - 1]), vec(run[i])));
  }
  return { points: run, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/** The segment of a run that holds the length `s` along it, by its first point's index. */
function segmentAt(run: MeasuredRun, s: number): number {
  let low = 0;
  let high = run.cumulative.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (run.cumulative[middle] <= s) low = middle;
    else high = middle;
  }
  return low;
}

function vecAtLength(run: MeasuredRun, s: number): Vec {
  const { points, cumulative } = run;
  if (s <= 0) return vec(points[0]);
  if (s >= run.length) return vec(points[points.length - 1]);
  const i = segmentAt(run, s);
  const span = cumulative[i + 1] - cumulative[i] || 1;
  return mix(vec(points[i]), vec(points[i + 1]), (s - cumulative[i]) / span);
}

/** The point of a run at a length along it, held to the run's ends. */
export function pointAtLength(run: MeasuredRun, s: number): PointMm {
  return pointOf(vecAtLength(run, s));
}

/**
 * How far along a run the first point after `fromS` stands that is `chordMm` from the point at
 * `fromS` in a straight line: where the far end of a table's back edge meets the path. Null where
 * the run ends first.
 */
export function chordEnd(run: MeasuredRun, fromS: number, chordMm: number): number | null {
  const a = vecAtLength(run, fromS);
  for (let i = segmentAt(run, fromS); i < run.points.length - 1; i += 1) {
    const p = vec(run.points[i]);
    const q = vec(run.points[i + 1]);
    if (between(q, a) < chordMm) continue;
    // Where on p to q the distance from a is the chord: the further of the two answers.
    const along = minus(q, p);
    const from = minus(p, a);
    const A = dot(along, along);
    const B = 2 * dot(from, along);
    const C = dot(from, from) - chordMm * chordMm;
    const root = Math.sqrt(Math.max(0, B * B - 4 * A * C));
    const t = Math.min(1, Math.max(0, (-B + root) / (2 * A)));
    const s = run.cumulative[i] + t * (run.cumulative[i + 1] - run.cumulative[i]);
    if (s > fromS) return s;
  }
  return null;
}

function toSegment(point: Vec, a: Vec, b: Vec): number {
  const along = minus(b, a);
  const t = Math.max(0, Math.min(1, dot(minus(point, a), along) / (dot(along, along) || 1)));
  return between(point, plus(a, times(along, t)));
}

function separationOf(a: readonly Vec[], b: readonly Vec[]): number {
  let best = -Infinity;
  for (const [shape, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (let i = 0; i < shape.length; i += 1) {
      const edge = minus(shape[(i + 1) % shape.length], shape[i]);
      const length = Math.hypot(edge[0], edge[1]);
      if (length === 0) continue;
      const axis: Vec = [edge[1] / length, -edge[0] / length];
      let near = Infinity;
      let far = -Infinity;
      for (const corner of shape) {
        const along = dot(corner, axis);
        near = Math.min(near, along);
        far = Math.max(far, along);
      }
      let otherNear = Infinity;
      let otherFar = -Infinity;
      for (const corner of other) {
        const along = dot(corner, axis);
        otherNear = Math.min(otherNear, along);
        otherFar = Math.max(otherFar, along);
      }
      best = Math.max(best, otherNear - far, near - otherFar);
    }
  }
  if (best <= 0) return best;
  let least = Infinity;
  for (const [shape, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const corner of shape) {
      for (let j = 0; j < other.length; j += 1) {
        least = Math.min(least, toSegment(corner, other[j], other[(j + 1) % other.length]));
      }
    }
  }
  return least;
}

/**
 * How far apart two convex shapes stand, each its corners in order: the distance between them
 * where they are apart, 0 where they touch, and less than nothing, by how deep one is in the
 * other, where they overlap.
 */
export function separation(a: readonly PointMm[], b: readonly PointMm[]): number {
  return separationOf(a.map(vec), b.map(vec));
}

interface Pose {
  centre: Vec;
  rotation: number;
  startS: number;
  endS: number;
}

function poseAt(
  run: MeasuredRun,
  startS: number,
  widthMm: number,
  depthMm: number,
  side: RowSide,
): Pose | null {
  const endS = chordEnd(run, startS, widthMm);
  if (endS === null) return null;
  const a = vecAtLength(run, startS);
  const b = vecAtLength(run, endS);
  const length = between(a, b) || 1;
  const along: Vec = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const right: Vec = [-along[1], along[0]];
  const middle = mix(a, b, 0.5);
  // How far the path bows off the chord between the table's ends, to its right and to its left.
  let most = 0;
  let least = 0;
  for (
    let i = segmentAt(run, startS) + 1;
    i < run.points.length && run.cumulative[i] < endS;
    i += 1
  ) {
    const off = dot(minus(vec(run.points[i]), middle), right);
    most = Math.max(most, off);
    least = Math.min(least, off);
  }
  const off =
    side === 'centre'
      ? (most + least) / 2
      : side === 'right'
        ? most + depthMm / 2
        : least - depthMm / 2;
  let rotation = (Math.atan2(along[1], along[0]) * 180) / Math.PI;
  if (rotation > 90) rotation -= 180;
  else if (rotation <= -90) rotation += 180;
  return { centre: plus(middle, times(right, off)), rotation, startS, endS };
}

const shown = (pose: Pose): PathPose => ({
  xMm: pose.centre[0],
  yMm: pose.centre[1],
  rotation: pose.rotation,
  startS: pose.startS,
  endS: pose.endS,
});

/**
 * Where one table of a row stands, its back edge beginning `startS` along the run: the edge is a
 * chord of the path, as long as the table is wide, and the table stands off it to the side asked,
 * never across the path. Inside a bend its two back corners touch the path; outside one, the
 * middle of its back edge does. `centre` puts the path through the table's middle instead. Null
 * where the table does not fit before the run ends.
 */
export function poseOnPath(
  run: MeasuredRun,
  startS: number,
  widthMm: number,
  depthMm: number,
  side: RowSide,
): PathPose | null {
  const pose = poseAt(run, startS, widthMm, depthMm, side);
  return pose && shown(pose);
}

function cornersAt(centre: Vec, rotation: number, widthMm: number, depthMm: number): Vec[] {
  const turn = (rotation * Math.PI) / 180;
  const half = times([Math.cos(turn), Math.sin(turn)], widthMm / 2);
  const deep = times([-Math.sin(turn), Math.cos(turn)], depthMm / 2);
  return [
    minus(minus(centre, half), deep),
    minus(plus(centre, half), deep),
    plus(plus(centre, half), deep),
    plus(minus(centre, half), deep),
  ];
}

/** How near a place found by halving is to the first clear one, along the run. */
const MARCH_WITHIN_MM = 0.05;
/** How far off the gap asked a table's first try may stand and be taken as it is. */
const MARCH_EXACT_MM = 0.01;

interface Standing {
  centre: Vec;
  /** As far as any of its corners stands from its centre. */
  reach: number;
  corners: Vec[];
}

/**
 * A row of tables along runs, in the order drawn: each table goes at the first place along its run
 * where it stands exactly `gapMm` clear of every table before it (further on inside a bend than
 * where the last one's edge ended, nearer outside one), so no two overlap at any radius and the
 * gap asked holds where they are nearest. On a straight run that is `floor((length + gap) /
 * (width + gap))` tables, a table's width and the gap apart. A table is placed only while its
 * whole back edge fits before its run ends. A place that would overlap one of `obstacles` is
 * passed over for the next clear one; a table whose centre would stand outside `extent` is left
 * out, the row going on as if it stood there; and no more than `maxCount` are placed.
 * `placedBefore` are tables of the same size the row keeps its gap from, as an earlier row of the
 * same gesture.
 */
export function placeAlongRuns(
  runs: readonly Run[],
  options: RowOptions,
  placedBefore: readonly PathPose[] = [],
): PathPose[] {
  const { widthMm, depthMm, gapMm, side, extent } = options;
  const maxCount = options.maxCount ?? Infinity;
  const half = Math.hypot(widthMm, depthMm) / 2;
  const standing = (centre: Vec, rotation: number): Standing => ({
    centre,
    reach: half,
    corners: cornersAt(centre, rotation, widthMm, depthMm),
  });
  /** The tables of the row so far, with those before it. */
  const placed: Standing[] = placedBefore.map((pose) =>
    standing([pose.xMm, pose.yMm], pose.rotation),
  );
  // Only what stands near the path can be in a table's way: the rest is left out once, here,
  // rather than asked about at every place tried.
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const run of runs) {
    for (const point of run) {
      box.left = Math.min(box.left, point.xMm);
      box.right = Math.max(box.right, point.xMm);
      box.top = Math.min(box.top, point.yMm);
      box.bottom = Math.max(box.bottom, point.yMm);
    }
  }
  const near = half * 2 + 1;
  const obstacles: Standing[] = [];
  for (const shape of options.obstacles ?? []) {
    const corners = shape.map(vec);
    const centre = times(
      corners.reduce<Vec>((sum, corner) => plus(sum, corner), [0, 0]),
      1 / (corners.length || 1),
    );
    const reach = Math.max(0, ...corners.map((c) => between(c, centre)));
    if (
      centre[0] + reach < box.left - near ||
      centre[0] - reach > box.right + near ||
      centre[1] + reach < box.top - near ||
      centre[1] - reach > box.bottom + near
    ) {
      continue;
    }
    obstacles.push({ centre, corners, reach });
  }
  const out: PathPose[] = [];

  /** How clear a pose stands of everything, less the gap from the row's own: 0 or more is clear. */
  const slack = (pose: Pose): number => {
    const corners = cornersAt(pose.centre, pose.rotation, widthMm, depthMm);
    let best = Infinity;
    for (let i = placed.length - 1; i >= 0; i -= 1) {
      const other = placed[i];
      if (between(pose.centre, other.centre) > half + other.reach + gapMm + 1) continue;
      best = Math.min(best, separationOf(corners, other.corners) - gapMm);
      // Too near one is too near: how much nearer another stands changes nothing.
      if (best < -MARCH_EXACT_MM) return best;
    }
    for (const other of obstacles) {
      if (between(pose.centre, other.centre) > half + other.reach + 1) continue;
      best = Math.min(best, separationOf(corners, other.corners));
      if (best < -MARCH_EXACT_MM) return best;
    }
    return best;
  };

  for (const points of runs) {
    if (points.length < 2) continue;
    const run = measureRun(points);
    const at = (s: number) => poseAt(run, s, widthMm, depthMm, side);
    /** The first clear place between one that is not and one that is, by halving. */
    const firstClear = (blocked: number, clear: number): Pose => {
      let low = blocked;
      let high = clear;
      while (high - low > MARCH_WITHIN_MM) {
        const middle = (low + high) / 2;
        const pose = at(middle);
        if (pose && slack(pose) >= 0) high = middle;
        else low = middle;
      }
      return at(high)!;
    };
    const step = widthMm / 16;
    let s = 0;
    let lastS = -Infinity;
    while (out.length < maxCount) {
      let pose = at(s);
      if (!pose) break;
      const clear = slack(pose);
      if (clear < -MARCH_EXACT_MM) {
        // Too near: on to the first clear place.
        let blocked = s;
        let found: number | null = null;
        for (let next = s + step; ; next += step) {
          const there = at(next);
          if (!there) break;
          if (slack(there) >= 0) {
            found = next;
            break;
          }
          blocked = next;
        }
        if (found === null) break;
        pose = firstClear(blocked, found);
      } else if (clear > MARCH_EXACT_MM) {
        // Looser than asked, as outside a bend: back to the first clear place.
        let found = s;
        let blocked: number | null = null;
        for (let next = s - step; next > lastS && next >= 0; next -= step) {
          const there = at(next);
          if (!there || slack(there) < 0) {
            blocked = next;
            break;
          }
          found = next;
        }
        if (blocked !== null) pose = firstClear(blocked, found);
        else pose = at(found)!;
      }
      placed.push(standing(pose.centre, pose.rotation));
      const inside =
        !extent ||
        (pose.centre[0] >= 0 &&
          pose.centre[0] <= extent.widthMm &&
          pose.centre[1] >= 0 &&
          pose.centre[1] <= extent.depthMm);
      if (inside) out.push(shown(pose));
      lastS = pose.startS;
      s = pose.endS + gapMm;
    }
  }
  return out;
}

/**
 * Where a point of a path being drawn snaps: to the nearest corner of a table within `withinMm`,
 * else to the nearest of the lines the tables' edges lie on within it, on the edge or up to
 * `reachMm` past its end, else nowhere. So a row begun on the end corner of another goes on from
 * it, touching, and one begun further along lines up with it. `shapes` are the tables as they
 * stand turned.
 */
export function snapPoint(
  point: PointMm,
  shapes: readonly (readonly PointMm[])[],
  withinMm: number,
  reachMm = 0,
): PointMm {
  const from = vec(point);
  let corner: Vec | null = null;
  let onEdge: Vec | null = null;
  let cornerAway = withinMm;
  let edgeAway = withinMm;
  for (const shape of shapes) {
    for (let i = 0; i < shape.length; i += 1) {
      const a = vec(shape[i]);
      const b = vec(shape[(i + 1) % shape.length]);
      const away = between(from, a);
      if (away <= cornerAway) {
        corner = a;
        cornerAway = away;
      }
      const along = minus(b, a);
      const length = Math.hypot(along[0], along[1]);
      if (length === 0) continue;
      const past = reachMm / length;
      const t = dot(minus(from, a), along) / (length * length);
      if (t < -past || t > 1 + past) continue;
      const foot = plus(a, times(along, t));
      const off = between(from, foot);
      if (off <= edgeAway) {
        onEdge = foot;
        edgeAway = off;
      }
    }
  }
  const to = corner ?? onEdge;
  return to ? pointOf(to) : point;
}
