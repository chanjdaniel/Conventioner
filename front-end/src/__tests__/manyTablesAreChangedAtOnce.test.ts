/**
 * A layout's commands on many tables at once (T257 ticket 05): a change of section and its
 * numbers, a change of type, duplicates, alignment and even spacing, Renumber by position, a
 * section's colour and label, and a table whose section is gone; each one step of undo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable, SectionStyle } from '@/assets/types/datatypes';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };
const SQUARE = { id: 'square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 };

function table(
  id: string,
  sectionId: string | null,
  number: number | null,
  xMm = 5000,
  yMm = 5000,
  rotation = 0,
): FloorplanTable {
  return { id, sectionId, number, tableTypeId: 'six-foot', xMm, yMm, rotation };
}

/** A row of a section's tables, 2 m apart from 2 m, numbered from 1. */
function row(sectionId: string, count: number, yMm: number): FloorplanTable[] {
  return Array.from({ length: count }, (_, index) =>
    table(`${sectionId}-${index + 1}`, sectionId, index + 1, 2000 + index * 2000, yMm),
  );
}

/** A hall 60 m by 45 m. */
function aLayout(tables: FloorplanTable[], sectionStyles: SectionStyle[] = []): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 60_000,
    tables,
    zones: [],
    sectionStyles,
    startingCounts: [],
  };
}

