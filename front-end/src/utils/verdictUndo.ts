import { onScopeDispose, ref, type Ref } from 'vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import {
  changedSinceSeen,
  undoSelection,
  undoVerdict,
  type SelectionResult,
  type UndoItem,
} from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { applicantName } from '@/utils/essentialFields';
import { useMarketStore } from '@/stores/market';

/**
 * Undoing a verdict just given (E38/F10/S01), as both review views offer it.
 *
 * A verdict was one click or one key with no way back for whoever gave it. Now its giver reads what
 * they decided and an Undo, for the window the server's answer gave (`undoSeconds`) or until their
 * next verdict, whichever is first; the server checks again that it is still theirs to undo, and
 * returns the application to what it kept of it. The server gives a window only for a verdict on an
 * application awaiting one: one that changed a verdict is the change row's, whose "instead" buttons
 * put it right.
 */

/**
 * The applicant as the review names them: the name their answers give, then their address; the
 * address alone when they gave no name. The app keeps no business name of its own: a business is
 * whatever question a market's form asks, so it is not part of the name.
 */
export function nameAndEmail(app: Pick<Application, 'formData' | 'applicantEmail'>): string {
  const name = applicantName(app.formData as Record<string, unknown> | undefined);
  return name ? `${name} (${app.applicantEmail})` : app.applicantEmail;
}

/** The undo line's words for a verdict just given on this application. */
export function undoLine(
  status: ApplicationStatus,
  app: Pick<Application, 'formData' | 'applicantEmail'>,
): string {
  const who = nameAndEmail(app);
  if (status === ApplicationStatus.NeedsFollowUp) return `Marked ${who} for follow-up.`;
  if (status === ApplicationStatus.ReviewerApproved) return `Approved ${who}.`;
  return `Rejected ${who}.`;
}

/** The verdict on offer to undo: what it wrote, and the line that says so. */
export interface UndoOffer {
  items: UndoItem[];
  line: string;
}

/** What an undo did: the applications it returned, and for a selection what it skipped. */
export type UndoOutcome =
  { kind: 'undone'; applications: Application[]; result?: SelectionResult } | { kind: 'refused' };

/**
 * The verdict on offer to undo, its timer, and the undo itself. `adopt` takes each application the
 * server answered with into the view's list.
 */
export function useVerdictUndo(
  market: Ref<Market | null | undefined>,
  adopt: (app: Application) => void,
) {
  const offered = ref<UndoOffer | null>(null);
  /** Why the undo on offer was refused, said on its line in place of the button. */
  const refusal = ref('');
  const undoing = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function withdraw() {
    if (timer) clearTimeout(timer);
    timer = null;
    offered.value = null;
    refusal.value = '';
  }

  /**
   * Offer the undo of what a verdict wrote, replacing any on offer: the screen offers the last
   * verdict only. Nothing is offered for no seconds - the server gives none for a verdict that
   * changed one - or when the list no longer holds any of it.
   */
  function offer(items: (UndoItem | null)[], line: string, seconds: number) {
    withdraw();
    if (!seconds || !items.length || items.some((item) => item === null)) return;
    offered.value = { items: items as UndoItem[], line };
    timer = setTimeout(withdraw, seconds * 1000);
  }

  /** Offer the undo of one verdict, given on `before` and answered with `after`. */
  function offerOne(
    before: Application,
    after: Application,
    status: ApplicationStatus,
    seconds: number,
  ) {
    offer([{ application: after }], undoLine(status, before), seconds);
  }

  async function undo(): Promise<UndoOutcome> {
    const marketId = market.value?.id;
    const on = offered.value;
    if (!marketId || !on || refusal.value || undoing.value) return { kind: 'refused' };
    undoing.value = true;
    try {
      if (on.items.length === 1) {
        const undone = await undoVerdict(marketId, on.items[0]!);
        adopt(undone);
        withdraw();
        void useMarketStore().refresh();
        return { kind: 'undone', applications: [undone] };
      }
      const result = await undoSelection(marketId, on.items);
      withdraw();
      void useMarketStore().refresh();
      return { kind: 'undone', applications: [], result };
    } catch (err) {
      // Someone wrote over it since: the list takes what is really there, and the line says who.
      const changed = changedSinceSeen(err);
      if (changed) adopt(changed.application);
      refusal.value = changed?.message || getApiErrorMessage(err, 'Could not undo the verdict.');
      return { kind: 'refused' };
    } finally {
      undoing.value = false;
    }
  }

  onScopeDispose(withdraw);

  return { offered, refusal, undoing, offer, offerOne, withdraw, undo };
}
