import { onUnmounted, watch, type Ref } from 'vue';

/**
 * The open overlays' closes, oldest first: Escape is the last one's alone.
 *
 * Each open overlay used to bind a listener of its own, so one Escape on a dialog opened from a
 * dialog closed both, and focus fell to `<body>` behind them (T114's review). One listener now
 * hands the key to the overlay opened last, which is the one on top.
 */
const openCloses: Array<() => void> = [];

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  openCloses.at(-1)?.();
}

function stopTaking(close: () => void) {
  const at = openCloses.lastIndexOf(close);
  if (at !== -1) openCloses.splice(at, 1);
  if (!openCloses.length) window.removeEventListener('keydown', onKeydown);
}

/**
 * Close an overlay when Escape is pressed while it is open and on top.
 *
 * Every overlay in this product used to ignore Escape - the vendor detail panel, Manage
 * organization, Manage market, the market chooser, Create new market and the setup-path chooser.
 * Two of them had no visible close control either, so an organizer who opened one and did not
 * think to click the scrim was stuck.
 *
 * An overlay takes Escape only while it is open, so a page holding several closed overlays does
 * not close them all at once, and only while no overlay opened after it is still open; it gives
 * the key up when it closes or is unmounted.
 */
export function useEscapeToClose(isOpen: Ref<boolean> | (() => boolean), close: () => void) {
  // Its own function, so two overlays given the same close are still two entries.
  const take = () => close();

  watch(
    typeof isOpen === 'function' ? isOpen : () => isOpen.value,
    (open) => {
      if (open) {
        if (!openCloses.length) window.addEventListener('keydown', onKeydown);
        openCloses.push(take);
      } else {
        stopTaking(take);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => stopTaking(take));
}
