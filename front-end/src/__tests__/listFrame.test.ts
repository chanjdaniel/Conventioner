import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { h } from 'vue';
import ListFrame from '@/components/ListFrame.vue';

interface Row {
  id: string;
  name: string;
}

const rows = (count: number, prefix = 'Row'): Row[] =>
  Array.from({ length: count }, (_, at) => ({ id: `${prefix}-${at}`, name: `${prefix} ${at}` }));

const mounted: VueWrapper[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/** The frame as a screen mounts it, on a real router, in the document so focus is real. */
async function mountFrame(
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {},
  at = '/list?kept=1',
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/list', component: { render: () => null } }],
  });
  await router.push(at);
  await router.isReady();
  const wrapper = mount(ListFrame, {
    attachTo: document.body,
    global: { plugins: [router] },
    props: {
      items: rows(312),
      finds: (item: Row, words: string) => item.name.toLowerCase().includes(words.toLowerCase()),
      itemKey: (item: Row) => item.id,
      noun: { one: 'application', many: 'applications' },
      findLabel: 'Find by name or address',
      testid: 'frame',
      ...props,
    } as never,
    slots: {
      row: ({ item, index }: { item: Row; index: number }) =>
        h('span', { 'data-testid': 'row-words' }, `${index}: ${item.name}`),
      ...slots,
    } as never,
  });
  mounted.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

const field = (wrapper: VueWrapper) => wrapper.find('[data-testid="frame-find"]');
const count = (wrapper: VueWrapper) => wrapper.get('[data-testid="frame-count"]').text();
const drawn = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="frame-row"]').length;
const more = (wrapper: VueWrapper) => wrapper.find('[data-testid="frame-more"]');

async function type(wrapper: VueWrapper, words: string): Promise<void> {
  await field(wrapper).setValue(words);
  await flushPromises();
}

describe('the find field', () => {
  it('is not there at 12 rows, the threshold', async () => {
    const { wrapper } = await mountFrame({ items: rows(12) });
    expect(field(wrapper).exists()).toBe(false);
  });

  it('is there at 13 rows, named by its label', async () => {
    const { wrapper } = await mountFrame({ items: rows(13) });
    const input = field(wrapper);
    expect(input.exists()).toBe(true);
    const label = wrapper.get('label');
    expect(label.text()).toBe('Find by name or address');
    expect(label.attributes('for')).toBe(input.attributes('id'));
  });

  it('takes its threshold from findFrom', async () => {
    const { wrapper } = await mountFrame({ items: rows(5), findFrom: 4 });
    expect(field(wrapper).exists()).toBe(true);
    await wrapper.setProps({ items: rows(4) });
    expect(field(wrapper).exists()).toBe(false);
  });

  it('stays while it holds words, so words narrowing the rows can always be cleared', async () => {
    const { wrapper } = await mountFrame({ items: rows(20) });
    await type(wrapper, 'Row 1');
    await wrapper.setProps({ items: rows(5) });
    expect(field(wrapper).exists()).toBe(true);
    expect(count(wrapper)).toBe('1 of 5 matches "Row 1"');
  });

  it('stays while it has the focus, so clearing it never drops the caret', async () => {
    const { wrapper } = await mountFrame({ items: rows(20) });
    const input = field(wrapper);
    (input.element as HTMLInputElement).focus();
    await input.trigger('focus');
    await type(wrapper, 'Row 1');
    await wrapper.setProps({ items: rows(5) });
    await type(wrapper, '');
    expect(field(wrapper).exists()).toBe(true);
    expect(document.activeElement).toBe(field(wrapper).element);
  });

  it('leaves only when the rows next change, so what it leaves for never moves under a press', async () => {
    const { wrapper } = await mountFrame({ items: rows(20) });
    const input = field(wrapper);
    (input.element as HTMLInputElement).focus();
    await input.trigger('focus');
    await type(wrapper, 'Row 1');
    await wrapper.setProps({ items: rows(5) });
    await type(wrapper, '');

    (field(wrapper).element as HTMLInputElement).blur();
    await field(wrapper).trigger('blur');
    await flushPromises();
    expect(field(wrapper).exists()).toBe(true);

    await wrapper.setProps({ items: rows(4) });
    expect(field(wrapper).exists()).toBe(false);
  });

  it('counts the whole list when told it, so a narrow filter leaves the field where it is', async () => {
    const { wrapper } = await mountFrame({ items: rows(3), wholeCount: 359 });
    expect(field(wrapper).exists()).toBe(true);
    expect(count(wrapper)).toBe('3 of 359 applications');
    await wrapper.setProps({ items: [] });
    expect(field(wrapper).exists()).toBe(true);
  });

  it('shows no field on a whole list at the threshold, however many rows it is told of', async () => {
    const { wrapper } = await mountFrame({ items: rows(13), wholeCount: 12 });
    expect(field(wrapper).exists()).toBe(false);
  });

  it('draws the filters slot with or without the field', async () => {
    const filters = () => h('button', { 'data-testid': 'a-filter' }, 'Open');
    const short = await mountFrame({ items: rows(3) }, { filters });
    expect(short.wrapper.find('[data-testid="a-filter"]').exists()).toBe(true);
    const long = await mountFrame({ items: rows(13) }, { filters });
    expect(long.wrapper.find('[data-testid="a-filter"]').exists()).toBe(true);
  });

  it('draws no tools at all with no field and no filters', async () => {
    const { wrapper } = await mountFrame({ items: rows(3) });
    expect(wrapper.find('[data-testid="frame-tools"]').exists()).toBe(false);
  });
});

