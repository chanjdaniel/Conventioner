// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';

import MarketsView from '@/views/MarketsView.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const fetchMarkets = vi.fn();
vi.mock('@/utils/market', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/market')>()),
  fetchMarkets: () => fetchMarkets(),
}));

vi.mock('@/utils/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/organizations')>()),
  fetchOrganizations: () => Promise.resolve([]),
}));

const A_MARKET = {
  id: 'market-1',
  name: 'Riverside Spring Market',
  phase: 'draft',
  creationDate: '2026-04-01T00:00:00Z',
};
const ANOTHER_MARKET = {
  id: 'market-2',
  name: 'Harbour Winter Market',
  phase: 'draft',
  creationDate: '2026-04-02T00:00:00Z',
};

const FIRST_TIME = 'You have not set up a market yet';
const GONE = 'no longer available';

const LINE = '[data-testid="markets-previously-opened"]';
const NOTE = '[data-testid="markets-last-market-gone"]';
const MESSAGE = '[data-testid="markets-no-market-yet"]';
const EMPTY = '[data-testid="markets-empty"]';

/** What the server answers for an account that can reach these. */
function serverHas(...markets: unknown[]) {
  fetchMarkets.mockResolvedValue(markets);
}

/** This browser last opened that market: the id and nothing else (E21/F02/S05). */
function browserRemembers(market: { id: string }) {
  localStorage.setItem('lastMarketId', market.id);
}

async function mountMarkets() {
  const wrapper = mount(MarketsView, {
    global: {
      stubs: {
        NewMarketOverlay: true,
        ManageMarketOverlay: true,
        RouterLink: RouterLinkStub,
      },
    },
  });
  // Mounting asks the server; the render follows its answer.
  await flushPromises();
  return wrapper;
}

/** A dialog closing re-reads the list, as it does after a market is deleted in Manage. */
async function closeManage(wrapper: Awaited<ReturnType<typeof mountMarkets>>) {
  wrapper.findComponent({ name: 'ManageMarketOverlay' }).vm.$emit('manageClose');
  await flushPromises();
}

