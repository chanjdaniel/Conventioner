/**
 * The favicon set (T212): writes every icon in `public/` from `src/assets/brand/conventioner-mark.svg`.
 *
 * Run it by hand when the mark changes, and commit what it writes: `npm run brand-icons`. Neither CI
 * nor the build runs it, so a deploy's build needs no browser. It renders with the Chromium that
 * `@playwright/test` installs and writes the ICO itself, so it adds no dependency.
 *
 * `public/manifest.webmanifest` is written by hand; the sizes here are the ones it names.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

const MARK = fileURLToPath(new URL('../src/assets/brand/conventioner-mark.svg', import.meta.url));
const PUBLIC = new URL('../public/', import.meta.url);

/** A picture of the mark: `size` square, the mark `markSize` square at its centre. */
interface Picture {
  size: number;
  markSize: number;
  /** A white tile, for what fills transparency with its own colour; else transparent. */
  opaque: boolean;
}

/** A transparent picture with the mark filling it. */
const fullMark = (size: number): Picture => ({ size, markSize: size, opaque: false });

const PNGS: Record<string, Picture> = {
  // iOS fills transparency with black, so this must be opaque and padded.
  'apple-touch-icon.png': { size: 180, markSize: 140, opaque: true },
  'icon-192.png': fullMark(192),
  'icon-512.png': fullMark(512),
  // A launcher crops this to its own shape; the safe zone is the central 409px circle.
  'icon-maskable-512.png': { size: 512, markSize: 384, opaque: true },
};

const ICO_SIZES = [16, 32, 48];

async function renderPng(browser: Browser, mark: string, picture: Picture): Promise<Buffer> {
  const { size, markSize, opaque } = picture;
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  try {
    const inset = (size - markSize) / 2;
    await page.setContent(`<!doctype html>
      <style>
        html, body { margin: 0; background: ${opaque ? 'white' : 'transparent'}; }
        svg { position: fixed; left: ${inset}px; top: ${inset}px; width: ${markSize}px; height: ${markSize}px; }
      </style>
      ${mark}`);
    return await page.screenshot({ omitBackground: !opaque });
  } finally {
    await page.close();
  }
}

/**
 * An ICO of PNGs: a six-byte header, a sixteen-byte directory entry per picture, then each picture's
 * bytes, which every current browser reads.
 */
function ico(pictures: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pictures.length, 4);

  let offset = header.length + pictures.length * 16;
  const directory = pictures.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...directory, ...pictures.map(({ png }) => png)]);
}

const mark = readFileSync(MARK, 'utf8');
const browser = await chromium.launch();
try {
  for (const [name, picture] of Object.entries(PNGS)) {
    writeFileSync(new URL(name, PUBLIC), await renderPng(browser, mark, picture));
  }
  const pictures = [];
  for (const size of ICO_SIZES) {
    pictures.push({ size, png: await renderPng(browser, mark, fullMark(size)) });
  }
  writeFileSync(new URL('favicon.ico', PUBLIC), ico(pictures));
  copyFileSync(MARK, new URL('favicon.svg', PUBLIC));
} finally {
  await browser.close();
}
