import { computed, type Ref } from 'vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { changedSinceSeen, reviewApplication } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { useMarketStore } from '@/stores/market';
import { signedInEmail } from '@/utils/signedIn';
import { saveVendorNote } from '@/utils/vendorNotes';

/** What became of a verdict: written, refused because it changed since it was seen, or failed. */
export type VerdictOutcome =
  | { kind: 'written'; application: Application }
  | { kind: 'changed'; application: Application; message: string }
  | { kind: 'failed'; message: string };

/**
 * Giving verdicts, as both review views do it (E34): the one-by-one card and the All view's drawer.
 *
 * Each verdict is written only on what the reviewer saw (F03/S01) - a refusal comes back as the
 * application as it stands and who changed it - and is followed by the store re-reading the market,
 * so the rail's count moves (E21/F02/S02). A follow-up is marked with its owner and, when the
 * reviewer wrote one, what is needed, kept in the vendor's notes (F02/S01).
 */
export function useVerdictActions(
  market: Ref<Market | null | undefined>,
  applications: Ref<Application[]>,
) {
  const marketStore = useMarketStore();

  /** The reviewer's own address, for "(you)" and for Mine. */
  const me = computed(() => signedInEmail() ?? '');

  /** A follow-up's possible owners, as the server serves them to this reviewer (T15): everyone
   *  with a role on the market if they are in its organization, its own roles if not. */
  const people = computed(() => market.value?.peopleOnMarket ?? []);

  /**
   * Take an application the server answered with, merged over what the list holds: a single
   * application's answer carries none of what only the list derives - a table-share notice is
   * read against every other application (E27/F01/S03).
   */
  function adopt(app: Application) {
    const index = applications.value.findIndex((a) => a.id === app.id);
    if (index !== -1) applications.value[index] = { ...applications.value[index], ...app };
    else applications.value.push(app);
  }

  async function give(
    app: Application,
    status: ApplicationStatus,
    ownerEmail?: string,
  ): Promise<VerdictOutcome> {
    const marketId = market.value?.id;
    if (!marketId) return { kind: 'failed', message: 'No market is open.' };
    try {
      const written = await reviewApplication(marketId, app, status, ownerEmail);
      adopt(written);
      void marketStore.refresh();
      return { kind: 'written', application: written };
    } catch (err) {
      const changed = changedSinceSeen(err);
      if (changed) {
        adopt(changed.application);
        return { kind: 'changed', application: changed.application, message: changed.message };
      }
      return { kind: 'failed', message: getApiErrorMessage(err, 'Failed to update application') };
    }
  }

  /**
   * Mark a follow-up: the note first, when the reviewer changed it - it is the vendor's notes, so
   * what was there is edited, never written over by an empty box - then the status.
   */
  async function markFollowUp(
    app: Application,
    { ownerEmail, note }: { ownerEmail: string; note: string },
    noteBefore: string,
  ): Promise<VerdictOutcome> {
    const marketId = market.value?.id;
    if (!marketId) return { kind: 'failed', message: 'No market is open.' };
    if (note !== noteBefore.trim()) {
      try {
        await saveVendorNote(marketId, app.applicantEmail, note);
      } catch (err) {
        return { kind: 'failed', message: getApiErrorMessage(err, 'Could not keep the note.') };
      }
    }
    return give(
      app,
      ApplicationStatus.NeedsFollowUp,
      ownerEmail.toLowerCase() === me.value.toLowerCase() ? undefined : ownerEmail,
    );
  }

  return { me, people, adopt, give, markFollowUp };
}
