// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, RouterLink } from 'vue-router';
import { defineComponent, h } from 'vue';

import BlockerPanel from '@/components/BlockerPanel.vue';
import type { PreconditionResult } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const Blank = defineComponent({ render: () => h('div') });

/**
 * A real router rather than a `RouterLinkStub`, because what the panel decides is route-dependent:
 * whether a resolution link goes anywhere depends on where the panel is being read from, and a stub
 * cannot answer that.
 */
async function mountPanelAt(
  path: string,
  blockers: PreconditionResult[],
  actionRefusals: Record<string, string | null> = answersRefusing(),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/markets/:marketId/:page(setup|form|applications|assignment)', component: Blank },
      { path: '/markets/:marketId/vendors', component: Blank },
      { path: '/:pathMatch(.*)*', component: Blank },
    ],
  });
  await router.push(path);
  await router.isReady();
  return mount(BlockerPanel, {
    props: { blockers, market: { id: 'm1', actionRefusals } },
    global: { plugins: [router] },
  });
}

const reviewBlocker: PreconditionResult = {
  id: 'all_applications_reviewed',
  passed: false,
  message: '2 applications are still awaiting review.',
  // Relative to the market's own pages: the server names the page, the panel names the market it
  // is showing (E21/F02/S02). Every page has its own address since E22/F04/S02.
  resolutionLink: 'applications',
  resolutionLabel: 'Finish deciding',
  resolutionAction: MarketAction.GiveVerdicts,
};

describe('BlockerPanel', () => {
  it('renders nothing when there are no blockers', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', []);
    expect(wrapper.find('.blocker-panel').exists()).toBe(false);
  });

  it('names each blocker', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', [reviewBlocker]);
    expect(wrapper.text()).toContain('2 applications are still awaiting review.');
  });

  it('routes the resolution link in-SPA rather than reloading the page', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', [reviewBlocker]);

    // A `RouterLink`, not a plain anchor: a real router renders a real `href`, so the href alone
    // no longer tells the two apart the way it did under a stub.
    const link = wrapper.findComponent(RouterLink);
    expect(link.exists()).toBe(true);
    expect(link.props('to')).toBe('/markets/m1/applications');
    expect(link.attributes('data-testid')).toBe('blocker-resolution-link');
  });

  it('names the link by what following it does, as the guard words it (E32/F01/S02)', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', [reviewBlocker]);

    expect(wrapper.get('[data-testid="blocker-resolution-link"]').text()).toBe('Finish deciding →');
  });

  it('omits the resolution link when a blocker has none', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', [
      { ...reviewBlocker, resolutionLink: undefined },
    ]);
    expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
  });

  it('renders every blocker generically, with no guard-specific logic', async () => {
    const wrapper = await mountPanelAt('/markets/m1/setup', [
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
      const wrapper = await mountPanelAt('/markets/m1/applications', [reviewBlocker]);

      expect(wrapper.text()).toContain('still awaiting review');
      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });

    it('is still offered from another page of the same market', async () => {
      const wrapper = await mountPanelAt('/markets/m1/setup', [reviewBlocker]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(true);
    });

    it('is still offered from another screen entirely', async () => {
      const wrapper = await mountPanelAt('/markets/m1/vendors', [reviewBlocker]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(true);
    });

    /**
     * A guard whose remedy spans two places sends no link at all, and the server spells that as
     * an explicit null rather than by omitting the key.
     */
    it('is not conjured from a null link', async () => {
      const wrapper = await mountPanelAt('/markets/m1/vendors', [
        { ...reviewBlocker, resolutionLink: null },
      ]);

      expect(wrapper.text()).toContain('still awaiting review');
      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });
  });

  /**
   * A refused move's panel offers a remedy only to someone the table lets take it (T142), as the
   * rail does: a link to work that is not theirs sends them to a page that refuses it.
   */
  describe('a link to work that is not yours to do', () => {
    it('is not offered, and the blocker is still said', async () => {
      const wrapper = await mountPanelAt('/markets/m1/setup', [reviewBlocker], VIEWER_ANSWERS);

      expect(wrapper.text()).toContain('still awaiting review');
      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });

    it('is offered beside one that is', async () => {
      const wrapper = await mountPanelAt(
        '/markets/m1/vendors',
        [
          reviewBlocker,
          {
            id: 'setup_has_dates',
            passed: false,
            message: 'This market has no dates.',
            resolutionLink: 'setup',
            resolutionLabel: 'Pick market dates',
            resolutionAction: MarketAction.ChangeSetup,
          },
        ],
        answersRefusing(MarketAction.GiveVerdicts),
      );

      const links = wrapper.findAll('[data-testid="blocker-resolution-link"]');
      expect(links.map((link) => link.text())).toEqual(['Pick market dates →']);
    });

    it('is not offered where the blocker names no action, as from an older server', async () => {
      const wrapper = await mountPanelAt('/markets/m1/setup', [
        { ...reviewBlocker, resolutionAction: undefined },
      ]);

      expect(wrapper.find('[data-testid="blocker-resolution-link"]').exists()).toBe(false);
    });
  });
});
