/**
 * A layout's editing model (T257 ticket 04): each command, undo and redo over 200 steps and across
 * a save, and the save queue: one write out at a time, a change made meanwhile saved after, a
 * failure and a stale refusal each keeping the working copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import { SAVE_FAILED, STALE_LAYOUT, type SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';
import { OFFLINE_MESSAGE } from '@/utils/api';

function table(id: string, sectionId: string | null, number: number | null, x = 5000, y = 5000) {
  return { id, sectionId, number, tableTypeId: 'six-foot', xMm: x, yMm: y, rotation: 0 };
}

/** A hall 30 m by 22.5 m. */
function aLayout(tables: FloorplanTable[] = [], revision = 3): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision,
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

function refused(status: number | null, error?: string) {
  return Object.assign(new Error('refused'), {
    isAxiosError: true,
    response: status === null ? undefined : { status, data: error ? { error } : {} },
  });
}

/** A server that stores what it is sent, one revision on, answering when the test says. */
function aServer(revision = 3) {
  const server = {
    revision,
    sent: [] as { layout: FloorplanObject; revision: number }[],
    waiting: [] as { resolve: () => void; reject: (err: unknown) => void }[],
    held: false,
    save: vi.fn((layout: FloorplanObject, read: number): Promise<SavedLayout> => {
      server.sent.push({ layout, revision: read });
      const answer = () => {
        if (read !== server.revision) throw refused(409, STALE_LAYOUT);
        server.revision += 1;
        return { floorplan: { ...layout, revision: server.revision }, sections: [] };
      };
      if (!server.held) {
        try {
          return Promise.resolve(answer());
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return new Promise<SavedLayout>((resolve, reject) => {
        server.waiting.push({
          resolve: () => {
            try {
              resolve(answer());
            } catch (err) {
              reject(err);
            }
          },
          reject,
        });
      });
    }),
  };
  return server;
}

function anEditor(tables: FloorplanTable[] = [], draft = true) {
  const server = aServer();
  let n = 0;
  const saved: SavedLayout[] = [];
  const editor = useLayoutEditor({
    save: server.save,
    onSaved: (answer) => saved.push(answer),
    draft: () => draft,
    newId: () => `new-${(n += 1)}`,
  });
  editor.adopt(aLayout(tables));
  const tablesNow = () => editor.layout.value!.tables;
  const codes = () => tablesNow().map((t) => `${t.id}:${t.sectionId ?? 'none'}:${t.number}`);
  return { editor, server, saved, tablesNow, codes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Let the save's wait run out and its answer land. */
async function settle() {
  await vi.advanceTimersByTimeAsync(600);
}

describe('adding tables', () => {
  it('numbers each new table one past its section, in the order given', () => {
    const { editor, codes } = anEditor([table('a', 'gold', 1)]);
    const ids = editor.addTables([
      { sectionId: 'gold', tableTypeId: 'six-foot', xMm: 1000, yMm: 1000 },
      { sectionId: 'gold', tableTypeId: 'six-foot', xMm: 3000, yMm: 1000 },
      { sectionId: 'silver', tableTypeId: 'six-foot', xMm: 3000, yMm: 4000 },
      { sectionId: null, tableTypeId: 'six-foot', xMm: 3000, yMm: 6000 },
    ]);
    expect(ids).toEqual(['new-1', 'new-2', 'new-3', 'new-4']);
    expect(codes()).toEqual([
      'a:gold:1',
      'new-1:gold:2',
      'new-2:gold:3',
      'new-3:silver:1',
      'new-4:none:null',
    ]);
  });

  it('places a table at the point given, of the type given, inside the floorplan', () => {
    const { editor, tablesNow } = anEditor();
    editor.addTables([
      { sectionId: 'gold', tableTypeId: 'square', xMm: 1234.56, yMm: 40_000, rotation: 15 },
    ]);
    expect(tablesNow()[0]).toMatchObject({
      tableTypeId: 'square',
      xMm: 1234.6,
      yMm: 22_500,
      rotation: 15,
    });
  });
});

describe('moving tables', () => {
  it('moves the tables named and no other', () => {
    const { editor, tablesNow } = anEditor([table('a', 'gold', 1), table('b', 'gold', 2)]);
    const other = tablesNow()[1];
    editor.moveTables(['a'], 250.04, -100);
    expect(tablesNow()[0]).toMatchObject({ xMm: 5250, yMm: 4900, number: 1 });
    expect(tablesNow()[1]).toBe(other);
  });

  it("stops at the floorplan's edge", () => {
    const { editor, tablesNow } = anEditor([table('a', 'gold', 1, 29_000, 5000)]);
    editor.moveTables(['a'], 5000, 0);
    expect(tablesNow()[0].xMm).toBe(30_000);
  });

  it('is no change when nothing moves', () => {
    const { editor } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 0, 0);
    editor.moveTables(['nobody'], 50, 50);
    expect(editor.canUndo.value).toBe(false);
  });
});

describe('turning tables', () => {
  it('turns one table about its own centre', () => {
    const { editor, tablesNow } = anEditor([table('a', 'gold', 1)]);
    editor.turnTables(['a'], 90);
    expect(tablesNow()[0]).toMatchObject({ xMm: 5000, yMm: 5000, rotation: 90 });
    editor.turnTables(['a'], 285);
    expect(tablesNow()[0].rotation).toBe(15);
  });

  it('turns several about the middle of them, each turned as much', () => {
    const { editor, tablesNow } = anEditor([
      table('a', 'gold', 1, 4000, 5000),
      table('b', 'gold', 2, 6000, 5000),
    ]);
    editor.turnTables(['a', 'b'], 90);
    expect(tablesNow()[0]).toMatchObject({ xMm: 5000, yMm: 4000, rotation: 90 });
    expect(tablesNow()[1]).toMatchObject({ xMm: 5000, yMm: 6000, rotation: 90 });
  });
});

describe('removing tables', () => {
  const four = () => [1, 2, 3, 4].map((n) => table(`g${n}`, 'gold', n));

  it("closes the gap in a draft, so the section's tables are numbered 1 to N", () => {
    const { editor, codes } = anEditor(four());
    editor.select(['g2', 'g3']);
    editor.removeTables(['g2']);
    expect(codes()).toEqual(['g1:gold:1', 'g3:gold:2', 'g4:gold:3']);
    expect(editor.selection.value).toEqual(['g3']);
  });

  it('leaves the numbers as they are past a draft', () => {
    const { editor, codes } = anEditor(four(), false);
    editor.removeTables(['g2']);
    expect(codes()).toEqual(['g1:gold:1', 'g3:gold:3', 'g4:gold:4']);
  });
});

describe('a gesture', () => {
  it('is one step of undo, however many frames it drew', () => {
    const { editor, tablesNow, server } = anEditor([table('a', 'gold', 1)]);
    editor.begin();
    editor.moveTables(['a'], 100, 0);
    editor.moveTables(['a'], 300, 0);
    editor.moveTables(['a'], 700, 50);
    // Each frame is the move from where the gesture began, not from the last frame.
    expect(tablesNow()[0]).toMatchObject({ xMm: 5700, yMm: 5050 });
    expect(editor.canUndo.value).toBe(false);
    editor.end();
    editor.undo();
    expect(tablesNow()[0]).toMatchObject({ xMm: 5000, yMm: 5000 });
    expect(editor.canUndo.value).toBe(false);
    expect(server.save).not.toHaveBeenCalled();
  });

  it('cancelled puts the tables back and is no change', () => {
    const { editor, tablesNow } = anEditor([table('a', 'gold', 1)]);
    editor.begin();
    editor.turnTables(['a'], 45);
    editor.cancel();
    expect(tablesNow()[0].rotation).toBe(0);
    expect(editor.canUndo.value).toBe(false);
  });

  it('that ends where it began is no change', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    editor.begin();
    editor.end();
    await settle();
    expect(editor.canUndo.value).toBe(false);
    expect(server.save).not.toHaveBeenCalled();
  });
});

describe('undo and redo', () => {
  it('take back and bring back each change, in order', () => {
    const { editor, codes, tablesNow } = anEditor([table('a', 'gold', 1)]);
    editor.addTables([{ sectionId: 'gold', tableTypeId: 'six-foot', xMm: 1000, yMm: 1000 }]);
    editor.moveTables(['a'], 500, 0);
    editor.turnTables(['a'], 90);
    editor.removeTables(['a']);
    expect(codes()).toEqual(['new-1:gold:1']);

    editor.undo();
    expect(codes()).toEqual(['a:gold:1', 'new-1:gold:2']);
    expect(tablesNow()[0]).toMatchObject({ xMm: 5500, rotation: 90 });
    editor.undo();
    expect(tablesNow()[0]).toMatchObject({ xMm: 5500, rotation: 0 });
    editor.undo();
    expect(tablesNow()[0].xMm).toBe(5000);
    editor.undo();
    expect(codes()).toEqual(['a:gold:1']);
    expect(editor.canUndo.value).toBe(false);

    editor.redo();
    editor.redo();
    editor.redo();
    editor.redo();
    expect(codes()).toEqual(['new-1:gold:1']);
    expect(editor.canRedo.value).toBe(false);
  });

  it('drop what was undone once a new change is made', () => {
    const { editor } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 500, 0);
    editor.undo();
    editor.moveTables(['a'], 0, 500);
    expect(editor.canRedo.value).toBe(false);
  });

  it('hold the last 200 steps', () => {
    const { editor, tablesNow } = anEditor([table('a', 'gold', 1, 1000, 1000)]);
    for (let i = 0; i < 205; i += 1) editor.moveTables(['a'], 10, 0);
    expect(tablesNow()[0].xMm).toBe(3050);
    let steps = 0;
    while (editor.canUndo.value) {
      editor.undo();
      steps += 1;
    }
    expect(steps).toBe(200);
    // The five oldest moves are past taking back.
    expect(tablesNow()[0].xMm).toBe(1050);
    while (editor.canRedo.value) editor.redo();
    expect(tablesNow()[0].xMm).toBe(3050);
  });

  it('cross a save, and each saves in turn', async () => {
    const { editor, server, tablesNow } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 500, 0);
    await settle();
    expect(server.sent).toHaveLength(1);
    expect(editor.saveState.value).toBe('saved');

    editor.undo();
    expect(tablesNow()[0].xMm).toBe(5000);
    await settle();
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1].layout.tables[0].xMm).toBe(5000);
    expect(server.sent[1].revision).toBe(4);

    editor.redo();
    await settle();
    expect(server.sent[2].layout.tables[0].xMm).toBe(5500);
    expect(server.sent[2].revision).toBe(5);
  });

  it('drop a selected table that an undo takes away', () => {
    const { editor } = anEditor();
    const ids = editor.addTables([
      { sectionId: 'gold', tableTypeId: 'six-foot', xMm: 1000, yMm: 1000 },
    ]);
    editor.select(ids);
    editor.undo();
    expect(editor.selection.value).toEqual([]);
  });
});

