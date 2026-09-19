/**
 * A vendor's date cards say what happened on each date.
 *
 * The cards existed and had the hole in them: a placed date and an unplaced one carried the same
 * green left border, and the unplaced one's content was a bare em dash - so a date with no table
 * read as placed at a glance, and said nothing about why.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import VendorDateCard from '@/components/VendorDateCard.vue';
import { placementReasonText, reasonIsActionable } from '@/utils/placementReason';

function card(props: Record<string, unknown>) {
  return mount(VendorDateCard, { props: { label: 'Friday, May 1, 2026', ...props } });
}

describe('the three states read differently', () => {
  it('a placed date says where', () => {
    const wrapper = card({ placement: 'Hall A 1 (Full Table)' });

    expect(wrapper.attributes('data-state')).toBe('placed');
    expect(wrapper.text()).toContain('Hall A 1');
  });

  it('a placement against the vendor own answer names what it overrides', () => {
    // Tier sets the price, so a vendor charged for a table they did not choose has to be visible.
    const wrapper = card({ placement: 'Hall A 1 (Full Table)', overrides: ['tier'] });

    expect(wrapper.attributes('data-state')).toBe('overridden');
    expect(wrapper.get('[data-testid="vendor-date-card-override"]').text()).toContain(
      'a tier they did not accept',
    );
  });

  it('a placement that overrides nothing is an ordinary placed date', () => {
    const wrapper = card({ placement: 'Hall A 1 (Full Table)', overrides: [] });

    expect(wrapper.attributes('data-state')).toBe('placed');
    expect(wrapper.find('[data-testid="vendor-date-card-override"]').exists()).toBe(false);
  });

  it('every contradiction is named, not just the first', () => {
    const wrapper = card({
      placement: 'Hall A 1 (Full Table)',
      overrides: ['table_choice', 'tier'],
    });

    const text = wrapper.get('[data-testid="vendor-date-card-override"]').text();
    // Tier first whatever order they arrive in: it is the one that costs money.
    expect(text.indexOf('tier they did not accept')).toBeLessThan(
      text.indexOf('table size they did not ask for'),
    );
  });

  it('an unplaced date is a different state, before any of its text is read', () => {
    const wrapper = card({ placement: null, reason: 'taken' });

    expect(wrapper.attributes('data-state')).toBe('unplaced');
  });
});

describe('an unplaced date states its reason in words', () => {
  it.each([
    ['not_available', 'Not available'],
    ['no_table_at_their_tier', 'No table at a tier they accept'],
    ['taken', 'Every table they accept is taken'],
    ['free', 'A table is free'],
  ])('%s reads as a sentence', (reason, expected) => {
    const wrapper = card({ placement: null, reason });

    expect(wrapper.get('[data-testid="vendor-date-card-reason"]').text()).toContain(expected);
  });

  it('never renders punctuation in place of a reason', () => {
    const wrapper = card({ placement: null, reason: undefined });

    const text = wrapper.get('[data-testid="vendor-date-card-reason"]').text();
    expect(text).toBe('Not placed');
    expect(text).not.toContain('—');
    expect(text).not.toBe('-');
  });
});

describe('a free table is actionable, the other reasons are reports', () => {
  it('offers a way to place them when a table is open', () => {
    const wrapper = card({ placement: null, reason: 'free', placeHref: '/markets/m/tables' });

    expect(wrapper.find('[data-testid="vendor-date-card-place-link"]').exists()).toBe(true);
  });

  it('emits rather than navigating, so the view decides where', async () => {
    const wrapper = card({ placement: null, reason: 'free', placeHref: '/markets/m/tables' });

    await wrapper.get('[data-testid="vendor-date-card-place-link"]').trigger('click');

    expect(wrapper.emitted('place')).toHaveLength(1);
  });

  it.each(['not_available', 'no_table_at_their_tier', 'taken'])(
    'offers nothing to press for %s, because the answer is elsewhere',
    (reason) => {
      const wrapper = card({ placement: null, reason, placeHref: '/markets/m/tables' });

      expect(wrapper.find('[data-testid="vendor-date-card-place-link"]').exists()).toBe(false);
      expect(reasonIsActionable(reason as never)).toBe(false);
    },
  );

  it('leads to the Tables view from a placed date too, to change it', () => {
    // The trigger for every change is a person, and this panel is where the organizer is looking
    // at one; only the Tables view can answer "where can they go" (E11/F03/S02).
    const wrapper = card({
      placement: 'Hall A 1',
      placeHref: '/markets/m/tables',
    });

    expect(wrapper.get('[data-testid="vendor-date-card-place-link"]').text()).toBe(
      'Change placement',
    );
  });

  it('says place, not change, when there is nobody there yet', () => {
    const wrapper = card({ placement: null, reason: 'free', placeHref: '/markets/m/tables' });

    expect(wrapper.get('[data-testid="vendor-date-card-place-link"]').text()).toBe('Place them');
  });

  it('offers nothing without somewhere to send them', () => {
    const wrapper = card({ placement: 'Hall A 1', placeHref: null });

    expect(wrapper.find('[data-testid="vendor-date-card-place-link"]').exists()).toBe(false);
  });
});

describe('placementReasonText', () => {
  it('falls back to a plain fact for a reason this build does not know', () => {
    expect(placementReasonText('something_new' as never)).toBe('Not placed');
  });
});
