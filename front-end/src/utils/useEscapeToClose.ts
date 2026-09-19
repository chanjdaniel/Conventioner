import { onUnmounted, watch, type Ref } from 'vue';

/**
 * Close an overlay when Escape is pressed while it is open.
 *
 * Every overlay in this product used to ignore Escape - the vendor detail panel, Manage
 * organization, Manage market, the market chooser, Create new market and the setup-path chooser.
 * Two of them had no visible close control either, so an organizer who opened one and did not
 * think to click the scrim was stuck.
 *
 * The listener is bound only while the overlay is open, so a page holding several overlays does
 * not close them all at once, and it is removed on unmount.
 */
export function useEscapeToClose(isOpen: Ref<boolean> | (() => boolean), close: () => void) {
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    close();
  }

  watch(
    typeof isOpen === 'function' ? isOpen : () => isOpen.value,
    (open) => {
      if (open) {
        window.addEventListener('keydown', onKeydown);
      } else {
        window.removeEventListener('keydown', onKeydown);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown);
  });
}
