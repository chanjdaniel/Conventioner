/**
 * Export PNG (T257 ticket 13), `exportLayoutPng.ts` in what a test's DOM can read: the file's name,
 * the map's size on the page, the legend's entries, the drawn map made standalone (each token a
 * colour, each stroke held at its screen size written in the map's millimetres), and the page's SVG
 * with the app's two families embedded and every word set in one of them. The PNG itself, drawn on
 * a canvas, is the E2E's (`the-layout-exports-a-png.spec.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { FloorplanObject, SectionObject, TableTypeObject } from '@/assets/types/datatypes';
import LayoutMap from '@/components/layout/LayoutMap.vue';
import {
  FONTS,
  fontFaces,
  layoutPngName,
  layoutPngSvg,
  legendEntries,
  mapSizePx,
  standaloneMap,
  type EmbeddedFont,
} from '@/components/layout/exportLayoutPng';

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const SECTIONS: SectionObject[] = [
  { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: { id: 1, name: 'Gold' }, count: 0 },
  { id: 'sec-silver', name: 'Silver aisle', location: UPPER, tier: null, count: 0 },
  { id: 'sec-empty', name: 'Bronze', location: UPPER, tier: null, count: 0 },
];
const TYPES: TableTypeObject[] = [
  { id: 'type-6ft', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 },
];

function layout(changes: Partial<FloorplanObject> = {}): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: UPPER.id,
    revision: 1,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables: [
      {
        id: 'g1',
        sectionId: 'sec-gold',
        number: 1,
        tableTypeId: 'type-6ft',
        xMm: 5000,
        yMm: 3000,
        rotation: 0,
      },
      {
        id: 's1',
        sectionId: 'sec-silver',
        number: 1,
        tableTypeId: 'type-6ft',
        xMm: 9000,
        yMm: 8000,
        rotation: 90,
      },
      {
        id: 'x',
        sectionId: null,
        number: null,
        tableTypeId: 'type-6ft',
        xMm: 20_000,
        yMm: 15_000,
        rotation: 0,
      },
    ],
    zones: [{ id: 'z1', label: 'Stage', xMm: 12_000, yMm: 500, widthMm: 8000, depthMm: 3000 }],
    sectionStyles: [],
    startingCounts: [],
    ...changes,
  };
}

const FONT_DATA: EmbeddedFont[] = FONTS.map((font) => ({
  family: font.family,
  weight: font.weight,
  dataUrl: `data:font/woff2;base64,${btoa(font.family)}`,
}));

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

/** The map drawn in print at `size`, as the export draws it off the screen. */
async function printed(size: { width: number; height: number }, floorplan = layout()) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, ...size }) as DOMRect,
  );
  wrapper = mount(LayoutMap, {
    attachTo: document.body,
    props: {
      layout: floorplan,
      locationName: UPPER.name,
      sections: SECTIONS,
      tableTypes: TYPES,
      mode: 'print',
    },
  });
  await nextTick();
  return wrapper.element as unknown as SVGSVGElement;
}

describe("the PNG's name", () => {
  it("is the market's slug, the location's and 'layout'", () => {
    expect(layoutPngName({ name: 'Spring Fair', slug: 'spring-fair-2026' }, UPPER)).toBe(
      'spring-fair-2026-upper-hall-layout.png',
    );
  });

  it("makes the market's slug from its name when it has none", () => {
    expect(layoutPngName({ name: 'Café  Market!' }, { name: 'Hall B / East' })).toBe(
      'cafe-market-hall-b-east-layout.png',
    );
  });
});

describe("the map's size on the page", () => {
  it('is the width of the page inside its margins, at the hall’s shape', () => {
    expect(mapSizePx({ widthMm: 30_000, heightMm: 22_500 })).toEqual({ width: 1488, height: 1116 });
  });

  it('is no taller than a browser can draw twice over, a long thin hall narrowed to it', () => {
    expect(mapSizePx({ widthMm: 1000, heightMm: 20_000 })).toEqual({ width: 400, height: 8000 });
  });
});

describe('the legend', () => {
  it('names the sections the map shows with their tiers, then the tables in none and the zones', () => {
    expect(legendEntries(layout(), SECTIONS)).toEqual([
      {
        swatch: { fill: '--layout-section-1-fill', edge: '--layout-section-1-edge' },
        name: 'Gold row',
        tier: 'Gold',
      },
      {
        swatch: { fill: '--layout-section-2-fill', edge: '--layout-section-2-edge' },
        name: 'Silver aisle',
        tier: '',
      },
      {
        swatch: { fill: '--layout-no-section-fill', edge: '--layout-no-section-edge' },
        name: 'In no section',
        tier: '',
      },
      { swatch: 'zone', name: 'No tables', tier: '' },
    ]);
  });

  it('says nothing of tables in no section or zones a layout does not have', () => {
    const plain = layout();
    const names = legendEntries(
      { ...plain, tables: plain.tables.slice(0, 2), zones: [] },
      SECTIONS,
    ).map((entry) => entry.name);
    expect(names).toEqual(['Gold row', 'Silver aisle']);
  });
});

