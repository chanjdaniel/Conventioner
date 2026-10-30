import { readdirSync, statSync } from 'node:fs';

/**
 * A run starts once the host's container network has settled (T121, review 3's note 17).
 *
 * A stack starting adds a bridge and a virtual interface per container to the host, and those keep
 * changing for a while after `up` returns: each takes an IPv6 link-local address within a second,
 * and changes link state again about 15 seconds later. Chromium takes every such change for the
 * network changing under it, and fails whatever it has in flight with `net::ERR_NETWORK_CHANGED`,
 * so the first spec after a stack starts loses a module or a request and fails. Watched with
 * `ip -ts monitor link address` across a restart; waiting for the interfaces to settle turned two
 * failed first runs out of three into none in two.
 *
 * The age of an interface is its sysfs entry's, which the kernel stamps when it is created. A host
 * whose newest one is older than the settle time, or one with none, such as a CI runner long after
 * its services started, waits for nothing.
 */
const SETTLE_MS = 20_000;
const INTERFACES = '/sys/class/net';
const CONTAINER_INTERFACE = /^(veth|br-|docker)/;

/** When the newest container interface on the host was created, in ms, or null where none is. */
function newestInterfaceAt(): number | null {
  let names: string[];
  try {
    names = readdirSync(INTERFACES);
  } catch {
    return null; // Not Linux: there is no sysfs to read, and nothing this knows how to wait for.
  }
  const times = names
    .filter((name) => CONTAINER_INTERFACE.test(name))
    .flatMap((name) => {
      try {
        return [statSync(`${INTERFACES}/${name}`).mtimeMs];
      } catch {
        return []; // Gone between the listing and the look: a stack stopping.
      }
    });
  return times.length ? Math.max(...times) : null;
}

/** Wait, once, for what is left of the newest container interface's settle time. */
export async function hostNetworkSettled(): Promise<void> {
  const newest = newestInterfaceAt();
  if (newest === null) return;
  const left = newest + SETTLE_MS - Date.now();
  if (left <= 0) return;
  console.log(`e2e: waiting ${Math.ceil(left / 1000)}s for the host's container network to settle`);
  await new Promise((resolve) => setTimeout(resolve, left));
}
