/**
 * A screen that holds work the server does not have yet asks before that work is dropped (T271).
 *
 * The form builder kept unsaved questions in the open tab, and opening Plan, a link or Back dropped
 * them with no word. One call registers both guards a screen needs:
 *
 * - **On unload** (a reload, closing the tab), a `beforeunload` listener while the screen is
 *   mounted, so the browser asks in its own words; nothing of the app's can be shown there.
 * - **In the app** (a link, a tab, Back), with `inApp`, the router's leave and update guards. A move
 *   that changes only the query or the hash stays on the work and never asks (the form's
 *   `?step=`), and a move to the sign-in page never asks: a sign-out and an ended session forget
 *   the session before they move, so nothing could be saved from the page any more.
 *
 * The question in the app is one dialog, {@link askToLeave}'s, drawn by `UnsavedWorkDialog.vue`
 * where `App.vue` mounts it once.
 */
import { onMounted, onUnmounted, shallowReadonly, shallowRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, type RouteLocationNormalized } from 'vue-router';

export interface UnsavedWorkOptions {
  /** Read when someone tries to leave: whether leaving now drops work. */
  unsaved: () => boolean;
  /** What the leave question says is lost, one or two sentences. */
  sentence: string;
  /** Ask on an in-app move that unmounts the work, as well as on unload. Default true. */
  inApp?: boolean;
}

/** The leave question on show: its sentence, and how it is answered. */
interface LeaveQuestion {
  sentence: string;
  answer: (leave: boolean) => void;
}

// Shallow, so the question held is the one asked, never a reactive copy its answer would not know.
const question = shallowRef<LeaveQuestion | null>(null);

/** The leave question on show, or null; read by `UnsavedWorkDialog.vue`. */
export const leaveQuestion = shallowReadonly(question);

/**
 * Ask whether to leave, dropping what `sentence` says is lost: true to leave. Used by the composable
 * and the dialog alone. A second question while one is open answers the first "stay" and takes its
 * place, so two moves never wait on one answer.
 */
export function askToLeave(sentence: string): Promise<boolean> {
  question.value?.answer(false);
  return new Promise<boolean>((resolve) => {
    const asked: LeaveQuestion = {
      sentence,
      answer: (leave) => {
        if (question.value === asked) question.value = null;
        resolve(leave);
      },
    };
    question.value = asked;
  });
}

/** Answer the question on show; the dialog's Leave is true, its Stay and every close false. */
export function answerLeaveQuestion(leave: boolean): void {
  question.value?.answer(leave);
}

/** Whether a move from `from` to `to` drops the screen's work: a new path, and not the sign-in page. */
function leavesTheWork(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  return to.path !== from.path && to.name !== 'login';
}

export function useUnsavedWork(options: UnsavedWorkOptions): void {
  const { unsaved, sentence, inApp = true } = options;

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!unsaved()) return;
    event.preventDefault();
    // The older spelling of the same request, which some browsers still read.
    event.returnValue = '';
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
  onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload));

  if (!inApp) return;
  const guard = async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    if (!leavesTheWork(to, from) || !unsaved()) return true;
    return askToLeave(sentence);
  };
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate(guard);
}
