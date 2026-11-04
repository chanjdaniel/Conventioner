/**
 * A list folded past a size (T200), the behaviour `BarLedger` and `RowGroup` share: the first rows,
 * a count of the rest, and one button that unfolds them in place and folds them again.
 *
 * The button stays one element through both, at the list's foot, so where the focus and the eye go
 * is the fold's to settle:
 *
 * - Unfolding hands the focus to the first new row, or Tab would go on past every row just shown.
 *   That row is the one `tabindex="-1"` a list carries, at index `fold`.
 * - Folding keeps the focus on the button, which has just moved up the page past the rows that
 *   went, so it is brought back into view: centred, since a phone's sticky header would cover it at
 *   the window's top edge.
 *
 * It stays as it was when the rows change: a fold is the reader's, and unlike a list frame's pages it
 * starts nothing new.
 *
 * Bind `list` to the rows' parent and `button` to the button, with `ref="list"` and `ref="button"`.
 */
import { computed, nextTick, ref } from 'vue';

export function useFold<T>(items: () => readonly T[], fold: () => number | undefined) {
  const unfolded = ref(false);
  const list = ref<HTMLElement>();
  const button = ref<HTMLButtonElement>();

  const rest = computed(() => {
    const size = fold();
    return size === undefined ? 0 : Math.max(items().length - size, 0);
  });
  const shown = computed(() =>
    rest.value && !unfolded.value ? items().slice(0, fold()) : items(),
  );

  async function toggle(): Promise<void> {
    unfolded.value = !unfolded.value;
    await nextTick();
    if (unfolded.value) (list.value?.children[fold() ?? 0] as HTMLElement | undefined)?.focus();
    else button.value?.scrollIntoView({ block: 'center' });
  }

  return { button, list, rest, shown, toggle, unfolded };
}
