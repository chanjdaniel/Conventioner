/**
 * When the review's list was last read, as both views say it (E38/F05/S03), and that it ages on
 * screen without another read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { updatedAgo } from '@/utils/updatedAgo';
import ListFreshness from '@/components/application/ListFreshness.vue';

const READ = Date.parse('2026-11-18T09:00:00Z');
const after = (seconds: number) => updatedAgo(READ, READ + seconds * 1000);

describe('updatedAgo', () => {
  it('says just now for the first minute', () => {
    expect(after(0)).toBe('Updated just now');
    expect(after(59)).toBe('Updated just now');
  });

  it('counts whole minutes, then hours', () => {
    expect(after(60)).toBe('Updated 1 minute ago');
    expect(after(150)).toBe('Updated 2 minutes ago');
    expect(after(59 * 60 + 59)).toBe('Updated 59 minutes ago');
    expect(after(60 * 60)).toBe('Updated 1 hour ago');
    expect(after(3 * 60 * 60 + 5)).toBe('Updated 3 hours ago');
  });

  it('reads a clock that runs behind the read as just now', () => {
    expect(after(-30)).toBe('Updated just now');
  });
});

describe('ListFreshness', () => {
  afterEach(() => vi.useRealTimers());

  it('ages as it stays on screen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(READ);
    const wrapper = mount(ListFreshness, {
      props: { readAt: READ, refreshing: false, failed: '' },
    });
    expect(wrapper.get('[data-testid="applications-updated"]').text()).toBe('Updated just now');

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(wrapper.get('[data-testid="applications-updated"]').text()).toBe(
      'Updated 2 minutes ago',
    );
    wrapper.unmount();
  });

  it('asks for a refresh, and says when one failed', async () => {
    const wrapper = mount(ListFreshness, {
      props: { readAt: READ, refreshing: false, failed: '' },
    });
    await wrapper.get('[data-testid="applications-refresh"]').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);

    await wrapper.setProps({ refreshing: true });
    expect(
      wrapper.get<HTMLButtonElement>('[data-testid="applications-refresh"]').element.disabled,
    ).toBe(true);
    await wrapper.setProps({ refreshing: false, failed: 'Could not refresh.' });
    expect(wrapper.get('[data-testid="applications-refresh-error"]').text()).toBe(
      'Could not refresh.',
    );
    wrapper.unmount();
  });
});
