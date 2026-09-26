import { describe, expect, it } from 'vitest';
import { planGateReason, planOffersSomething } from '@/utils/planGate';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

const plan = (over: Partial<typeof EMPTY_ESSENTIAL_OPTIONS>) => ({
  ...EMPTY_ESSENTIAL_OPTIONS,
  ...over,
});

describe('the form section is gated on the plan offering something', () => {
  it('refuses a plan that offers nothing, and says what is missing', () => {
    const reason = planGateReason(plan({}));
    expect(planOffersSomething(plan({}))).toBe(false);
    expect(reason).toMatch(/dates/);
    expect(reason).toMatch(/tiers/);
  });

  it('opens once the plan offers a date, which is the guard’s own bar', () => {
    // `FormHasFieldsGuard` lets a market with a date on the plan and no custom fields through:
    // the essential questions ARE a form. This has to agree with it, or a market could pass the
    // guard and still be told here that it cannot.
    const withDates = plan({ dates: ['2026-11-17'] });
    expect(planOffersSomething(withDates)).toBe(true);
    expect(planGateReason(withDates)).toBeNull();
  });

  it('does not count custom fields, because it is not asking about the form', () => {
    // A form is its custom fields PLUS the essential questions the plan asks. Counting custom
    // fields here is the disagreement that let a market open applications and then refuse every
    // application it received.
    expect(planOffersSomething(plan({}))).toBe(false);
  });

  it('names dates, tiers and sections rather than naming the rule', () => {
    expect(planGateReason(plan({}))).not.toMatch(/essential|guard|precondition/i);
  });
});
