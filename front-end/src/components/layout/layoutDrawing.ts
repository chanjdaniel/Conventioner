/**
 * What a layout's drawing says and paints (T257): the sections a layout draws, each one's colour of
 * the section palette, and a table's code and name. `LayoutMap.vue` draws from these and the page's
 * "Sections" card lists from them, so the map and its legend can never disagree.
 */
import type {
  FloorplanObject,
  FloorplanTable,
  SectionObject,
  TableTypeObject,
} from '@/assets/types/datatypes';
import { plural } from '@/utils/utils';
import { sectionColors } from './layoutGeometry';

/** A fill and the edge round it, as the names of two tokens of `base.css`. */
export interface Paint {
  fill: string;
  edge: string;
}

/** The paint of the section palette's colour `index`, 1 to 8. */
export function sectionPaint(index: number): Paint {
  return { fill: `--layout-section-${index}-fill`, edge: `--layout-section-${index}-edge` };
}

/** The paint of a table in no section. */
export const NO_SECTION_PAINT: Paint = {
  fill: '--layout-no-section-fill',
  edge: '--layout-no-section-edge',
};

export interface LayoutSection {
  section: SectionObject & { id: string };
  /** Its place in the section palette, 1 to 8. */
  color: number;
  paint: Paint;
  /** Its tables, in number order. */
  tables: FloorplanTable[];
}

/**
 * The sections a layout draws, in the plan's order: those of its location, each with its colour
 * and its tables. A table whose section is gone, or is another location's, is in none of them.
 */
export function layoutSections(
  layout: Pick<FloorplanObject, 'locationId' | 'tables' | 'sectionStyles'>,
  sections: readonly SectionObject[],
): LayoutSection[] {
  const here = sections.filter(
    (section): section is SectionObject & { id: string } =>
      Boolean(section.id) &&
      Boolean(layout.locationId) &&
      section.location?.id === layout.locationId,
  );
  const colors = sectionColors(
    here.map((section) => section.id),
    layout.sectionStyles ?? [],
  );
  return here.map((section) => {
    const color = colors.get(section.id) ?? 1;
    return {
      section,
      color,
      paint: sectionPaint(color),
      // A table with a section and no number is no table of the section: it has no code.
      tables: layout.tables
        .filter((table) => table.sectionId === section.id && table.number !== null)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    };
  });
}

/** A table's code, "Gold row 5", as the server's `table_code_for` names it; null in no section. */
export function tableCode(
  table: Pick<FloorplanTable, 'number'>,
  section: Pick<SectionObject, 'name'> | null | undefined,
): string | null {
  return section && table.number !== null ? `${section.name} ${table.number}` : null;
}

/** A length in metres to one decimal, "12.4 m". */
export const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;

/** Where a table's centre stands, in metres from the floorplan's top-left corner: "12.4 m, 6.1 m". */
export function placeInMetres(table: Pick<FloorplanTable, 'xMm' | 'yMm'>): string {
  return `${metres(table.xMm)}, ${metres(table.yMm)}`;
}

/** What a table is called on the map: "Gold row 5, Standard 6 ft", or "Table in no section,
 *  Standard 6 ft". A type that is not the market's is left unsaid. */
export function tableName(
  table: Pick<FloorplanTable, 'number'>,
  section: Pick<SectionObject, 'name'> | null | undefined,
  type: Pick<TableTypeObject, 'name'> | null | undefined,
): string {
  const what = tableCode(table, section) ?? 'Table in no section';
  return type ? `${what}, ${type.name}` : what;
}

/** What the map is called: "Upper Hall layout, 49 tables". */
export function mapName(locationName: string, tables: number): string {
  return `${locationName} layout, ${plural(tables, 'table', 'tables')}`;
}

let measurer: CanvasRenderingContext2D | null | undefined;

/**
 * How wide words are drawn in the app's type at a size and weight, in pixels, measured as the
 * browser would draw them. Where nothing can measure (a test's DOM has no canvas), it is reckoned
 * from Outfit's average letter, a little over half the size.
 */
export function textWidthPx(text: string, sizePx: number, weight = 600): number {
  if (measurer === undefined) {
    try {
      // jsdom says its canvas is not implemented by a console error; a user agent check spares it.
      measurer = /jsdom/i.test(globalThis.navigator?.userAgent ?? '')
        ? null
        : document.createElement('canvas').getContext('2d');
    } catch {
      measurer = null;
    }
  }
  if (measurer) {
    measurer.font = `${weight} ${sizePx}px Outfit, sans-serif`;
    return measurer.measureText(text).width;
  }
  return text.length * sizePx * 0.56;
}
