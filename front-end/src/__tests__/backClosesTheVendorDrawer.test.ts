/**
 * Back closes the vendor drawer (E38/F13/S01).
 *
 * The drawer opened and closed by replacing the address, so Back with it open left the page: from
 * Vendors, it went to the dashboard. Opening it from a closed drawer is now a step of its own in the
 * browser's history, and closing it takes that step back, so Back and the drawer's own close leave
 * history alike. A drawer reached by a link or a reload has no step to take back, and closing it
 * replaces the address as before, so it never leaves the site.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { useVendorDrawer } from '@/utils/vendorDrawer';

const ANA = 'ana@ember.test';
const BEN = 'ben@ember.test';

type Drawer = ReturnType<typeof useVendorDrawer>;

const Page = defineComponent({
  setup(_, { expose }) {
    const drawer = useVendorDrawer();
    expose({ drawer });
    return () => h('main', drawer.email.value ?? 'closed');
  },
});

let wrapper: VueWrapper | null = null;
let router: Router;
let drawer: Drawer;

/** Waits for a navigation, Back's included, to land. */
async function landed() {
  await new Promise<void>((resolve) => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
  });
  await flushPromises();
}

async function back() {
  const done = landed();
  router.back();
  await done;
}

/** Starts at `/dashboard`, then goes to `start` as a click on a link does. */
async function begin(start: string) {
  window.history.replaceState(null, '', '/dashboard');
  router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/dashboard', component: { render: () => h('p', 'dashboard') } },
      { path: '/vendors', component: Page },
    ],
  });
  await router.push('/dashboard');
  await router.isReady();
  await router.push(start);
  wrapper = mount(Page, { global: { plugins: [router] } });
  await flushPromises();
  drawer = (wrapper.vm as unknown as { drawer: Drawer }).drawer;
}

const path = () => router.currentRoute.value.fullPath;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('opening the drawer is a step; Back takes it back', () => {
  it('Back with the drawer open closes it and stays on the page, its filter kept', async () => {
    await begin('/vendors?q=gold');
    drawer.open(ANA);
    await flushPromises();
    expect(path()).toBe(`/vendors?q=gold&vendor=${ANA}`);
    expect(drawer.email.value).toBe(ANA);

    await back();
    expect(path()).toBe('/vendors?q=gold');
    expect(drawer.email.value).toBeNull();

    // A second Back goes to the page before.
    await back();
    expect(path()).toBe('/dashboard');
  });

  it('changing the tab and opening another vendor are no steps: one Back closes the drawer', async () => {
    await begin('/vendors');
    drawer.open(ANA);
    await flushPromises();
    drawer.setTab('assignments');
    await flushPromises();
    drawer.setTab('history');
    await flushPromises();
    drawer.open(BEN, 'payment');
    await flushPromises();
    expect(drawer.email.value).toBe(BEN);
    expect(drawer.tab.value).toBe('payment');

    await back();
    expect(path()).toBe('/vendors');
    expect(drawer.email.value).toBeNull();
  });

  it('closing takes the step back, so a Back after it goes to the page before', async () => {
    await begin('/vendors');
    drawer.open(ANA);
    await flushPromises();
    drawer.setTab('history');
    await flushPromises();

    const closed = landed();
    drawer.close();
    await closed;
    expect(path()).toBe('/vendors');
    expect(drawer.email.value).toBeNull();

    await back();
    expect(path()).toBe('/dashboard');
  });
});

describe('a drawer reached by a link or a reload', () => {
  it('opens, and closing it stays on the page', async () => {
    await begin(`/vendors?vendor=${encodeURIComponent(ANA)}&vendorTab=history`);
    expect(drawer.email.value).toBe(ANA);
    expect(drawer.tab.value).toBe('history');

    drawer.close();
    await flushPromises();
    expect(path()).toBe('/vendors');
    expect(drawer.email.value).toBeNull();

    // The address was replaced, not taken back: Back goes where the link came from.
    await back();
    expect(path()).toBe('/dashboard');
  });

  it('a drawer opened again after one closed in place is a step of its own', async () => {
    await begin(`/vendors?vendor=${encodeURIComponent(ANA)}`);
    drawer.close();
    await flushPromises();

    drawer.open(BEN);
    await flushPromises();
    await back();
    expect(path()).toBe('/vendors');

    await back();
    expect(path()).toBe('/dashboard');
  });

  it('a page whose address changed under the open drawer is replaced, not left', async () => {
    await begin('/vendors');
    drawer.open(ANA);
    await flushPromises();
    // The entry before is no longer this page without the drawer.
    await router.replace({ query: { ...router.currentRoute.value.query, q: 'silver' } });

    drawer.close();
    await flushPromises();
    expect(path()).toBe('/vendors?q=silver');
  });
});
