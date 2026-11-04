/**
 * A person as a choice in a `SearchPicker` (T204). An account holds an address and no name, so a
 * person is found by their address and called by it; the reader's own reads "You" beside it in the
 * list and "(you)" on a chip.
 */
import type { PickerOption } from '@/components/SearchPicker.vue';
import { signedInEmail } from '@/utils/signedIn';

/** How many matching people a chooser draws before "N more, type to narrow". */
export const PEOPLE_CAP = 50;

/** One address as a choice, marked when it is the reader's own, whatever its capitals. */
export function personOption(address: string): PickerOption {
  const isMe = address.toLowerCase() === (signedInEmail() ?? '').toLowerCase();
  return {
    value: address,
    label: address,
    ...(isMe ? { detail: 'You', chip: `${address} (you)` } : {}),
  };
}

/** Whether the words are anywhere in the address, capitals aside. */
export const findsPerson = (option: PickerOption, words: string): boolean =>
  option.label.toLowerCase().includes(words.toLowerCase());
