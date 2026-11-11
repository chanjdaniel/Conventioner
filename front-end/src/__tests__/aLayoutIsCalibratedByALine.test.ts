/**
 * A layout's scale is set by a line of known length (T257 ticket 02).
 */
import { describe, expect, it } from 'vitest';
import { clampToImage, lengthMm, metresAcross, pxPerMm } from '@/components/layout/calibration';

describe("a layout's scale", () => {
  it('reads a typed length in each unit as millimetres', () => {
    expect(lengthMm('30', 'm')).toBe(30_000);
    expect(lengthMm('250', 'cm')).toBe(2500);
    expect(lengthMm('1830', 'mm')).toBe(1830);
    expect(lengthMm('10', 'ft')).toBeCloseTo(3048);
    expect(lengthMm('12', 'in')).toBeCloseTo(304.8);
    expect(lengthMm(' 2.5 ', 'm')).toBe(2500);
  });

  it('reads no length from words, nothing, zero or less', () => {
    for (const typed of ['', ' ', 'ten', '0', '-3', 'Infinity']) {
      expect(lengthMm(typed, 'm')).toBeNull();
    }
  });

  it("is the line's pixels over its millimetres", () => {
    expect(pxPerMm([0, 300], [800, 300], 30_000)).toBeCloseTo(800 / 30_000);
    expect(pxPerMm([0, 0], [300, 400], 5000)).toBeCloseTo(0.1);
  });

  it('is not read from a line too short to be measured', () => {
    expect(pxPerMm([10, 10], [15, 10], 1000)).toBeNull();
    expect(pxPerMm([10, 10], [10, 10], 1000)).toBeNull();
  });

  it('says the floorplan 800 px wide at 30 m to the line reads "30.0 m across"', () => {
    const scale = pxPerMm([0, 0], [800, 0], 30_000);
    expect(metresAcross({ imageWidth: 800, scalePxPerUnit: scale })).toBe('30.0 m across');
    expect(metresAcross({ imageWidth: 800, scalePxPerUnit: 800 / 36_000 })).toBe('36.0 m across');
  });

  it('says nothing before a scale', () => {
    expect(metresAcross({ imageWidth: 800, scalePxPerUnit: null })).toBeNull();
    expect(metresAcross(null)).toBeNull();
  });

  it('keeps a point inside the image', () => {
    expect(clampToImage([-5, 900], 800, 600)).toEqual([0, 600]);
    expect(clampToImage([400, 300], 800, 600)).toEqual([400, 300]);
  });
});
