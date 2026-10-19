import { computed } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import type { VendorTab } from '@/components/VendorDrawer.vue';
import { withoutQueryKey } from '@/utils/routeQuery';

const TABS: readonly VendorTab[] = ['application', 'assignments', 'history'];

/**
 * Which vendor's drawer is open, and on which tab, as part of the page's address (E35/F01/S01):
 * `?vendor=<email>&vendorTab=assignments`. A link, a refresh or Back returns to the same panel, on
 * any screen that opens it.
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
    void router.replace({ query });
  }

  function setTab(onTab: VendorTab) {
    if (email.value) open(email.value, onTab);
  }

  function close() {
    void router.replace({
      query: withoutQueryKey(withoutQueryKey(route.query, 'vendor'), 'vendorTab'),
    });
  }

  return { email, tab, open, setTab, close };
}
