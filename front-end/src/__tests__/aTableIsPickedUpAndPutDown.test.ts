/**
 * A layout's tables picked up by keyboard (T257 ticket 06), in the editing model: from the pick-up
 * to the drop is one step of undo and one save, each key's move or turn going on from the last,
 * and Escape puts the tables back where they were picked up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

function table(id: string, sectionId: string | null, number: number | null, x = 5000, y = 5000) {
  return { id, sectionId, number, tableTypeId: 'six-foot', xMm: x, yMm: y, rotation: 0 };
}

/** A hall 30 m by 22.5 m. */
function aLayout(tables: FloorplanTable[]): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables,
    zones: [],
    sectionStyles: [],
    startingCounts: [],
  };
}

function anEditor(tables: FloorplanTable[], sectionIds?: string[]) {
  let revision = 3;
  const sent: FloorplanObject[] = [];
  const save = vi.fn((layout: FloorplanObject): Promise<SavedLayout> => {
    sent.push(layout);
    revision += 1;
    return Promise.resolve({ floorplan: { ...layout, revision }, sections: [] });
  });
  const editor = useLayoutEditor({ save, sectionIds: sectionIds && (() => sectionIds) });
  editor.adopt(aLayout(tables));
  const at = (id: string) => {
    const found = editor.layout.value!.tables.find((one) => one.id === id)!;
    return [found.xMm, found.yMm, found.rotation];
  };
  return { editor, sent, at };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Let the save's wait run out and its answer land. */
async function settle() {
  await vi.advanceTimersByTimeAsync(600);
}

describe('a table picked up', () => {
  it('moves on from where the last key left it, unlike a drag, whose frames start over', () => {
    const { editor, at } = anEditor([table('a', 'gold', 1)]);
    expect(editor.pickUp(['a'])).toBe(true);
    expect(editor.pickedUp.value).toEqual(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], 0, 1000);
    expect(at('a')).toEqual([5200, 6000, 0]);
    editor.turnTables(['a'], 90);
    editor.turnTables(['a'], 15);
    expect(at('a')).toEqual([5200, 6000, 105]);
  });

  it('is one step of undo and one save from the pick-up to the drop', async () => {
    const { editor, sent, at } = anEditor([table('a', 'gold', 1), table('b', 'gold', 2, 9000)]);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], 100, 0);
    editor.turnTables(['a'], 90);
    expect(editor.canUndo.value).toBe(false);
    await settle();
    // Nothing is sent while the table is in hand.
    expect(sent).toHaveLength(0);

    expect(editor.drop()).toBe(true);
    expect(editor.pickedUp.value).toEqual([]);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].tables.find((one) => one.id === 'a')).toMatchObject({
      xMm: 5200,
      yMm: 5000,
      rotation: 90,
    });

    editor.undo();
    expect(at('a')).toEqual([5000, 5000, 0]);
    expect(editor.canUndo.value).toBe(false);
    editor.redo();
    expect(at('a')).toEqual([5200, 5000, 90]);
  });

  it('goes back where it was picked up when it is put back, with no step and no save', async () => {
    const { editor, sent, at } = anEditor([table('a', 'gold', 1)]);
    const before = editor.layout.value!.tables;
    editor.pickUp(['a']);
    editor.moveTables(['a'], 1000, 1000);
    editor.turnTables(['a'], 90);
    editor.putBack();
    expect(at('a')).toEqual([5000, 5000, 0]);
    expect(editor.layout.value!.tables).toBe(before);
    expect(editor.pickedUp.value).toEqual([]);
    expect(editor.canUndo.value).toBe(false);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('dropped where it was picked up is no change', async () => {
    const { editor, sent } = anEditor([table('a', 'gold', 1)]);
    const before = editor.layout.value!.tables;
    editor.pickUp(['a']);
    expect(editor.drop()).toBe(false);

    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], -100, 0);
    editor.turnTables(['a'], 90);
    editor.turnTables(['a'], 270);
    expect(editor.drop()).toBe(false);
    expect(editor.layout.value!.tables).toBe(before);
    expect(editor.canUndo.value).toBe(false);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('carries several together, each key moving them all', () => {
    const { editor, at } = anEditor([
      table('a', 'gold', 1, 5000, 5000),
      table('b', 'gold', 2, 7000, 5000),
      table('c', 'gold', 3, 20_000, 5000),
    ]);
    editor.pickUp(['a', 'b']);
    editor.moveTables(['a', 'b'], 0, 100);
    editor.turnTables(['a', 'b'], 90);
    // Turned about the middle of the two, (6000, 5100).
    expect(at('a')).toEqual([6000, 4100, 90]);
    expect(at('b')).toEqual([6000, 6100, 90]);
    expect(at('c')).toEqual([20_000, 5000, 0]);
    editor.drop();
    editor.undo();
    expect(at('a')).toEqual([5000, 5000, 0]);
    expect(at('b')).toEqual([7000, 5000, 0]);
  });

  it('stops at the wall, and comes away from it by the next key', () => {
    const { editor, at } = anEditor([table('a', 'gold', 1, 150, 5000)]);
    editor.pickUp(['a']);
    editor.moveTables(['a'], -100, 0);
    editor.moveTables(['a'], -100, 0);
    editor.moveTables(['a'], -100, 0);
    expect(at('a')).toEqual([0, 5000, 0]);
    editor.moveTables(['a'], 100, 0);
    expect(at('a')).toEqual([100, 5000, 0]);
  });

  it('keeps a change made before it out of the save until it is dropped', async () => {
    const { editor, sent } = anEditor([table('a', 'gold', 1), table('b', 'gold', 2, 9000)]);
    editor.moveTables(['b'], 1000, 0);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    await settle();
    // The earlier move is sent; the table in hand as it was picked up.
    expect(sent).toHaveLength(1);
    expect(sent[0].tables.map((one) => one.xMm)).toEqual([5000, 10_000]);
    editor.drop();
    await settle();
    expect(sent[1].tables.map((one) => one.xMm)).toEqual([5100, 10_000]);
  });

  it('goes as it was picked up in the write sent as the page leaves', () => {
    const onUnload: number[][] = [];
    const editor = useLayoutEditor({
      save: vi.fn(),
      saveOnUnload: (layout) => {
        onUnload.push(layout.tables.map((one) => one.xMm));
        return true;
      },
    });
    editor.adopt(aLayout([table('a', 'gold', 1), table('b', 'gold', 2, 9000)]));
    editor.moveTables(['b'], 1000, 0);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.sendOnUnload();
    // The earlier move goes; the table in hand where it was picked up, as a save's wait sends it.
    expect(onUnload).toEqual([[5000, 10_000]]);
  });

  it('is not begun with nothing to pick up, under a drag, or twice', () => {
    const { editor } = anEditor([table('a', 'gold', 1), table('b', 'gold', 2, 9000)]);
    expect(editor.pickUp([])).toBe(false);
    expect(editor.pickUp(['gone'])).toBe(false);
    editor.begin();
    expect(editor.pickUp(['a'])).toBe(false);
    editor.cancel();
    expect(editor.pickUp(['a'])).toBe(true);
    expect(editor.pickUp(['b'])).toBe(false);
    expect(editor.pickedUp.value).toEqual(['a']);
  });

  it('holds undo and redo off while it is in hand', () => {
    const { editor, at } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 1000, 0);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.undo();
    expect(at('a')).toEqual([6100, 5000, 0]);
  });

  it('is let go when the layout is reloaded under it', () => {
    const { editor, at } = anEditor([table('a', 'gold', 1)]);
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.reload(aLayout([table('a', 'gold', 1, 8000)]));
    expect(editor.pickedUp.value).toEqual([]);
    expect(at('a')).toEqual([8000, 5000, 0]);
    expect(editor.pickUp(['a'])).toBe(true);
  });

  it('leaves a table of a section that is gone as read when nothing was moved', () => {
    const { editor } = anEditor([table('a', 'gold', 1), table('lost', 'gone', 4, 9000)], ['gold']);
    const before = editor.layout.value!.tables;
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], -100, 0);
    expect(editor.drop()).toBe(false);
    expect(editor.layout.value!.tables).toBe(before);

    // Moved, the drop stores the lost table in no section, as any change does.
    editor.pickUp(['a']);
    editor.moveTables(['a'], 100, 0);
    expect(editor.drop()).toBe(true);
    expect(editor.layout.value!.tables.find((one) => one.id === 'lost')).toMatchObject({
      sectionId: null,
      number: null,
    });
  });
});
