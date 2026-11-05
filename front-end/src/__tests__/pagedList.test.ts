/**
 * A list the server pages (T224): the next page as the end of the rows comes into view, in a box of
 * its own or in the flow of a scroller around it, and what it says at its end while a page is on its
 * way or has failed. Its height and its shades only exist in a real browser, so
 * `the-markets-history.spec.ts` proves those; what is held here is when it asks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import PagedList from '@/components/PagedList.vue';
import { installIntersectionObserver } from './support/intersection';

/** A list whose rows, and whether a page is on its way, the test sets as a screen would. */
function mountList(given: { box?: 'own' | 'parent'; rows?: number; hasMore?: boolean } = {}) {
  const rows = ref(given.rows ?? 2);
  const hasMore = ref(given.hasMore ?? true);
  const loading = ref(false);
  const error = ref('');
  const asked = ref(0);
  const Screen = defineComponent({
    setup: () => () =>
      h(
        PagedList,
        {
          box: given.box,
          label: 'Changes',
          testid: 'list',
          hasMore: hasMore.value,
          loading: loading.value,
          error: error.value,
          onMore: () => asked.value++,
        },
        {
          default: () =>
            Array.from({ length: rows.value }, (_, n) =>
              h('p', { key: n, 'data-testid': 'row' }, [h('button', `Row ${n}`)]),
            ),
        },
      ),
  });
  const wrapper: VueWrapper = mount(Screen, { attachTo: document.body });
  mounted = wrapper;
  return { wrapper, rows, hasMore, loading, error, asked };
}

let mounted: VueWrapper | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

const sel = (id: string) => `[data-testid="${id}"]`;

describe('asking for the next page', () => {
  it('asks when the end of the rows comes into view, and not before', async () => {
    const view = installIntersectionObserver();
    const { asked } = mountList();
    await flushPromises();

    await view.hideSentinels();
    expect(asked.value).toBe(0);

    await view.showSentinels();
    expect(asked.value).toBe(1);
  });

  it('does not ask while a page is on its way', async () => {
    const view = installIntersectionObserver();
    const { asked, loading } = mountList();
    loading.value = true;
    await flushPromises();

    await view.showSentinels();

    expect(asked.value).toBe(0);
  });

  it('observes again as the rows change, since a sentinel still in view does not fire by itself', async () => {
    const view = installIntersectionObserver();
    const { rows } = mountList();
    await flushPromises();
    const before = view.observed();

    rows.value = 3;
    await flushPromises();

    expect(view.observed()).toBeGreaterThan(before);
    expect(view.watched()).toBe(1);
  });

  it('observes again once a page has landed with no new row, so an empty page does not stall it', async () => {
    const view = installIntersectionObserver();
    const { loading } = mountList();
    loading.value = true;
    await flushPromises();
    const before = view.observed();

    loading.value = false;
    await flushPromises();

    expect(view.observed()).toBeGreaterThan(before);
  });

  it('holds no sentinel past the last page, and asks for nothing', async () => {
    const view = installIntersectionObserver();
    const { wrapper, hasMore, asked } = mountList();
    await flushPromises();
    expect(wrapper.find(sel('list-sentinel')).exists()).toBe(true);

    hasMore.value = false;
    await flushPromises();

    expect(wrapper.find(sel('list-sentinel')).exists()).toBe(false);
    expect(view.watched()).toBe(0);
    await view.showSentinels();
    expect(asked.value).toBe(0);
  });

  it('holds no sentinel while a page has failed, so it does not ask again by itself', async () => {
    const view = installIntersectionObserver();
    const { wrapper, error } = mountList();
    await flushPromises();

    error.value = 'Older changes could not be loaded.';
    await flushPromises();

    expect(wrapper.find(sel('list-sentinel')).exists()).toBe(false);
    expect(view.watched()).toBe(0);
  });

  it('hides its sentinel from a reader and from the pointer', async () => {
    installIntersectionObserver();
    const { wrapper } = mountList();
    await flushPromises();

    expect(wrapper.get(sel('list-sentinel')).attributes('aria-hidden')).toBe('true');
  });

  it('stops observing as it goes', async () => {
    const view = installIntersectionObserver();
    const { wrapper } = mountList();
    await flushPromises();
    expect(view.watched()).toBe(1);

    wrapper.unmount();
    mounted = null;

    expect(view.watched()).toBe(0);
  });

  it('draws its rows with no observer at all, as a test’s DOM has none', async () => {
    const { wrapper } = mountList();
    await flushPromises();

    expect(wrapper.findAll(sel('row'))).toHaveLength(2);
  });
});

