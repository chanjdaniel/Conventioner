import { watch, onUnmounted, type Ref } from 'vue';

/**
 * How many live modals have marked each element.
 *
 * Module-level, and a count rather than a flag, because two modals can be open at once and their
 * marked sets overlap: with a per-instance flag the first one to close un-inerts the page the
 * second still needs. Only elements this module marked are ever released, so an `inert` that was
 * already on an element when a modal opened is left exactly as it was found.
 */
const markedBy = new Map<HTMLElement, number>();

/**
 * How many live modals have taken `inert` off each element because it is part of them.
 *
 * Module-level for the same reason as `markedBy`: a modal beneath walks again when one of its parts
 * changes while it is open, and its walk must not put `inert` back on a dialog opened on top of it,
 * whose branch that dialog holds live.
 */
const suppressedBy = new Map<HTMLElement, number>();

/** Nothing here can hold focus or take a click, so marking it would only puzzle a reader. */
const NOT_RENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

/**
 * While a modal is open, make everything that is not part of it inert.
 *
 * A scrim stops the mouse. It does not stop the keyboard, and nothing else did either: with the
 * vendor drawer open, fourteen controls behind it stayed in the tab order, the phase rail's forward
 * action among them - so it could be tabbed onto and fired with Enter while a vendor's details were
 * on screen (E14/F02/S02). The drawer already said `aria-modal="true"`, which tells a screen reader
 * that everything outside it is out of play; this makes that true.
 *
 * It walks up from each element the modal is made of and marks every SIBLING along the way, which
 * is what "everything else on the page" means in DOM terms. Marking one container is not enough:
 * the page content and the app's own header are in different branches, so the first attempt at this
 * trapped two tabs and let the third reach the header's nav button.
 *
 * `inert` and not `aria-hidden`: `aria-hidden` hides a control from a screen reader while leaving it
 * clickable and focusable, which is the same lie in a different accent.
 *
 * Known limit: the page is marked when the modal opens, so an element appended to the document
 * afterwards (a teleported dialog or toast) is not marked. Nothing in this product does that behind
 * an open modal today.
 *
 * @param isOpen   whether the modal is currently open. Takes a ref or a getter, like
 *                 `useEscapeToClose`, which every overlay here already calls beside this.
 * @param partsOf  the elements the modal itself is made of - typically its scrim and its panel.
 *                 These, and their ancestors, are what stays live.
 */
export function useInertBehind(
  isOpen: Ref<boolean> | (() => boolean),
  partsOf: () => (HTMLElement | null)[],
): void {
  let marked: HTMLElement[] = [];
  /**
   * Elements this modal took `inert` OFF because they are part of it.
   *
   * A dialog opened FROM a dialog is a sibling of the one beneath it, so the first modal marked
   * the second before it existed as anything to click: the confirmation rendered, said the right
   * things, and silently could not be pressed. The count stays, so the modal beneath still
   * releases correctly when it closes; only the attribute comes off, and goes back on release.
   */
  let suppressed: HTMLElement[] = [];

  function release() {
    for (const el of suppressed) {
      const holders = (suppressedBy.get(el) ?? 1) - 1;
      if (holders > 0) suppressedBy.set(el, holders);
      else suppressedBy.delete(el);
      // Still marked by something else, and held live by no other modal, so it goes back to being
      // out of play.
      if (holders === 0 && (markedBy.get(el) ?? 0) > 0) el.setAttribute('inert', '');
    }
    suppressed = [];

    for (const el of marked) {
      const count = (markedBy.get(el) ?? 1) - 1;
      if (count > 0) {
        markedBy.set(el, count);
        continue;
      }
      markedBy.delete(el);
      el.removeAttribute('inert');
    }
    marked = [];
  }

  function mark(el: HTMLElement) {
    const already = markedBy.get(el);
    // A modal open on top holds this one live: counted, so it goes out of play once that closes.
    if (already === undefined && !suppressedBy.has(el)) el.setAttribute('inert', '');
    markedBy.set(el, (already ?? 0) + 1);
    marked.push(el);
  }

  function apply() {
    release();
    // `instanceof`, not a null check. A caller reading a component's `$el` gets `any` from Vue, and
    // a component with a fragment root hands back a comment node: that would join the spine while
    // the real panel became a sibling of it, so the modal would mark ITSELF out of play.
    const parts = partsOf().filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (parts.length === 0) return;

    // Every ancestor of every part, so the walk below can tell the modal's own branch apart.
    const spine = new Set<Element>();
    for (const part of parts) {
      for (let el: Element | null = part; el && el !== document.body; el = el.parentElement) {
        spine.add(el);
      }
    }

    // This modal's own branch is live, whatever a modal beneath it decided before it opened.
    for (const el of spine) {
      if (!(el instanceof HTMLElement) || !markedBy.has(el)) continue;
      el.removeAttribute('inert');
      suppressedBy.set(el, (suppressedBy.get(el) ?? 0) + 1);
      suppressed.push(el);
    }

    for (const part of parts) {
      for (let el: Element | null = part; el && el !== document.body; el = el.parentElement) {
        for (const sibling of el.parentElement?.children ?? []) {
          if (spine.has(sibling) || !(sibling instanceof HTMLElement)) continue;
          if (NOT_RENDERED.has(sibling.tagName)) continue;
          // Marked by something other than this module: not ours to release, so not ours to set.
          if (sibling.hasAttribute('inert') && !markedBy.has(sibling)) continue;
          mark(sibling);
        }
      }
    }
  }

  const openNow = typeof isOpen === 'function' ? isOpen : () => isOpen.value;
  watch(
    // The parts as well as the open state. A modal mounted already open (a `v-if` dialog with
    // `:open="true"`) is open from setup, before the template ref that names its parts has bound,
    // so watching the open state alone walked once with no parts and never again: the page behind
    // the change-placement dialog stayed live (T181). The ref binding on mount now re-runs the walk,
    // and `apply` releases before it marks, so a re-run never counts an element twice, and leaves a
    // dialog opened on top live (`suppressedBy`).
    () => [openNow(), ...partsOf()] as const,
    ([open]) => (open ? apply() : release()),
    // `immediate` and `post` together: a modal whose parts already exist when it opens is marked
    // at once, and every later walk runs after the render that bound its parts.
    { immediate: true, flush: 'post' },
  );

  onUnmounted(release);
}
