/**
 * The dialog that changes one placement.
 *
 * Two operations and deliberately no third (`E11/F03/S01`): a seat is filled, or two vendors trade
 * seats. Nothing here displaces an occupant, because that is how a vendor is silently unassigned
 * on market day.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlacementDialog from '@/components/PlacementDialog.vue';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  type PlaceableVendor,
} from '@/utils/placementChange';

const DATE = '2026-08-01';

function applicant(email: string, overrides: Partial<PlaceableVendor> = {}): PlaceableVendor {
  return {
    email,
    tableChoice: 'full',
    availableDates: [DATE],
    acceptedTiersByDate: {},
    maxDates: null,
    ...overrides,
  };
}

function dialog(props: Record<string, unknown> = {}) {
  return mount(PlacementDialog, {
    props: {
      open: true,
      mode: 'place',
      date: DATE,
      dateLabel: 'Saturday, August 1, 2026',
      tableCode: 'Front 1',
      section: 'Front',
      tier: 'Gold',
      seat: null,
      vendors: [applicant('nadia@ember.test')],
      datesHeld: {},
      marketCeiling: null,
      swapTargets: [],
      vendorNames: { 'nadia@ember.test': 'Nadia Ember' },
      ...props,
    },
  });
}

describe('filling a seat', () => {
  it('offers the seat as a choice when the whole table is free', () => {
    const wrapper = dialog({ seat: null });

    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="placement-dialog-fixed-seat"]').exists()).toBe(false);
  });

  it('states the seat rather than offering one when only a side is free', () => {
    const wrapper = dialog({ seat: HALF_TABLE_RIGHT });

    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(0);
    expect(wrapper.get('[data-testid="placement-dialog-fixed-seat"]').text()).toContain(
      'The right half',
    );
  });

  it('warns before the change when it would alter what the vendor asked for', async () => {
    const wrapper = dialog({ seat: HALF_TABLE_RIGHT });

    await wrapper.get('[data-testid="placement-dialog-vendor"]').setValue('nadia@ember.test');

    expect(wrapper.get('[data-testid="placement-dialog-warning"]').text()).toContain('whole table');
  });

  it('cannot be confirmed until a vendor is chosen', async () => {
    const wrapper = dialog();
    const confirm = wrapper.get('[data-testid="placement-dialog-confirm"]');

    expect(confirm.attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="placement-dialog-vendor"]').setValue('nadia@ember.test');
    expect(confirm.attributes('disabled')).toBeUndefined();
  });

  it('emits the vendor and the seat', async () => {
    const wrapper = dialog({ seat: HALF_TABLE_RIGHT });
    await wrapper.get('[data-testid="placement-dialog-vendor"]').setValue('nadia@ember.test');

    // The confirm is `type="submit"` in the dialog's form now (E20/F01/S03), which is what gives
    // Enter its meaning. jsdom does not turn a click on a submit button into a form submission the
    // way a browser does, so the form is submitted directly - the same event either path raises.
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('place')).toEqual([
      [{ email: 'nadia@ember.test', seat: HALF_TABLE_RIGHT }],
    ]);
  });

  it('names the vendor and their address, because two traders may share a name', () => {
    const wrapper = dialog();

    expect(wrapper.get('[data-testid="placement-dialog-vendor"]').text()).toContain(
      'Nadia Ember (nadia@ember.test)',
    );
  });

  it('offers who the seat fits apart from who it would override, and hides neither', () => {
    const wrapper = dialog({
      vendors: [
        applicant('nadia@ember.test'),
        applicant('lee@ember.test', { acceptedTiersByDate: { [DATE]: ['Silver'] } }),
      ],
    });

    expect(wrapper.get('[data-testid="placement-dialog-fits"]').text()).toContain('Nadia Ember');
    expect(wrapper.get('[data-testid="placement-dialog-overrides"]').text()).toContain(
      'lee@ember.test',
    );
  });

  it('does not offer a vendor who already has a table on this date', () => {
    const wrapper = dialog({ datesHeld: { 'nadia@ember.test': [DATE] } });

    expect(wrapper.get('[data-testid="placement-dialog-vendor"]').text()).not.toContain('Nadia');
    expect(wrapper.text()).toContain('already has a table on this date');
  });

  it("warns, without blocking, when it passes their limit and the market's ceiling", async () => {
    const wrapper = dialog({
      vendors: [applicant('nadia@ember.test', { maxDates: 1 })],
      datesHeld: { 'nadia@ember.test': ['2026-08-02'] },
      marketCeiling: 1,
    });

    await wrapper.get('[data-testid="placement-dialog-vendor"]').setValue('nadia@ember.test');

    const warning = wrapper.get('[data-testid="placement-dialog-warning"]').text();
    expect(warning).toContain('they asked for at most 1');
    expect(warning).toContain('the market allows at most 1 per vendor');
    expect(
      wrapper.get('[data-testid="placement-dialog-confirm"]').attributes('disabled'),
    ).toBeUndefined();
  });
});

describe('a seat somebody holds', () => {
  const occupied = {
    mode: 'occupied',
    seat: FULL_TABLE,
    occupantEmail: 'nadia@ember.test',
    vendors: [applicant('nadia@ember.test'), applicant('lee@ember.test')],
    swapTargets: [
      { email: 'lee@ember.test', tableCode: 'Front 2', tier: 'Gold', seat: FULL_TABLE },
    ],
  };

  it('offers a trade and a way to free the seat, and no way to displace them', () => {
    const wrapper = dialog(occupied);

    expect(wrapper.find('[data-testid="placement-dialog-swap"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="placement-dialog-free"]').exists()).toBe(true);
    // Nothing here places a different vendor into an occupied seat.
    expect(wrapper.find('[data-testid="placement-dialog-vendor"]').exists()).toBe(false);
  });

  it('cannot swap until a partner is chosen', async () => {
    const wrapper = dialog(occupied);
    const swap = wrapper.get('[data-testid="placement-dialog-swap"]');

    expect(swap.attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="placement-dialog-swap-target"]').setValue('lee@ember.test');
    expect(swap.attributes('disabled')).toBeUndefined();
  });

  it('says where a swap partner currently sits', () => {
    const wrapper = dialog(occupied);

    expect(wrapper.get('[data-testid="placement-dialog-swap-target"]').text()).toContain('Front 2');
  });

  it('says so when there is nobody to trade with', () => {
    const wrapper = dialog({ ...occupied, swapTargets: [] });

    expect(wrapper.text()).toContain('nobody to trade with');
  });

  it('warns for each vendor what the seat they move into overrides (bug 18)', async () => {
    const wrapper = dialog({
      ...occupied,
      vendors: [
        applicant('nadia@ember.test', { acceptedTiersByDate: { [DATE]: ['Gold'] } }),
        applicant('lee@ember.test', { tableChoice: 'half' }),
      ],
      swapTargets: [
        { email: 'lee@ember.test', tableCode: 'Back 2', tier: 'Bronze', seat: HALF_TABLE_LEFT },
      ],
    });

    await wrapper.get('[data-testid="placement-dialog-swap-target"]').setValue('lee@ember.test');

    const warning = wrapper.get('[data-testid="placement-dialog-swap-warning"]');
    const nadia = warning.get('[data-vendor-email="nadia@ember.test"]').text();
    expect(nadia).toContain('Nadia Ember');
    expect(nadia).toContain('They did not accept the Bronze tier on this date');
    expect(nadia).toContain('They asked for a whole table. This gives them half of one.');
    expect(warning.get('[data-vendor-email="lee@ember.test"]').text()).toContain(
      'They asked to share a table. This gives them a whole one.',
    );
    expect(
      wrapper.get('[data-testid="placement-dialog-swap"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('says nothing about a trade that overrides nobody', async () => {
    const wrapper = dialog(occupied);

    await wrapper.get('[data-testid="placement-dialog-swap-target"]').setValue('lee@ember.test');

    expect(wrapper.find('[data-testid="placement-dialog-swap-warning"]').exists()).toBe(false);
  });
});
