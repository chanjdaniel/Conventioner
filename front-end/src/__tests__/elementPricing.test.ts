/**
 * The Pricing card on Market Setup (E43/F01/S01): a price per tier for a full table on one market
 * day, what a half table costs, and the market's currency.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
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
