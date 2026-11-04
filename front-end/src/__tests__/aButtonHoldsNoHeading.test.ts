// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import InitView from '@/views/InitView.vue';

/**
 * A control is named by its words, and a heading inside one puts the control in the page's outline
 * in place of the page's own headings: a screen reader listing headings read out buttons and links
 * (rereview notes 10 and 11).
 */
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

describe('the market chooser at /init', () => {
  function mountInit() {
    return mount(InitView, {
      global: { stubs: { NewMarketOverlay: true, LoadMarketOverlay: true } },
    });
  }

  it('opens with one title', () => {
    const wrapper = mountInit();

    expect(wrapper.findAll('h1').map((h) => h.text())).toEqual(['Set up or load a market']);
  });

  it('puts no heading inside either button, and names each by its words', () => {
    const wrapper = mountInit();

    for (const [testid, words] of [
      ['init-setup-new-market-button', 'Set Up New Market'],
      ['init-load-existing-market-button', 'Load Existing Market'],
    ]) {
      const button = wrapper.find(`[data-testid="${testid}"]`);
      expect(button.find(HEADINGS).exists(), testid).toBe(false);
      expect(button.text()).toBe(words);
    }
  });
});