function anEditor(
  tables: FloorplanTable[],
  options: { sectionIds?: string[]; sectionStyles?: SectionStyle[] } = {},
) {
  let n = 0;
  const sent: FloorplanObject[] = [];
  let revision = 3;
  const editor = useLayoutEditor({
    save: (layout): Promise<SavedLayout> => {
      sent.push(layout);
      revision += 1;
      return Promise.resolve({ floorplan: { ...layout, revision }, sections: [] });
    },
    newId: () => `new-${(n += 1)}`,
    tableTypes: () => [SIX_FOOT, SQUARE],
    sectionIds: () => options.sectionIds ?? ['gold', 'silver'],
  });
  editor.adopt(aLayout(tables, options.sectionStyles));
  const tablesNow = () => editor.layout.value!.tables;
  const codes = () => tablesNow().map((t) => `${t.id}:${t.sectionId ?? 'none'}:${t.number}`);
  const byId = (id: string) => tablesNow().find((one) => one.id === id)!;
  return { editor, sent, tablesNow, codes, byId };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle() {
  await vi.advanceTimersByTimeAsync(600);
}

describe("changing tables' section", () => {
  it('makes 3 of Gold row (of 9) into Silver aisle 19 to 21 and closes Gold row to 6', () => {
    const { editor, tablesNow, byId } = anEditor([
      ...row('gold', 9, 2000),
      ...row('silver', 18, 9000),
    ]);
    // Given out of order: they join in the order of the numbers they had.
    editor.setSection(['gold-7', 'gold-2', 'gold-4'], 'silver');

    expect(
      ['gold-2', 'gold-4', 'gold-7'].map((id) => [byId(id).sectionId, byId(id).number]),
    ).toEqual([
      ['silver', 19],
      ['silver', 20],
      ['silver', 21],
    ]);
    const gold = tablesNow().filter((one) => one.sectionId === 'gold');
    expect(gold.map((one) => [one.id, one.number])).toEqual([
      ['gold-1', 1],
      ['gold-3', 2],
      ['gold-5', 3],
      ['gold-6', 4],
      ['gold-8', 5],
      ['gold-9', 6],
    ]);
    expect(tablesNow().filter((one) => one.sectionId === 'silver')).toHaveLength(21);
    // Nothing moved.
    expect(byId('gold-2').xMm).toBe(4000);
  });

  it('is one step of undo, and saves', async () => {
    const { editor, codes, sent } = anEditor([...row('gold', 3, 2000), ...row('silver', 1, 9000)]);
    const before = codes();
    editor.setSection(['gold-1', 'gold-2'], 'silver');
    await settle();
    expect(sent).toHaveLength(1);
    editor.undo();
    expect(codes()).toEqual(before);
    expect(editor.canUndo.value).toBe(false);
  });

  it('takes the number from tables put in no section, and closes the gap they leave', () => {
    const { editor, codes } = anEditor(row('gold', 3, 2000));
    editor.setSection(['gold-2'], null);
    expect(codes()).toEqual(['gold-1:gold:1', 'gold-2:none:null', 'gold-3:gold:2']);
  });

  it('numbers tables of no section into their new one, in the order they are stored', () => {
    const { editor, codes } = anEditor([
      table('g1', 'gold', 1),
      table('loose-a', null, null),
      table('loose-b', null, null),
    ]);
    editor.setSection(['loose-b', 'loose-a'], 'gold');
    expect(codes()).toEqual(['g1:gold:1', 'loose-a:gold:2', 'loose-b:gold:3']);
  });

  it('changes nothing for tables already of the section', () => {
    const { editor, codes } = anEditor(row('gold', 2, 2000));
    const before = codes();
    editor.setSection(['gold-1', 'gold-2'], 'gold');
    expect(codes()).toEqual(before);
    expect(editor.canUndo.value).toBe(false);
  });
});

describe("changing tables' type", () => {
  it('gives each the type and keeps its place, section and number', () => {
    const { editor, byId } = anEditor(row('gold', 3, 2000));
    editor.setType(['gold-1', 'gold-3'], 'square');
    expect(['gold-1', 'gold-2', 'gold-3'].map((id) => byId(id).tableTypeId)).toEqual([
      'square',
      'six-foot',
      'square',
    ]);
    expect(byId('gold-3')).toMatchObject({ number: 3, sectionId: 'gold', xMm: 6000, yMm: 2000 });
    editor.undo();
    expect(byId('gold-1').tableTypeId).toBe('six-foot');
  });

  it('changes nothing for tables already of the type', () => {
    const { editor } = anEditor(row('gold', 2, 2000));
    editor.setType(['gold-1'], 'six-foot');
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('duplicating tables', () => {
  it('puts a copy of each a table depth and 300 mm down, numbered on in its section', () => {
    const { editor, byId, tablesNow } = anEditor([
      ...row('gold', 2, 2000),
      table('loose', null, null, 9000, 2000, 30),
    ]);
    const ids = editor.duplicate(['gold-2', 'loose', 'gold-1']);
    expect(ids).toEqual(['new-1', 'new-2', 'new-3']);
    expect(tablesNow()).toHaveLength(6);
    // In the order of their numbers, those of no section last.
    expect(byId('new-1')).toMatchObject({ sectionId: 'gold', number: 3, xMm: 2000, yMm: 3060 });
    expect(byId('new-2')).toMatchObject({ sectionId: 'gold', number: 4, xMm: 4000, yMm: 3060 });
    expect(byId('new-3')).toMatchObject({
      sectionId: null,
      number: null,
      xMm: 9000,
      yMm: 3060,
      rotation: 30,
      tableTypeId: 'six-foot',
    });
  });

  it('goes to the right of the selection when tables stand below it', () => {
    const { editor, byId } = anEditor([...row('gold', 2, 2000), ...row('silver', 2, 3060)]);
    editor.duplicate(['gold-1', 'gold-2']);
    // The two stand 3,830 mm wide: that and 300 mm to the right.
    expect(byId('new-1')).toMatchObject({ xMm: 2000 + 4130, yMm: 2000 });
    expect(byId('new-2')).toMatchObject({ xMm: 4000 + 4130, yMm: 2000 });
  });

  it('is one step of undo', () => {
    const { editor, tablesNow } = anEditor(row('gold', 2, 2000));
    editor.duplicate(['gold-1', 'gold-2']);
    editor.undo();
    expect(tablesNow()).toHaveLength(2);
    expect(editor.canUndo.value).toBe(false);
  });

  it('duplicates nothing of no table', () => {
    const { editor } = anEditor(row('gold', 2, 2000));
    expect(editor.duplicate(['nobody'])).toEqual([]);
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('aligning and spacing tables', () => {
  const ragged = () => [
    table('a', 'gold', 1, 2000, 2000),
    table('b', 'gold', 2, 5000, 2300),
    table('c', 'gold', 3, 12_000, 1800),
    table('far', 'gold', 4, 30_000, 30_000),
  ];

  it('lines the selection up by its tops, and leaves the others', () => {
    const { editor, byId } = anEditor(ragged());
    editor.align(['a', 'b', 'c'], 'top');
    expect(['a', 'b', 'c'].map((id) => byId(id).yMm)).toEqual([1800, 1800, 1800]);
    expect(['a', 'b', 'c'].map((id) => byId(id).xMm)).toEqual([2000, 5000, 12_000]);
    expect(byId('far')).toMatchObject({ xMm: 30_000, yMm: 30_000 });
    editor.undo();
    expect(byId('b').yMm).toBe(2300);
    expect(editor.canUndo.value).toBe(false);
  });

  it('lines tables of two sizes up by their edges, not their centres', () => {
    const { editor, byId } = anEditor([
      table('long', 'gold', 1, 5000, 2000),
      { ...table('square', 'gold', 2, 9000, 5000), tableTypeId: 'square' },
    ]);
    editor.align(['long', 'square'], 'left');
    // The long table's left edge is at 4,085 mm; the square's centre stands 610 mm in from it.
    expect(byId('long').xMm).toBe(5000);
    expect(byId('square').xMm).toBe(4085 + 610);
  });

  it('spaces the selection evenly across, the outer two staying', () => {
    const { editor, byId } = anEditor(ragged());
    editor.distribute(['a', 'b', 'c'], 'across');
    expect(['a', 'b', 'c'].map((id) => byId(id).xMm)).toEqual([2000, 7000, 12_000]);
    expect(byId('b').yMm).toBe(2300);
    editor.undo();
    expect(byId('b').xMm).toBe(5000);
  });

  it('changes nothing when the selection is already in line', () => {
    const { editor } = anEditor(row('gold', 3, 2000));
    editor.align(['gold-1', 'gold-2', 'gold-3'], 'middle');
    editor.distribute(['gold-1', 'gold-2', 'gold-3'], 'across');
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('Renumber by position', () => {
  it("numbers a section's tables in rows from the top, each from the left, and no other's", () => {
    const { editor, byId, codes } = anEditor([
      table('g-low-right', 'gold', 1, 8000, 6000),
      table('g-top-right', 'gold', 2, 8000, 2000),
      table('g-low-left', 'gold', 3, 2000, 6000),
      table('g-top-left', 'gold', 4, 2000, 2000),
      table('s-right', 'silver', 1, 9000, 12_000),
      table('s-left', 'silver', 2, 3000, 12_000),
    ]);
    editor.renumber('gold');
    expect(
      ['g-top-left', 'g-top-right', 'g-low-left', 'g-low-right'].map((id) => byId(id).number),
    ).toEqual([1, 2, 3, 4]);
    expect(codes().slice(4)).toEqual(['s-right:silver:1', 's-left:silver:2']);
    editor.undo();
    expect(byId('g-top-left').number).toBe(4);
    expect(editor.canUndo.value).toBe(false);
  });

  it('changes nothing for a section already in order', () => {
    const { editor } = anEditor(row('gold', 3, 2000));
    editor.renumber('gold');
    expect(editor.canUndo.value).toBe(false);
  });
});

describe("a section's colour and label", () => {
  it('keeps the colour chosen, saves it, and undo takes it back', async () => {
    const { editor, sent } = anEditor(row('gold', 1, 2000));
    editor.setSectionStyle('silver', { color: 5 });
    expect(editor.layout.value!.sectionStyles).toEqual([
      { sectionId: 'silver', color: 5, labelAt: null },
    ]);
    await settle();
    expect(sent.at(-1)!.sectionStyles).toEqual([{ sectionId: 'silver', color: 5, labelAt: null }]);

    editor.undo();
    expect(editor.layout.value!.sectionStyles).toEqual([]);
    await settle();
    expect(sent.at(-1)!.sectionStyles).toEqual([]);
    editor.redo();
    expect(editor.layout.value!.sectionStyles).toHaveLength(1);
  });

  it("keeps a label's place with the colour the section was drawn in", () => {
    const { editor } = anEditor(row('gold', 1, 2000));
    // Silver aisle, the second section, is drawn in the second colour until one is chosen.
    editor.setSectionStyle('silver', { labelAt: { xMm: 4000.004, yMm: 3000 } });
    expect(editor.layout.value!.sectionStyles).toEqual([
      { sectionId: 'silver', color: 2, labelAt: { xMm: 4000, yMm: 3000 } },
    ]);
  });

  it('changes the one field named of a style already kept', () => {
    const { editor } = anEditor(row('gold', 1, 2000), {
      sectionStyles: [{ sectionId: 'gold', color: 4, labelAt: { xMm: 1000, yMm: 1000 } }],
    });
    editor.setSectionStyle('gold', { color: 7 });
    expect(editor.layout.value!.sectionStyles).toEqual([
      { sectionId: 'gold', color: 7, labelAt: { xMm: 1000, yMm: 1000 } },
    ]);
    editor.setSectionStyle('gold', { labelAt: null });
    expect(editor.layout.value!.sectionStyles).toEqual([
      { sectionId: 'gold', color: 7, labelAt: null },
    ]);
  });

  it('holds a label inside the hall', () => {
    const { editor } = anEditor(row('gold', 1, 2000));
    editor.setSectionStyle('gold', { labelAt: { xMm: -500, yMm: 99_000 } });
    expect(editor.layout.value!.sectionStyles[0].labelAt).toEqual({ xMm: 0, yMm: 45_000 });
  });

  it('is one step for a label dragged, and none for a drag put back', () => {
    const { editor } = anEditor(row('gold', 1, 2000));
    editor.begin();
    editor.setSectionStyle('gold', { labelAt: { xMm: 3000, yMm: 3000 } });
    editor.setSectionStyle('gold', { labelAt: { xMm: 4000, yMm: 3500 } });
    editor.end();
    expect(editor.layout.value!.sectionStyles[0].labelAt).toEqual({ xMm: 4000, yMm: 3500 });
    editor.undo();
    expect(editor.layout.value!.sectionStyles).toEqual([]);
    expect(editor.canUndo.value).toBe(false);

    editor.begin();
    editor.setSectionStyle('gold', { labelAt: { xMm: 3000, yMm: 3000 } });
    editor.cancel();
    expect(editor.layout.value!.sectionStyles).toEqual([]);
    expect(editor.canUndo.value).toBe(false);
  });

  it('changes nothing for the colour a section already keeps', () => {
    const { editor } = anEditor(row('gold', 1, 2000), {
      sectionStyles: [{ sectionId: 'gold', color: 4, labelAt: null }],
    });
    editor.setSectionStyle('gold', { color: 4 });
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('tables whose section is gone', () => {
  const stale = () => [...row('gold', 2, 2000), ...row('removed', 3, 9000)];

  it('are saved in no section, numberless, by the next change', async () => {
    const { editor, sent, codes } = anEditor(stale());
    // As read, they still name the section that is gone.
    expect(codes()[2]).toBe('removed-1:removed:1');
    editor.moveTables(['gold-1'], 100, 0);
    await settle();
    expect(sent[0].tables.slice(2).map((one) => [one.sectionId, one.number])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it('join a section numbered after its own, leaving no number behind them', () => {
    const { editor, codes } = anEditor(stale());
    editor.setSection(['removed-2', 'removed-3'], 'gold');
    expect(codes()).toEqual([
      'gold-1:gold:1',
      'gold-2:gold:2',
      'removed-1:none:null',
      'removed-2:gold:3',
      'removed-3:gold:4',
    ]);
  });

  it('are left as they were read while nothing changes', async () => {
    const { editor, sent, codes } = anEditor(stale());
    editor.setSection(['gold-1'], 'gold');
    await settle();
    expect(sent).toHaveLength(0);
    expect(codes()[2]).toBe('removed-1:removed:1');
  });

  it('come back as they were read with an undo', () => {
    const { editor, codes } = anEditor(stale());
    editor.removeTables(['gold-1']);
    editor.undo();
    expect(codes()[2]).toBe('removed-1:removed:1');
  });

  it('make no step of a drag that ends where it began', () => {
    const { editor, codes } = anEditor(stale());
    editor.begin();
    editor.moveTables(['gold-1'], 500, 0);
    editor.moveTables(['gold-1'], 0, 0);
    editor.end();
    expect(editor.canUndo.value).toBe(false);
    expect(editor.pending()).toBe(false);
    expect(codes()[2]).toBe('removed-1:removed:1');
  });
});

describe('a save whose wait runs out under a gesture', () => {
  it('sends the layout as the gesture found it, so a drag put back leaves the server right', async () => {
    const { editor, sent, byId } = anEditor(row('gold', 2, 2000));
    editor.moveTables(['gold-1'], 0, 1000);
    // Within the wait, a drag of the other table begins, and is still in hand when it runs out.
    editor.begin();
    editor.moveTables(['gold-2'], 0, 5000);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].tables.map((one) => one.yMm)).toEqual([3000, 2000]);
    // The drag in hand is still drawn.
    expect(byId('gold-2').yMm).toBe(7000);

    editor.cancel();
    expect(byId('gold-2').yMm).toBe(2000);
    await settle();
    // Nothing more to send: the server holds what the page shows.
    expect(sent).toHaveLength(1);
    expect(editor.pending()).toBe(false);
  });

  it('saves the gesture once it ends', async () => {
    const { editor, sent } = anEditor(row('gold', 2, 2000));
    editor.moveTables(['gold-1'], 0, 1000);
    editor.begin();
    editor.setSectionStyle('gold', { labelAt: { xMm: 9000, yMm: 9000 } });
    await settle();
    expect(sent[0].sectionStyles).toEqual([]);
    editor.end();
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1].sectionStyles[0].labelAt).toEqual({ xMm: 9000, yMm: 9000 });
    // One step each: the label, then the move.
    editor.undo();
    expect(editor.layout.value!.sectionStyles).toEqual([]);
    expect(editor.layout.value!.tables[0].yMm).toBe(3000);
  });
});
