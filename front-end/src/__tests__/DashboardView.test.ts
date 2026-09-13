// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import DashboardView from '@/views/DashboardView.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

async function mountDashboard() {
  const wrapper = mount(DashboardView, {
    global: { provide: { setUser: vi.fn() } },
  });
  // onMounted reads localStorage; the render that follows it is async.
  await flushPromises();
  return wrapper;
}

const A_MARKET = {
  id: 'market-1',
  name: 'Riverside Spring Market',
  creationDate: '2026-04-01T00:00:00Z',
};

describe('DashboardView, the first screen after signing in', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  describe('an organizer who has never opened a market', () => {
    it('is not told that anything is missing', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.text()).not.toContain('not found');
      expect(wrapper.text()).not.toContain('no longer available');
    });

    it('is invited to begin instead', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Open a market to get started');
    });

    it('sees no "Previously opened" heading over a card for nothing', async () => {
      const wrapper = await mountDashboard();

      expect(wrapper.text()).not.toContain('Previously opened');
    });

    it('reaches the markets list from that card, so the invitation goes somewhere', async () => {
      const wrapper = await mountDashboard();

      await wrapper.find('[data-testid="dashboard-no-market-yet"]').trigger('click');

      expect(push).toHaveBeenCalledWith('/markets');
    });
  });

  describe('an organizer whose remembered market cannot be read', () => {
    it('is told that one, and it is a different message from having none', async () => {
      localStorage.setItem('market', 'not json at all');

      const wrapper = await mountDashboard();

      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('no longer available');
      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
    });

    it('still gets the heading, because there really was a previous market', async () => {
      localStorage.setItem('market', JSON.stringify({ nonsense: true }));

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('Previously opened');
    });
  });

  describe('an organizer with a market to return to', () => {
    it('sees it, and neither of the empty states', async () => {
      localStorage.setItem('market', JSON.stringify(A_MARKET));

      const wrapper = await mountDashboard();

      expect(wrapper.text()).toContain('Riverside Spring Market');
      expect(wrapper.text()).toContain('Previously opened');
      expect(wrapper.find('[data-testid="dashboard-no-market-yet"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="dashboard-last-market-unavailable"]').exists()).toBe(
        false,
      );
    });
  });
});
