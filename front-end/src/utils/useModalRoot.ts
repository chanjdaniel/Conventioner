import { ref, type Ref } from 'vue';
import { useInertBehind } from '@/utils/useInertBehind';

/**
 * A template ref for a modal's root element, with the page held inert while that modal is open.
 *
 * Most modals here are one element that wraps the whole thing - its scrim and its panel are both
 * inside it - so naming that one element is all `useInertBehind` needs. That made the wiring the
 * same three lines in nine components, carrying the same paragraph of explanation nine times, which
 * is nine copies of one idea to drift apart.
 *
 * Bind the returned ref to the modal's outermost element:
 *
 * ```vue
 * const modalRoot = useModalRoot(() => props.open);
 * // <div ref="modalRoot" class="scrim">…</div>
 * ```
 *
 * A modal whose scrim and panel are separate siblings, rather than one inside the other, cannot use
 * this: it has to name both, so it calls `useInertBehind` directly. The app's navigation drawer and
 * the vendor detail drawer are the two.
 */
export function useModalRoot(isOpen: Ref<boolean> | (() => boolean)): Ref<HTMLElement | null> {
  const root = ref<HTMLElement | null>(null);
  useInertBehind(isOpen, () => [root.value]);
  return root;
}
