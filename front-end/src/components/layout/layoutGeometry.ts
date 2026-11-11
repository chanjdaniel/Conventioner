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
