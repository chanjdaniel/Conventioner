/**
 * A location's layout as a PNG fit to print (T257): the market's name over the map, the location
 * and the market's dates beside it, the map as the page draws it (`LayoutMap.vue` in `print`), and
 * under it a legend of the sections it shows, with "No tables" for its zones. The page is drawn as
 * one standalone SVG 1600 px wide and rendered on a canvas at twice that, 3200 px wide, then saved
 * as `<market-slug>-<location-slug>-layout.png`.
 *
 * A standalone SVG drawn as an image reads nothing of the page: not its stylesheet, its fonts or
 * its session. So every token the drawing names (`var(--layout-section-1-fill)`) is resolved by
 * `canvasColor()`, the app's two families are embedded as data URLs fetched from `/fonts/`, and the
 * floorplan image, read on its market with the session (T272), is embedded as a data URL too, so
 * the canvas is never tainted and the image is the one the page shows. A stroke the map holds at
 * its screen size (`vector-effect: non-scaling-stroke`) is written at the size the map was drawn
 * at instead, so the picture is the same at any size it is rendered.
 */
import { createApp, nextTick } from 'vue';
import type {
  FloorplanObject,
  LocationObject,
  SectionObject,
  TableTypeObject,
} from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { canvasColor } from '@/utils/canvasColor';
import { saveFile } from '@/utils/download';
import { marketNameToKebabSlug } from '@/utils/marketSlug';
import { getDatesInWords } from '@/utils/utils';
import LayoutMap from './LayoutMap.vue';
import { NO_SECTION_PAINT, layoutSections, textWidthPx, type Paint } from './layoutDrawing';
import { hallOf } from './layoutGeometry';

/** The page's width in the SVG's pixels; the PNG is twice it. */
const PAGE_WIDTH_PX = 1600;
/** How much larger than the SVG the PNG is drawn. */
const PNG_SCALE = 2;
const MARGIN_PX = 56;
const MAP_WIDTH_PX = PAGE_WIDTH_PX - MARGIN_PX * 2;
/** The tallest a map is drawn, so a long, thin hall still makes a canvas a browser can hold. */
const MAX_MAP_HEIGHT_PX = 8000;

const NAME_SIZE_PX = 44;
const MIN_NAME_SIZE_PX = 28;
const PLACE_SIZE_PX = 22;
const DATES_SIZE_PX = 18;
const HEAD_HEIGHT_PX = 64;
const GAP_PX = 32;

const LEGEND_TEXT_PX = 18;
const LEGEND_TIER_PX = 16;
const LEGEND_ROW_PX = 36;
const SWATCH_WIDTH_PX = 32;
const SWATCH_HEIGHT_PX = 20;
const ITEM_GAP_PX = 40;

/** The app's two families as the PNG embeds them, by the files `main.css` names. */
export const FONTS = [
  { family: 'Outfit', url: '/fonts/Outfit-VariableFont_wght.woff2', weight: '100 900' },
  { family: 'Merge One', url: '/fonts/MergeOne-Regular.woff2', weight: '400' },
] as const;

/** What the export draws: the market, the location and its layout, and what the dialog chose. */
export interface LayoutExport {
  market: { name: string; slug?: string; dates: readonly string[] };
  location: Pick<LocationObject, 'name'>;
  layout: FloorplanObject;
  sections: readonly SectionObject[];
  tableTypes: readonly TableTypeObject[];
  /** "Include the venue's floorplan": the image under the tables. */
  withImage: boolean;
  /** "Show table numbers". */
  withNumbers: boolean;
}

/** The PNG's file name: `<market-slug>-<location-slug>-layout.png`. */
export function layoutPngName(
  market: { name: string; slug?: string },
  location: Pick<LocationObject, 'name'>,
): string {
  const parts = [
    market.slug || marketNameToKebabSlug(market.name),
    marketNameToKebabSlug(location.name),
  ];
  return `${parts.filter(Boolean).join('-')}-layout.png`;
}

/** Make the layout's PNG and save it under its name. */
export async function exportLayoutPng(what: LayoutExport): Promise<void> {
  const png = await layoutPng(what);
  saveFile(png, layoutPngName(what.market, what.location));
}

