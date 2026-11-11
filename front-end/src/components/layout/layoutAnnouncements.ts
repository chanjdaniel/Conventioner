/**
 * What the layout's editor says of a change (T257), for a screen reader: each move, turn,
 * placement and removal in a sentence, with a table by its code ("Gold row 5") and a place in
 * metres to one decimal from the floorplan's top-left corner, as the selection's card reads it.
 * The page holds one polite live region and puts these in it.
 */
import { ref, type Ref } from 'vue';
import type { FloorplanTable } from '@/assets/types/datatypes';
import { plural } from '@/utils/historyReaders/shared';
import { metres, placeInMetres, tableCode, type LayoutSection } from './layoutDrawing';
import type { Alignment, Bounds, PointMm } from './layoutGeometry';

/** A table's code among the sections the map draws; null for a table in no section. */
function codeOf(table: FloorplanTable, sections: readonly LayoutSection[]): string | null {
  const section = sections.find(({ section: one }) => one.id === table.sectionId)?.section;
  return tableCode(table, section);
}

/** The tables by name where a sentence begins: "Gold row 5", "Table in no section", "3 tables". */
function named(tables: readonly FloorplanTable[], sections: readonly LayoutSection[]): string {
  if (tables.length !== 1) return plural(tables.length, 'table', 'tables');
  return codeOf(tables[0], sections) ?? 'Table in no section';
}

/** The tables by name after a verb: "Added Gold row 10", "Removed a table in no section". */
function object(tables: readonly FloorplanTable[], sections: readonly LayoutSection[]): string {
  if (tables.length !== 1) return plural(tables.length, 'table', 'tables');
  return codeOf(tables[0], sections) ?? 'a table in no section';
}

/** Where the one table stands, or of several the one the keys are on: "Gold row 5 to 12.4 m, 6.1 m". */
function where(
  tables: readonly FloorplanTable[],
  lead: FloorplanTable,
  sections: readonly LayoutSection[],
  word: 'to' | 'at',
): string {
  const place = `${word} ${placeInMetres(lead)}`;
  return tables.length === 1 ? ` ${place}` : `, ${named([lead], sections)} ${place}`;
}

const them = (tables: readonly FloorplanTable[]) => (tables.length === 1 ? 'it' : 'them');

/** A whole number of degrees as it is, any other to two decimals at most. */
const degrees = (turn: number) => `${Math.round(turn * 100) / 100}°`;

/** "Gold row 5 picked up: the arrow keys move it, R turns it, Enter drops it, Escape puts it back" */
export function saidPickedUp(
  tables: readonly FloorplanTable[],
  sections: readonly LayoutSection[],
): string {
  const it = them(tables);
  return (
    `${named(tables, sections)} picked up: the arrow keys move ${it}, R turns ${it}, ` +
    `Enter drops ${it}, Escape puts ${it} back`
  );
}

/** "Gold row 5 moved to 12.4 m, 6.1 m"; of several, "3 tables moved, Gold row 5 to 12.4 m, 6.1 m". */
export function saidMoved(
  tables: readonly FloorplanTable[],
  lead: FloorplanTable,
  sections: readonly LayoutSection[],
): string {
  return `${named(tables, sections)} moved${where(tables, lead, sections, 'to')}`;
}

/** "Gold row 5 turned to 90°"; several are turned together, each from its own angle: "3 tables
 *  turned by 90°", and the short way round past a half turn, "by 15° anticlockwise". */
export function saidTurned(
  tables: readonly FloorplanTable[],
  by: number,
  sections: readonly LayoutSection[],
): string {
  return tables.length === 1
    ? `${named(tables, sections)} turned to ${degrees(tables[0].rotation)}`
    : `${named(tables, sections)} turned by ${by > 180 ? `${degrees(360 - by)} anticlockwise` : degrees(by)}`;
}

/** "Gold row 5 dropped at 12.4 m, 6.1 m". */
export function saidDropped(
  tables: readonly FloorplanTable[],
  lead: FloorplanTable,
  sections: readonly LayoutSection[],
): string {
  return `${named(tables, sections)} dropped${where(tables, lead, sections, 'at')}`;
}

/** "Gold row 5 put back at 12.4 m, 6.1 m". */
export function saidPutBack(
  tables: readonly FloorplanTable[],
  lead: FloorplanTable,
  sections: readonly LayoutSection[],
): string {
  return `${named(tables, sections)} put back${where(tables, lead, sections, 'at')}`;
}

/** "Added Gold row 10", "Added 3 tables". */
export function saidAdded(
  tables: readonly FloorplanTable[],
  sections: readonly LayoutSection[],
): string {
  return `Added ${object(tables, sections)}`;
}

/** "Removed Gold row 5", "Removed 3 tables". */
export function saidRemoved(
  tables: readonly FloorplanTable[],
  sections: readonly LayoutSection[],
): string {
  return `Removed ${object(tables, sections)}`;
}

/** The selection's card lined tables up or spaced them evenly: "Aligned 3 tables left",
 *  "Spaced 3 tables evenly across". */
export function saidArranged(
  tables: readonly FloorplanTable[],
  how: Alignment | 'across' | 'down',
): string {
  const count = plural(tables.length, 'table', 'tables');
  return how === 'across' || how === 'down'
    ? `Spaced ${count} evenly ${how}`
    : `Aligned ${count} ${how}`;
}

/** The selection's card put tables in a section, by their codes before: "Put Gold row 5 in
 *  Silver aisle", "Put 3 tables in no section". */
