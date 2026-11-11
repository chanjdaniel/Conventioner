/**
 * A location's layout, written (T257): `POST /floorplans/save-to-market` with the revision the
 * editor read, and what its answer means to the page.
 *
 * The answer is the layout and the plan's sections as stored, so the page adopts the new revision
 * at once; the market is then re-read through the one store, as every write is followed
 * (`docs/implementation/conventions/one-market-from-the-server.md`).
 */
import type { FloorplanObject, SectionObject } from '@/assets/types/datatypes';
import { api, getApiErrorMessage, getApiErrorStatus } from '@/utils/api';

/** The server's sentence for a save over a layout another tab or person saved in between. */
export const STALE_LAYOUT = 'This layout changed elsewhere. Reload to see the latest.';
/** What a save that failed in transit says, the server having said nothing. */
export const SAVE_FAILED = 'Could not save the layout. Retry in a moment.';

/** A floorplan image as the upload stored it. */
export type UploadedFloorplan = {
  gridfs_id: string;
  width: number;
  height: number;
  /** The page of the PDF it was drawn from, counted from 1; absent for an image. */
  page?: number;
};

export interface SavedLayout {
  floorplan: FloorplanObject;
  sections: SectionObject[];
}

/** Why a save did not land: `stale` wants a reload, `failed` a retry of the same save. */
export type SaveRefusal = { kind: 'stale' | 'failed'; message: string };

export async function saveLayout(
  marketId: string,
  floorplan: FloorplanObject,
  revision: number,
): Promise<SavedLayout> {
  const { data } = await api.post('/floorplans/save-to-market', {
    market_id: marketId,
    floorplan,
    revision,
  });
  return data as SavedLayout;
}

/** A failed save, as the page says it: the server's sentence for a refusal, and the one failure
 * sentence when the server said none (no answer, or a fault of its own). */
export function saveRefusal(err: unknown): SaveRefusal {
  const status = getApiErrorStatus(err);
  if (status === null || status >= 500) return { kind: 'failed', message: SAVE_FAILED };
  const message = getApiErrorMessage(err, SAVE_FAILED);
  return { kind: status === 409 && message === STALE_LAYOUT ? 'stale' : 'failed', message };
}
