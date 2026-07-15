// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';

import BlockerPanel from '@/components/BlockerPanel.vue';
import type { PreconditionResult } from '@/assets/types/datatypes';

function mountPanel(blockers: PreconditionResult[]) {
  return mount(BlockerPanel, {
    props: { blockers },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

const formBlocker: PreconditionResult = {
  id: 'form_has_fields',
  passed: false,
  message: 'The application form has no fields.',
  resolutionLink: '/markets/market-1/form-builder',
};

describe('BlockerPanel', () => {
  it('renders nothing when there are no blockers', () => {
    expect(mountPanel([]).find('.blocker-panel').exists()).toBe(false);
  });

  it('names each blocker', () => {
    const wrapper = mountPanel([formBlocker]);
    expect(wrapper.text()).toContain('The application form has no fields.');
  });

  it('routes the resolution link in-SPA rather than reloading the page', () => {
    const wrapper = mountPanel([formBlocker]);
    const link = wrapper.findComponent(RouterLinkStub);

    expect(link.exists()).toBe(true);
    expect(link.props('to')).toBe('/markets/market-1/form-builder');
    expect(wrapper.find('a[href]').exists()).toBe(false);
  });

  it('omits the resolution link when a blocker has none', () => {
    const wrapper = mountPanel([{ ...formBlocker, resolutionLink: undefined }]);
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
  });

  it('renders every blocker generically, with no guard-specific logic', () => {
    const wrapper = mountPanel([
      formBlocker,
      { id: 'other_guard', passed: false, message: 'Something else is wrong.' },
    ]);

    expect(wrapper.findAll('.blocker-item')).toHaveLength(2);
    expect(wrapper.text()).toContain('Something else is wrong.');
  });
});
