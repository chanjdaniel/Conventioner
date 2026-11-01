import { computed } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { withoutQueryKey } from '@/utils/routeQuery';

/** The vendor drawer's tabs (E35/F01/S01). */
export type VendorTab = 'application' | 'assignments' | 'payment' | 'history';

const TABS: readonly VendorTab[] = ['application', 'assignments', 'payment', 'history'];

/** The `history.state` key that marks an entry pushed by opening the drawer. */
const DRAWER_STEP = 'vendorDrawer';

/** Two queries alike, key by key, whatever their order. */
function sameQuery(a: LocationQuery, b: LocationQuery): boolean {
  const values = (value: LocationQuery[string] | undefined) =>
    JSON.stringify(Array.isArray(value) ? value : [value]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => key in a && key in b && values(a[key]) === values(b[key]));
}

/**
 * Which vendor's drawer is open, and on which tab, as part of the page's address (E35/F01/S01):
 * `?vendor=<email>&vendorTab=assignments`. A link or a refresh returns to the same panel, on any
 * screen that opens it.
 *
 * Opening the drawer is the one part of a page that is a step of its own in the browser's history
 * (E38/F13/S01): opening it from closed pushes an entry marked as the drawer's, and closing it takes
 * that step back, so Back (a phone's back gesture, the browser's button) closes the drawer and stays
 * on the page, with its filter and scroll. Changing the tab or the vendor while it is open replaces
 * the entry, so one Back closes it whatever was done inside. A drawer reached by a link has no step
 * of its own to take back, and closing it replaces the address instead, never leaving the site; a
 * reload keeps the entry it reloaded, so it closes as before the reload.
 */
export function useVendorDrawer() {
  const route = useRoute();
  const router = useRouter();

  const email = computed(() => {
    const asked = String(route.query.vendor ?? '')
      .trim()
      .toLowerCase();
    return asked || null;
  });
  const tab = computed<VendorTab>(() => {
    const asked = String(route.query.vendorTab ?? '') as VendorTab;
    return TABS.includes(asked) ? asked : 'application';
  });

  function open(vendor: string, onTab: VendorTab = 'application') {
    const query: LocationQuery = { ...route.query, vendor: vendor.trim().toLowerCase() };
    if (onTab === 'application') delete query.vendorTab;
    else query.vendorTab = onTab;
    if (email.value) void router.replace({ query });
    else void router.push({ query, state: { [DRAWER_STEP]: true } });
  }

  function setTab(onTab: VendorTab) {
    if (email.value) open(email.value, onTab);
  }

  // Set while a close's Back is on its way: a browser answers it later, with a popstate, and until
  // then the entry is still the drawer's, so a second close would take a second step, off the page.
  let goingBack = false;

  function close() {
    if (goingBack) return;
    const query = withoutQueryKey(withoutQueryKey(route.query, 'vendor'), 'vendorTab');
    // The router's own record of this entry: whether opening the drawer pushed it, and the address
    // of the entry before it.
    const here = router.options.history.state;
    if (here[DRAWER_STEP] === true && isThisPage(here.back, query)) {
      goingBack = true;
      const landed = router.afterEach(() => {
        goingBack = false;
        landed();
      });
      router.back();
      return;
    }
    void router.replace({ query, state: { [DRAWER_STEP]: false } });
  }

  /**
   * Whether `address`, the entry before as the browser holds it, is this page with `query`: compared
   * as locations, path and query, since the browser may spell the same address otherwise (`%20`
   * where the router writes `+`).
   */
  function isThisPage(address: unknown, query: LocationQuery): boolean {
    if (typeof address !== 'string') return false;
    const before = router.resolve(address);
    return before.path === route.path && sameQuery(before.query, query);
  }

  return { email, tab, open, setTab, close };
}