describe('the map made standalone', () => {
  it("resolves each token to the stylesheet's colour", async () => {
    document.documentElement.style.setProperty('--layout-section-1-fill', '#f8e7c2');
    document.documentElement.style.setProperty('--mm-black', '#272323');
    const map = standaloneMap(await printed({ width: 1488, height: 1116 }), {
      width: 1488,
      height: 1116,
    });
    const markup = new XMLSerializer().serializeToString(map);
    expect(markup).toContain('fill="#f8e7c2"');
    expect(markup).toContain('fill="#272323"');
    expect(markup).not.toContain('var(--layout-section-1-fill)');
    expect(markup).not.toContain('var(--mm-black)');
  });

  it('writes a stroke held at its screen size in the millimetres the map was drawn at', async () => {
    // 30 m across 1,500 px: 20 mm to a pixel.
    const map = standaloneMap(await printed({ width: 1500, height: 1125 }), {
      width: 1500,
      height: 1125,
    });
    expect(map.querySelector('[vector-effect]')).toBeNull();
    const top = map.querySelector('[data-table-id="g1"] rect:not([aria-hidden])');
    expect(Number(top?.getAttribute('stroke-width'))).toBeCloseTo(1.5 * 20);
    const zone = map.querySelector('rect[stroke-dasharray]');
    expect(zone?.getAttribute('stroke-dasharray')).toBe('120 80');
    expect(map.getAttribute('width')).toBe('1500');
    expect(map.getAttribute('height')).toBe('1125');
  });

  it("carries none of the page's classes, styles or test ids, and leaves the drawn map as it was", async () => {
    const drawn = await printed({ width: 1488, height: 1116 });
    const map = standaloneMap(drawn, { width: 1488, height: 1116 });
    expect(map.querySelector('[class], [style], [data-testid]')).toBeNull();
    expect(drawn.getAttribute('data-testid')).toBe('layout-map');
  });
});

describe("the page's SVG", () => {
  async function page(dates: string[] = ['2026-03-07', '2026-03-08']) {
    const size = { width: 1488, height: 1116 };
    const map = standaloneMap(await printed(size), size);
    return layoutPngSvg({
      market: { name: 'Spring Fair', dates },
      location: UPPER,
      layout: layout(),
      sections: SECTIONS,
      map,
      mapSize: size,
      fonts: FONT_DATA,
    });
  }

  it('is 1600 px wide, drawn at twice that', async () => {
    const svg = await page();
    const root = new DOMParser().parseFromString(svg.markup, 'image/svg+xml').documentElement;
    expect(svg.width).toBe(1600);
    expect(root.getAttribute('viewBox')).toBe(`0 0 1600 ${svg.height}`);
    expect(root.getAttribute('width')).toBe('3200');
    expect(root.getAttribute('height')).toBe(String(svg.height * 2));
  });

  it('embeds Outfit and Merge One as data URLs, and sets every word in one of them', async () => {
    const svg = await page();
    const root = new DOMParser().parseFromString(svg.markup, 'image/svg+xml').documentElement;
    const faces = root.querySelector('style')?.textContent ?? '';
    for (const font of FONT_DATA)
      expect(faces).toContain(
        `@font-face { font-family: '${font.family}'; src: url(${font.dataUrl}) format('woff2');`,
      );
    const texts = [...root.querySelectorAll('text')];
    expect(texts.length).toBeGreaterThan(5);
    for (const text of texts)
      expect(text.getAttribute('font-family'), text.textContent ?? '').toMatch(
        /^(Outfit|'Merge One'),/,
      );
    const name = texts.find((text) => text.textContent === 'Spring Fair');
    expect(name?.getAttribute('font-family')).toBe("'Merge One', serif");
    expect(name?.getAttribute('font-size')).toBe('44');
  });

  it("heads the map with the market's name, the location and its dates, and a legend under it", async () => {
    const words = [
      ...new DOMParser()
        .parseFromString((await page()).markup, 'image/svg+xml')
        .querySelectorAll('svg > text'),
    ].map((text) => text.textContent);
    expect(words).toEqual([
      'Spring Fair',
      'Upper Hall',
      '7 to 8 March',
      'Gold row',
      'Gold',
      'Silver aisle',
      'In no section',
      'No tables',
    ]);
  });

  it('says no date for a market with none', async () => {
    const words = [
      ...new DOMParser()
        .parseFromString((await page([])).markup, 'image/svg+xml')
        .querySelectorAll('svg > text'),
    ].map((text) => text.textContent);
    expect(words.slice(0, 3)).toEqual(['Spring Fair', 'Upper Hall', 'Gold row']);
  });
});

describe('the fonts', () => {
  it('are fetched from /fonts/ and embedded as woff2 data URLs', async () => {
    const fetched = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => new Response(new Blob([String(url)])));
    const faces = await fontFaces();
    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      '/fonts/Outfit-VariableFont_wght.woff2',
      '/fonts/MergeOne-Regular.woff2',
    ]);
    expect(faces.map((face) => face.family)).toEqual(['Outfit', 'Merge One']);
    expect(faces[0].dataUrl).toBe(
      `data:font/woff2;base64,${btoa('/fonts/Outfit-VariableFont_wght.woff2')}`,
    );
  });

  it('refuse a font the server does not have, rather than a PNG in a fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(fontFaces()).rejects.toThrow('answered 404');
  });
});