describe('Enter in the find field', () => {
  it('is kept from a form around the frame: it finds, it never saves a dialog', async () => {
    const { wrapper } = await mountFrame();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    wrapper.get('[data-testid="frame-find"]').element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });
});

describe('the count line', () => {
  it('names the rows when all are shown', async () => {
    const { wrapper } = await mountFrame({ items: rows(40) });
    expect(count(wrapper)).toBe('40 applications');
  });

  it('says one in the singular', async () => {
    const { wrapper } = await mountFrame({ items: rows(1) });
    expect(count(wrapper)).toBe('1 application');
  });

  it('says how many are shown when capped', async () => {
    const { wrapper } = await mountFrame();
    expect(count(wrapper)).toBe('Showing 50 of 312');
  });

  it('says how many match, with words', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'row 30');
    expect(count(wrapper)).toBe('11 of 312 match "row 30"');
  });

  it('agrees with one match', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'row 311');
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
  });

  it('says nothing matches, and draws no rows', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'ann');
    expect(count(wrapper)).toBe('Nothing matches "ann"');
    expect(drawn(wrapper)).toBe(0);
    expect(more(wrapper).exists()).toBe(false);
  });

  it('finds by the trimmed words, and spaces alone are no words', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, '  row 311 ');
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
    await type(wrapper, '   ');
    expect(count(wrapper)).toBe('Showing 50 of 312');
  });

  it('is announced, since a reader stays in the field as the rows change', async () => {
    const { wrapper } = await mountFrame();
    expect(wrapper.get('[data-testid="frame-count"]').attributes('role')).toBe('status');
  });
});

describe('the count line with wholeCount', () => {
  it('says the filters left fewer than the whole, capped', async () => {
    const { wrapper } = await mountFrame({ items: rows(110), wholeCount: 359 });
    expect(count(wrapper)).toBe('Showing 50 of 110 (359 in all)');
  });

  it('says the filters left fewer than the whole, every one drawn', async () => {
    const { wrapper } = await mountFrame({ items: rows(40), wholeCount: 359 });
    expect(count(wrapper)).toBe('40 of 359 applications');
  });

  it('reads as it does without one when nothing is narrowed', async () => {
    const capped = await mountFrame({ items: rows(359), wholeCount: 359 });
    expect(count(capped.wrapper)).toBe('Showing 50 of 359');
    const whole = await mountFrame({ items: rows(5), wholeCount: 5 });
    expect(count(whole.wrapper)).toBe('5 applications');
  });

  it('leaves the words to say what they found', async () => {
    const { wrapper } = await mountFrame({ items: rows(110), wholeCount: 359 });
    await type(wrapper, 'row 10');
    expect(count(wrapper)).toBe('11 of 110 match "row 10"');
  });
});