describe('the save queue', () => {
  it('saves once, 600 ms after the last of several changes', async () => {
    const { editor, server, saved } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 100, 0);
    await vi.advanceTimersByTimeAsync(500);
    editor.moveTables(['a'], 100, 0);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0].revision).toBe(3);
    expect(server.sent[0].layout.tables[0].xMm).toBe(5200);
    expect(editor.saveState.value).toBe('saved');
    expect(editor.layout.value!.revision).toBe(4);
    expect(saved).toHaveLength(1);
  });

  it('keeps one write out at a time, and saves a change made meanwhile after it', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.held = true;
    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(editor.saveState.value).toBe('saving');

    editor.moveTables(['a'], 100, 0);
    await settle();
    await settle();
    // The second change waits for the first write's answer.
    expect(server.sent).toHaveLength(1);

    server.waiting[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1].revision).toBe(4);
    expect(server.sent[1].layout.tables[0].xMm).toBe(5200);
    // The first answer did not put the older tables back over the newer.
    expect(editor.layout.value!.tables[0].xMm).toBe(5200);

    server.waiting[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.saveState.value).toBe('saved');
    expect(editor.layout.value!.revision).toBe(5);
    expect(editor.pending()).toBe(false);
  });

  it('keeps the working copy when a save fails, and Retry sends it', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.save.mockImplementationOnce(() => Promise.reject(refused(null)));
    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(editor.saveState.value).toBe('failed');
    // The app's one sentence for a request that reached no server.
    expect(editor.saveMessage.value).toBe(OFFLINE_MESSAGE);
    expect(editor.layout.value!.tables[0].xMm).toBe(5100);
    expect(editor.canUndo.value).toBe(true);

    editor.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.saveState.value).toBe('saved');
    expect(server.sent.at(-1)!.layout.tables[0].xMm).toBe(5100);
  });

  it('says its own sentence for a refusal that carries none, and keeps the working copy', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.save.mockImplementationOnce(() => Promise.reject(refused(400)));
    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(editor.saveState.value).toBe('failed');
    expect(editor.saveMessage.value).toBe(SAVE_FAILED);
    expect(editor.layout.value!.tables[0].xMm).toBe(5100);
    expect(editor.pending()).toBe(true);
  });

  it('sends a failed save again with the next change', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.save.mockImplementationOnce(() => Promise.reject(refused(500)));
    editor.moveTables(['a'], 100, 0);
    await settle();
    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(editor.saveState.value).toBe('saved');
    expect(server.sent.at(-1)!.layout.tables[0].xMm).toBe(5200);
  });

  it('surfaces a stale refusal, keeps the working copy and sends nothing more', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.revision = 9; // another tab saved
    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(editor.saveState.value).toBe('stale');
    expect(editor.saveMessage.value).toBe(STALE_LAYOUT);
    expect(editor.layout.value!.tables[0].xMm).toBe(5100);

    editor.moveTables(['a'], 100, 0);
    await settle();
    expect(server.sent).toHaveLength(1);
    expect(editor.layout.value!.tables[0].xMm).toBe(5200);
    expect(editor.saveState.value).toBe('stale');
  });

  it("takes the server's layout on Reload, and saves again from its revision", async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.revision = 9;
    editor.moveTables(['a'], 100, 0);
    await settle();
    editor.reload(aLayout([table('z', 'gold', 1, 800, 800)], 9));
    expect(editor.saveState.value).toBe('idle');
    expect(editor.layout.value!.tables[0].id).toBe('z');
    expect(editor.canUndo.value).toBe(false);

    editor.moveTables(['z'], 100, 0);
    await settle();
    expect(server.sent.at(-1)!.revision).toBe(9);
    expect(editor.saveState.value).toBe('saved');
  });

  it('saves at once on the way out of the page, and waits for the answer', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 100, 0);
    const left = editor.flush();
    await vi.advanceTimersByTimeAsync(0);
    await left;
    expect(server.sent).toHaveLength(1);
    expect(editor.pending()).toBe(false);
  });

  it('on the way out waits for the write that is out and sends what changed since', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.held = true;
    editor.moveTables(['a'], 100, 0);
    await settle();
    editor.moveTables(['a'], 100, 0);
    let out = false;
    const left = editor.flush().then(() => {
      out = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toBe(false);
    server.waiting[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toBe(false);
    server.waiting[1].resolve();
    await left;
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1].layout.tables[0].xMm).toBe(5200);
  });

  it('does not hold the way out for a save that fails', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.save.mockImplementation(() => Promise.reject(refused(null)));
    editor.moveTables(['a'], 100, 0);
    await editor.flush();
    expect(editor.saveState.value).toBe('failed');
    expect(editor.pending()).toBe(true);
  });
});

