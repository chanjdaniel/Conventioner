/**
 * The split bar (T201): one bar of a whole cut into its parts in order, each its own fill with a
 * gap between, hidden from a screen reader, which reads the legend: each part's label and count, a
 * link where the part has one and something to list, a zero told but not linked.
 */
import { describe, expect, it } from 'vitest';
import { RouterLinkStub, mount } from '@vue/test-utils';
import SplitBar from '@/components/charts/SplitBar.vue';
import type { SplitPart } from '@/utils/splitBar';

const to = (status: string) => ({ path: '/markets/m1/applications', query: { status } });

const PARTS: SplitPart[] = [
  { label: 'Open', value: 'undecided', count: 12, fill: '--mm-blue', to: to('undecided') },
  {
    label: 'Needs follow-up',
    value: 'needs_follow_up',
    count: 0,
    fill: '--mm-chart-yellow',
    to: to('needs_follow_up'),
  },
  { label: 'Approved', value: 'reviewer_approved', count: 20, fill: '--mm-green', to: to('a') },
  { label: 'Rejected', value: 'reviewer_rejected', count: 4, fill: '--mm-red', to: to('r') },
  { label: 'Cancelled', value: 'cancelled', count: 4, fill: '--mm-chart-grey' },
];

function mountBar(parts = PARTS) {
  return mount(SplitBar, {
    props: { title: 'Where the review stands', parts, whole: 'applications', testid: 'split' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

describe('SplitBar', () => {
  it('draws each part with something in it, in order, sized by its count, in its own fill', () => {
    const bar = mountBar().find('[data-testid="split-bar"]');
    expect(bar.attributes('aria-hidden')).toBe('true');
    const drawn = bar.findAll('[data-testid="split-bar-part"]');
    expect(drawn.map((part) => part.attributes('data-value'))).toEqual([
      'undecided',
      'reviewer_approved',
      'reviewer_rejected',
      'cancelled',
    ]);
    expect(drawn.map((part) => part.attributes('style'))).toEqual([
      'flex-grow: 12; background: var(--mm-blue);',
      'flex-grow: 20; background: var(--mm-green);',
      'flex-grow: 4; background: var(--mm-red);',
      'flex-grow: 4; background: var(--mm-chart-grey);',
    ]);
  });

  it('is a beige track with nothing in it, and white between parts otherwise', () => {
    expect(mountBar().find('[data-testid="split-bar"]').classes()).not.toContain(
      'split-bar-bar--empty',
    );
    const empty = mountBar(PARTS.map((part) => ({ ...part, count: 0 })));
    expect(empty.find('[data-testid="split-bar"]').classes()).toContain('split-bar-bar--empty');
    expect(empty.findAll('[data-testid="split-bar-part"]')).toHaveLength(0);
  });

  it('reads as its legend: every part, a zero included, with its count and share', () => {
    const lines = mountBar().findAll('[data-testid="split"]');
    expect(lines.map((line) => line.attributes('data-value'))).toEqual(PARTS.map((p) => p.value));
    expect(lines[0].text()).toBe('Open: 12, 30% of applications');
    expect(lines[1].text()).toBe('Needs follow-up: 0, 0% of applications');
  });

  it('links each part to its list, but a zero, and a part with nowhere to go', () => {
    const wrapper = mountBar();
    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links.map((link) => link.props('to'))).toEqual([to('undecided'), to('a'), to('r')]);
    const line = (value: string) => wrapper.find(`[data-testid="split"][data-value="${value}"]`);
    expect(line('needs_follow_up').element.tagName).toBe('DIV');
    expect(line('cancelled').element.tagName).toBe('DIV');
  });

  it('wears each part’s fill on its legend swatch', () => {
    const swatches = mountBar().findAll('[data-testid="split-swatch"]');
    expect(swatches.map((s) => s.attributes('style'))).toEqual(
      PARTS.map((p) => `background: var(${p.fill});`),
    );
    expect(swatches.every((s) => s.attributes('aria-hidden') === 'true')).toBe(true);
  });
});