describe('the rows slot', () => {
  /** A screen's own table, as a screen draws one: its rows carry `data-list-row` and `tabindex`. */
  const table = {
    rows: ({ rows: drawnRows }: { rows: Row[] }) =>
      h('table', { 'data-testid': 'own-table' }, [
        h('tbody', [
          h('tr', { 'data-testid': 'group' }, [h('th', 'A heading between rows')]),
          ...drawnRows.map((item) =>
            h('tr', { key: item.id, 'data-list-row': '', tabindex: -1, 'data-testid': 'own-row' }, [
              h('td', item.name),
            ]),
          ),
        ]),
      ]),
  };
  const ownRows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="own-row"]');

  it("draws the screen's rows in place of the frame's list, a page at a time", async () => {
    const { wrapper } = await mountFrame({}, table);
    expect(wrapper.find('[data-testid="frame-rows"]').exists()).toBe(false);
    expect(drawn(wrapper)).toBe(0);
    expect(ownRows(wrapper)).toHaveLength(50);
    expect(count(wrapper)).toBe('Showing 50 of 312');
  });

  it('hands the focus to the first new row, whatever stands between the rows', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) }, table);
    const button = more(wrapper);
    (button.element as HTMLButtonElement).focus();
    await button.trigger('click');
    await flushPromises();
    expect(ownRows(wrapper)).toHaveLength(62);
    expect(document.activeElement).toBe(ownRows(wrapper)[50]!.element);
  });

  it('draws nothing of the screen when the words find no row', async () => {
    const { wrapper } = await mountFrame({}, table);
    await type(wrapper, 'ann');
    expect(wrapper.find('[data-testid="own-table"]').exists()).toBe(false);
    expect(count(wrapper)).toBe('Nothing matches "ann"');
  });

  it("marks the frame's own rows too, so the focus is found the same way in either slot", async () => {
    const { wrapper } = await mountFrame({ items: rows(2) });
    const row = wrapper.get('[data-testid="frame-row"]');
    expect(row.attributes('data-list-row')).toBeDefined();
    expect(row.attributes('tabindex')).toBe('-1');
  });
});

describe('the aboveRows slot', () => {
  const above = { aboveRows: () => h('p', { 'data-testid': 'above' }, 'Select all') };

  it('stands between the tools and the count line', async () => {
    const { wrapper } = await mountFrame({}, above);
    const order = wrapper.get('[data-testid="frame"]').element.children;
    const testids = [...order].map((child) => child.getAttribute('data-testid'));
    expect(testids.indexOf('frame-tools')).toBeLessThan(testids.indexOf('above'));
    expect(testids.indexOf('above')).toBeLessThan(testids.indexOf('frame-count'));
  });

  it('stays in every state, each line judging for itself when it speaks', async () => {
    for (const state of ['loading', 'failed']) {
      const { wrapper } = await mountFrame({ state, items: [] }, above);
      expect(wrapper.find('[data-testid="above"]').exists()).toBe(true);
    }
    const { wrapper } = await mountFrame({ items: [] }, above);
    expect(wrapper.find('[data-testid="above"]').exists()).toBe(true);
  });
});