/** The layout's PNG, 3200 px wide. */
async function layoutPng(what: LayoutExport): Promise<Blob> {
  const hall = hallOf(what.layout);
  if (!hall) throw new Error('A layout with no scale has no map to export');
  const [fonts, image] = await Promise.all([
    fontFaces(),
    what.withImage && what.layout.imageGridfsId ? imageDataUrl(what.layout.imageGridfsId) : '',
  ]);
  // The words are measured in the app's type, so it must be at hand before the page is laid out.
  await Promise.all(
    [
      `400 ${NAME_SIZE_PX}px 'Merge One'`,
      `600 ${PLACE_SIZE_PX}px Outfit`,
      `400 ${DATES_SIZE_PX}px Outfit`,
    ].map((font) => document.fonts?.load(font)),
  );
  const mapSize = mapSizePx(hall);
  const map = await drawnMap(what, image, mapSize);
  const svg = layoutPngSvg({ ...what, map, mapSize, fonts });
  return render(svg.markup, svg.width, svg.height);
}

/** The map's size on the page: the page's width, at the hall's shape, no taller than the most. */
export function mapSizePx(hall: { widthMm: number; heightMm: number }): {
  width: number;
  height: number;
} {
  const height = (MAP_WIDTH_PX * hall.heightMm) / hall.widthMm;
  if (height <= MAX_MAP_HEIGHT_PX) return { width: MAP_WIDTH_PX, height: Math.round(height) };
  return {
    width: Math.round((MAX_MAP_HEIGHT_PX * hall.widthMm) / hall.heightMm),
    height: MAX_MAP_HEIGHT_PX,
  };
}

// ── The map, drawn and made standalone ───────────────────────────────────────

/**
 * The layout drawn by `LayoutMap` in `print` at its size on the page, off the screen, and taken
 * as a standalone `<svg>` element.
 */
