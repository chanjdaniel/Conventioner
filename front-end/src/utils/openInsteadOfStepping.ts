/** The keys that step a closed select's value, each step its own change and so its own question. */
const STEPPING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/**
 * A closed select steps its value on these keys, and every step is a change, so a keyboard user
 * met a confirmation at the first option past their own (T114's review). They open the list
 * instead, where the keys move among the options and only Enter chooses.
 */
export function openInsteadOfStepping(event: KeyboardEvent) {
  if (event.altKey || !STEPPING_KEYS.has(event.key)) return;
  event.preventDefault();
  const select = event.currentTarget as HTMLSelectElement & { showPicker?: () => void };
  try {
    select.showPicker?.();
  } catch {
    // Refused without a user gesture somewhere: Space and Alt+ArrowDown still open the list.
  }
}
