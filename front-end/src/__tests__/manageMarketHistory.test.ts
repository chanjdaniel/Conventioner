/**
 * Manage market's History section (E40/F01/S03): the newest changes, older ones as the end of the
 * list comes into view, each filter narrowing what the server is asked for, and no section for a person below the row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import MarketHistory from '@/components/MarketHistory.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import { installIntersectionObserver } from './support/intersection';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="JSON.stringify(to)"><slot /></a>',
};

function assigned(id: string, minutes: number, vendor = 'ana@ember.test'): MarketHistoryEntry {
  return {
    id,
    actor: 'dana@ember.test',
    at: new Date(Date.UTC(2026, 10, 1, 9, minutes)).toISOString(),
    action: 'assign',
    kind: 'placed',
    vendors: [vendor],
    subject: {},
    detail: { date: '2026-11-19', table_code: `A${minutes}`, before: null },
  };
}

const GROUPS = [
  { group: 'Applications', actions: [{ id: 'give-verdicts', label: 'Give verdicts' }] },
  { group: 'Assignment', actions: [{ id: 'assign', label: 'Run the assignment' }] },
];

/** Answers each read of the history with `pages`, in order, and records what it was asked. */
function serve(...pages: Array<{ entries: MarketHistoryEntry[]; next: string | null }>) {
  const asked: string[] = [];
  api.get.mockImplementation(async (url: string) => {
    asked.push(url);
    const page = pages[Math.min(asked.length - 1, pages.length - 1)];
    return {
      data: {
        ...page,
        vendorNames: { 'ana@ember.test': 'Ana Rivera', 'ben@ember.test': 'Ben Okafor' },
        ...(url.includes('before=')
          ? {}
          : { actors: ['dana@ember.test', 'priya@ember.test'], groups: GROUPS }),
      },
    };
  });
  return asked;
}