describe('the drawn event', () => {
  const said = (wrapper: VueWrapper) =>
    wrapper.emitted('drawn') as [rows: Row[], left: number][] | undefined;
  const last = (wrapper: VueWrapper) => said(wrapper)!.at(-1)!;

  it('says the rows on screen at mount, and how many the cap leaves off', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) });
    expect(last(wrapper)[0]).toHaveLength(50);
    expect(last(wrapper)[1]).toBe(12);
  });

  it('says so again with each page', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) });
    await more(wrapper).trigger('click');
    await flushPromises();
    expect(last(wrapper)[0]).toHaveLength(62);
    expect(last(wrapper)[1]).toBe(0);
  });

  it('follows the words, and what the filters leave', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) });
    await type(wrapper, 'row 61');
    expect(last(wrapper)[0].map((row) => row.id)).toEqual(['Row-61']);
    await type(wrapper, '');
    await wrapper.setProps({ items: rows(3) });
    await flushPromises();
    expect(last(wrapper)[0]).toHaveLength(3);
  });

  it('follows a fold back: rows past the first page are off the screen again', async () => {
    const { wrapper } = await mountFrame({ filterKey: 'open' });
    await more(wrapper).trigger('click');
    await flushPromises();
    expect(last(wrapper)[0]).toHaveLength(100);
    await wrapper.setProps({ filterKey: 'approved' });
    await flushPromises();
    expect(last(wrapper)[0]).toHaveLength(50);
  });

  it('says the new rows when a read again brings them, at the same place', async () => {
    const { wrapper } = await mountFrame();
    await wrapper.setProps({ items: rows(312, 'Other') });
    await flushPromises();
    expect(last(wrapper)[0][0]!.id).toBe('Other-0');
  });

  it('says none while the state draws no rows', async () => {
    const { wrapper } = await mountFrame({ items: rows(5) });
    expect(last(wrapper)[0]).toHaveLength(5);
    await wrapper.setProps({ state: 'failed' });
    await flushPromises();
    expect(last(wrapper)).toEqual([[], 0]);
    await wrapper.setProps({ state: 'ready' });
    await flushPromises();
    expect(last(wrapper)[0]).toHaveLength(5);
  });
});

describe('the rows and "Show N more"', () => {
  it('draws the first page, at most 50 of a market of 361', async () => {
    const { wrapper } = await mountFrame({ items: rows(361) });
    expect(drawn(wrapper)).toBe(50);
    expect(wrapper.findAll('[data-testid="row-words"]')[49]!.text()).toBe('49: Row 49');
  });

  it('adds a page, a whole one while more than that is left', async () => {
    const { wrapper } = await mountFrame();
    expect(more(wrapper).text()).toBe('Show 50 more');
    await more(wrapper).trigger('click');
    expect(drawn(wrapper)).toBe(100);
    expect(count(wrapper)).toBe('Showing 100 of 312');
  });

  it('offers only what is left, then reads all and offers nothing', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) });
    expect(more(wrapper).text()).toBe('Show 12 more');
    await more(wrapper).trigger('click');
    expect(drawn(wrapper)).toBe(62);
    expect(count(wrapper)).toBe('62 applications');
    expect(more(wrapper).exists()).toBe(false);
  });

  it('offers nothing at exactly one page', async () => {
    const { wrapper } = await mountFrame({ items: rows(50) });
    expect(more(wrapper).exists()).toBe(false);
    expect(count(wrapper)).toBe('50 applications');
  });

  it('takes its page from pageSize', async () => {
    const { wrapper } = await mountFrame({ items: rows(30), pageSize: 10 });
    expect(drawn(wrapper)).toBe(10);
    expect(more(wrapper).text()).toBe('Show 10 more');
    expect(count(wrapper)).toBe('Showing 10 of 30');
  });

  it('pages through what the words find', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'row 1');
    expect(count(wrapper)).toBe('111 of 312 match "row 1"');
    expect(drawn(wrapper)).toBe(50);
    expect(more(wrapper).text()).toBe('Show 50 more');
  });

  it('moves the focus to the first new row, since the button may be gone', async () => {
    const { wrapper } = await mountFrame({ items: rows(62) });
    const button = more(wrapper);
    (button.element as HTMLButtonElement).focus();
    await button.trigger('click');
    await flushPromises();
    const row = wrapper.findAll('[data-testid="frame-row"]')[50]!;
    expect(document.activeElement).toBe(row.element);
  });

  it('goes back to one page when the words change', async () => {
    const { wrapper } = await mountFrame();
    await more(wrapper).trigger('click');
    expect(drawn(wrapper)).toBe(100);
    await type(wrapper, 'row 1');
    expect(drawn(wrapper)).toBe(50);
  });

  it('keeps the page through a space that changes no word', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'row 1');
    await more(wrapper).trigger('click');
    expect(drawn(wrapper)).toBe(100);
    await type(wrapper, 'row 1 ');
    expect(drawn(wrapper)).toBe(100);
  });

  it('goes back to one page when the filters change, by filterKey', async () => {
    const { wrapper } = await mountFrame({ filterKey: 'open' });
    await more(wrapper).trigger('click');
    await wrapper.setProps({ items: rows(200, 'Other'), filterKey: 'approved' });
    expect(drawn(wrapper)).toBe(50);
    expect(count(wrapper)).toBe('Showing 50 of 200');
  });

  it('holds the place when a read again brings other rows under the same filters', async () => {
    const { wrapper } = await mountFrame({ filterKey: 'open' });
    await more(wrapper).trigger('click');
    await wrapper.setProps({ items: rows(311, 'Other') });
    expect(drawn(wrapper)).toBe(100);
    expect(count(wrapper)).toBe('Showing 100 of 311');
  });

  it('holds the place through a change of the rows on a list with no filters', async () => {
    const { wrapper } = await mountFrame();
    await more(wrapper).trigger('click');
    await wrapper.setProps({ items: rows(311) });
    expect(drawn(wrapper)).toBe(100);
  });

  it('holds the place when a change of the rows leaves fewer than were drawn', async () => {
    const { wrapper } = await mountFrame();
    await more(wrapper).trigger('click');
    await wrapper.setProps({ items: rows(60) });
    expect(drawn(wrapper)).toBe(60);
    expect(count(wrapper)).toBe('60 applications');
    expect(more(wrapper).exists()).toBe(false);
  });

  it('gives the row slot each item and its index', async () => {
    const { wrapper } = await mountFrame({ items: rows(2) });
    expect(wrapper.findAll('[data-testid="row-words"]').map((row) => row.text())).toEqual([
      '0: Row 0',
      '1: Row 1',
    ]);
  });
});

