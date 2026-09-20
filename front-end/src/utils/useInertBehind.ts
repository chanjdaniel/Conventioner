import { watch, onBeforeUnmount, type Ref } from 'vue';

/**
 * While a modal is open, make everything that is not part of it inert.
 *
 * A scrim stops the mouse. It does not stop the keyboard, and nothing else did either: with the
 * vendor drawer open, fourteen controls behind it stayed in the tab order, the phase rail's forward
 * action among them - so "Publish Market" could be tabbed onto and fired with Enter while a
 * vendor's details were on screen (E14/F02/S02). The drawer already said `aria-modal="true"`, which
 * tells a screen reader that everything outside it is out of play; this makes that true.
 *
 * It walks up from each element the modal is made of and marks every SIBLING along the way inert,
 * which is what "everything else on the page" means in DOM terms. Marking one container is not
 * enough: the page content and the app's own header are in different branches, so the first attempt
 * at this trapped two tabs and let the third reach the header's nav button.
 *
 * `inert` and not `aria-hidden`: `aria-hidden` hides a control from a screen reader while leaving
 * it clickable and focusable, which is the same lie in a different accent.
 *
 * @param isOpen   whether the modal is currently open.
 * @param partsOf  the elements the modal itself is made of - typically its scrim and its panel.
 *                 These, and their ancestors, are what stays live.
 */
export function useInertBehind(isOpen: Ref<boolean>, partsOf: () => (HTMLElement | null)[]): void {
  let marked: HTMLElement[] = [];

  function release() {
    for (const el of marked) el.removeAttribute('inert');
    marked = [];
  }

  /** Nothing here can hold focus or take a click, so marking it would only puzzle a reader. */
  const NOT_RENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

  function apply() {
    release();
    const parts = partsOf().filter((el): el is HTMLElement => el !== null);
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
          // Something else marked it for its own reasons; releasing it later is not ours to do.
          if (sibling.hasAttribute('inert')) continue;
          sibling.setAttribute('inert', '');
          marked.push(sibling);
        }
      }
    }
  }

  watch(isOpen, (open) => (open ? apply() : release()), { flush: 'post' });
  onBeforeUnmount(release);
}
