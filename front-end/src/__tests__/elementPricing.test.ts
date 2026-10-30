/**
 * The Pricing card on Market Setup (E43/F01/S01): a price per tier for a full table on one market
 * day, what a half table costs, and the market's currency.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import ElementPricing from '@/components/elements/ElementPricing.vue';
import type { PricingObject, SetupObject } from '@/assets/types/datatypes';

function plan(pricing?: PricingObject | null, tiers = ['Gold', 'Silver']): SetupObject {
  return {
    priority: [],
    marketDates: [],
    tiers: tiers.map((name, id) => ({ id, name })),
    locations: [],
    sections: [],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
    pricing,
  };
}

function card(setupObject: SetupObject) {
  return mount(ElementPricing, { props: { setupObject }, attachTo: document.body });
}

function lastPricing(wrapper: ReturnType<typeof card>): PricingObject | null | undefined {
  const emitted = wrapper.emitted('update:setupObject') as SetupObject[][] | undefined;
  return emitted?.at(-1)?.[0].pricing;
}

describe('the card', () => {
  it('has a column per tier and one row, Everyone else', () => {
    const wrapper = card(plan());

    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toEqual(['Who', 'Gold', 'Silver']);
    expect(wrapper.get('tbody th').text()).toBe('Everyone else');
  });

  it('starts unpriced, in Canadian dollars, half off', () => {
    const wrapper = card(plan(null));

    expect((wrapper.get('[data-testid="pricing-price-0"]').element as HTMLInputElement).value).toBe(
      '',
    );
    expect(
      (wrapper.get('[data-testid="pricing-half-percent"]').element as HTMLInputElement).value,
    ).toBe('50');
    expect(
      (wrapper.get('[data-testid="pricing-currency"]').element as HTMLSelectElement).value,
    ).toBe('CAD');
  });

  it('names each cell by its row and its tier', () => {
    const wrapper = card(plan());

    const cell = wrapper.get('[data-testid="pricing-price-1"]');
    const ids = cell.attributes('aria-labelledby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent?.trim())).toEqual([
      'Everyone else',
      'Silver',
    ]);
  });

  it('says to add a tier when the plan has none', () => {
    const wrapper = card(plan(null, []));

    expect(wrapper.find('[data-testid="pricing-no-tiers"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pricing-table"]').exists()).toBe(false);
  });
});

describe('typing a price', () => {
  it('writes it in cents, in the tiers order', async () => {
    const wrapper = card(plan(null));

    await wrapper.get('[data-testid="pricing-price-1"]').setValue('30');
    await wrapper.setProps({ setupObject: plan(lastPricing(wrapper)) });
    await wrapper.get('[data-testid="pricing-price-0"]').setValue('35.50');

    expect(lastPricing(wrapper)).toEqual({
      currency: 'CAD',
      halfTablePercent: 50,
      everyoneElse: [
        { tier: 'Gold', cents: 3550 },
        { tier: 'Silver', cents: 3000 },
      ],
    });
  });

  it('a cleared cell is no price', async () => {
    const wrapper = card(
      plan({
        currency: 'CAD',
        halfTablePercent: 50,
        everyoneElse: [{ tier: 'Gold', cents: 3500 }],
      }),
    );

    await wrapper.get('[data-testid="pricing-price-0"]').setValue('');

    expect(lastPricing(wrapper)?.everyoneElse).toEqual([]);
  });

  it('text that is not an amount is kept, flagged, and not written', async () => {
    const wrapper = card(plan(null));

    await wrapper.get('[data-testid="pricing-price-0"]').setValue('35.5x');

    expect(wrapper.emitted('update:setupObject')).toBeUndefined();
    expect(wrapper.get('[data-testid="pricing-price-0"]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('[data-testid="pricing-error"]').text()).toContain('35.50');
  });
});

describe('the rest of the card', () => {
  it('a half table share from 0 to 100 is written', async () => {
    const wrapper = card(plan(null));

    await wrapper.get('[data-testid="pricing-half-percent"]').setValue('60');

    expect(lastPricing(wrapper)?.halfTablePercent).toBe(60);
  });

  it('a share past 100 is not', async () => {
    const wrapper = card(plan(null));

    await wrapper.get('[data-testid="pricing-half-percent"]').setValue('150');

    expect(wrapper.emitted('update:setupObject')).toBeUndefined();
  });

  it('the currency is the market one', async () => {
    const wrapper = card(plan(null));

    await wrapper.get('[data-testid="pricing-currency"]').setValue('USD');

    expect(lastPricing(wrapper)?.currency).toBe('USD');
  });
});

describe('a tier changing in Tier Setup', () => {
  it('a renamed tier keeps its price', async () => {
    const setupObject = plan({
      currency: 'CAD',
      halfTablePercent: 50,
      everyoneElse: [{ tier: 'Gold', cents: 3500 }],
    });
    const wrapper = card(setupObject);

    setupObject.tiers[0].name = 'Golden';
    await wrapper.setProps({ setupObject: { ...setupObject, tiers: [...setupObject.tiers] } });

    expect(lastPricing(wrapper)?.everyoneElse).toEqual([{ tier: 'Golden', cents: 3500 }]);
  });
});

/**
 * The card as Market Setup holds it: every write comes straight back as the prop, as the plan's
 * working copy does, so a field is redrawn between keystrokes exactly as on the page.
 */
