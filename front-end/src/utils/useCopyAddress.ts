import { ref } from 'vue';

/**
 * Copy a public address, and say "Copied" beside it for two seconds: the rail's address chips and
 * Publish results' vendor page address.
 *
 * `copied` is the address last copied, so two addresses on one screen do not share one "Copied".
 * Clipboard access can be refused, and the address is shown and linked either way, so the copy is
 * a convenience, never the only way to get it.
 */
export function useCopyAddress() {
  const copied = ref('');

  async function copy(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      copied.value = address;
      window.setTimeout(() => {
        if (copied.value === address) copied.value = '';
      }, 2000);
    } catch {
      copied.value = '';
    }
  }

  return { copied, copy };
}