describe('the words set from outside', () => {
  it('finds by them, and shows them in the field', async () => {
    const { wrapper } = await mountFrame();
    await wrapper.setProps({ words: 'row 311' });
    expect((field(wrapper).element as HTMLInputElement).value).toBe('row 311');
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
    expect(wrapper.findAll('[data-testid="row-words"]').map((row) => row.text())).toEqual([
      '0: Row 311',
    ]);
  });

  it('opens on them', async () => {
    const { wrapper } = await mountFrame({ words: 'row 311' });
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
  });

  it('says what is typed, so the screen holding them can follow', async () => {
    const { wrapper } = await mountFrame();
    await type(wrapper, 'row');
    expect(wrapper.emitted('update:words')).toEqual([['row']]);
  });

  it('goes back to one page when they change, as typed words do', async () => {
    const { wrapper } = await mountFrame();
    await more(wrapper).trigger('click');
    await wrapper.setProps({ words: 'row 1' });
    expect(drawn(wrapper)).toBe(50);
  });

  it('shows the field for them on a short list, so they can be cleared', async () => {
    const { wrapper } = await mountFrame({ items: rows(3), words: 'row 1' });
    expect(field(wrapper).exists()).toBe(true);
    expect(count(wrapper)).toBe('1 of 3 matches "row 1"');
  });
});

