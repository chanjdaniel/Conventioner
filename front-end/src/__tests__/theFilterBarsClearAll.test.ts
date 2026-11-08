/**
 * "Clear all" lets go of the filters the bar offers chips for. The Assignments page's search is one
 * of them; the Vendors page's stands in the page's own field, under the same address key, and is no
 * chip of the bar's, so it stays (T223).
 */
import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import { filtersBeside } from '@/utils/resultFilters';

async function clearAll(page: 'tables' | 'vendors', at: string): Promise<Record<string, unknown>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/page', component: { render: () => null } }],
  });
  await router.push(at);
  await router.isReady();
  const wrapper = mount(ResultFilterBar, {
    global: { plugins: [router] },
    props: {
      options: { dates: ['2099-08-01'], sections: ['North'], tiers: [] },
      offered: filtersBeside(page),
      testid: page,
    },
  });
  await wrapper.get(`[data-testid="${page}-filter-chip-clear-all"]`).trigger('click');
  await flushPromises();
  // Before the unmount, which takes the router back to where it started.
  const { query } = router.currentRoute.value;
  wrapper.unmount();
  return query;
}

describe('Clear all', () => {
  it('on Vendors, leaves the search and the open vendor', async () => {
    const query = await clearAll(
      'vendors',
      '/page?date=2099-08-01&section=North&search=ada&vendor=a%40example.test',
    );
    expect(query).toEqual({ search: 'ada', vendor: 'a@example.test' });
  });

  it('on the Assignments page, lets the search go with the rest', async () => {
    const query = await clearAll('tables', '/page?date=2099-08-01&search=ada&vendor=a%40x.test');
    expect(query).toEqual({ vendor: 'a@x.test' });
  });
});