describe("the server's layout", () => {
  it('is taken when it is newer and the working copy holds nothing unsaved', () => {
    const { editor } = anEditor([table('a', 'gold', 1)]);
    editor.adopt(aLayout([table('z', 'gold', 1)], 5));
    expect(editor.layout.value!.tables[0].id).toBe('z');
  });

  it('is left alone while the working copy holds a change it lacks', () => {
    const { editor } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 100, 0);
    editor.adopt(aLayout([table('z', 'gold', 1)], 5));
    expect(editor.layout.value!.tables[0].id).toBe('a');
  });

  it("is left alone when it is the editor's own save read back", async () => {
    const { editor } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 100, 0);
    await settle();
    const before = editor.layout.value;
    editor.adopt(aLayout([table('a', 'gold', 1, 5100)], 4));
    expect(editor.layout.value).toBe(before);
    expect(editor.canUndo.value).toBe(true);
  });
});

describe("a write of the layout's own fields", () => {
  it('starts a layout at revision 0 and takes the answer', async () => {
    const server = aServer(0);
    const editor = useLayoutEditor({ save: server.save });
    const started = editor.write(aLayout([], 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(await started).toBe(true);
    expect(server.sent[0].revision).toBe(0);
    expect(editor.layout.value!.revision).toBe(1);
  });

  it('saves a scale at once, with the tables as they stand, outside undo', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    editor.moveTables(['a'], 100, 0);
    const written = editor.write({ ...editor.layout.value!, scalePxPerUnit: 0.05 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await written).toBe(true);
    const last = server.sent.at(-1)!.layout;
    expect(last.scalePxPerUnit).toBe(0.05);
    expect(last.tables[0].xMm).toBe(5100);
    editor.undo();
    expect(editor.layout.value!.scalePxPerUnit).toBe(0.05);
  });

  it('puts the layout back as it was read when the write is refused as stale', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.revision = 9; // another tab saved
    const before = editor.layout.value!.scalePxPerUnit;
    const written = editor.write({ ...editor.layout.value!, scalePxPerUnit: 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await written).toBe(false);
    expect(editor.saveState.value).toBe('stale');
    expect(editor.layout.value!.scalePxPerUnit).toBe(before);
  });

  it('says a write that was refused did not land', async () => {
    const { editor, server } = anEditor([table('a', 'gold', 1)]);
    server.save.mockImplementationOnce(() =>
      Promise.reject(refused(400, 'Every table must stand inside the floorplan.')),
    );
    const written = editor.write({ ...editor.layout.value!, scalePxPerUnit: 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await written).toBe(false);
    expect(editor.saveMessage.value).toBe('Every table must stand inside the floorplan.');
  });
});
