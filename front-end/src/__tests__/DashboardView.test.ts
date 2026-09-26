// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import DashboardView from '@/views/DashboardView.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

const fetchMarkets = vi.fn();
vi.mock('@/utils/market', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/market')>()),
  fetchMarkets: () => fetchMarkets(),
}));

const A_MARKET = {
  id: 'market-1',
  name: 'Riverside Spring Market',
  creationDate: '2026-04-01T00:00:00Z',
};
const ANOTHER_MARKET = {
  id: 'market-2',
  name: 'Harbour Winter Market',
  creationDate: '2026-04-02T00:00:00Z',
};

/** What the server answers for an account that can reach these. */
function serverHas(...markets: unknown[]) {
  fetchMarkets.mockResolvedValue(markets);
}

async function mountDashboard() {
  const wrapper = mount(DashboardView, {
    global: { provide: { setUser: vi.fn() } },
  });
  // onMounted asks the server; the render follows its answer.
  await flushPromises();
  return wrapper;
}

/**
 * This browser last opened that market. It remembers the id and nothing else (E21/F02/S05): what
 * the market is called now, and whether it still exists, is the server's to say.
 */
function browserRemembers(market: { id: string }) {
  localStorage.setItem('lastMarketId', market.id);
}

describe('DashboardView, the first screen after signing in', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    fetchMarkets.mockReset();
    serverHas();
  });

  describe('an organizer who genuinely owns no market', () => {
    it('is not told that anything is missing', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.text()).not.toContain('not found');
      expect(wrapper.text()).not.toContain('no longer available');
    });

    it('is invited to begin instead', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('You have not set up a market yet');
    });

    it('is offered the step that starts it, not only told to open something that does not exist', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-create-market-button"]').exists()).toBe(true);
    });

    it('sees no "Previously opened" heading over a card for nothing', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.text()).not.toContain('Previously opened');
    });

    it('reaches the markets list from that card, so the invitation goes somewhere', async () => {
      const wrapper = await mountDashboard();

      await wrapper.find('[data-testid="dashboard-create-market-button"]').trigger('click');

      expect(push).toHaveBeenCalledWith('/markets');
    });
  });

  /**
   * The story. Every one of these used to render "You have not set up a market yet", because the
   * question was put to `localStorage` - which knows what this browser opened, not what the
   * account owns (E14/F01/S02).
   */
  describe('an organizer who owns markets, on a browser that has opened none', () => {
    it('is never told they have none', async () => {
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('You have not set up a market yet');
    });

    it('is told what they actually have, and offered the way in', async () => {
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('2 markets are open to you');
      await wrapper.find('[data-testid="dashboard-open-market-button"]').trigger('click');
      expect(push).toHaveBeenCalledWith('/markets');
    });

    it('is not told about "1 markets"', async () => {
      serverHas(A_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('1 market is open to you');
    });

    /**
     * `GET /markets` answers what the account can REACH, which includes markets reached through an
     * organization as a viewer, so the copy must not claim ownership of them.
     */
    it('does not claim they own what they may only be able to view', async () => {
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).not.toMatch(/you (have|own) \d+ markets/i);
    });
  });

  describe('an organizer whose remembered market is gone', () => {
    it('is told that, rather than being greeted as a first-time organizer', async () => {
      browserRemembers(A_MARKET);
      serverHas(ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('no longer available');
      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
    });

    it('is told once: the pointer is forgotten, so the next visit does not repeat it', async () => {
      browserRemembers(A_MARKET);
      serverHas(ANOTHER_MARKET);

      await mountDashboard();

      expect(localStorage.getItem('lastMarketId')).toBeNull();
    });

    /**
     * They had one, so "set up your FIRST market" would be the falsehood this story removes, worn
     * the other way round. They are still told where they stand, and still offered the step.
     */
    it('is not greeted as a first-time organizer when it was their only one', async () => {
      browserRemembers(A_MARKET);
      serverHas();

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('no longer available');
      expect(wrapper.text()).not.toContain('your first market');
      expect(wrapper.find('[data-testid="dashboard-create-market-button"]').exists()).toBe(true);
    });
  });

  describe('an organizer with a market to return to', () => {
    it('sees it, and none of the empty states', async () => {
      browserRemembers(A_MARKET);
      serverHas(A_MARKET, ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('Riverside Spring Market');
      expect(wrapper.text()).toContain('Previously opened');
      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-testid="dashboard-has-markets"]').exists()).toBe(false);
    });

    /**
     * The card is drawn from the server's answer, so a market renamed on another device reads back
     * under its current name - there is no cached copy for an old one to come from.
     */
    it('sees its current name, as the server has it', async () => {
      browserRemembers(A_MARKET);
      serverHas({ ...A_MARKET, name: 'Its New Name' });

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('Its New Name');
    });
  });

  /**
   * A request that fails leaves the count unknown. Rendering the welcome would be the same
   * falsehood the story removes, arriving by a different road, so the screen claims nothing.
   */
  describe('when the server cannot be reached', () => {
    it('makes no claim about the account either way', async () => {
      fetchMarkets.mockRejectedValue(new Error('offline'));

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-has-markets"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('You have not set up a market yet');
    });

    /**
     * The card used to be drawn from a whole market cached in the browser when the server could not
     * be asked. Nothing about a market is kept there now (E21/F02/S05), so with no answer there is
     * no card - a convenience lost, never a stale market shown - and the pointer is kept for later.
     */
    it('offers no card it cannot draw from the server, and keeps the pointer', async () => {
      browserRemembers(A_MARKET);
      fetchMarkets.mockRejectedValue(new Error('offline'));

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-last-market-card"]').exists()).toBe(false);
      expect(localStorage.getItem('lastMarketId')).toBe('market-1');
    });
  });
});