describe('Markets, the first thing it says', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    fetchMarkets.mockReset();
    serverHas();
  });

  describe('an organizer who has never had a market', () => {
    it('is told what to do first, and that nothing is missing', async () => {
      const wrapper = await mountMarkets();

      expect(wrapper.find(MESSAGE).text()).toContain(FIRST_TIME);
      expect(wrapper.find(EMPTY).exists()).toBe(false);
      expect(wrapper.text()).not.toContain('not found');
      expect(wrapper.text()).not.toContain(GONE);
      expect(wrapper.text()).not.toContain('Previously opened');
    });

    it('is told where an organization comes from, by a link', async () => {
      const wrapper = await mountMarkets();

      const link = wrapper.find(MESSAGE).findComponent(RouterLinkStub);
      expect(link.text()).toBe('Organizations');
      expect(link.props('to')).toBe('/organizations');
    });
  });

  /**
   * The story the dashboard's words were written for: the question is put to the server, which
   * knows what the account can reach, never to `localStorage`, which knows what this browser
   * opened (E14/F01/S02).
   */
  describe('an organizer with markets, on a browser that has opened none', () => {
    it('is never told they have none, and is offered no line', async () => {
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountMarkets();

      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(FIRST_TIME);
      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(NOTE).exists()).toBe(false);
    });
  });

  describe('an organizer with a market to return to', () => {
    it('is offered it on one line, which opens it', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountMarkets();

      const line = wrapper.find(LINE);
      expect(line.text()).toContain('Previously opened');
      expect(line.text()).toContain('Riverside Spring Market');
      expect(wrapper.find(NOTE).exists()).toBe(false);
      expect(wrapper.find(MESSAGE).exists()).toBe(false);

      await line.trigger('click');

      expect(push).toHaveBeenCalledWith('/markets/market-1');
    });

    /** There is no cached copy for an old name to come from: the server's answer draws it. */
    it('reads its current name, as the server has it', async () => {
      browserRemembers(A_MARKET);
      serverHas({ ...A_MARKET, name: 'Its New Name' }, ANOTHER_MARKET);

      const wrapper = await mountMarkets();

      expect(wrapper.find(LINE).text()).toContain('Its New Name');
    });

    it('is not offered the same market twice when it is their only one', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET);

      const wrapper = await mountMarkets();

      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(NOTE).exists()).toBe(false);
      expect(localStorage.getItem('lastMarketId')).toBe('market-1');
    });
  });

  describe('an organizer whose remembered market is gone', () => {
    it('is told once, in the words for others left, and the next visit is silent', async () => {
      browserRemembers(A_MARKET);
      serverHas(ANOTHER_MARKET);

      const wrapper = await mountMarkets();

      expect(wrapper.find(NOTE).text()).toBe(
        'The market you last opened is no longer available. Your other markets are still here.',
      );
      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(localStorage.getItem('lastMarketId')).toBeNull();

      const nextVisit = await mountMarkets();

      expect(nextVisit.find(NOTE).exists()).toBe(false);
    });

    /** They had one, so a first-time welcome would be false, worn the other way round. */
    it('is told in the words for none left, in place of the empty state', async () => {
      browserRemembers(A_MARKET);
      serverHas();

      const wrapper = await mountMarkets();

      expect(wrapper.find(NOTE).text()).toBe(
        'The market you last opened is no longer available, and there are no others.',
      );
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(wrapper.find(EMPTY).exists()).toBe(false);
      expect(localStorage.getItem('lastMarketId')).toBeNull();
    });

    it('keeps the note through a re-read, its words following the list', async () => {
      browserRemembers(A_MARKET);
      serverHas(ANOTHER_MARKET);
      const wrapper = await mountMarkets();

      serverHas();
      await closeManage(wrapper);

      expect(wrapper.find(NOTE).text()).toContain('and there are no others');
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
    });
  });

  /** Only the page's first successful read may say a market has gone. */
  describe('an organizer who deletes their remembered market on this page', () => {
    it('is not told what they just did: the line goes, with no note', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET, ANOTHER_MARKET);
      const wrapper = await mountMarkets();
      expect(wrapper.find(LINE).exists()).toBe(true);

      serverHas(ANOTHER_MARKET);
      await closeManage(wrapper);

      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(NOTE).exists()).toBe(false);
    });

    it('is not told on the next visit either', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET, ANOTHER_MARKET);
      const wrapper = await mountMarkets();

      serverHas(ANOTHER_MARKET);
      await closeManage(wrapper);

      expect(localStorage.getItem('lastMarketId')).toBeNull();
      const nextVisit = await mountMarkets();
      expect(nextVisit.find(NOTE).exists()).toBe(false);
    });

    it('reads as empty, not as first-time, when it was their last', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET);
      const wrapper = await mountMarkets();

      serverHas();
      await closeManage(wrapper);

      expect(wrapper.find(NOTE).exists()).toBe(false);
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(wrapper.find(EMPTY).text()).toBe('No markets found');
    });

    it('reads as empty, too, when this browser had opened none', async () => {
      serverHas(A_MARKET);
      const wrapper = await mountMarkets();

      serverHas();
      await closeManage(wrapper);

      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(wrapper.find(EMPTY).exists()).toBe(true);
    });
  });

  /**
   * A failed read knows nothing of the account, so a welcome or a note would be a claim made on no
   * evidence, and forgetting the pointer would lose it for nothing.
   */
  describe('when the server cannot be reached', () => {
    it('makes no claim, and forgets nothing', async () => {
      browserRemembers(A_MARKET);
      fetchMarkets.mockRejectedValue(new Error('offline'));

      const wrapper = await mountMarkets();

      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(NOTE).exists()).toBe(false);
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(wrapper.find(EMPTY).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(FIRST_TIME);
      expect(localStorage.getItem('lastMarketId')).toBe('market-1');
    });

    it('judges on the first read that succeeds', async () => {
      browserRemembers(A_MARKET);
      fetchMarkets.mockRejectedValueOnce(new Error('offline'));
      const wrapper = await mountMarkets();

      serverHas(ANOTHER_MARKET);
      await wrapper.find('[data-testid="markets-retry"]').trigger('click');
      await flushPromises();

      expect(wrapper.find(NOTE).exists()).toBe(true);
      expect(localStorage.getItem('lastMarketId')).toBeNull();
    });

    it('takes the line and the note off a re-read that fails, and leaves the pointer', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET, ANOTHER_MARKET);
      const wrapper = await mountMarkets();

      fetchMarkets.mockRejectedValue(new Error('offline'));
      await closeManage(wrapper);

      expect(wrapper.find(LINE).exists()).toBe(false);
      expect(wrapper.find(NOTE).exists()).toBe(false);
      expect(wrapper.find(MESSAGE).exists()).toBe(false);
      expect(localStorage.getItem('lastMarketId')).toBe('market-1');
    });
  });

  /** A heading inside the line would make the outline a control (`every-control-is-named`). */
  it('puts no heading inside the line', async () => {
    browserRemembers(A_MARKET);
    serverHas(A_MARKET, ANOTHER_MARKET);

    const wrapper = await mountMarkets();

    expect(wrapper.find(LINE).find('h1, h2, h3, h4, h5, h6').exists()).toBe(false);
  });
});