describe('its two box modes', () => {
  it('stands the rows in a scroll box of its own by default, named while it scrolls', async () => {
    const { wrapper } = mountList();
    await flushPromises();

    const box = wrapper.get(sel('list-box'));
    expect(box.classes()).toContain('scroll-box__scroller');
    expect(box.find(sel('row')).exists()).toBe(true);
    expect(wrapper.element.classList).toContain('paged-list--own');
  });

  it('holds no scroller of its own in the flow of one around it', async () => {
    const { wrapper } = mountList({ box: 'parent' });
    await flushPromises();

    expect(wrapper.find('.scroll-box').exists()).toBe(false);
    expect(wrapper.find(sel('row')).exists()).toBe(true);
    expect(wrapper.element.classList).toContain('paged-list--parent');
  });
});

describe('what it says at its end', () => {
  it('says "Loading…" in a status line that was there before it spoke', async () => {
    const { wrapper, loading } = mountList();
    await flushPromises();
    const line = wrapper.get(sel('list-loading'));
    expect(line.attributes('role')).toBe('status');
    expect(line.text()).toBe('');

    loading.value = true;
    await nextTick();

    expect(wrapper.get(sel('list-loading')).element).toBe(line.element);
    expect(line.text()).toBe('Loading…');
  });

  it('says what failed, and Try again asks for the page', async () => {
    const { wrapper, error, asked } = mountList();
    error.value = 'Older changes could not be loaded.';
    await flushPromises();

    expect(wrapper.get(sel('list-read-failed')).text()).toContain(
      'Older changes could not be loaded.',
    );
    await wrapper.get(sel('list-retry')).trigger('click');

    expect(asked.value).toBe(1);
  });
});

describe('the focus after Try again', () => {
  /** A failed page, then Try again from its button: the page is on its way. */
  async function tryAgain() {
    const list = mountList();
    list.error.value = 'Older changes could not be loaded.';
    await flushPromises();
    const button = list.wrapper.get(sel('list-retry')).element as HTMLButtonElement;
    button.focus();
    button.click();
    list.error.value = '';
    list.loading.value = true;
    await flushPromises();
    return list;
  }

  it('never falls to the body while the page is on its way', async () => {
    await tryAgain();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(document.querySelector('.paged-list__rows'));
  });

  it('goes to the first control of what landed', async () => {
    const { wrapper, rows, loading } = await tryAgain();

    rows.value = 4;
    loading.value = false;
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.findAll(sel('row'))[2].get('button').element);
  });

  it('stays on the rows when what landed holds no control', async () => {
    const { loading } = await tryAgain();

    loading.value = false;
    await flushPromises();

    expect(document.activeElement).toBe(document.querySelector('.paged-list__rows'));
  });

  it('goes back to Try again when the page fails again', async () => {
    const { wrapper, error, loading } = await tryAgain();

    error.value = 'Older changes could not be loaded.';
    loading.value = false;
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get(sel('list-retry')).element);
  });

  it('leaves the focus alone if the reader has moved it while the page came', async () => {
    const { wrapper, rows, loading } = await tryAgain();
    const elsewhere = wrapper.findAll(sel('row'))[0].get('button').element as HTMLButtonElement;
    elsewhere.focus();

    rows.value = 4;
    loading.value = false;
    await flushPromises();

    expect(document.activeElement).toBe(elsewhere);
  });

  it('does not take the focus when a page lands that nobody tried again for', async () => {
    const { wrapper, rows, loading } = mountList();
    await flushPromises();
    const reading = wrapper.findAll(sel('row'))[1].get('button').element as HTMLButtonElement;
    reading.focus();
    loading.value = true;
    await flushPromises();

    rows.value = 4;
    loading.value = false;
    await flushPromises();

    expect(document.activeElement).toBe(reading);
  });
});
