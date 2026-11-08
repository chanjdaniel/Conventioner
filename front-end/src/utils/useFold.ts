/**
 * A list folded past a size (T200), the behaviour `BarLedger`, `RowGroup` and a question's options in
 * `FormFieldEditor` share: the first rows, a count of the rest, and one button that unfolds them in
 * place and folds them again.
 *
 * The button stays one element through both, at the list's foot, so where the focus and the eye go
 * is the fold's to settle:
 *
 * - Unfolding hands the focus to the first new row, or Tab would go on past every row just shown.
 *   That row is the one a list gives `tabindex="-1"`, by `rowTabindex`.
 * - Folding keeps the focus on the button, which has just moved up the page past the rows that
 *   went, so it is brought back into view: centred, since a phone's sticky header would cover it at
 *   the window's top edge.
 *
 * It stays as it was when the rows change: a fold is the reader's, and unlike a list frame's pages it
 * starts nothing new. A page that must keep it past the list's own life, or change it from outside,
 * passes the `unfolded` ref (`useGroupFolds`); the focus moves only on the list's own button.
 *
 * Bind `list` to the rows' parent, with the rows its first children, and `button` to the button, with
 * `ref="list"` and `ref="button"`, and each row's `tabindex` to `rowTabindex(index)`.
 */
import { computed, nextTick, ref, type Ref } from 'vue';

export function useFold<T>(
  items: () => readonly T[],
  fold: () => number | undefined,
  unfolded: Ref<boolean> = ref(false),
) {
  const list = ref<HTMLElement>();
  const button = ref<HTMLButtonElement>();

  const rest = computed(() => {
    const size = fold();
    return size === undefined ? 0 : Math.max(items().length - size, 0);
  });
  const shown = computed(() =>
    rest.value && !unfolded.value ? items().slice(0, fold()) : items(),
  );

  /** Only the row the fold hands the focus to may take it, and Tab still passes it by. */
  const rowTabindex = (index: number) => (index === fold() ? -1 : undefined);

  async function toggle(): Promise<void> {
    // Read now: a fold the page holds is only as it was told once the page has drawn it.
    const unfolding = !unfolded.value;
    unfolded.value = unfolding;
    await nextTick();
    if (unfolding) (list.value?.children[fold()!] as HTMLElement | undefined)?.focus();
    else button.value?.scrollIntoView({ block: 'center' });
  }

  return { button, list, rest, rowTabindex, shown, toggle, unfolded };
}
