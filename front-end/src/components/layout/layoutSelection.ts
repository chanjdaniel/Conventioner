/**
 * The selected tables of a layout as one thing (T257): the box they stand in, which the turn
 * handle sits over and a turn of several goes about, so the handle, the R key and "Turn 90°" all
 * turn the same way.
 */
import type { FloorplanObject, TableTypeObject } from '@/assets/types/datatypes';
import { STANDARD_TABLE, tableBounds, unionOf, type Bounds, type PointMm } from './layoutGeometry';
import type { LayoutEditor } from './useLayoutEditor';

/** The box the tables named stand in; null for none of the layout's. */
export function selectionBounds(
  layout: Pick<FloorplanObject, 'tables'> | null,
  ids: readonly string[],
  tableTypes: readonly TableTypeObject[],
): Bounds | null {
  if (!layout || !ids.length) return null;
  const named = new Set(ids);
  const types = new Map(tableTypes.map((type) => [type.id, type]));
  return unionOf(
    layout.tables
      .filter((table) => named.has(table.id))
      .map((table) => tableBounds(table, types.get(table.tableTypeId) ?? STANDARD_TABLE)),
  );
}

export function centreOf(box: Bounds): PointMm {
  return { xMm: (box.left + box.right) / 2, yMm: (box.top + box.bottom) / 2 };
}

/** Turn the selection by `degrees` about its box's centre; one table turns about its own. */
export function turnSelection(
  editor: LayoutEditor,
  tableTypes: readonly TableTypeObject[],
  degrees: number,
) {
  const ids = editor.selection.value;
  const box = selectionBounds(editor.layout.value, ids, tableTypes);
  if (box) editor.turnTables(ids, degrees, centreOf(box));
}
