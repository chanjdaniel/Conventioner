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

/** A length as the editor keeps it: to a tenth of a millimetre. */
export function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A turn as the editor keeps it: 0 up to 360, to a hundredth of a degree. */
export function roundTurn(degrees: number): number {
  const turn = Math.round((((degrees % 360) + 360) % 360) * 100) / 100;
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