function heldCard(setupObject: SetupObject) {
  const held: boolean[] = [];
  const kept = ref(setupObject);
  const host = defineComponent({
    setup() {
      return () =>
        h(ElementPricing, {
          setupObject: kept.value,
          'onUpdate:setupObject': (value: SetupObject) => (kept.value = value),
          onHeld: (value: boolean) => held.push(value),
        });
    },
  });
  const wrapper = mount(host, { attachTo: document.body });
  /** What Tier Setup does: the same plan with these tier names, in this order. */
  const renameTiers = async (names: string[]) => {
    kept.value = { ...kept.value, tiers: names.map((name, id) => ({ id, name })) };
    await nextTick();
  };
  return Object.assign(wrapper, { kept: () => kept.value.pricing, held, renameTiers });
}

async function typeKeys(input: ReturnType<ReturnType<typeof mount>['get']>, text: string) {
  const element = input.element as HTMLInputElement;
  await input.trigger('focus');
  for (let at = 1; at <= text.length; at += 1) {
    element.value = text.slice(0, at);
    await input.trigger('input');
  }
}

describe('typing key by key (review finding 1)', () => {
  it.each([
    ['12.05', 1205],
    ['30.01', 3001],
    ['35.5', 3550],
  ])('%s is kept as %d cents and shown as typed', async (text, cents) => {
    const wrapper = heldCard(plan(null));
    const cell = wrapper.get('[data-testid="pricing-price-0"]');

    await typeKeys(cell, text);

    expect(wrapper.kept()?.everyoneElse).toEqual([{ tier: 'Gold', cents }]);
    expect((cell.element as HTMLInputElement).value).toBe(text);
  });

  it('leaving the cell redraws it from the cents', async () => {
    const wrapper = heldCard(plan(null));
    const cell = wrapper.get('[data-testid="pricing-price-0"]');

    await typeKeys(cell, '35.5');
    await cell.trigger('blur');

    expect((cell.element as HTMLInputElement).value).toBe('35.50');
  });
});

describe('text that ends as no value keeps the value from before (review note 2)', () => {
  it('a share typed past 100 keeps the share it had, and holds the plan', async () => {
    const wrapper = heldCard(plan(null));
    const share = wrapper.get('[data-testid="pricing-half-percent"]');

    await share.setValue('');
    await typeKeys(share, '150');

    expect(wrapper.kept()?.halfTablePercent).toBe(50);
    expect((share.element as HTMLInputElement).value).toBe('150');
    expect(wrapper.get('[data-testid="pricing-share-error"]').exists()).toBe(true);
    expect(wrapper.held.at(-1)).toBe(true);

    await share.setValue('60');
    expect(wrapper.kept()?.halfTablePercent).toBe(60);
    expect(wrapper.held.at(-1)).toBe(false);
  });

  it.each([
    ['a priced cell', [{ tier: 'Gold', cents: 3500 }]],
    ['a blank cell (rereview finding 8)', []],
  ])('a price that turns into no amount in %s keeps the price from before', async (_, before) => {
    const wrapper = heldCard(plan({ currency: 'CAD', halfTablePercent: 50, everyoneElse: before }));
    const cell = wrapper.get('[data-testid="pricing-price-0"]');

    await cell.trigger('focus');
    await typeKeys(cell, '3');
    await typeKeys(cell, '3x');

    expect(wrapper.kept()?.everyoneElse).toEqual(before);
    expect(wrapper.held.at(-1)).toBe(true);
    await cell.trigger('blur');
    expect((cell.element as HTMLInputElement).value).toBe('3x');
  });
});

describe('text that is no value, when Tier Setup changes the tiers (rereview finding 9)', () => {
  const priced: PricingObject = {
    currency: 'CAD',
    halfTablePercent: 50,
    everyoneElse: [{ tier: 'Silver', cents: 3000 }],
  };

  it('moves with its tier when the tier is renamed', async () => {
    const wrapper = heldCard(plan(priced));
    await typeKeys(wrapper.get('[data-testid="pricing-price-1"]'), '30x');

    await wrapper.renameTiers(['Gold', 'Silvery']);

    const cell = wrapper.get('[data-testid="pricing-price-1"]');
    expect((cell.element as HTMLInputElement).value).toBe('30x');
    expect(cell.attributes('aria-invalid')).toBe('true');
    expect(wrapper.held.at(-1)).toBe(true);

    await cell.setValue('31');
    expect(wrapper.kept()?.everyoneElse).toEqual([{ tier: 'Silvery', cents: 3100 }]);
    expect(wrapper.find('[data-testid="pricing-error"]').exists()).toBe(false);
    expect(wrapper.held.at(-1)).toBe(false);
  });

  it('goes with its tier when the tier is removed', async () => {
    const wrapper = heldCard(plan(priced));
    await typeKeys(wrapper.get('[data-testid="pricing-price-1"]'), '30x');

    await wrapper.renameTiers(['Gold']);

    expect(wrapper.find('[data-testid="pricing-error"]').exists()).toBe(false);
    expect(wrapper.held.at(-1)).toBe(false);
  });

  it("the share's goes when the last tier is removed", async () => {
    const wrapper = heldCard(plan(priced));
    const share = wrapper.get('[data-testid="pricing-half-percent"]');
    await share.setValue('');
    await typeKeys(share, '150');

    await wrapper.renameTiers([]);

    expect(wrapper.find('[data-testid="pricing-share-error"]').exists()).toBe(false);
    expect(wrapper.held.at(-1)).toBe(false);
    expect(wrapper.kept()?.halfTablePercent).toBe(50);
  });
});

describe('a plan with no tiers', () => {
  it('offers no share or currency until there is a tier (review note 4)', () => {
    const wrapper = card(plan(null, []));

    expect(wrapper.find('[data-testid="pricing-half-percent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pricing-currency"]').exists()).toBe(false);
  });
});
