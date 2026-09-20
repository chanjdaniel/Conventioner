// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h } from 'vue';

import BlockerPanel from '@/components/BlockerPanel.vue';
import type { PreconditionResult } from '@/assets/types/datatypes';

const Blank = defineComponent({ render: () => h('div') });

/**
 * A real router rather than a `RouterLinkStub`, because what the panel decides is route-dependent:
 * whether a resolution link goes anywhere depends on where the panel is being read from, and a stub
 * cannot answer that.
 */
async function mountPanelAt(path: string, blockers: PreconditionResult[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/market-setup', component: Blank },
      { path: '/vendors', component: Blank },
      { path: '/:pathMatch(.*)*', component: Blank },
    ],
  });
  await router.push(path);
  await router.isReady();
  return mount(BlockerPanel, { props: { blockers }, global: { plugins: [router] } });
}

const reviewBlocker: PreconditionResult = {
  id: 'all_applications_reviewed',
  passed: false,
  message: '2 applications are still awaiting review.',
  resolutionLink: '/market-setup?tab=applications',
};

describe('BlockerPanel', () => {
  it('renders nothing when there are no blockers', async () => {
    const wrapper = await mountPanelAt('/market-setup', []);
    expect(wrapper.find('.blocker-panel').exists()).toBe(false);
  });

  it('names each blocker', async () => {
    const wrapper = await mountPanelAt('/market-setup', [reviewBlocker]);
    expect(wrapper.text()).toContain('2 applications are still awaiting review.');
  });

  it('routes the resolution link in-SPA rather than reloading the page', async () => {
    const wrapper = await mountPanelAt('/market-setup', [reviewBlocker]);
    const link = wrapper.find('[data-testid="blocker-resolution-link"]');

    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/market-setup?tab=applications');
  });

  it('omits the resolution link when a blocker has none', async () => {
    const wrapper = await mountPanelAt('/market-setup', [
      { ...reviewBlocker, resolutionLink: undefined },
    ]);
    expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
  });

  it('renders every blocker generically, with no guard-specific logic', async () => {
    const wrapper = await mountPanelAt('/market-setup', [
      reviewBlocker,
      { id: 'other_guard', passed: false, message: 'Something else is wrong.' },
    ]);

    expect(wrapper.findAll('.blocker-item')).toHaveLength(2);
    expect(wrapper.text()).toContain('Something else is wrong.');
  });

  /**
   * The rail carries this panel onto four organizer screens, so the same blocker is read from four
   * places and its link is only useful from three. "Fix this" on the page holding the fix looks
   * like a control and does nothing (E14/F01/S03).
   */
  describe('a link to the page you are already on', () => {
    it('is not offered', async () => {
      const wrapper = await mountPanelAt('/market-setup?tab=applications', [reviewBlocker]);

      expect(wrapper.text()).toContain('still awaiting review');
      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });

    it('is still offered from a different tab of the same page', async () => {
      const wrapper = await mountPanelAt('/market-setup?tab=setup', [reviewBlocker]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(true);
    });

    it('is still offered from another screen entirely', async () => {
      const wrapper = await mountPanelAt('/vendors', [reviewBlocker]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(true);
    });

    /** Query order is the router's business, not a reason to show a dead link. */
    it('is recognised however the current location spells its query', async () => {
      const wrapper = await mountPanelAt('/market-setup?tab=applications', [
        { ...reviewBlocker, resolutionLink: '/market-setup?tab=applications' },
      ]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });
  });
});
