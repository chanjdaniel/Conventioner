import { computed, getCurrentInstance, onMounted, onUnmounted, readonly, ref } from 'vue';
import { getApiErrorMessage, getApiErrorStatus } from '@/utils/api';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'refused';

/** Said after a refusal's own sentence: what the screen did about it. */
const TAKEN_BACK = ' The plan is back as it was last saved.';

/**
 * Whether a failed save was the server saying no (400 to 499) rather than the save not getting
 * through: no answer, a 5xx, a 401 (the session ended, which the app's interceptor answers), a 408
 * (the request timed out) or a 429 (too many requests). A refusal will be refused again, so what it
 * carried is dropped; a failure may go through next time, so it is kept and sent again.
 */
export function isRefusal(err: unknown): boolean {
  const status = getApiErrorStatus(err);
  if (status === null || status < 400 || status > 499) return false;
  return status !== 401 && status !== 408 && status !== 429;
}

export interface AutosaveOptions {
  /** Write the working copy as it stands at the call. */
  send: () => Promise<void>;
  /**
   * The last try on the way out of the page: start a write that outlives it (a keepalive request),
   * true when one started. Its answer is never read: the page is going.
   */
  sendOnUnload: () => boolean;
  /** After a save the server took: the re-read. */
  afterSave: () => Promise<void> | void;
  /** After a refusal: take the server's copy back. Called with the refusal's sentence. */
  afterRefusal: (sentence: string) => Promise<void> | void;
  /** Whether this person may write at all; false sends nothing and counts no edit. */
  may: () => boolean;
  /** The sentence for a failure with no sentence of its own. */
  failure: string;
  /** The pause after an edit. */
  delay?: number;
}

/**
 * The order of the saves of one working copy that saves itself as it is edited (T271).
 *
 * The copy is written whole a pause after each edit, one save at a time. The plan used to send a
 * save at every pause whether or not one was still out, and answers are not promised in order: a
 * slow first save reaching the server last stored the older plan over the newer one, and the
 * re-read after it put that older plan back on screen beside "Plan saved".
 *
 * So a pause that ends while a save is out marks a save as wanted, and the answer sends it at once
 * with the working copy as it then stands; an edit whose pause is still running when the answer
 * comes is sent by its pause. Edits are counted, and an answered save marks stored only the edits
 * it carried, so `unsaved` holds until the server has the last one.
 *
 * A save the server refuses drops every edit made so far, since the copy is written whole and every
 * later edit builds on the refused one, and the screen takes the server's copy back and says why.
 * A save that fails on the way (no answer, a 401, 408, 429 or 5xx) keeps the edits unsaved and
 * says so; nothing retries on a timer, and the next edit, `retry` or a flush sends the copy again.
 *
 * A reload or a closed tab never unmounts the view, so an edit still waiting then (in its pause,
 * held, or after a failure) used to be lost. On `pagehide` the screen's `sendOnUnload` starts one
 * last write that outlives the page; the screen's browser question (`useUnsavedWork`) is the
 * guard, and this is a best effort.
 *
 * It knows nothing of markets: the screen gives it the write, the re-read and who may write.
 */