async function drawnMap(
  what: LayoutExport,
  imageUrl: string,
  size: { width: number; height: number },
): Promise<SVGSVGElement> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${size.width}px`,
    height: `${size.height}px`,
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(host);
  const app = createApp(LayoutMap, {
    layout: what.layout,
    locationName: what.location.name,
    sections: what.sections,
    tableTypes: what.tableTypes,
    mode: 'print',
    imageUrl,
    showImage: what.withImage,
    numbers: what.withNumbers,
  });
  try {
    app.mount(host);
    // Drawn once it has measured its box, and again once its type has loaded.
    await nextTick();
    await document.fonts?.ready;
    await nextTick();
    const drawn = host.querySelector('svg');
    if (!drawn) throw new Error('The layout drew no map');
    return standaloneMap(drawn, size);
  } finally {
    app.unmount();
    host.remove();
  }
}

/**
 * A copy of a drawn map that holds its picture alone: each token resolved to its colour, each
 * stroke held at its screen size written at that size in the map's millimetres, and placed at the
 * size it was drawn at.
 */
export function standaloneMap(
  drawn: SVGSVGElement,
  size: { width: number; height: number },
): SVGSVGElement {
  const map = drawn.cloneNode(true) as SVGSVGElement;
  const [, , viewWidth, viewHeight] = (map.getAttribute('viewBox') ?? '0 0 1 1')
    .split(/\s+/)
    .map(Number);
  // The view is drawn whole in its box, as `preserveAspectRatio` fits it.
  const mmPerPx = Math.max(viewWidth / size.width, viewHeight / size.height);
  for (const el of [map, ...map.querySelectorAll('*')]) {
    for (const name of ['class', 'style', 'tabindex', 'data-testid']) el.removeAttribute(name);
    for (const name of ['fill', 'stroke']) {
      const value = el.getAttribute(name);
      if (value) el.setAttribute(name, canvasColor(value));
    }
    if (el.getAttribute('vector-effect') === 'non-scaling-stroke') {
      el.removeAttribute('vector-effect');
      const width = Number(el.getAttribute('stroke-width') ?? 1);
      el.setAttribute('stroke-width', String(width * mmPerPx));
      const dashes = el.getAttribute('stroke-dasharray');
      if (dashes)
        el.setAttribute(
          'stroke-dasharray',
          dashes
            .split(/[\s,]+/)
            .map((dash) => String(Number(dash) * mmPerPx))
            .join(' '),
        );
    }
  }
  map.setAttribute('width', String(size.width));
  map.setAttribute('height', String(size.height));
  return map;
}

// ── The page ─────────────────────────────────────────────────────────────────

/** An `@font-face` the PNG embeds: a family and its file as a data URL. */
export interface EmbeddedFont {
  family: string;
  weight: string;
  dataUrl: string;
}

/** A legend's entry: a swatch, a name and what follows it (the section's tier). */
interface LegendEntry {
  swatch: Paint | 'zone';
  name: string;
  tier: string;
}

/** The sections the map shows, then the tables in none and the zones, as the legend names them. */
export function legendEntries(
  layout: FloorplanObject,
  sections: readonly SectionObject[],
): LegendEntry[] {
  const drawn = layoutSections(layout, sections);
  const entries: LegendEntry[] = drawn
    .filter(({ tables }) => tables.length)
    .map(({ section, paint }) => ({
      swatch: paint,
      name: section.name,
      tier: section.tier?.name ?? '',
    }));
  const placed = drawn.reduce((sum, { tables }) => sum + tables.length, 0);
  if (placed < layout.tables.length)
    entries.push({ swatch: NO_SECTION_PAINT, name: 'In no section', tier: '' });
  if (layout.zones.length) entries.push({ swatch: 'zone', name: 'No tables', tier: '' });
  return entries;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const color = (token: string) => escape(canvasColor(`var(${token})`));

/** Words cut to a width, with an ellipsis where they were cut. */
function fitted(text: string, widthPx: number, sizePx: number, weight: number, family?: string) {
  if (textWidthPx(text, sizePx, weight, family) <= widthPx) return text;
  let kept = text;
  while (kept.length > 1 && textWidthPx(`${kept}…`, sizePx, weight, family) > widthPx)
    kept = kept.slice(0, -1);
  return `${kept.trimEnd()}…`;
}

/**
 * The PNG's page as SVG markup, in the SVG's pixels: the head (the market's name in Merge One at
 * the left, shrunk to share the line, the location and the dates at the right), the map under it,
 * and the legend, its entries flowing in rows. Its size says the PNG's, twice the page.
 */
export function layoutPngSvg(page: {
  market: { name: string; dates: readonly string[] };
  location: Pick<LocationObject, 'name'>;
  layout: FloorplanObject;
  sections: readonly SectionObject[];
  map: SVGSVGElement;
  mapSize: { width: number; height: number };
  fonts: readonly EmbeddedFont[];
}): { markup: string; width: number; height: number } {
  const black = color('--mm-black');
  const muted = color('--mm-text-muted');
  const right = PAGE_WIDTH_PX - MARGIN_PX;

  // The head: the place and the dates at the right, the name in what is left of the line.
  const place = page.location.name;
  const dates = getDatesInWords(page.market.dates);
  const placeWidth = Math.max(
    textWidthPx(place, PLACE_SIZE_PX, 600),
    dates ? textWidthPx(dates, DATES_SIZE_PX, 400) : 0,
  );
  const nameRoom = MAP_WIDTH_PX - placeWidth - GAP_PX;
  const fullName = textWidthPx(page.market.name, NAME_SIZE_PX, 400, 'Merge One');
  const nameSize = Math.max(
    MIN_NAME_SIZE_PX,
    Math.min(NAME_SIZE_PX, (NAME_SIZE_PX * nameRoom) / fullName),
  );
  const name = fitted(page.market.name, nameRoom, nameSize, 400, 'Merge One');
  const head = [
    `<text x="${MARGIN_PX}" y="${MARGIN_PX + 46}" font-family="'Merge One', serif" font-size="${nameSize}" fill="${black}">${escape(name)}</text>`,
    `<text x="${right}" y="${MARGIN_PX + 24}" font-family="Outfit, sans-serif" font-weight="600" font-size="${PLACE_SIZE_PX}" text-anchor="end" fill="${black}">${escape(place)}</text>`,
    dates
      ? `<text x="${right}" y="${MARGIN_PX + 54}" font-family="Outfit, sans-serif" font-weight="400" font-size="${DATES_SIZE_PX}" text-anchor="end" fill="${muted}">${escape(dates)}</text>`
      : '',
  ];

  // The map, centred under the head, edged as the page edges it.
  const mapTop = MARGIN_PX + HEAD_HEIGHT_PX + GAP_PX;
  const mapLeft = (PAGE_WIDTH_PX - page.mapSize.width) / 2;
  page.map.setAttribute('x', String(mapLeft));
  page.map.setAttribute('y', String(mapTop));
  const mapMarkup = new XMLSerializer().serializeToString(page.map);
  const mapEdge = `<rect x="${mapLeft - 0.5}" y="${mapTop - 0.5}" width="${page.mapSize.width + 1}" height="${page.mapSize.height + 1}" fill="none" stroke="${color('--mm-border')}" stroke-width="1"/>`;

  // The legend, its entries in rows.
  const legend: string[] = [];
  let x = MARGIN_PX;
  let row = 0;
  const legendTop = mapTop + page.mapSize.height + GAP_PX;
  for (const entry of legendEntries(page.layout, page.sections)) {
    const nameWidth = textWidthPx(entry.name, LEGEND_TEXT_PX, 600);
    const tierWidth = entry.tier ? 8 + textWidthPx(entry.tier, LEGEND_TIER_PX, 400) : 0;
    const width = SWATCH_WIDTH_PX + 10 + nameWidth + tierWidth;
    if (x > MARGIN_PX && x + width > right) {
      x = MARGIN_PX;
      row += 1;
    }
    const middle = legendTop + row * LEGEND_ROW_PX + LEGEND_ROW_PX / 2;
    const swatch =
      entry.swatch === 'zone'
        ? `fill="url(#legend-hatch)" stroke="${color('--layout-zone-edge')}" stroke-dasharray="4 3"`
        : `fill="${color(entry.swatch.fill)}" stroke="${color(entry.swatch.edge)}"`;
    legend.push(
      `<rect x="${x}" y="${middle - SWATCH_HEIGHT_PX / 2}" width="${SWATCH_WIDTH_PX}" height="${SWATCH_HEIGHT_PX}" rx="6" ${swatch} stroke-width="1.5"/>`,
      `<text x="${x + SWATCH_WIDTH_PX + 10}" y="${middle}" dy="0.36em" font-family="Outfit, sans-serif" font-weight="600" font-size="${LEGEND_TEXT_PX}" fill="${black}">${escape(entry.name)}</text>`,
    );
    if (entry.tier)
      legend.push(
        `<text x="${x + SWATCH_WIDTH_PX + 10 + nameWidth + 8}" y="${middle}" dy="0.36em" font-family="Outfit, sans-serif" font-weight="400" font-size="${LEGEND_TIER_PX}" fill="${muted}">${escape(entry.tier)}</text>`,
      );
    x += width + ITEM_GAP_PX;
  }
  const legendHeight = legend.length ? (row + 1) * LEGEND_ROW_PX : 0;

  const width = PAGE_WIDTH_PX;
  const height = Math.ceil(
    legendTop + legendHeight + (legend.length ? MARGIN_PX : MARGIN_PX - GAP_PX),
  );
  const faces = page.fonts
    .map(
      (font) =>
        `@font-face { font-family: '${font.family}'; src: url(${font.dataUrl}) format('woff2'); font-weight: ${font.weight}; font-style: normal; }`,
    )
    .join('\n');
  const markup = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * PNG_SCALE}" height="${height * PNG_SCALE}" viewBox="0 0 ${width} ${height}">`,
    `<defs><style>${faces}</style>`,
    `<pattern id="legend-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${color('--layout-zone-fill')}"/><line x1="0.75" y1="0" x2="0.75" y2="6" stroke="${color('--layout-zone-hatch')}" stroke-width="1.5"/></pattern>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
    ...head,
    mapMarkup,
    mapEdge,
    ...legend,
    `</svg>`,
  ].join('\n');
  return { markup, width, height };
}

// ── What the page embeds ─────────────────────────────────────────────────────

/** A blob as a data URL. */
function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The app's families, each file fetched from `/fonts/` as a data URL. */
export async function fontFaces(): Promise<EmbeddedFont[]> {
  return Promise.all(
    FONTS.map(async (font) => {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error(`${font.url} answered ${response.status}`);
      const blob = await response.blob();
      const dataUrl = await dataUrlOf(new Blob([blob], { type: 'font/woff2' }));
      return { family: font.family, weight: font.weight, dataUrl };
    }),
  );
}

/** The floorplan image, read on its market with the session, as a data URL. */
async function imageDataUrl(gridfsId: string): Promise<string> {
  const { data } = await api.get<Blob>(`/floorplans/${encodeURIComponent(gridfsId)}`, {
    responseType: 'blob',
  });
  return dataUrlOf(data);
}

// ── The PNG ──────────────────────────────────────────────────────────────────

/** The page's SVG rendered on a canvas at its own size, twice the page, as a PNG. */
async function render(markup: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The layout could not be drawn'));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = width * PNG_SCALE;
    canvas.height = height * PNG_SCALE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas to draw the layout on');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be made'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
