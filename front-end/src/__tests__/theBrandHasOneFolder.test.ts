/**
 * The brand has one folder, `src/assets/brand/`, and its files are one drawing (T212).
 *
 * The logo used to sit among 22 files nothing referenced, with no file holding the mark alone, so
 * anyone who needed the mark cut it out of the logo by hand. Now the mark and the wordmark are each
 * their own file, and this test fails when either drifts from the logo, since a copy of a path is
 * free to become a different drawing with nothing on screen to show it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BRAND = join(ROOT, 'src/assets/brand');

interface DrawnPath {
  d: string;
  fill: string;
}

function brandFile(name: string): string {
  return readFileSync(join(BRAND, name), 'utf8');
}

function pathsOf(svg: string): DrawnPath[] {
  return [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
    d: /\bd="([^"]*)"/.exec(tag)?.[1] ?? '',
    fill: /\bfill="([^"]*)"/.exec(tag)?.[1] ?? '',
  }));
}

function rootOf(svg: string): string {
  return /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
}

describe('the brand has one folder', () => {
  const [logoMark, logoWordmark] = pathsOf(brandFile('conventioner-logo.svg'));

  it('the logo is two drawn paths, the mark and then the wordmark', () => {
    expect(pathsOf(brandFile('conventioner-logo.svg'))).toHaveLength(2);
    expect(logoMark.d).not.toBe('');
    expect(logoWordmark.d).not.toBe('');
  });

  it("the mark is the logo's first path and nothing else", () => {
    const svg = brandFile('conventioner-mark.svg');
    expect(pathsOf(svg)).toEqual([logoMark]);
    expect(rootOf(svg)).toContain('viewBox="0 0 48 48"');
  });

  it("the mark's fill is the brand green token", () => {
    const base = readFileSync(join(ROOT, 'src/assets/base.css'), 'utf8');
    const token = /--mm-green:\s*(#[0-9a-f]{6})/i.exec(base)?.[1] ?? '';
    expect(token).not.toBe('');
    expect(logoMark.fill.toLowerCase()).toBe(token.toLowerCase());
  });

  it("the currentColor copy draws the mark's path in the colour around it", () => {
    const svg = brandFile('conventioner-mark-currentcolor.svg');
    expect(pathsOf(svg)).toEqual([{ d: logoMark.d, fill: 'currentColor' }]);
    expect(rootOf(svg)).toContain('viewBox="0 0 48 48"');
  });

  it("the wordmark is the logo's second path and nothing else", () => {
    const svg = brandFile('conventioner-wordmark.svg');
    expect(pathsOf(svg)).toEqual([logoWordmark]);
    expect(logoWordmark.fill).toBe('black');
    expect(rootOf(svg)).toContain('viewBox="57 11 227 25"');
  });

  it('the old icons folder stays gone', () => {
    expect(existsSync(join(ROOT, 'src/assets/icons'))).toBe(false);
  });
});