export function useAutosave(options: AutosaveOptions) {
  const delay = options.delay ?? 600;
  const status = ref<AutosaveStatus>('idle');
  const message = ref('');
  /** Edits made, and the edits the last save the server took carried. */
  const edits = ref(0);
  const stored = ref(0);
  /** The save out, settled once its answer is handled; null while none is out. */
  const out = ref<Promise<string | null> | null>(null);
  /** The edits the save out carries. */
  let outCarrying = 0;

  let pause: ReturnType<typeof setTimeout> | null = null;
  let savedShown: ReturnType<typeof setTimeout> | null = null;
  /** A pause ended while a save was out: send when it answers. */
  let wanted = false;
  let held = false;
  /** An edit made, or wanted, while held, which waits for the hold to end. */
  let heldEdit = false;

  const unsaved = computed(() => edits.value !== stored.value || out.value !== null);

  function stopPause() {
    if (pause !== null) clearTimeout(pause);
    pause = null;
  }

  function startPause() {
    stopPause();
    pause = setTimeout(() => {
      pause = null;
      if (out.value) wanted = true;
      else if (edits.value !== stored.value) void save();
    }, delay);
  }

  /** Send the working copy now; the caller makes sure no save is out. */
  function save(): Promise<string | null> {
    // This save carries every edit so far, so no pause or wanted save is left to send them.
    stopPause();
    wanted = false;
    if (!options.may()) {
      dropUnsendable();
      return Promise.resolve(null);
    }
    const carrying = edits.value;
    outCarrying = carrying;
    if (savedShown !== null) clearTimeout(savedShown);
    savedShown = null;
    status.value = 'saving';
    message.value = '';
    const answered = options.send().then(
      async () => {
        out.value = null;
        stored.value = carrying;
        // An edit made after this save went, which the person may no longer write, is dropped here
        // whether or not a pause or a wanted save is behind it: a held one has neither.
        if (!options.may()) dropUnsendable();
        // "Saving…" stands only while a save is out: an edit this one did not carry, waiting in its
        // pause or held, shows nothing until a save carries it.
        const next = sendWanted();
        if (!next) {
          if (edits.value === stored.value) showSaved();
          else status.value = 'idle';
        }
        await options.afterSave();
        return null;
      },
      async (err: unknown) => {
        out.value = null;
        const sentence = getApiErrorMessage(err, options.failure);
        if (isRefusal(err)) {
          dropEdits();
          status.value = 'refused';
          // Some refusals carry no full stop ("Market not found"), so the line after it would run on.
          message.value = (/[.!?…]$/.test(sentence) ? sentence : `${sentence}.`) + TAKEN_BACK;
          await options.afterRefusal(sentence);
          return sentence;
        }
        status.value = 'failed';
        message.value = sentence;
        // Retry could never send it, so neither the edits nor the failed line are kept for it.
        if (!options.may()) dropUnsendable();
        else sendWanted();
        return sentence;
      },
    );
    out.value = answered;
    return answered;
  }

  /** At an answer: a save wanted while it was out goes now, unless the copy is held. */
  function sendWanted(): boolean {
    if (!wanted) return false;
    wanted = false;
    if (edits.value === stored.value) return false;
    if (!options.may()) {
      dropUnsendable();
      return false;
    }
    if (held) {
      heldEdit = true;
      return false;
    }
    void save();
    return true;
  }

  /** A refusal: nothing made so far is to be sent, by a pause, a hold or a wanted save. */
  function dropEdits() {
    stored.value = edits.value;
    stopPause();
    wanted = false;
    heldEdit = false;
  }

  /**
   * The person may no longer write (the market archived, their role gone, by another person's
   * change): nothing made so far can ever be sent, so it is dropped as a refusal drops it, rather
   * than left unsaved for good, which kept the screen off every later re-read and had the browser
   * ask at every reload. The screen takes the server's copy back by its re-read.
   *
   * A send finds it (a pause's save, a wanted save, a save's answer, a flush), and so does the
   * screen, by `forgetUnsendable`, for an edit no send is coming for: one a failed save left, whose
   * failed line and Retry would stand beside the server's copy, or one held.
   */
  function dropUnsendable() {
    dropEdits();
    if (status.value === 'failed') {
      status.value = 'idle';
      message.value = '';
    }
  }

  /**
   * The screen read that the person may no longer write: drop what can never be sent now, rather
   * than at a send that may never come. A save out is left to answer, and its answer drops what is
   * still unsaved, since a drop before it would be undone when it moves `stored`.
   */
  function forgetUnsendable() {
    if (!options.may() && !out.value) dropUnsendable();
  }

  function showSaved() {
    status.value = 'saved';
    savedShown = setTimeout(() => {
      savedShown = null;
      if (status.value === 'saved') status.value = 'idle';
    }, 2000);
  }

  /** The working copy changed. */
  function edited() {
    if (!options.may()) return;
    edits.value += 1;
    // "Plan saved", and a refusal's "back as it was last saved", are not true of the new edit.
    if (status.value === 'saved' || status.value === 'refused') {
      status.value = 'idle';
      message.value = '';
    }
    if (held) {
      stopPause();
      heldEdit = true;
      return;
    }
    startPause();
  }

  /**
   * Hold the pause while the screen shows what is not kept (the Pricing card's text that is not a
   * price or a share, or a group's name it refuses, E43/F01/S01), so "Plan saved" never stands
   * beside it. An edit made meanwhile waits, and is sent a pause after the hold ends.
   */
  function hold(next: boolean) {
    held = next;
    if (held) {
      if (pause !== null || wanted) heldEdit = true;
      stopPause();
      wanted = false;
    } else if (heldEdit) {
      heldEdit = false;
      startPause();
    }
  }

  /**
   * Send what is not stored and wait: null once the server holds the last edit, else the sentence
   * of the failure or refusal that stopped it, a save out it waited for included. A held edit is
   * sent as kept: the working copy holds the value from before the text that is not one.
   */
  async function flush(): Promise<string | null> {
    if (!options.may()) {
      forgetUnsendable();
      return null;
    }
    stopPause();
    heldEdit = false;
    wanted = false;
    for (;;) {
      if (out.value) {
        const stopped = await out.value;
        if (stopped !== null) return stopped;
        continue;
      }
      if (edits.value === stored.value) return null;
      if (!options.may()) {
        dropUnsendable();
        return null;
      }
      const failed = await save();
      if (failed !== null) return failed;
    }
  }

  /** Send what is not stored again, after a failure: the button beside it. */
  function retry() {
    void flush();
  }

  /**
   * The page is going (a reload, a closed tab, a link out of the app): an edit the server does not
   * have and no save out carries is sent one last time. A save out carrying every edit is left to
   * land; one with a later edit behind it most likely lands first, since it was sent first, and
   * waiting for it would lose the later edit for sure. A screen whose writes hold a revision (the
   * plan, ADR 0024) sends the copy's own, which that save out moves past, so there the server
   * refuses the last write and only the browser's question guarded the later edit.
   */
  function onPageHide() {
    if (!options.may()) return;
    const behind = out.value ? edits.value !== outCarrying : edits.value !== stored.value;
    if (behind) options.sendOnUnload();
  }

  if (getCurrentInstance()) {
    onMounted(() => window.addEventListener('pagehide', onPageHide));
    // Leaving the view must not lose an edit, so what is unsaved is sent without waiting.
    onUnmounted(() => {
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    });
  }

  return {
    status: readonly(status),
    message: readonly(message),
    unsaved,
    edited,
    hold,
    flush,
    retry,
    forgetUnsendable,
  };
}
