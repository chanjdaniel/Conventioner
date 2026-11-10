import { computed, getCurrentInstance, onUnmounted, readonly, ref } from 'vue';
import { getApiErrorMessage } from '@/utils/api';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface AutosaveOptions {
  /** Write the working copy as it stands at the call. */
  send: () => Promise<void>;
  /** After a save the server took: the re-read. */
  afterSave: () => Promise<void> | void;
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
    if (!options.may()) return Promise.resolve(null);
    const carrying = edits.value;
    if (savedShown !== null) clearTimeout(savedShown);
    savedShown = null;
    status.value = 'saving';
    message.value = '';
    const answered = options.send().then(
      async () => {
        out.value = null;
        stored.value = carrying;
        const next = sendWanted();
        if (!next) {
          if (edits.value === stored.value) showSaved();
          else if (held) status.value = 'idle';
        }
        await options.afterSave();
        return null;
      },
      (err: unknown) => {
        out.value = null;
        status.value = 'failed';
        message.value = getApiErrorMessage(err, options.failure);
        const failed = message.value;
        sendWanted();
        return failed;
      },
    );
    out.value = answered;
    return answered;
  }

  /** At an answer: a save wanted while it was out goes now, unless the copy is held. */
  function sendWanted(): boolean {
    if (!wanted) return false;
    wanted = false;
    if (edits.value === stored.value || !options.may()) return false;
    if (held) {
      heldEdit = true;
      return false;
    }
    void save();
    return true;
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
    if (status.value === 'saved') status.value = 'idle';
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
   * of the failure that stopped it. A held edit is sent as kept: the working copy holds the value
   * from before the text that is not one.
   */
  async function flush(): Promise<string | null> {
    if (!options.may()) return null;
    stopPause();
    heldEdit = false;
    wanted = false;
    for (;;) {
      if (out.value) {
        await out.value;
        continue;
      }
      if (edits.value === stored.value || !options.may()) return null;
      const failed = await save();
      if (failed !== null) return failed;
    }
  }

  // Leaving the page must not lose an edit, so what is unsaved is sent without waiting.
  if (getCurrentInstance()) onUnmounted(() => void flush());

  return {
    status: readonly(status),
    message: readonly(message),
    unsaved,
    edited,
    hold,
    flush,
  };
}
