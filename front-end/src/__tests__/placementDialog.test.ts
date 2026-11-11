/**
 * The dialog that changes one placement.
 *
 * Three changes and never a fourth (`E11/F03/S01`, T208): a seat is filled, from nobody or from
 * another table; two vendors trade seats; a seat is freed. Nothing here displaces an occupant,
 * because that is how a vendor is silently unassigned on market day.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PlacementDialog from '@/components/PlacementDialog.vue';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  type EmptySeat,
  type PlaceableVendor,
  type SeatedVendor,
} from '@/utils/placementChange';

const DATE = '2026-08-01';

function applicant(email: string, overrides: Partial<PlaceableVendor> = {}): PlaceableVendor {
  return {
    email,
    tableChoice: 'full',
    availableDates: [DATE],
    acceptedTiersByDate: {},
    maxDates: null,
    notApproved: null,
    inTheRun: true,
    addedByHand: false,
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
      seated: [],
      emptySeats: [],
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

/** The occupant of the seat the occupied cases open, as the page lists everyone seated. */
const NADIA_AT_FRONT_1: SeatedVendor = {
  email: 'nadia@ember.test',
  tableCode: 'Front 1',
  section: 'Front',
  tier: 'Gold',
  seat: FULL_TABLE,
};

describe('a seat somebody holds', () => {
  const occupied = {
    mode: 'occupied',
    seat: FULL_TABLE,
    occupantEmail: 'nadia@ember.test',
    vendors: [applicant('nadia@ember.test'), applicant('lee@ember.test')],
    seated: [
      NADIA_AT_FRONT_1,
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
    const wrapper = dialog({ ...occupied, deduction: { amount: '$15.00', name: 'Nadia Ember' } });

    const box = wrapper.get<HTMLInputElement>('[data-testid="placement-dialog-deduct"]');
    expect(box.element.checked).toBe(false);
    expect(wrapper.text()).toContain(
      'Also remove its $15.00 from what Nadia Ember owes? (Cancelled before the deadline: a refund may be due.)',
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
      seated: [
        NADIA_AT_FRONT_1,
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
    const wrapper = dialog({ ...occupied, seated: [NADIA_AT_FRONT_1] });

    expect(wrapper.text()).toContain('nobody to trade with');
  });

  it('warns for each vendor what the seat they move into overrides (bug 18)', async () => {
    const wrapper = dialog({
      ...occupied,
      vendors: [
        applicant('nadia@ember.test', { acceptedTiersByDate: { [DATE]: ['Gold'] } }),
        applicant('lee@ember.test', { tableChoice: 'half' }),
      ],
      seated: [
        NADIA_AT_FRONT_1,
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

describe('moving the vendor of a taken seat to an empty one (T208)', () => {
  const empty = (overrides: Partial<EmptySeat>): EmptySeat => ({
    tableCode: 'Back 1',
    section: 'Back',
    location: 'Courtyard',
    tier: 'Silver',
    seat: null,
    ...overrides,
  });

  const taken = {
    mode: 'occupied',
    seat: FULL_TABLE,
    occupantEmail: 'nadia@ember.test',
    vendors: [applicant('nadia@ember.test'), applicant('lee@ember.test')],
    seated: [
      NADIA_AT_FRONT_1,
      {
        email: 'lee@ember.test',
        tableCode: 'Front 2',
        section: 'Front',
        tier: 'Gold',
        seat: FULL_TABLE,
      },
    ],
    emptySeats: [
      empty({ tableCode: 'Front 3', section: 'Front', location: 'Main hall', tier: 'Gold' }),
      empty({ tableCode: 'Back 1', seat: HALF_TABLE_RIGHT }),
      empty({ tableCode: 'Back 2' }),
    ],
  };

  const action = (wrapper: Dialog, which: 'move' | 'swap') =>
    wrapper.get<HTMLInputElement>(`[data-testid="placement-dialog-action-${which}"]`);

  it('asks what to do with them, and starts at a move when the day has an empty seat', () => {
    const wrapper = dialog(taken);

    expect(wrapper.get('fieldset').text()).toContain('What to do with them');
    expect(action(wrapper, 'move').element.checked).toBe(true);
    expect(action(wrapper, 'swap').element.checked).toBe(false);
    expect(wrapper.find('[data-testid="placement-dialog-move-target"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="placement-dialog-swap-target"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="placement-dialog-move"]').text()).toBe('Move them');
    expect(wrapper.find('[data-testid="placement-dialog-swap"]').exists()).toBe(false);
  });

  it('starts at a swap when every table is taken, and says there is nowhere to move them', async () => {
    const wrapper = dialog({ ...taken, emptySeats: [] });

    expect(action(wrapper, 'swap').element.checked).toBe(true);
    expect(wrapper.find('[data-testid="placement-dialog-swap-target"]').exists()).toBe(true);

    await action(wrapper, 'move').setValue(true);
    expect(wrapper.text()).toContain(
      'Every table is taken on this date, so there is nowhere empty to move them.',
    );
  });

  it("forgets the other action's choice when the action changes", async () => {
    const wrapper = dialog(taken);
    await choose(wrapper, 'placement-dialog-move-target', 'Back 2');
    expect(
      wrapper.get('[data-testid="placement-dialog-move"]').attributes('disabled'),
    ).toBeUndefined();

    await action(wrapper, 'swap').setValue(true);
    await choose(wrapper, 'placement-dialog-swap-target', 'lee@ember.test');
    await action(wrapper, 'move').setValue(true);

    expect(
      wrapper.get('[data-testid="placement-dialog-move"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="placement-dialog-move-target-input"]').element
        .value,
    ).toBe('');
    await action(wrapper, 'swap').setValue(true);
    expect(
      wrapper.get('[data-testid="placement-dialog-swap"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('groups the empty seats by section, headed with its tier, each naming its free part', async () => {
    const wrapper = dialog({
      ...taken,
      emptySeats: [...taken.emptySeats, empty({ tableCode: 'Yard 1', section: 'Yard', tier: '' })],
    });
    const list = await openPicker(wrapper, 'placement-dialog-move-target');

    expect(offered(list)).toEqual(['Front 3', 'Back 1', 'Back 2', 'Yard 1']);
    const headings = list.findAll('.search-picker-group-label').map((heading) => heading.text());
    expect(headings).toEqual(['Front, Gold', 'Back, Silver', 'Yard']);
    const options = list.findAll('[role="option"]').map((option) => option.text());
    expect(options[0]).toContain('The whole table');
    expect(options[1]).toContain('The right half');
  });

  it('finds an empty seat by its code, its section, its location or its tier', async () => {
    const wrapper = dialog(taken);
    const field = wrapper.get('[data-testid="placement-dialog-move-target-input"]');

    await field.setValue('back 2');
    const list = wrapper.get('[data-testid="placement-dialog-move-target-list"]');
    expect(offered(list)).toEqual(['Back 2']);
    await field.setValue('FRONT');
    expect(offered(list)).toEqual(['Front 3']);
    await field.setValue('courtyard');
    expect(offered(list)).toEqual(['Back 1', 'Back 2']);
    await field.setValue('silver');
    expect(offered(list)).toEqual(['Back 1', 'Back 2']);
    expect(list.text()).toContain('None match "silver".');
  });

  it('says nothing matches, not nobody, of the empty seats of one section', async () => {
    const wrapper = dialog({ ...taken, emptySeats: [empty({ tableCode: 'Back 2' })] });

    await wrapper.get('[data-testid="placement-dialog-move-target-input"]').setValue('zzz');

    expect(wrapper.get('[data-testid="placement-dialog-move-target-none"]').text()).toBe(
      'Nothing matches "zzz".',
    );
  });

  it('offers which seat at a wholly free table, starting at the shape they hold now', async () => {
    const wrapper = dialog({ ...taken, seat: HALF_TABLE_RIGHT });
    await choose(wrapper, 'placement-dialog-move-target', 'Back 2');

    const left = wrapper.get<HTMLInputElement>(
      `[data-testid="placement-dialog-seat-${HALF_TABLE_LEFT}"]`,
    );
    expect(left.element.checked).toBe(true);
    expect(wrapper.find('[data-testid="placement-dialog-fixed-seat"]').exists()).toBe(false);

    const whole = dialog(taken);
    await choose(whole, 'placement-dialog-move-target', 'Back 2');
    expect(
      whole.get<HTMLInputElement>(`[data-testid="placement-dialog-seat-${FULL_TABLE}"]`).element
        .checked,
    ).toBe(true);
  });

  it('states the free side of a half-taken table rather than offering one', async () => {
    const wrapper = dialog(taken);
    await choose(wrapper, 'placement-dialog-move-target', 'Back 1');

    expect(wrapper.get('[data-testid="placement-dialog-fixed-seat"]').text()).toBe(
      'The right half - the other side is taken.',
    );
    expect(wrapper.find(`[data-testid="placement-dialog-seat-${FULL_TABLE}"]`).exists()).toBe(
      false,
    );
  });

  it("warns about the new seat's tier and size, and never its date or a ceiling", async () => {
    const wrapper = dialog({
      ...taken,
      vendors: [
        applicant('nadia@ember.test', { acceptedTiersByDate: { [DATE]: ['Gold'] }, maxDates: 1 }),
      ],
      datesHeld: { 'nadia@ember.test': [DATE, '2026-08-02'] },
      marketCeiling: 1,
    });
    await choose(wrapper, 'placement-dialog-move-target', 'Back 1');

    const warning = wrapper.get('[data-testid="placement-dialog-move-warning"]').text();
    expect(warning).toContain('They did not accept the Silver tier on this date');
    expect(warning).toContain('They asked for a whole table. This gives them half of one.');
    expect(warning).not.toContain('at most');
    expect(warning).not.toContain('available on this date');
  });

  it('says nothing about a move that overrides nobody', async () => {
    const wrapper = dialog(taken);
    await choose(wrapper, 'placement-dialog-move-target', 'Front 3');

    expect(wrapper.find('[data-testid="placement-dialog-move-warning"]').exists()).toBe(false);
  });

  it('cannot move them until a seat is chosen, by its button or by Enter', async () => {
    const wrapper = dialog(taken);
    const move = wrapper.get('[data-testid="placement-dialog-move"]');

    expect(move.attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('move')).toBeUndefined();

    await choose(wrapper, 'placement-dialog-move-target', 'Back 1');
    expect(move.attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('move')).toEqual([[{ tableCode: 'Back 1', seat: HALF_TABLE_RIGHT }]]);
    expect(wrapper.emitted('free')).toBeUndefined();
    expect(wrapper.emitted('swap')).toBeUndefined();
  });

  it('moves them into the seat chosen at a wholly free table', async () => {
    const wrapper = dialog(taken);
    await choose(wrapper, 'placement-dialog-move-target', 'Back 2');
    await wrapper.get(`[data-testid="placement-dialog-seat-${HALF_TABLE_RIGHT}"]`).setValue(true);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('move')).toEqual([[{ tableCode: 'Back 2', seat: HALF_TABLE_RIGHT }]]);
  });

  it('still swaps behind "Swap with someone seated", and Enter swaps there', async () => {
    const wrapper = dialog(taken);
    await action(wrapper, 'swap').setValue(true);

    expect(wrapper.find('[data-testid="placement-dialog-move-target"]').exists()).toBe(false);
    await choose(wrapper, 'placement-dialog-swap-target', 'lee@ember.test');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('swap')).toEqual([['lee@ember.test']]);
    expect(wrapper.emitted('move')).toBeUndefined();
  });

  it('never offers the occupant as their own swap partner', async () => {
    const wrapper = dialog({ ...taken, emptySeats: [] });

    expect(offered(await openPicker(wrapper, 'placement-dialog-swap-target'))).toEqual([
      'lee@ember.test',
    ]);
  });

  it('keeps "Free this seat" a separate button that Enter never reaches', () => {
    const wrapper = dialog(taken);
    const free = wrapper.get('[data-testid="placement-dialog-free"]');

    expect(free.attributes('type')).toBe('button');
    expect(free.text()).toBe('Free this seat');
    expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
  });
});

describe('moving someone seated elsewhere into an empty seat (T208)', () => {
  const lee: SeatedVendor = {
    email: 'lee@ember.test',
    tableCode: 'Back 2',
    section: 'Back',
    tier: 'Silver',
    seat: HALF_TABLE_LEFT,
  };
  const sam: SeatedVendor = {
    email: 'sam@ember.test',
    tableCode: 'Front 1',
    section: 'Front',
    tier: 'Gold',
    seat: HALF_TABLE_LEFT,
  };

  /** Front 1's right half is free; Lee sits at Back 2 and Sam at Front 1's other half. */
  const elsewhere = {
    mode: 'place',
    vendors: [
      applicant('nadia@ember.test'),
      applicant('lee@ember.test', {
        tableChoice: 'half',
        acceptedTiersByDate: { [DATE]: ['Silver'] },
      }),
      applicant('sam@ember.test'),
    ],
    datesHeld: { 'lee@ember.test': [DATE], 'sam@ember.test': [DATE] },
    seated: [sam, lee],
    vendorNames: { 'nadia@ember.test': 'Nadia Ember', 'lee@ember.test': 'Lee Park' },
    vendorSearch: {
      'nadia@ember.test': ['Nadia Ember', 'Ember Candles'],
      'lee@ember.test': ['Lee Park', 'Park Pottery'],
    },
  };

  const primary = (wrapper: Dialog) => wrapper.get('[data-testid="placement-dialog-confirm"]');

  it('ends "Who sits here" with everyone seated at another table, each naming the table they leave', async () => {
    const wrapper = dialog(elsewhere);
    await openPicker(wrapper, 'placement-dialog-vendor');

    const group = wrapper.get('[data-testid="placement-dialog-seated-elsewhere"]');
    expect(group.text()).toContain('Seated elsewhere today (moves them)');
    expect(offered(group)).toEqual(['lee@ember.test']);
    expect(group.text()).toContain('Lee Park (lee@ember.test)');
    expect(group.text()).toContain('Leaves Back 2, left half');
    // The four groups before it still hold only those with no seat that day.
    expect(wrapper.get('[data-testid="placement-dialog-fits"]').text()).toContain('Nadia Ember');
    const groups = wrapper.findAll('[role="group"]');
    expect(groups.at(-1)!.attributes('data-testid')).toBe('placement-dialog-seated-elsewhere');
  });

  it('offers anyone seated, an applicant or not', async () => {
    const wrapper = dialog({
      ...elsewhere,
      seated: [sam, lee, { ...lee, email: 'kim@ember.test' }],
    });
    await openPicker(wrapper, 'placement-dialog-vendor');

    expect(offered(wrapper.get('[data-testid="placement-dialog-seated-elsewhere"]'))).toEqual([
      'lee@ember.test',
      'kim@ember.test',
    ]);
  });

  it('finds them by name, business, address, or their table by its code or its section', async () => {
    const wrapper = dialog(elsewhere);
    const field = wrapper.get('[data-testid="placement-dialog-vendor-input"]');
    const list = () => wrapper.get('[data-testid="placement-dialog-vendor-list"]');

    for (const words of ['Lee Park', 'pottery', 'lee@ember.test', 'Back 2', 'back']) {
      await field.setValue(words);
      expect(offered(list()), words).toEqual(['lee@ember.test']);
    }
  });

  it('warns as a move, about the tier and the size only, and reads "Move them here"', async () => {
    const wrapper = dialog({
      ...elsewhere,
      // A date they never offered, and a ceiling crossed, are not a move's to say.
      vendors: [
        applicant('lee@ember.test', {
          tableChoice: 'half',
          availableDates: [DATE],
          acceptedTiersByDate: { [DATE]: ['Silver'] },
          maxDates: 1,
        }),
      ],
      datesHeld: { 'lee@ember.test': [DATE, '2026-08-02'] },
      marketCeiling: 1,
    });
    expect(primary(wrapper).text()).toBe('Assign them here');

    await choose(wrapper, 'placement-dialog-vendor', 'Lee Park');

    expect(primary(wrapper).text()).toBe('Move them here');
    const warning = () => wrapper.get('[data-testid="placement-dialog-warning"]').text();
    expect(warning()).toContain('did not accept the Gold tier');
    expect(warning()).not.toContain('at most');
    expect(warning()).not.toContain('share a table');

    // They hold a half, so the move starts at one; the whole table is the size they did not ask for.
    await wrapper.get(`[data-testid="placement-dialog-seat-${FULL_TABLE}"]`).setValue(true);
    expect(warning()).toContain('They asked to share a table. This gives them a whole one.');
    expect(warning()).not.toContain('at most');
  });

  it('starts "Which seat" at the shape they hold, at a wholly free table', async () => {
    const wrapper = dialog(elsewhere);
    await choose(wrapper, 'placement-dialog-vendor', 'Lee Park');

    const left = wrapper.get<HTMLInputElement>(
      `[data-testid="placement-dialog-seat-${HALF_TABLE_LEFT}"]`,
    );
    expect(left.element.checked).toBe(true);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('place')).toEqual([
      [{ email: 'lee@ember.test', seat: HALF_TABLE_LEFT }],
    ]);
  });

  it('keeps the free side of a half-taken table, and moves them there', async () => {
    const wrapper = dialog({ ...elsewhere, seat: HALF_TABLE_RIGHT });
    await choose(wrapper, 'placement-dialog-vendor', 'Lee Park');

    expect(wrapper.get('[data-testid="placement-dialog-fixed-seat"]').text()).toContain(
      'The right half',
    );
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('place')).toEqual([
      [{ email: 'lee@ember.test', seat: HALF_TABLE_RIGHT }],
    ]);
  });

  it('reads "Assign them here" and warns as today for anyone else chosen', async () => {
    const wrapper = dialog(elsewhere);
    await choose(wrapper, 'placement-dialog-vendor', 'Lee Park');
    await choose(wrapper, 'placement-dialog-vendor', 'Nadia');

    expect(primary(wrapper).text()).toBe('Assign them here');
    const whole = wrapper.get<HTMLInputElement>(
      `[data-testid="placement-dialog-seat-${FULL_TABLE}"]`,
    );
    expect(whole.element.checked).toBe(true);
    expect(wrapper.find('[data-testid="placement-dialog-warning"]').exists()).toBe(false);
  });

  it('says choosing someone moves them when nobody is left without a table', () => {
    const wrapper = dialog({ ...elsewhere, vendors: [applicant('lee@ember.test')] });

    expect(wrapper.text()).toContain(
      'Every vendor who applied already has a table on this date. Choosing one moves them here.',
    );
  });

  it('says only that every vendor has a table when nobody sits elsewhere either', () => {
    const wrapper = dialog({ ...elsewhere, vendors: [applicant('sam@ember.test')], seated: [sam] });

    expect(wrapper.text()).toContain('Every vendor who applied already has a table on this date.');
    expect(wrapper.text()).not.toContain('Choosing one moves them here.');
    expect(wrapper.find('[data-testid="placement-dialog-seated-elsewhere"]').exists()).toBe(false);
  });
});
