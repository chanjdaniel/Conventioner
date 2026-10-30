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
      vendorSearch: { 'nadia@ember.test': ['Nadia Ember', 'Ember Candles'] },
      ...props,
    },
    attachTo: document.body,
  });
}

type Dialog = ReturnType<typeof dialog>;

/** Type into a picker and take the first match with Enter, as the keyboard does (E38/F08/S03). */
async function choose(wrapper: Dialog, picker: string, words: string): Promise<void> {
  const field = wrapper.get(`[data-testid="${picker}-input"]`);
  await field.setValue(words);
  await field.trigger('keydown', { key: 'Enter' });
}

/** Open a picker's list, as a click on its field does. */
async function openPicker(wrapper: Dialog, picker: string) {
  await wrapper.get(`[data-testid="${picker}-input"]`).trigger('click');
  return wrapper.get(`[data-testid="${picker}-list"]`);
}

const offered = (list: ReturnType<Dialog['get']>) =>
  list.findAll('[role="option"]').map((option) => option.attributes('data-value'));

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

    await choose(wrapper, 'placement-dialog-vendor', 'nadia@ember.test');

    expect(wrapper.get('[data-testid="placement-dialog-warning"]').text()).toContain('whole table');
  });

  it('cannot be confirmed until a vendor is chosen', async () => {
    const wrapper = dialog();
    const confirm = wrapper.get('[data-testid="placement-dialog-confirm"]');

    expect(confirm.attributes('disabled')).toBeDefined();

    await choose(wrapper, 'placement-dialog-vendor', 'nadia@ember.test');
    expect(confirm.attributes('disabled')).toBeUndefined();
  });

  it('emits the vendor and the seat', async () => {
    const wrapper = dialog({ seat: HALF_TABLE_RIGHT });
    await choose(wrapper, 'placement-dialog-vendor', 'nadia@ember.test');

    // The confirm is `type="submit"` in the dialog's form now (E20/F01/S03), which is what gives
    // Enter its meaning. jsdom does not turn a click on a submit button into a form submission the
    // way a browser does, so the form is submitted directly - the same event either path raises.
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('place')).toEqual([
      [{ email: 'nadia@ember.test', seat: HALF_TABLE_RIGHT }],
    ]);
  });

  it('names the vendor and their address, because two traders may share a name', async () => {
    const wrapper = dialog();

    expect((await openPicker(wrapper, 'placement-dialog-vendor')).text()).toContain(
      'Nadia Ember (nadia@ember.test)',
    );
  });

  it('offers who the seat fits apart from who it would override, and hides neither', async () => {
    const wrapper = dialog({
      vendors: [
        applicant('nadia@ember.test'),
        applicant('lee@ember.test', { acceptedTiersByDate: { [DATE]: ['Silver'] } }),
      ],
    });
    await openPicker(wrapper, 'placement-dialog-vendor');

    expect(wrapper.get('[data-testid="placement-dialog-fits"]').text()).toContain('Nadia Ember');
    expect(wrapper.get('[data-testid="placement-dialog-overrides"]').text()).toContain(
      'lee@ember.test',
    );
  });

  it('is searched by name, business or address, every group kept (E38/F08/S03)', async () => {
    const wrapper = dialog({
      vendors: [
        applicant('nadia@ember.test'),
        applicant('lee@ember.test', { acceptedTiersByDate: { [DATE]: ['Silver'] } }),
      ],
    });
    const field = wrapper.get('[data-testid="placement-dialog-vendor-input"]');

    // A business is found by the answers the pages' search reads.
    await field.setValue('candles');
    const list = wrapper.get('[data-testid="placement-dialog-vendor-list"]');
    expect(offered(list)).toEqual(['nadia@ember.test']);
    expect(wrapper.get('[data-testid="placement-dialog-overrides"]').text()).toContain(
      'None match "candles".',
    );

    await field.setValue('lee@');
    expect(offered(list)).toEqual(['lee@ember.test']);
    expect(wrapper.get('[data-testid="placement-dialog-fits"]').text()).toContain('None match');
  });

  it('does not offer a vendor who already has a table on this date', async () => {
    const wrapper = dialog({ datesHeld: { 'nadia@ember.test': [DATE] } });

    await wrapper.get('[data-testid="placement-dialog-vendor-input"]').trigger('click');
    expect(wrapper.find('[data-testid="placement-dialog-vendor-list"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('already has a table on this date');
  });

  it("warns, without blocking, when it passes their limit and the market's ceiling", async () => {
    const wrapper = dialog({
      vendors: [applicant('nadia@ember.test', { maxDates: 1 })],
      datesHeld: { 'nadia@ember.test': ['2026-08-02'] },
      marketCeiling: 1,
    });

    await choose(wrapper, 'placement-dialog-vendor', 'nadia@ember.test');

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
      {
        email: 'lee@ember.test',
        tableCode: 'Front 2',
        section: 'Front',
        tier: 'Gold',
        seat: FULL_TABLE,
      },
    ],
  };

  it('asks nothing about what they owe unless it is given the question', async () => {
    const wrapper = dialog(occupied);

    expect(wrapper.find('[data-testid="placement-dialog-deduct"]').exists()).toBe(false);
    await wrapper.get('[data-testid="placement-dialog-free"]').trigger('click');
    expect(wrapper.emitted('free')).toEqual([[false]]);
  });

  it('asks, unticked, whether freeing also takes the seat off what they owe (E44/F01/S02)', async () => {
    const wrapper = dialog({ ...occupied, deduction: { amount: '$15', name: 'Nadia Ember' } });

    const box = wrapper.get<HTMLInputElement>('[data-testid="placement-dialog-deduct"]');
    expect(box.element.checked).toBe(false);
    expect(wrapper.text()).toContain(
      'Also remove its $15 from what Nadia Ember owes? (Cancelled before the deadline: a refund may be due.)',
    );
    await box.setValue(true);
    await wrapper.get('[data-testid="placement-dialog-free"]').trigger('click');
    expect(wrapper.emitted('free')).toEqual([[true]]);
  });

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

    await choose(wrapper, 'placement-dialog-swap-target', 'lee@ember.test');
    expect(swap.attributes('disabled')).toBeUndefined();
  });

  it('says where a swap partner currently sits', async () => {
    const wrapper = dialog(occupied);

    expect((await openPicker(wrapper, 'placement-dialog-swap-target')).text()).toContain('Front 2');
  });

  it('finds a partner by their table, its code or its section (E38/F08/S03)', async () => {
    const wrapper = dialog({
      ...occupied,
      vendors: [
        applicant('nadia@ember.test'),
        applicant('lee@ember.test'),
        applicant('sam@ember.test'),
      ],
      swapTargets: [
        {
          email: 'lee@ember.test',
          tableCode: 'Front 2',
          section: 'Front',
          tier: 'Gold',
          seat: FULL_TABLE,
        },
        {
          email: 'sam@ember.test',
          tableCode: 'Back 1',
          section: 'Back',
          tier: 'Gold',
          seat: FULL_TABLE,
        },
      ],
    });
    const field = wrapper.get('[data-testid="placement-dialog-swap-target-input"]');

    await field.setValue('back 1');
    const list = wrapper.get('[data-testid="placement-dialog-swap-target-list"]');
    expect(offered(list)).toEqual(['sam@ember.test']);
    await field.setValue('front');
    expect(offered(list)).toEqual(['lee@ember.test']);

    await field.trigger('keydown', { key: 'Enter' });
    expect(
      wrapper.get('[data-testid="placement-dialog-swap"]').attributes('disabled'),
    ).toBeUndefined();
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
        {
          email: 'lee@ember.test',
          tableCode: 'Back 2',
          section: 'Back',
          tier: 'Bronze',
          seat: HALF_TABLE_LEFT,
        },
      ],
    });

    await choose(wrapper, 'placement-dialog-swap-target', 'lee@ember.test');

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

    await choose(wrapper, 'placement-dialog-swap-target', 'lee@ember.test');

    expect(wrapper.find('[data-testid="placement-dialog-swap-warning"]').exists()).toBe(false);
  });
});
