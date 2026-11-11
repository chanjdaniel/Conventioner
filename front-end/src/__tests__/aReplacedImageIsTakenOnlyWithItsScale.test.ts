/**
 * Replacing a layout's floorplan image (T257 ticket 10): the layout takes the new image only with
 * its scale, in one write, and a write that fails or is refused leaves the layout as it was, so
 * giving the replacement up after it, which deletes the new image, never leaves the editor naming a
 * deleted image or holding a change that cannot be saved (the review of ticket 10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject } from '@/assets/types/datatypes';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

const STORED: FloorplanObject = {
  id: 'fp',
  locationId: 'loc-upper',
  revision: 3,
  imageGridfsId: 'old',
  imageWidth: 800,
  imageHeight: 600,
  scalePxPerUnit: 0.02,
  tables: [],
  zones: [],
  sectionStyles: [],
  startingCounts: [],
};

const refusal = (status: number, error?: string) =>
  Object.assign(new Error('refused'), {
    isAxiosError: true,
    response: { status, data: error ? { error } : {} },
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function replaced(save: () => Promise<SavedLayout>) {
  const editor = useLayoutEditor({ save });
  editor.adopt(STORED);
  const said: string[] = [];
  const written = editor.write(
    { ...editor.layout.value!, imageGridfsId: 'new', scalePxPerUnit: 0.05 },
    { rollBack: true, onRefused: (sentence) => said.push(sentence) },
  );
  await vi.advanceTimersByTimeAsync(0);
  return { editor, landed: await written, said };
}

describe('a replaced image', () => {
  it('refused, leaves the layout on its old image with nothing unsaved, and says why', async () => {
    const { editor, landed, said } = await replaced(() =>
      Promise.reject(refusal(400, 'Every table must stand inside the floorplan.')),
    );

    expect(landed).toBe(false);
    expect(said).toEqual(['Every table must stand inside the floorplan.']);
    expect(editor.layout.value!.imageGridfsId).toBe('old');
    expect(editor.layout.value!.scalePxPerUnit).toBe(0.02);
    expect(editor.pending()).toBe(false);
    expect(editor.saveState.value).not.toBe('failed');
  });

  it('failed in transit, leaves the layout as it was too', async () => {
    const { editor, landed, said } = await replaced(() => Promise.reject(refusal(503)));

    expect(landed).toBe(false);
    expect(said).toHaveLength(1);
    expect(editor.layout.value!.imageGridfsId).toBe('old');
    expect(editor.pending()).toBe(false);
  });

  it('landed, is the layout with its scale', async () => {
    const { editor, landed } = await replaced(() =>
      Promise.resolve({
        floorplan: { ...STORED, imageGridfsId: 'new', scalePxPerUnit: 0.05, revision: 4 },
        sections: [],
      }),
    );

    expect(landed).toBe(true);
    expect(editor.layout.value!.imageGridfsId).toBe('new');
  });
});
