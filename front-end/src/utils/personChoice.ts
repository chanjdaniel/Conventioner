/**
 * A person as a choice in a `SearchPicker` (T204). An account holds an address and no name, so a
 * person is found by their address and called by it; the reader's own reads "You" beside it in the
 * list and "(you)" on a chip. A vendor's application may hold a name, so a vendor is called by both
 * (T223).
 */
import type { PickerOption } from '@/components/SearchPicker.vue';
import { signedInEmail } from '@/utils/signedIn';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';

/** How many matching people a chooser draws before "N more, type to narrow". */
export const PEOPLE_CAP = 50;

/** Whether this address is the reader's own, whatever its capitals. */
export const isTheReader = (address: string): boolean =>
  address.toLowerCase() === (signedInEmail() ?? '').toLowerCase();

/** One address as a choice, marked when it is the reader's own, whatever its capitals. */
export function personOption(address: string): PickerOption {
  const isMe = isTheReader(address);
  return {
    value: address,
    label: address,
    address: true,
    ...(isMe ? { detail: 'You', chip: `${address} (you)` } : {}),
  };
}

/** Whether the words are anywhere in the address, capitals aside. */
export const findsPerson = (option: PickerOption, words: string): boolean =>
  option.label.toLowerCase().includes(words.toLowerCase());

/**
 * A vendor in one line. The address alone is what every vendor surface used to show; the name alone
 * is ambiguous where someone is choosing, as two traders may share one. So: the name, and the
 * address that identifies them, or the address alone for a vendor with no name.
 */
export function vendorLabel(email: string | null | undefined, names: VendorNames): string {
  const address = String(email ?? '').trim();
  const name = vendorName(address, names);
  return name ? `${name} (${address})` : address;
}

/** One vendor as a choice, so a row narrower than the address breaks it only before its "@" or a dot. */
export function vendorOption(email: string, names: VendorNames): PickerOption {
  return { value: email, label: vendorLabel(email, names), address: true };
}
