/**
 * Every way a person closes an `AppDialog`, tried in turn: its close control, Cancel, the scrim and
 * Escape, each of which must be drawn. A dialog holding through a save (`close-disabled`) emits `close` for none of them.
 */
import { flushPromises } from '@vue/test-utils';

export async function tryEveryClose(testid: string): Promise<void> {
  for (const part of ['close-button', 'cancel-button', 'background']) {
    const control = document.querySelector<HTMLElement>(`[data-testid="${testid}-${part}"]`);
    if (!control) throw new Error(`The dialog draws no ${testid}-${part}.`);
    control.click();
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await flushPromises();
}