export function saidSectioned(
  tables: readonly FloorplanTable[],
  sectionName: string | null,
  sections: readonly LayoutSection[],
): string {
  return `Put ${object(tables, sections)} in ${sectionName ?? 'no section'}`;
}

/** The selection's card gave tables another type: "Made Gold row 5 Square 4 ft". */
export function saidRetyped(
  tables: readonly FloorplanTable[],
  typeName: string,
  sections: readonly LayoutSection[],
): string {
  return `Made ${object(tables, sections)} ${typeName}`;
}

/**
 * A row placed along a path, by its section's numbers in the order drawn: "Added Gold row 10 to
 * 23."; one table, "Added Gold row 10."; in no section, "Added 14 tables in no section."
 */
export function saidRowAdded(
  tables: readonly FloorplanTable[],
  sections: readonly LayoutSection[],
): string {
  if (tables.length === 1) return `${saidAdded(tables, sections)}.`;
  const first = codeOf(tables[0], sections);
  const last = tables[tables.length - 1];
  if (!first || last.number === null) {
    return `Added ${plural(tables.length, 'table', 'tables')} in no section.`;
  }
  return `Added ${first} to ${last.number}.`;
}

/** What the path holds: a count of tables, or, while the strip's Gap or Aisle refuses, that
 *  field's sentence, since the path then holds and places none. */
export type RowHolds = number | string;

/** What the path holds, as a sentence: "14 tables.", "No tables yet.", or the field's refusal. */
const held = (holds: RowHolds) => {
  if (typeof holds === 'string') return holds;
  return holds ? `${plural(holds, 'table', 'tables')}.` : 'No tables yet.';
};

/** A point laid by the crosshair, and what the path now holds: "Point 3 at 12.4 m, 6.1 m. 14
 *  tables." */
export function saidPoint(number: number, at: PointMm, count: RowHolds): string {
  return `Point ${number} at ${placeInMetres(at)}. ${held(count)}`;
}

/** "Point 3 taken back. 9 tables."; the first, "Point 1 taken back. No points left." */
export function saidPointTaken(number: number, count: RowHolds): string {
  return `Point ${number} taken back. ${number === 1 ? 'No points left.' : held(count)}`;
}

/** Where the crosshair stands: "Crosshair at 12.4 m, 6.1 m". */
export function saidCrosshair(at: PointMm): string {
  return `Crosshair at ${placeInMetres(at)}`;
}

/** The side a row's tables stand on, and what the path holds there: "Tables on the left of the
 *  line. 12 tables."; with no path, the side alone. */
export function saidSide(side: 'right' | 'left', count: RowHolds | null): string {
  const said = `Tables on the ${side} of the line.`;
  return count === null ? said : `${said} ${held(count)}`;
}

/** A path closed into a shape, and what it holds: "Closed. 10 tables." */
export function saidClosed(count: RowHolds): string {
  return `Closed. ${held(count)}`;
}

/** A closed path opened again, and what it holds: "Opened again. 9 tables." */
export function saidOpened(count: RowHolds): string {
  return `Opened again. ${held(count)}`;
}

/** A curved stroke let go, smoothed into a path that waits: "Curve drawn through 6 points. 10
 *  tables. Enter places it."; one that came back to its start, "Loop drawn through 8 points. 14
 *  tables. Enter places it."; while a field refuses, its sentence, and no Enter, which would
 *  place nothing. */
export function saidCurveDrawn(points: number, tables: RowHolds, closed: boolean): string {
  const drawn = `${closed ? 'Loop' : 'Curve'} drawn through ${points} points. ${held(tables)}`;
  return typeof tables === 'string' ? drawn : `${drawn} Enter places it.`;
}

/** Said when a path of fewer than three points is asked to close. */
export const SHAPE_NEEDS_THREE = 'A shape takes three points or more.';

/** A corner of an area laid by the crosshair: "Corner 3 at 12.4 m, 6.1 m." */
export function saidCorner(number: number, at: PointMm): string {
  return `Corner ${number} at ${placeInMetres(at)}.`;
}

/** "Corner 3 taken back."; the first, "Corner 1 taken back. No corners left." */
export function saidCornerTaken(number: number): string {
  return `Corner ${number} taken back.${number === 1 ? ' No corners left.' : ''}`;
}

/** Said when a path is dropped unplaced. */
export const ROW_DROPPED = 'Row dropped. No table was added.';
/** Said when a path is placed that no table fits along. */
export const NO_TABLE_FITS = 'No table fits along that line.';

/** Said when a key would carry a table past the floorplan's edge, where it stays. */
export const AT_THE_EDGE = 'At the edge of the floorplan';

/**
 * What the page's live region holds. The same words said twice running are told apart by a space
 * that is not read, since a region whose words did not change is not read again.
 */
export function useAnnouncements(): { said: Ref<string>; say: (words: string) => void } {
  const said = ref('');
  function say(words: string) {
    said.value = said.value === words ? `${words} ` : words;
  }
  return { said, say };
}

/** "Added a no-table zone 4.0 m by 3.0 m. Name it in the panel." */
export function saidZoneAdded(box: Bounds): string {
  return (
    `Added a no-table zone ${metres(box.right - box.left)} by ${metres(box.bottom - box.top)}. ` +
    'Name it in the panel.'
  );
}

/** "Removed the no-table zone Stage", or one with no name. */
export function saidZoneRemoved(label: string): string {
  return label.trim() ? `Removed the no-table zone ${label.trim()}` : 'Removed a no-table zone';
}