function mountHistory() {
  return mount(MarketHistory, {
    props: { marketId: 'market-1', path: IntakeMode.Form },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

type History = ReturnType<typeof mountHistory>;

const sentences = (wrapper: History) =>
  wrapper.findAll('[data-testid="market-history-sentence"]').map((p) => p.text());

const whoField = (wrapper: History) => wrapper.get('[data-testid="market-history-who-input"]');
const whoList = (wrapper: History) => wrapper.find('[data-testid="market-history-who-list"]');
const whoOptions = (wrapper: History) =>
  wrapper.findAll('[data-testid="market-history-who-option"]');
const whoValue = (wrapper: History) => (whoField(wrapper).element as HTMLInputElement).value;

const vendorField = (wrapper: History) =>
  wrapper.get('[data-testid="market-history-vendor-input"]');
const vendorRows = (wrapper: History) =>
  wrapper.findAll('[data-testid="market-history-vendor-option"]');
const vendorValue = (wrapper: History) => (vendorField(wrapper).element as HTMLInputElement).value;

/** Finds someone by typing, and takes the first row with Enter. */
async function chooseWho(wrapper: History, words: string) {
  await whoField(wrapper).setValue(words);
  await whoField(wrapper).trigger('keydown', { key: 'Enter' });
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
});

describe('the History section', () => {
  it('shows the newest page, and the end of the list coming into view adds the older ones', async () => {
    const view = installIntersectionObserver();
    const asked = serve(
      { entries: [assigned('e3', 3), assigned('e2', 2)], next: 'cursor-2' },
      { entries: [assigned('e1', 1)], next: null },
    );
    const wrapper = mountHistory();
    await flushPromises();

    expect(sentences(wrapper)).toEqual([
      'dana@ember.test assigned Ana Rivera ana@ember.test at A3 on Nov 19, 2026',
      'dana@ember.test assigned Ana Rivera ana@ember.test at A2 on Nov 19, 2026',
    ]);

    await view.showSentinels();

    expect(asked[1]).toBe('/markets/market-1/history?before=cursor-2');
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="market-history-sentinel"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Load more');
  });

  it('keeps a before and after open as a later page lands', async () => {
    const view = installIntersectionObserver();
    serve(
      { entries: [assigned('e2', 2)], next: 'cursor-2' },
      { entries: [assigned('e1', 1)], next: null },
    );
    const wrapper = mountHistory();
    await flushPromises();
    await wrapper.get('[data-testid="market-history-toggle"]').trigger('click');

    await view.showSentinels();

    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="market-history-changes"]')).toHaveLength(1);
  });

  it('drops a next page answered after a filter changed', async () => {
    const view = installIntersectionObserver();
    let answerLate: (page: unknown) => void = () => {};
    const asked: string[] = [];
    api.get.mockImplementation((url: string) => {
      asked.push(url);
      if (url.includes('before=')) {
        return new Promise((resolve) => {
          answerLate = resolve;
        });
      }
      const narrowed = url.includes('group=');
      return Promise.resolve({
        data: {
          entries: [assigned(narrowed ? 'narrow' : 'e2', 2)],
          next: narrowed ? null : 'cursor-2',
          vendorNames: {},
          actors: [],
          groups: GROUPS,
        },
      });
    });
    const wrapper = mountHistory();
    await flushPromises();

    await view.showSentinels();
    expect(asked.at(-1)).toBe('/markets/market-1/history?before=cursor-2');

    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    answerLate({
      data: { entries: [assigned('late', 1)], next: 'cursor-3', vendorNames: {} },
    });
    await flushPromises();

    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="market-history-sentinel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-history-loading"]').text()).toBe('');
  });

  it('drops a next page that fails after a filter changed, saying nothing of it', async () => {
    const view = installIntersectionObserver();
    let failLate: (reason: unknown) => void = () => {};
    api.get.mockImplementation((url: string) => {
      if (url.includes('before=')) {
        return new Promise((_, reject) => {
          failLate = reject;
        });
      }
      return Promise.resolve({
        data: {
          entries: [assigned('e2', 2)],
          next: 'cursor-2',
          vendorNames: {},
          actors: [],
          groups: GROUPS,
        },
      });
    });
    const wrapper = mountHistory();
    await flushPromises();

    await view.showSentinels();
    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    failLate(new Error('late'));
    await flushPromises();

    expect(wrapper.find('[data-testid="market-history-read-failed"]').exists()).toBe(false);
  });

  it('says so when a next page fails, and Try again brings it beneath the same entries', async () => {
    const view = installIntersectionObserver();
    let fails = true;
    const asked: string[] = [];
    api.get.mockImplementation(async (url: string) => {
      asked.push(url);
      if (!url.includes('before=')) {
        return {
          data: {
            entries: [assigned('e2', 2)],
            next: 'cursor-2',
            vendorNames: {},
            actors: [],
            groups: GROUPS,
          },
        };
      }
      if (fails) throw new Error('offline');
      return { data: { entries: [assigned('e1', 1)], next: null, vendorNames: {} } };
    });
    const wrapper = mountHistory();
    await flushPromises();

    await view.showSentinels();

    expect(wrapper.get('[data-testid="market-history-read-failed"]').text()).toContain(
      'Older changes could not be loaded.',
    );
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(1);
    // Nothing asks again by itself: a failed page waits for the reader.
    await view.showSentinels();
    expect(asked.filter((url) => url.includes('before='))).toHaveLength(1);

    fails = false;
    await wrapper.get('[data-testid="market-history-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="market-history-read-failed"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(2);
  });

  it('asks nothing beyond the first page with no observer firing', async () => {
    const asked = serve({ entries: [assigned('e2', 2)], next: 'cursor-2' });
    mountHistory();
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
  });

  it('stands its list in a box of its own unless told otherwise', async () => {
    serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    expect(wrapper.find('.paged-list--own').exists()).toBe(true);
    expect(wrapper.find('[data-testid="market-history-box"]').exists()).toBe(true);
  });

  it('asks the server again, narrowed, for each filter', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await chooseWho(wrapper, 'priya');
    expect(asked.at(-1)).toBe('/markets/market-1/history?actor=priya%40ember.test');

    await chooseWho(wrapper, 'Anyone');
    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    expect(asked.at(-1)).toBe('/markets/market-1/history?group=Assignment');

    await wrapper.get('[data-testid="market-history-kind"]').setValue('');
    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('Ben');
    await flushPromises();
    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ben%40ember.test');

    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('');
    await wrapper.get('[data-testid="market-history-from"]').setValue('2026-11-19');
    await wrapper.get('[data-testid="market-history-to"]').setValue('2026-11-19');
    await flushPromises();
    const query = new URL(`http://x${asked.at(-1)}`).searchParams;
    expect(new Date(query.get('since')!).getDate()).toBe(19);
    expect(new Date(query.get('until')!).getDate()).toBe(20);
  });

  it('does not narrow by a vendor the filter has not settled on, and says why', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('ember');
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
    expect(wrapper.get('[data-testid="market-history-vendor-hint"]').text()).toBe(
      '2 vendors match. Keep typing, or choose one.',
    );
  });

  it('narrows to nothing, asking nothing, for a vendor the filter matches nobody by', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('Zelda');
    await flushPromises();

    expect(asked).toEqual(['/markets/market-1/history']);
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(0);
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'No change matches these filters.',
    );

    await wrapper.get('[data-testid="market-history-clear"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(1);
  });

  it('narrows by a vendor typed before the first page came back, once it has', async () => {
    const asked = serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();

    // Typed while the first read is still on its way: no vendor is known yet.
    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('Ana');
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ana%40ember.test');
    expect(wrapper.find('[data-testid="market-history-empty"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="market-history-entry"]')).toHaveLength(1);
  });

  it('finds a vendor with no name by part of an address the history names', async () => {
    const asked = serve({ entries: [assigned('e1', 1, 'cy.vendor@ember.test')], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('cy.vend');
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=cy.vendor%40ember.test');
    expect(wrapper.find('datalist').exists()).toBe(false);
    expect(vendorRows(wrapper).map((row) => row.attributes('data-value'))).toContain(
      'cy.vendor@ember.test',
    );
  });

  describe('the vendor field', () => {
    async function mountServed() {
      const asked = serve({ entries: [assigned('e1', 1, 'cy.vendor@ember.test')], next: null });
      const wrapper = mountHistory();
      await flushPromises();
      return { asked, wrapper };
    }

    it('lists each vendor by name beside address, and an address alone where no name was given', async () => {
      const { wrapper } = await mountServed();
      await vendorField(wrapper).trigger('click');

      expect(vendorRows(wrapper).map((row) => row.text())).toEqual([
        'Ana Rivera (ana@ember.test)',
        'Ben Okafor (ben@ember.test)',
        'cy.vendor@ember.test',
      ]);
    });

    it('names the hint as the words describing the field, while there is one', async () => {
      const { asked, wrapper } = await mountServed();
      await vendorField(wrapper).setValue('ember');
      await flushPromises();

      const hint = wrapper.get('[data-testid="market-history-vendor-hint"]');
      expect(vendorField(wrapper).attributes('aria-describedby')).toBe(hint.attributes('id'));
      expect(asked).toEqual(['/markets/market-1/history']);

      await vendorField(wrapper).setValue('ana');
      await flushPromises();
      expect(wrapper.find('[data-testid="market-history-vendor-hint"]').exists()).toBe(false);
      expect(vendorField(wrapper).attributes('aria-describedby')).toBeUndefined();
    });

    it('narrows to a vendor chosen from the list, names them, and Clear filters empties it', async () => {
      const { asked, wrapper } = await mountServed();
      await vendorField(wrapper).setValue('ember');
      await vendorRows(wrapper)
        .find((row) => row.attributes('data-value') === 'ben@ember.test')!
        .trigger('click');
      await flushPromises();

      expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ben%40ember.test');
      expect(vendorValue(wrapper)).toBe('Ben Okafor (ben@ember.test)');
      expect(wrapper.find('[data-testid="market-history-vendor-list"]').exists()).toBe(false);

      await wrapper.get('[data-testid="market-history-clear"]').trigger('click');
      await flushPromises();
      expect(vendorValue(wrapper)).toBe('');
      expect(asked.at(-1)).toBe('/markets/market-1/history');
    });

    it('keeps words that narrow as typed, on leaving and on Escape', async () => {
      const { asked, wrapper } = await mountServed();
      await vendorField(wrapper).setValue('Ana');
      await flushPromises();
      expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ana%40ember.test');

      await vendorField(wrapper).trigger('keydown', { key: 'Escape' });
      await vendorField(wrapper).trigger('blur');
      await flushPromises();

      expect(vendorValue(wrapper)).toBe('Ana');
      expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ana%40ember.test');
    });

    it('narrows to an address typed whole that no entry it has loaded names', async () => {
      const { asked, wrapper } = await mountServed();
      await vendorField(wrapper).setValue('New.Vendor@Ember.test');
      await flushPromises();

      expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=new.vendor%40ember.test');
      expect(wrapper.find('[data-testid="market-history-vendor-hint"]').exists()).toBe(false);
    });

    it('names a vendor whose whole address was typed, once the field is left', async () => {
      const { asked, wrapper } = await mountServed();
      await vendorField(wrapper).setValue('ana@ember.test');
      await vendorField(wrapper).trigger('blur');
      await flushPromises();

      expect(vendorValue(wrapper)).toBe('Ana Rivera (ana@ember.test)');
      expect(asked.at(-1)).toBe('/markets/market-1/history?vendor=ana%40ember.test');
    });

    it('draws at most 50 and says how many more, finding past them by typing', async () => {
      const many = Array.from({ length: 60 }, (_, n) => `vendor${n}@ember.test`);
      serve({
        entries: [{ ...assigned('e1', 1), vendors: many }],
        next: null,
      });
      const wrapper = mountHistory();
      await flushPromises();
      await vendorField(wrapper).trigger('click');

      expect(vendorRows(wrapper)).toHaveLength(50);
      expect(wrapper.get('[data-testid="market-history-vendor-more"]').text()).toBe(
        '12 more, type to narrow',
      );

      await vendorField(wrapper).setValue('vendor59');
      expect(vendorRows(wrapper).map((row) => row.attributes('data-value'))).toContain(
        'vendor59@ember.test',
      );
    });

    it("is not drawn in a vendor's own history", async () => {
      serve({ entries: [assigned('e1', 1)], next: null });
      const wrapper = mount(MarketHistory, {
        props: { marketId: 'market-1', path: IntakeMode.Form, vendor: 'ana@ember.test' },
        global: { stubs: { RouterLink: RouterLinkStub } },
      });
      await flushPromises();

      expect(wrapper.find('[data-testid="market-history-vendor"]').exists()).toBe(false);
    });
  });

  it('links a vendor to their drawer on the Vendors page', async () => {
    serve({ entries: [assigned('e1', 1)], next: null });
    const wrapper = mountHistory();
    await flushPromises();

    expect(
      JSON.parse(wrapper.get('[data-testid="market-history-vendor-link"]').attributes('href')!),
    ).toEqual({ path: '/markets/market-1/vendors', query: { vendor: 'ana@ember.test' } });
  });

  it('opens an entry to show before and after', async () => {
    serve({
      entries: [
        {
          ...assigned('e1', 1),
          action: 'manage-editors-and-viewers',
          kind: 'role_changed',
          vendors: [],
          subject: { user_id: 'u1', email: 'priya@ember.test' },
          detail: { before: { role: 'viewer' }, after: { role: 'editor' } },
        },
      ],
      next: null,
    });
    const wrapper = mountHistory();
    await flushPromises();
    const toggle = wrapper.get('[data-testid="market-history-toggle"]');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="market-history-changes"] tbody').text()).toBe(
      'RoleViewerEditor',
    );
  });

  it('breaks an address in the Field column only before its "@" or a dot, as the values do', async () => {
    // A check's rows name each vendor in the Field column (T137 review note 7): at 390 an
    // address ran on unbroken past the column.
    serve({
      entries: [
        {
          ...assigned('e1', 1),
          action: 'connect-discord',
          kind: 'discord_checked',
          vendors: ['e2e-discord-a-long-address@riverside-makers.example.com'],
          subject: { application_ids: ['app-ana'] },
          detail: {
            before: { 'app-ana': null },
            after: { 'app-ana': 'not_found' },
            addresses: { 'app-ana': 'e2e-discord-a-long-address@riverside-makers.example.com' },
            counts: { not_found: 1 },
          },
        },
      ],
      next: null,
    });
    const wrapper = mountHistory();
    await flushPromises();
    await wrapper.get('[data-testid="market-history-toggle"]').trigger('click');

    const field = wrapper.get('[data-testid="market-history-changes"] tbody th');
    expect(field.findAll('.email-address').map((part) => part.text())).toEqual([
      'e2e-discord-a-long-address',
      '@riverside-makers.example.com',
    ]);
    // It may break before its "@" and each dot, and never just after a hyphen (T181).
    expect(field.findAll('.email-address-break').map((piece) => piece.text())).toEqual([
      '@riverside-makers',
      '.example',
      '.com',
    ]);
    expect(field.findAll('.email-address-held').map((run) => run.text())).toEqual([
      '-d',
      '-a',
      '-l',
      '-a',
      '-m',
    ]);
    expect(field.find('wbr').exists()).toBe(false);
  });

  it('breaks an address in an entry’s sentence only before its "@" or a dot, as the table does', async () => {
    // A verdict on someone else's share names whose it was (T127 review note 35): at 390 the
    // sentence broke the address at its hyphen.
    serve({
      entries: [
        {
          ...assigned('e1', 1),
          actor: 'dana-lee@ember.test',
          action: 'give-verdicts',
          kind: 'verdict',
          vendors: ['ana@ember.test'],
          subject: {},
          detail: {
            before: { status: 'open' },
            after: { status: 'reviewer_approved' },
            dealt_to: 'rv-sam-lee@ember.test',
          },
        },
      ],
      next: null,
    });
    const wrapper = mountHistory();
    await flushPromises();

    const sentence = wrapper.get('[data-testid="market-history-sentence"]');
    expect(sentence.findAll('.email-address').map((part) => part.text())).toEqual([
      'dana-lee',
      '@ember.test',
      'ana',
      '@ember.test',
      'rv-sam-lee',
      '@ember.test',
    ]);
    // The text reads as before, each address one word: nothing added, nothing hidden.
    expect(sentence.text()).toBe(
      'dana-lee@ember.test set Ana Rivera ana@ember.test to Approved, dealt to rv-sam-lee@ember.test',
    );
    expect(sentence.find('[aria-hidden]').exists()).toBe(false);
  });

  it('names a permission row by the label the market’s table gives it', async () => {
    serve({
      entries: [
        {
          ...assigned('e1', 1),
          action: 'change-the-table',
          kind: 'permission_set',
          vendors: [],
          subject: { action: 'read-history' },
          detail: {
            before: { role: 'viewer', source: 'built-in' },
            after: { role: 'editor', source: 'market' },
          },
        },
      ],
      next: null,
    });
    const wrapper = mount(MarketHistory, {
      props: {
        marketId: 'market-1',
        path: IntakeMode.Form,
        rowLabels: { 'read-history': "Read the market's history" },
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    expect(sentences(wrapper)).toEqual([
      "dana@ember.test changed Read the market's history from Viewer to Editor",
    ]);
  });

  it('says so when nothing matches the filters', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountHistory();
    await flushPromises();
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'Nothing has changed on this market yet.',
    );

    await wrapper.get('[data-testid="market-history-kind"]').setValue('Assignment');
    await flushPromises();
    expect(wrapper.get('[data-testid="market-history-empty"]').text()).toBe(
      'No change matches these filters.',
    );
  });
});

