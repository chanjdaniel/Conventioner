/**
 * The folds of a page's groups (T223), held by the page, for a page of `RowGroup`s with one "Show
 * all" over them: the Assignments page's sections, by date.
 *
 * The page holds them because a fold is the reader's and a group does not last: a re-read takes every
 * group off the screen and draws them again, and a filter takes a group away and brings it back. So
 * a fold is kept by the group's key, whether or not the group is on the page, and stays as it was
 * until a press changes it.
 *
 * The page's button speaks for the groups now on the page that pass the fold, so it is offered only
 * while one does, says "Show fewer" once each of them is unfolded however they came to be, and acts
 * only on them: what a filter has hidden comes back as it was left.
 */
import { computed, ref } from 'vue';

export interface FoldedGroup {
  /** Stands for the group through a re-read: the Assignments page's `date|section`. */
  key: string;
  /** How many rows the group has now, its filter applied. */
  rows: number;
}

export function useGroupFolds(groups: () => readonly FoldedGroup[], fold: number) {
  const unfolded = ref<ReadonlySet<string>>(new Set());

  const foldable = computed(() =>
    groups()
      .filter(({ rows }) => rows > fold)
      .map(({ key }) => key),
  );
  const offered = computed(() => foldable.value.length > 0);
  const allUnfolded = computed(() => foldable.value.every((key) => unfolded.value.has(key)));
  const rows = computed(() => groups().reduce((all, group) => all + group.rows, 0));

  const isUnfolded = (key: string) => unfolded.value.has(key);

  function setUnfolded(key: string, open: boolean): void {
    const next = new Set(unfolded.value);
    if (open) next.add(key);
    else next.delete(key);
    unfolded.value = next;
  }

  function toggleAll(): void {
    const open = !allUnfolded.value;
    for (const key of foldable.value) setUnfolded(key, open);
  }

  function reset(): void {
    unfolded.value = new Set();
  }

  return { allUnfolded, isUnfolded, offered, reset, rows, setUnfolded, toggleAll };
}
