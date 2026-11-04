/**
 * The brand has one folder, `src/assets/brand/`, and its files are one drawing (T212).
 *
 * The logo used to sit among 22 files nothing referenced, with no file holding the mark alone, so
 * anyone who needed the mark cut it out of the logo by hand. Now the mark and the wordmark are each
 * their own file, and this test fails when either drifts from the logo, since a copy of a path is
 * free to become a different drawing with nothing on screen to show it.
 *
 * The favicon set in `public/` is generated from the mark by `npm run brand-icons`, and what it
 * holds is asserted from the committed files: a re-render's bytes depend on the Chromium, so nothing
 * here compares a PNG with a fresh one. What a browser receives is
 * `e2e/the-brand-reaches-the-browser.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BRAND = join(ROOT, 'src/assets/brand');
const PUBLIC = join(ROOT, 'public');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_RGB = 2;
const PNG_RGBA = 6;

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

function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/** A PNG's size and colour type, from its IHDR chunk, which always comes first. */
function pngHeader(name: string): { width: number; height: number; colourType: number } {
  const bytes = readFileSync(join(PUBLIC, name));
  expect(isPng(bytes), `${name} is a PNG`).toBe(true);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colourType: bytes.readUInt8(25),
  };
}

/** Each picture an ICO holds: its directory's size, and the bytes that entry points at. */
function icoEntries(name: string): { size: number; height: number; image: Buffer }[] {
  const bytes = readFileSync(join(PUBLIC, name));
  expect(bytes.readUInt16LE(0), 'reserved').toBe(0);
  expect(bytes.readUInt16LE(2), 'type 1 is an icon').toBe(1);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    return {
      size: bytes.readUInt8(entry),
      height: bytes.readUInt8(entry + 1),
      image: bytes.subarray(offset, offset + length),
    };
  });
}

/** The `<link>` tags of `index.html` that name an icon or the manifest, as attribute maps. */
function brandLinks(): Record<string, string>[] {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) =>
      Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
    )
    .filter(({ rel }) => ['icon', 'apple-touch-icon', 'manifest'].includes(rel));
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

describe('the favicon set', () => {
  it('favicon.svg is the mark, byte for byte', () => {
    expect(
      readFileSync(join(PUBLIC, 'favicon.svg')).equals(
        readFileSync(join(BRAND, 'conventioner-mark.svg')),
      ),
    ).toBe(true);
  });

  it('favicon.ico holds 16, 32 and 48px, each a PNG of that size', () => {
    const entries = icoEntries('favicon.ico');
    expect(entries.map((entry) => entry.size)).toEqual([16, 32, 48]);
    for (const { size, height, image } of entries) {
      expect(height).toBe(size);
      expect(isPng(image), `the ${size}px picture is a PNG`).toBe(true);
      expect(image.readUInt32BE(16)).toBe(size);
      expect(image.readUInt32BE(20)).toBe(size);
    }
  });

  it.each([
    { name: 'apple-touch-icon.png', size: 180, colourType: PNG_RGB },
    { name: 'icon-192.png', size: 192, colourType: PNG_RGBA },
    { name: 'icon-512.png', size: 512, colourType: PNG_RGBA },
    { name: 'icon-maskable-512.png', size: 512, colourType: PNG_RGB },
  ])('$name is $size px square, opaque only where iOS and launchers need it', (icon) => {
    expect(pngHeader(icon.name)).toEqual({
      width: icon.size,
      height: icon.size,
      colourType: icon.colourType,
    });
  });

  it('the manifest says what the app is, and asks for the browser display', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({
      name: 'Conventioner',
      short_name: 'Conventioner',
      start_url: '/',
      display: 'browser',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    });
  });

  it('the manifest names files that exist, at the sizes it claims', () => {
    const { icons } = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    expect(icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of icons) {
      const { width, height } = pngHeader(icon.src.replace(/^\//, ''));
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });

  it("index.html's head links the ICO at 32x32, the SVG, the Apple icon and the manifest", () => {
    expect(brandLinks()).toEqual([
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ]);
  });

  it('every link in index.html names a file in public/', () => {
    for (const { href } of brandLinks()) {
      expect(existsSync(join(PUBLIC, href)), `${href} is in public/`).toBe(true);
    }
  });
});
