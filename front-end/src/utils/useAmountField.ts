import type { Ref } from 'vue';
import { focusedAmountText, leftAmountText } from '@/utils/pricing';

/**
 * An amount field's caret: focused, a field gives its plain number with the caret at its end, never
 * the whole text selected (the rule "an amount reads to the cent", in `docs/business/rules/`).
 *
 * `focused` writes the focused text into the input at once, inside the focus handler, so nothing
 * typed right after the focus is undone; text that does not change (a blank, or text that is no
 * amount) keeps whatever selection the browser gave it. A mouse press lands the caret where the
 * pointer was, after the focus and over the text the plain number replaced, so the click that ends
 * the press puts it back at the end: bind `onPointerdown` and `onClick` on the input for that.
 */
export function useAmountCaret() {
  /** The input a press is focusing, whose text the focus rewrote. */
  let pressed: HTMLInputElement | null = null;

  function focused(input: HTMLInputElement, text: string): void {
    if (input.value === text) {
      pressed = null;
      return;
    }
    input.value = text;
    input.setSelectionRange(text.length, text.length);
  }

  function onPointerdown(event: PointerEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    pressed = document.activeElement === input ? null : input;
  }

  function onClick(event: MouseEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    if (pressed !== input) return;
    pressed = null;
    input.setSelectionRange(input.value.length, input.value.length);
  }

  return { focused, onPointerdown, onClick };
}

/**
 * One amount field whose text is `text` (bound with `v-model`): left, it reads as currency in
 * `currency()` ("$35.00"); focused, the plain number ("35.00"); text that is no amount stays as typed.
 * The text changes only on focus and on leaving, never while typing.
 */
export function useAmountField(text: Ref<string>, currency: () => string) {
  const caret = useAmountCaret();

  function onFocus(event: FocusEvent): void {
    text.value = focusedAmountText(text.value);
    caret.focused(event.target as HTMLInputElement, text.value);
  }

  function onBlur(): void {
    text.value = leftAmountText(text.value, currency());
  }

  return {
    onFocus,
    onBlur,
    onPointerdown: caret.onPointerdown,
    onClick: caret.onClick,
  };
}
