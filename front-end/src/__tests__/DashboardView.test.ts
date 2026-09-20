// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import DashboardView from '@/views/DashboardView.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

const get = vi.fn();
vi.mock('@/utils/api', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
  },
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

/** What `GET /markets` answers for an account owning these. */
function serverHas(...markets: unknown[]) {
  get.mockResolvedValue({ data: { markets } });
}

async function mountDashboard() {
  const wrapper = mount(DashboardView, {
    global: { provide: { setUser: vi.fn() } },
  });
  // onMounted reads localStorage and then asks the server; the render follows both.
  await flushPromises();
  return wrapper;
}

/** This browser last opened that market - the only thing localStorage is still consulted for. */
function browserRemembers(market: unknown) {
  localStorage.setItem('market', JSON.stringify(market));
}

describe('DashboardView, the first screen after signing in', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    get.mockReset();
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

      expect(wrapper.text()).toContain('You have 2 markets');
      await wrapper.find('[data-testid="dashboard-open-market-button"]').trigger('click');
      expect(push).toHaveBeenCalledWith('/markets');
    });

    it('is not told they have "1 markets"', async () => {
      serverHas(A_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('You have one market');
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

    it('is covered by the same branch when what was stored cannot even be read', async () => {
      localStorage.setItem('market', 'not json at all');
      serverHas(ANOTHER_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(true);
    });

    it('falls to the welcome when it was their only one, because now they really have none', async () => {
      browserRemembers(A_MARKET);
      serverHas();

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(true);
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
     * The card is drawn from the server's answer, not from the cached copy, so a market renamed on
     * another device does not read back under its old name here.
     */
    it('sees its current name, not the one this browser cached', async () => {
      browserRemembers({ ...A_MARKET, name: 'Its Old Name' });
      serverHas(A_MARKET);

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('Riverside Spring Market');
      expect(wrapper.text()).not.toContain('Its Old Name');
    });
  });

  /**
   * A request that fails leaves the count unknown. Rendering the welcome would be the same
   * falsehood the story removes, arriving by a different road, so the screen claims nothing.
   */
  describe('when the server cannot be reached', () => {
    it('makes no claim about the account either way', async () => {
      browserRemembers(A_MARKET);
      get.mockRejectedValue(new Error('offline'));

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-has-markets"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain('You have not set up a market yet');
    });
  });
});