describe('the words in the address', () => {
  it('writes the words to findKey, keeping the rest of the query', async () => {
    const { wrapper, router } = await mountFrame({ findKey: 'find' });
    await type(wrapper, 'row 1');
    expect(router.currentRoute.value.query).toEqual({ kept: '1', find: 'row 1' });
  });

  it('drops the key when the words are cleared', async () => {
    const { wrapper, router } = await mountFrame({ findKey: 'find' });
    await type(wrapper, 'row 1');
    await type(wrapper, '');
    expect(router.currentRoute.value.query).toEqual({ kept: '1' });
  });

  it('drops the key when only spaces are left', async () => {
    const { wrapper, router } = await mountFrame({ findKey: 'find' });
    await type(wrapper, '   ');
    expect(router.currentRoute.value.query).toEqual({ kept: '1' });
  });

  it('replaces the entry, so Back leaves the list rather than stepping through the words', async () => {
    const { wrapper, router } = await mountFrame({ findKey: 'find' }, {}, '/list?before=1');
    await router.push('/list?page=2');
    await type(wrapper, 'row');
    await type(wrapper, 'row 1');
    expect(router.currentRoute.value.query).toEqual({ page: '2', find: 'row 1' });
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ before: '1' });
  });

  it('opens on the words in the address, as after a refresh', async () => {
    const { wrapper } = await mountFrame({ findKey: 'find' }, {}, '/list?find=row+311');
    expect((field(wrapper).element as HTMLInputElement).value).toBe('row 311');
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
  });

  it('follows the address when it changes, as Back does', async () => {
    const { wrapper, router } = await mountFrame({ findKey: 'find' });
    await router.push('/list?find=row+311');
    await flushPromises();
    expect((field(wrapper).element as HTMLInputElement).value).toBe('row 311');
    expect(count(wrapper)).toBe('1 of 312 matches "row 311"');
  });

  it('takes a key given twice for no words, since it is not one string', async () => {
    const { wrapper } = await mountFrame({ findKey: 'find' }, {}, '/list?find=a&find=b');
    expect(count(wrapper)).toBe('Showing 50 of 312');
  });

  it('leaves the address alone without findKey', async () => {
    const { wrapper, router } = await mountFrame();
    await type(wrapper, 'row 1');
    expect(router.currentRoute.value.query).toEqual({ kept: '1' });
    expect(count(wrapper)).toBe('111 of 312 match "row 1"');
  });

  it('shows a short list narrowed by a link, with the field to clear it', async () => {
    const { wrapper } = await mountFrame(
      { items: rows(3), findKey: 'find' },
      {},
      '/list?find=row+1',
    );
    expect(field(wrapper).exists()).toBe(true);
    expect(count(wrapper)).toBe('1 of 3 matches "row 1"');
  });
});