describe('the History section\'s "Who"', () => {
  /** Answers every read with one page and these `actors`, and records what it was asked. */
  function serveActors(actors: string[]) {
    const asked: string[] = [];
    api.get.mockImplementation(async (url: string) => {
      asked.push(url);
      return {
        data: { entries: [assigned('e1', 1)], next: null, vendorNames: {}, actors, groups: GROUPS },
      };
    });
    return asked;
  }

  const person = (n: number) => `person-${String(n).padStart(3, '0')}@people.test`;
  const everyone = Array.from({ length: 150 }, (_, at) => person(at + 1));

  it('is a combobox named Who, Anyone first and chosen, then who changed something', async () => {
    serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();

    const field = whoField(wrapper);
    expect(field.attributes('role')).toBe('combobox');
    expect(wrapper.get(`label[for="${field.attributes('id')}"]`).text()).toBe('Who');
    expect(whoValue(wrapper)).toBe('Anyone');

    await field.trigger('click');
    expect(whoOptions(wrapper).map((option) => option.text())).toEqual([
      'Anyone',
      'dana@ember.test',
      'priya@ember.test',
    ]);
    expect(whoOptions(wrapper)[0]!.attributes('aria-selected')).toBe('true');
    expect(whoOptions(wrapper)[0]!.attributes('data-value')).toBe('');
    wrapper.unmount();
  });

  it('marks the reader in the list, and finds nobody it was not served', async () => {
    localStorage.setItem('user', JSON.stringify('dana@ember.test'));
    serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();

    await whoField(wrapper).trigger('click');
    const dana = wrapper.get(
      '[data-testid="market-history-who-option"][data-value="dana@ember.test"]',
    );
    expect(dana.get('.search-picker-option-detail').text()).toBe('You');

    await whoField(wrapper).setValue('zelda');
    expect(whoOptions(wrapper)).toHaveLength(0);
    expect(wrapper.get('[data-testid="market-history-who-none"]').text()).toBe(
      'Nobody matches "zelda".',
    );
    localStorage.removeItem('user');
    wrapper.unmount();
  });

  it('finds one of 150 by typing, and narrows the history to them', async () => {
    const asked = serveActors(everyone);
    const wrapper = mountHistory();
    await flushPromises();

    await whoField(wrapper).trigger('click');
    expect(whoOptions(wrapper)).toHaveLength(50);
    expect(whoOptions(wrapper)[0]!.text()).toBe('Anyone');
    expect(wrapper.get('[data-testid="market-history-who-more"]').text()).toBe(
      '101 more, type to narrow',
    );

    await whoField(wrapper).setValue('PERSON-123');
    expect(whoOptions(wrapper).map((option) => option.text())).toEqual([person(123)]);

    await whoField(wrapper).trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(whoList(wrapper).exists()).toBe(false);
    expect(whoValue(wrapper)).toBe(person(123));
    expect(asked.at(-1)).toBe(`/markets/market-1/history?actor=${encodeURIComponent(person(123))}`);
    wrapper.unmount();
  });

  it('takes the row the arrow keys reach', async () => {
    const asked = serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();

    await whoField(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await whoField(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await whoField(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await whoField(wrapper).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(asked.at(-1)).toBe('/markets/market-1/history?actor=priya%40ember.test');
    wrapper.unmount();
  });

  it('asks nothing for words alone, and names who it holds on leaving', async () => {
    const asked = serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();
    await chooseWho(wrapper, 'priya');
    const reads = asked.length;

    await whoField(wrapper).setValue('dana');
    await flushPromises();
    expect(asked).toHaveLength(reads);

    await whoField(wrapper).trigger('blur');
    expect(whoValue(wrapper)).toBe('priya@ember.test');
    expect(asked).toHaveLength(reads);
    wrapper.unmount();
  });

  it('keeps Escape from the dialog while its list is open, then lets it go', async () => {
    serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();
    const dialogHears = vi.fn();
    wrapper.element.addEventListener('keydown', dialogHears);

    await whoField(wrapper).trigger('click');
    expect(whoList(wrapper).exists()).toBe(true);
    await whoField(wrapper).trigger('keydown', { key: 'Escape' });
    expect(whoList(wrapper).exists()).toBe(false);
    expect(dialogHears).not.toHaveBeenCalled();

    await whoField(wrapper).trigger('keydown', { key: 'Escape' });
    expect(dialogHears).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('goes back to Anyone on Clear filters, and asks for everything again', async () => {
    const asked = serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();
    await chooseWho(wrapper, 'priya');

    await wrapper.get('[data-testid="market-history-clear"]').trigger('click');
    await flushPromises();

    expect(whoValue(wrapper)).toBe('Anyone');
    expect(asked.at(-1)).toBe('/markets/market-1/history');
    expect(wrapper.find('[data-testid="market-history-clear"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps who it holds through a read of the first page again', async () => {
    const asked = serveActors(['dana@ember.test', 'priya@ember.test']);
    const wrapper = mountHistory();
    await flushPromises();
    await chooseWho(wrapper, 'priya');

    await wrapper.setProps({ changesMade: 1 });
    await flushPromises();

    expect(whoValue(wrapper)).toBe('priya@ember.test');
    expect(asked.at(-1)).toBe('/markets/market-1/history?actor=priya%40ember.test');
    wrapper.unmount();
  });

  it("is not drawn on one vendor's history", async () => {
    serveActors(['dana@ember.test']);
    const wrapper = mount(MarketHistory, {
      props: { marketId: 'market-1', path: IntakeMode.Form, vendor: 'ana@ember.test' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="market-history-who"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('in Manage market', () => {
  function market(readHistory: string | null): Market {
    return {
      id: 'market-1',
      name: 'Riverside',
      phase: MarketPhase.Applications,
      roles: {},
      actionRefusals: { 'read-history': readHistory },
    } as unknown as Market;
  }

  async function open(readHistory: string | null) {
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: market(readHistory) } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: market(readHistory) },
      global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
    });
    await flushPromises();
    return wrapper;
  }

  const historyRead = () =>
    api.get.mock.calls.filter(([url]) => String(url).startsWith('/markets/market-1/history'));

  it('holds the History section, closed, its heading in sight and nothing read', async () => {
    const wrapper = await open(null);
    const toggle = wrapper.get('[data-testid="manage-market-history-toggle"]');

    expect(wrapper.get('[data-testid="manage-market-history"] h3').text()).toBe('History');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-testid="market-history"]').exists()).toBe(false);
    expect(historyRead()).toHaveLength(0);
  });

  it('opening it reads the first page, and closing and opening again keeps its filters', async () => {
    const wrapper = await open(null);
    const toggle = wrapper.get('[data-testid="manage-market-history-toggle"]');

    await toggle.trigger('click');
    await flushPromises();
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="market-history"]').isVisible()).toBe(true);
    expect(historyRead()).toHaveLength(1);

    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('cy@ember.test');
    await flushPromises();
    await toggle.trigger('click');
    await toggle.trigger('click');
    await flushPromises();

    expect(
      (wrapper.get('[data-testid="market-history-vendor-input"]').element as HTMLInputElement)
        .value,
    ).toBe('cy@ember.test');
  });

  it('reads its first page again, under its filters, after a change made in the same dialog', async () => {
    const draft = {
      ...market(null),
      phase: MarketPhase.Draft,
      actionRefusals: { 'read-history': null, 'change-setup': null },
    } as unknown as Market;
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: draft } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
    api.put.mockResolvedValue({ data: {} });
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: draft },
      global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
    });
    await flushPromises();
    await wrapper.get('[data-testid="manage-market-history-toggle"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="market-history-vendor-input"]').setValue('cy@ember.test');
    await flushPromises();
    const before = historyRead().length;

    await wrapper.get('[data-testid="manage-market-rename-input"]').setValue('Riverside Fair');
    await wrapper.get('form.rename-row').trigger('submit');
    await flushPromises();

    expect(historyRead()).toHaveLength(before + 1);
    expect(historyRead().at(-1)![0]).toBe('/markets/market-1/history?vendor=cy%40ember.test');
  });

  it('puts focus in the field "Add user" opens, and back on it when the row closes', async () => {
    const mine = {
      ...market(null),
      actionRefusals: {
        'read-history': null,
        'manage-editors-and-viewers': null,
        'manage-admins': null,
      },
    } as unknown as Market;
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: mine } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: mine },
      global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.get('[data-testid="manage-market-add-user-button"]').trigger('click');
    await flushPromises();
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'manage-market-add-user-input',
    );

    await wrapper.get('[data-testid="manage-market-add-user-cancel"]').trigger('click');
    await flushPromises();
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'manage-market-add-user-button',
    );
    wrapper.unmount();
  });

  it('holds none for a person below the row, and never asks for it', async () => {
    const wrapper = await open("Only someone who holds a role may read this market's history.");
    expect(wrapper.find('[data-testid="manage-market-history"]').exists()).toBe(false);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/markets/market-1/history');
  });
});
