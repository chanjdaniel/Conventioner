/**
 * A layout after Draft (T257 ticket 11): past Draft a table still moves and turns, and the
 * zones and the sections' colours still change, but no seat does: the model adds, removes,
 * duplicates, renumbers and re-sections or re-types nothing, whatever control or key asks it.
 */
import { describe, expect, it } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

function table(id: string, number: number, x: number): FloorplanTable {
  return { id, sectionId: 'gold', number, tableTypeId: 'six-foot', xMm: x, yMm: 5000, rotation: 0 };
}

function aLayout(): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables: [table('g1', 1, 4000), table('g2', 2, 9000), table('g3', 3, 2000)],
    zones: [],
    sectionStyles: [],
    startingCounts: [],
  };
}

function aSettledEditor() {
  const editor = useLayoutEditor({
    save: async (layout): Promise<SavedLayout> => ({
      floorplan: { ...layout, revision: layout.revision + 1 },
    }),
    draft: () => false,
    tableTypes: () => [
      { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 },
      { id: 'square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 },
    ],
    sectionIds: () => ['gold', 'silver'],
    newId: () => 'new',
  });
  editor.adopt(aLayout());
  const seats = () =>
    editor.layout.value!.tables.map(
      (t) => `${t.id}:${t.sectionId ?? 'none'}:${t.number}:${t.tableTypeId}`,
    );
  return { editor, seats };
}

const AS_READ = ['g1:gold:1:six-foot', 'g2:gold:2:six-foot', 'g3:gold:3:six-foot'];

describe('past Draft, no seat changes', () => {
  it('adds no table', () => {
    const { editor, seats } = aSettledEditor();
    expect(
      editor.addTables([{ sectionId: 'gold', tableTypeId: 'six-foot', xMm: 1000, yMm: 1000 }]),
    ).toEqual([]);
    expect(seats()).toEqual(AS_READ);
  });

  it('duplicates no table', () => {
    const { editor, seats } = aSettledEditor();
    expect(editor.duplicate(['g1'])).toEqual([]);
    expect(seats()).toEqual(AS_READ);
  });

  it('removes no table', () => {
    const { editor, seats } = aSettledEditor();
    editor.removeTables(['g2']);
    expect(seats()).toEqual(AS_READ);
  });

  it('puts no table in another section, or in none', () => {
    const { editor, seats } = aSettledEditor();
    editor.setSection(['g2'], 'silver');
    editor.setSection(['g3'], null);
    expect(seats()).toEqual(AS_READ);
  });

  it('gives no table another type', () => {
    const { editor, seats } = aSettledEditor();
    editor.setType(['g2'], 'square');
    expect(seats()).toEqual(AS_READ);
  });

  it('renumbers no section', () => {
    const { editor, seats } = aSettledEditor();
    editor.renumber('gold');
    expect(seats()).toEqual(AS_READ);
  });

  it('makes no step of undo for any of them', () => {
    const { editor } = aSettledEditor();
    editor.addTables([{ sectionId: 'gold', tableTypeId: 'six-foot', xMm: 1000, yMm: 1000 }]);
    editor.duplicate(['g1']);
    editor.removeTables(['g2']);
    editor.renumber('gold');
    expect(editor.canUndo.value).toBe(false);
    expect(editor.pending()).toBe(false);
  });
});

describe('past Draft, where a table stands still changes', () => {
  it('moves, turns, lines up and takes it back, each table keeping its seat', () => {
    const { editor, seats } = aSettledEditor();
    editor.moveTables(['g1'], 500, 0);
    editor.turnTables(['g2'], 90);
    editor.align(['g1', 'g2', 'g3'], 'top');
    const [g1, g2] = editor.layout.value!.tables;
    expect(g1.xMm).toBe(4500);
    expect(g2.rotation).toBe(90);
    expect(seats()).toEqual(AS_READ);

    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.layout.value!.tables).toEqual(aLayout().tables);
  });

  it("marks a no-table zone and changes a section's colour", () => {
    const { editor } = aSettledEditor();
    expect(editor.addZone({ left: 20_000, top: 15_000, right: 24_000, bottom: 18_000 })).not.toBe(
      null,
    );
    editor.setSectionStyle('gold', { color: 3 });
    expect(editor.layout.value!.zones).toHaveLength(1);
    expect(editor.layout.value!.sectionStyles).toEqual([
      { sectionId: 'gold', color: 3, labelAt: null },
    ]);
  });
});