describe('the states', () => {
  it('says it is loading, with no count and no rows', async () => {
    const { wrapper } = await mountFrame({ state: 'loading', items: [] });
    expect(wrapper.get('[data-testid="frame-loading"]').text()).toBe('Loading applications…');
    expect(wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="frame-empty"]').exists()).toBe(false);
  });

  it('keeps the filters while loading and after a failed read', async () => {
    const filters = () => h('button', { 'data-testid': 'a-filter' }, 'Open');
    for (const state of ['loading', 'failed']) {
      const { wrapper } = await mountFrame({ state, items: [] }, { filters });
      expect(wrapper.find('[data-testid="a-filter"]').exists()).toBe(true);
    }
  });

  it('says a failed read by ReadFailed, in the noun by default, and asks to retry', async () => {
    const { wrapper } = await mountFrame({ state: 'failed', items: [] });
    expect(wrapper.get('[data-testid="frame-read-failed"]').text()).toContain(
      'The applications could not be loaded.',
    );
    expect(wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
    await wrapper.get('[data-testid="frame-retry"]').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it("says a failed read in the screen's message", async () => {
    const { wrapper } = await mountFrame({
      state: 'failed',
      items: [],
      failedMessage: 'You are offline.',
    });
    expect(wrapper.get('[data-testid="frame-read-failed"]').text()).toContain('You are offline.');
  });

  it("takes the screen's failed slot over ReadFailed", async () => {
    const { wrapper } = await mountFrame(
      { state: 'failed', items: [] },
      { failed: () => h('p', { 'data-testid': 'own-failure' }, 'Gone') },
    );
    expect(wrapper.find('[data-testid="own-failure"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="frame-read-failed"]').exists()).toBe(false);
  });

  it('draws the empty slot with no items, with no count', async () => {
    const { wrapper } = await mountFrame(
      { items: [] },
      { empty: () => h('p', 'No applications received yet.') },
    );
    expect(wrapper.get('[data-testid="frame-empty"]').text()).toBe('No applications received yet.');
    expect(wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
    expect(drawn(wrapper)).toBe(0);
  });

  it('says none in the noun without an empty slot', async () => {
    const { wrapper } = await mountFrame({ items: [] });
    expect(wrapper.get('[data-testid="frame-empty"]').text()).toBe('No applications.');
  });

  it('reads the state ready by default', async () => {
    const { wrapper } = await mountFrame({ items: rows(2) });
    expect(wrapper.find('[data-testid="frame-loading"]').exists()).toBe(false);
    expect(drawn(wrapper)).toBe(2);
  });
});

describe('without finds, a screen whose own field lies elsewhere', () => {
  const noField = { finds: undefined, findLabel: undefined };

  it('draws no field however long the list is, and no tools with no filters', async () => {
    const { wrapper } = await mountFrame({ ...noField, items: rows(300) });
    expect(field(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-testid="frame-tools"]').exists()).toBe(false);
  });

  it('takes items as final: words in the address are not its own', async () => {
    const { wrapper } = await mountFrame({ ...noField, items: rows(60) }, {}, '/list?search=row+1');
    expect(count(wrapper)).toBe('Showing 50 of 60');
    expect(drawn(wrapper)).toBe(50);
  });

  it('counts only while the cap leaves rows off, as the screen counts the rest', async () => {
    const capped = await mountFrame({ ...noField, items: rows(120) });
    expect(count(capped.wrapper)).toBe('Showing 50 of 120');
    expect(more(capped.wrapper).text()).toBe('Show 50 more');

    await more(capped.wrapper).trigger('click');
    expect(count(capped.wrapper)).toBe('Showing 100 of 120');
    await more(capped.wrapper).trigger('click');
    expect(drawn(capped.wrapper)).toBe(120);
    expect(capped.wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
    expect(more(capped.wrapper).exists()).toBe(false);

    const short = await mountFrame({ ...noField, items: rows(50) });
    expect(short.wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
    expect(drawn(short.wrapper)).toBe(50);
  });

  it('folds back only on filterKey, which must carry the words, and holds through new rows', async () => {
    const { wrapper } = await mountFrame({
      ...noField,
      items: rows(120),
      filterKey: JSON.stringify(['', '']),
    });
    await more(wrapper).trigger('click');
    expect(drawn(wrapper)).toBe(100);

    // A re-read: other rows under the same words and filters.
    await wrapper.setProps({ items: rows(118, 'Read') } as never);
    expect(drawn(wrapper)).toBe(100);

    // The screen's words narrow the items and change the key together.
    await wrapper.setProps({ items: rows(80), filterKey: JSON.stringify(['', 'row']) } as never);
    expect(drawn(wrapper)).toBe(50);
  });

  it('lets the empty slot speak for what the screen found nothing for', async () => {
    const { wrapper } = await mountFrame(
      { ...noField, items: [] },
      { empty: () => h('p', 'No vendors match "ada".') },
    );
    expect(wrapper.get('[data-testid="frame-empty"]').text()).toBe('No vendors match "ada".');
    expect(wrapper.find('[data-testid="frame-count"]').exists()).toBe(false);
  });

  it('hands the focus to the first new row of the rows slot', async () => {
    const { wrapper } = await mountFrame(
      { ...noField, items: rows(62) },
      {
        rows: ({ rows: shown }: { rows: Row[] }) =>
          h(
            'ul',
            shown.map((row) =>
              h('li', { key: row.id, 'data-list-row': '', tabindex: -1, id: row.id }, row.name),
            ),
          ),
      },
    );
    await more(wrapper).trigger('click');
    await flushPromises();
    expect(document.activeElement?.id).toBe('Row-50');
  });
});
