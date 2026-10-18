/**
 * The two kinds of note on a market's vendors, read once per page (E31/F04).
 *
 * The vendor's own request - their answer to "Anything else you need from us?" - and the
 * organizer's side: one shared note, a "From your sheet" line an import replaces, and the mark that
 * the request was handled. `GET /markets/:id/vendor-notes` serves both kinds by address, each under
 * its own key; the vendor never sees the organizer's (map ticket 03).
 *
 * A write is followed by a re-read, never a patch, as every market write is.
 */
import { ref, type Ref } from 'vue';
import { api } from '@/utils/api';

export interface VendorNoteEntry {
  request: string;
  note: string;
  noteEditedBy: string | null;
  noteEditedAt: string | null;
  fromSheet: string | null;
  requestHandledAt: string | null;
  requestHandledBy: string | null;
}

/** Whether there is anything to show about this vendor at all. */
export function hasNotes(entry: VendorNoteEntry | undefined): boolean {
  return !!entry && !!(entry.request || entry.note || entry.fromSheet);
}

/** A request the door still has to deal with. */
export function requestOutstanding(entry: VendorNoteEntry | undefined): boolean {
  return !!entry?.request && !entry.requestHandledAt;
}

export function useVendorNotes(marketId: Ref<string>) {
  const notes = ref<Record<string, VendorNoteEntry>>({});

  async function load(): Promise<void> {
    if (!marketId.value) return;
    try {
      const { data } = await api.get(`/markets/${encodeURIComponent(marketId.value)}/vendor-notes`);
      notes.value = (data?.notes ?? {}) as Record<string, VendorNoteEntry>;
    } catch {
      // Notes are beside the page's work, never its subject: a page that cannot read them still
      // does its job, without them.
      notes.value = {};
    }
  }

  /** One vendor's entry, by address however it is cased. */
  function entryFor(email: string): VendorNoteEntry | undefined {
    return notes.value[email.trim().toLowerCase()];
  }

  return { notes, load, entryFor };
}

/** Replace the organizer's note on one vendor. */
export async function saveVendorNote(marketId: string, email: string, note: string): Promise<void> {
  await api.put(
    `/markets/${encodeURIComponent(marketId)}/vendor-notes/${encodeURIComponent(email)}`,
    { note },
  );
}

/** Mark a vendor's request handled, or take the mark back. */
export async function markRequestHandled(
  marketId: string,
  email: string,
  handled: boolean,
): Promise<void> {
  await api.put(
    `/markets/${encodeURIComponent(marketId)}/vendor-notes/${encodeURIComponent(email)}/request-handled`,
    { handled },
  );
}
