/**
 * A layout's scale, as arithmetic the page does (T257): a line drawn over something of known
 * length on the floorplan, in the image's pixels, and that length, give the pixels per millimetre
 * every table is drawn at. The server stores what the page computes; there is no route for it.
 */
import type { FloorplanObject } from '@/assets/types/datatypes';

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';

/** The units a length is typed in, m first, as the unit select offers them. */
export const LENGTH_UNITS: { unit: LengthUnit; label: string; mm: number }[] = [
  { unit: 'm', label: 'm', mm: 1000 },
  { unit: 'cm', label: 'cm', mm: 10 },
  { unit: 'mm', label: 'mm', mm: 1 },
  { unit: 'ft', label: 'ft', mm: 304.8 },
  { unit: 'in', label: 'in', mm: 25.4 },
];

export type Point = [number, number];

/** A typed length in millimetres; null when it is no positive number. */
export function lengthMm(typed: string | number, unit: LengthUnit): number | null {
  const value = typeof typed === 'number' ? typed : Number(String(typed).trim());
  const factor = LENGTH_UNITS.find((u) => u.unit === unit)?.mm;
  if (!factor || !Number.isFinite(value) || value <= 0 || String(typed).trim() === '') return null;
  return value * factor;
}

export function pixelLength(start: Point, end: Point): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

/** The shortest line the scale is read from: shorter, a pixel's error is too much of it. */
export const MIN_LINE_PX = 10;

/** The scale a line of `mm` gives, in image pixels per millimetre; null for a line too short. */
export function pxPerMm(start: Point, end: Point, mm: number): number | null {
  const px = pixelLength(start, end);
  if (px < MIN_LINE_PX || !(mm > 0)) return null;
  return px / mm;
}

/** How wide the floorplan reads at its scale, "36.0 m across"; null before it has one. */
export function metresAcross(
  floorplan: Pick<FloorplanObject, 'imageWidth' | 'scalePxPerUnit'> | null | undefined,
): string | null {
  const width = floorplan?.imageWidth;
  const scale = floorplan?.scalePxPerUnit;
  if (!width || !scale) return null;
  return `${(width / scale / 1000).toFixed(1)} m across`;
}

/** A point kept inside the image. */
export function clampToImage(point: Point, width: number, height: number): Point {
  return [Math.min(Math.max(point[0], 0), width), Math.min(Math.max(point[1], 0), height)];
}
