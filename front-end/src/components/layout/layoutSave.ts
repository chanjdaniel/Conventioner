/**
 * A location's layout, written (T257): `POST /floorplans/save-to-market` with the revision the
 * editor read, and what its answer means to the page.
 *
 * The answer is the layout and the plan's sections as stored, so the page adopts the new revision
 * at once; the market is then re-read through the one store, as every write is followed
 * (`docs/implementation/conventions/one-market-from-the-server.md`).
 */
import type { FloorplanObject, SectionObject } from '@/assets/types/datatypes';
import { api } from '@/utils/api';

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

/**
 * The last try as the page goes (a reload, a closed tab): the same write as a keepalive request,
 * which may outlive the page; true when one started. `fetch`, not the app's axios, whose browser
 * adapter is XHR and has no `keepalive`. A best effort: its answer is never read, and a layout
 * over the browser's 64 KiB keepalive limit, some hundreds of tables, is not sent at all, so the
 * browser's own question before the page goes is the guard.
 */
export function saveLayoutOnUnload(
  marketId: string,
  floorplan: FloorplanObject,
  revision: number,
): boolean {
  try {
    void fetch(`${import.meta.env.VITE_FLASK_HOST}/floorplans/save-to-market`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, floorplan, revision }),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
