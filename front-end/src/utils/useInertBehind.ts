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

  function release() {
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
    if (already === undefined) el.setAttribute('inert', '');
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

  watch(
    typeof isOpen === 'function' ? isOpen : () => isOpen.value,
    (open) => (open ? apply() : release()),
    // `immediate` and `post` together: a modal that is already open when its view mounts must be
    // marked, and the walk needs the elements in `partsOf` to exist before it runs.
    { immediate: true, flush: 'post' },
  );

  onUnmounted(release);
}
