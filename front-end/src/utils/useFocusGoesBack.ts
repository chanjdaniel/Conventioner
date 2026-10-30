import { nextTick, onBeforeUnmount, watch } from 'vue';

/**
 * Focus goes back to what opened a modal when it closes, by any path (T45).
 *
 * Closing unmounts what was focused inside, which drops focus to `<body>`, so a keyboard user
 * started again from the top of the page after every dialog. The opener is taken as the modal
 * opens, before focus moves in - so a caller moves focus in after a `nextTick` - and focused once
 * the page behind is no longer inert (`useInertBehind` releases it in a post-flush watcher, which
 * `nextTick` waits for). It is left alone when it has left the page - a deleted row, a navigation -
 * and when something has already put focus somewhere of its own.
 *
 * `AppDialog` and the vendor drawer share it, which is why it is not the dialog's alone.
 *
 * @param isOpen whether the modal is open, as a getter.
 */
export function useFocusGoesBack(isOpen: () => boolean): void {
  let opener: HTMLElement | null = null;

  function returnFocus() {
    const target = opener;
    opener = null;
    if (!target) return;
    void nextTick(() => {
      const active = document.activeElement;
      if (target.isConnected && (!active || active === document.body)) target.focus();
    });
  }

  onBeforeUnmount(() => {
    if (isOpen()) returnFocus();
  });

  watch(
    isOpen,
    (open, wasOpen) => {
      if (!open) {
        if (wasOpen) returnFocus();
        return;
      }
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    { immediate: true },
  );
}
