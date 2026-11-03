/**
 * Record a payment's amount and Change the amount owed's (T203): each reads as currency once left
 * and gives the plain number while focused, as a Pricing card cell does, and takes "35", "$35" or
 * the app's own text pasted back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import RecordPaymentDialog from '@/components/RecordPaymentDialog.vue';
import ChangeOwedDialog from '@/components/ChangeOwedDialog.vue';
import type { Payment, PaymentLine, VendorAccount } from '@/utils/payments';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const ANSWER: VendorAccount = {
  currency: 'CAD',
  lines: [],
  payments: [],
  owedCents: 0,
  paidCents: 0,
};

const PAYMENT: Payment = {
  id: 'p1',
  kind: 'payment',
  cents: 123450,
  method: 'cash',
  paidOn: '2099-04-01',
  note: '',
  recordedBy: 'editor@example.com',
  recordedAt: '2099-04-01T18:00:00+00:00',
  editedBy: null,
  editedAt: null,
  removedBy: null,
  removedAt: null,
};

const LINE: PaymentLine = {
  date: '2099-05-08',
  tableCode: 'North Wing 1',
  tier: 'Gold',
  tableChoice: 'Full Table',
  priceCents: 3500,
  owedCents: 3500,
  owedSetBy: null,
  owedSetAt: null,
  freed: false,
  freedAt: null,
  freedBy: null,
};

let mounted: VueWrapper | null = null;

async function opened<T extends VueWrapper>(wrapper: T): Promise<T> {
  mounted = wrapper;
  await flushPromises();
  return wrapper;
}

function recordDialog(props: Record<string, unknown> = {}) {
  return opened(
    mount(RecordPaymentDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        email: 'ana@example.com',
        currency: 'CAD',
        ...props,
      },
      attachTo: document.body,
    }),
  );
}

function owedDialog(props: Record<string, unknown> = {}) {
  return opened(
    mount(ChangeOwedDialog, {
      props: {
        open: true,
        marketId: 'market-1',
        email: 'ana@example.com',
        line: LINE,
        currency: 'CAD',
        ...props,
      },
      attachTo: document.body,
    }),
  );
}

const field = (testid: string) =>
  document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;

/** Types `text` as a person does: the field already focused, then an input with each change. */
async function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await nextTick();
}

async function leave(input: HTMLInputElement) {
  input.blur();
  await nextTick();
}

async function focus(input: HTMLInputElement) {
  input.focus();
  await nextTick();
}

describe('Record a payment’s amount', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.put.mockReset();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('opens blank and focused, and keeps its label’s currency code', async () => {
    const wrapper = await recordDialog();
    const amount = field('record-payment-amount');

    expect(document.activeElement).toBe(amount);
    expect(amount.value).toBe('');
    expect(wrapper.text()).toContain('Amount (CAD)');
  });

  it.each([
    ['35', 3500, '$35.00', '35.00'],
    ['35.5', 3550, '$35.50', '35.50'],
    ['$35', 3500, '$35.00', '35.00'],
    ['$1,234.50', 123450, '$1,234.50', '1234.50'],
  ])(
    '%s, typed, stays as typed; it records %d cents and reads %s once left',
    async (text, cents, left, refocused) => {
      const wrapper = await recordDialog();
      const amount = field('record-payment-amount');
      api.post.mockResolvedValue({ data: ANSWER });

      await type(amount, text);
      expect(amount.value).toBe(text);
      await leave(amount);
      expect(amount.value).toBe(left);

      await focus(amount);
      expect(amount.value).toBe(refocused);
      expect([amount.selectionStart, amount.selectionEnd]).toEqual([
        refocused.length,
        refocused.length,
      ]);

      await wrapper.get('[data-testid="record-payment-submit-button"]').trigger('click');
      await flushPromises();
      expect(api.post).toHaveBeenCalledWith(
        '/markets/market-1/payments/ana%40example.com',
        expect.objectContaining({ cents }),
      );
    },
  );

  it('reads in the market’s currency, and in Canadian dollars where the market names none', async () => {
    await recordDialog({ currency: 'USD' });
    let amount = field('record-payment-amount');
    await type(amount, '35');
    await leave(amount);
    expect(amount.value).toBe('US$35.00');
    mounted?.unmount();

    const wrapper = await recordDialog({ currency: null });
    amount = field('record-payment-amount');
    await type(amount, '35');
    await leave(amount);
    expect(amount.value).toBe('$35.00');
    expect(wrapper.text()).toContain('Amount');
    expect(wrapper.text()).not.toContain('Amount (');
  });

  it('text that is no amount keeps its text and its error, and Record stays disabled', async () => {
    const wrapper = await recordDialog();
    const amount = field('record-payment-amount');

    await type(amount, '3x');
    await leave(amount);
    expect(amount.value).toBe('3x');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(wrapper.get('[data-testid="record-payment-amount-error"]').text()).toBe(
      'Type an amount, such as 35 or 35.50.',
    );
    expect(
      wrapper.get('[data-testid="record-payment-submit-button"]').attributes('disabled'),
    ).toBeDefined();

    await focus(amount);
    expect(amount.value).toBe('3x');
  });

  it('a field cleared and left stays blank', async () => {
    await recordDialog();
    const amount = field('record-payment-amount');

    await type(amount, '35');
    await leave(amount);
    await focus(amount);
    await type(amount, '');
    await leave(amount);
    expect(amount.value).toBe('');
  });

  it('editing an entry fills its amount, read as the plain number under the dialog’s focus', async () => {
    const wrapper = await recordDialog({ mode: 'edit', entry: PAYMENT });
    const amount = field('record-payment-amount');

    expect(document.activeElement).toBe(amount);
    expect(amount.value).toBe('1234.50');
    expect([amount.selectionStart, amount.selectionEnd]).toEqual([7, 7]);
    await leave(amount);
    expect(amount.value).toBe('$1,234.50');

    api.put.mockResolvedValue({ data: ANSWER });
    await wrapper.get('[data-testid="record-payment-submit-button"]').trigger('click');
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith(
      '/markets/market-1/payment-entries/p1',
      expect.objectContaining({ cents: 123450 }),
    );
  });

  it('editing a refund fills its amount without the minus, as currency once left', async () => {
    await recordDialog({ mode: 'edit', entry: { ...PAYMENT, kind: 'refund', cents: -1500 } });
    const amount = field('record-payment-amount');

    expect(amount.value).toBe('15.00');
    await leave(amount);
    expect(amount.value).toBe('$15.00');
  });

  it('an edit opened while the field is not focused reads as currency', async () => {
    const wrapper = await recordDialog({ open: false, mode: 'edit', entry: PAYMENT });
    await wrapper.setProps({ open: true });
    // The dialog's own focus comes after a tick; before it, the field reads its left form.
    expect(field('record-payment-amount').value).toBe('$1,234.50');
  });
});

describe('Change the amount owed', () => {
  beforeEach(() => {
    api.put.mockReset();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('fills the line’s amount owed, read as the plain number while focused', async () => {
    const wrapper = await owedDialog();
    const amount = field('change-owed-amount');

    expect(document.activeElement).toBe(amount);
    expect(amount.value).toBe('35.00');
    expect([amount.selectionStart, amount.selectionEnd]).toEqual([5, 5]);
    await leave(amount);
    expect(amount.value).toBe('$35.00');
    expect(wrapper.text()).toContain('Amount owed (CAD)');
  });

  it('fills $0.00 for a line with no amount owed', async () => {
    await owedDialog({ line: { ...LINE, priceCents: null, owedCents: null } });
    const amount = field('change-owed-amount');

    expect(amount.value).toBe('0.00');
    await leave(amount);
    expect(amount.value).toBe('$0.00');
  });

  it.each(['0', '$0', '0.00'])('%s sets $0.00 and says so', async (text) => {
    const wrapper = await owedDialog();
    const amount = field('change-owed-amount');
    api.put.mockResolvedValue({ data: ANSWER });

    await type(amount, text);
    expect(amount.value).toBe(text);
    expect(wrapper.get('[data-testid="change-owed-sentence"]').text()).toBe(
      'Friday, May 8, 2099 will owe $0.00 instead of $35.00.',
    );
    await leave(amount);
    expect(amount.value).toBe('$0.00');
    await focus(amount);
    expect(amount.value).toBe('0.00');

    await wrapper.get('[data-testid="change-owed-submit-button"]').trigger('click');
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith(
      '/markets/market-1/payments/ana%40example.com/owed/2099-05-08',
      { cents: 0 },
    );
  });

  it('takes the app’s own text pasted, in the market’s currency', async () => {
    const wrapper = await owedDialog({ currency: 'EUR' });
    const amount = field('change-owed-amount');

    expect(amount.value).toBe('35.00');
    await type(amount, '€1,234.50');
    await leave(amount);
    expect(amount.value).toBe('€1,234.50');
    expect(wrapper.get('[data-testid="change-owed-sentence"]').text()).toBe(
      'Friday, May 8, 2099 will owe €1,234.50 instead of €35.00.',
    );
  });

  it('text that is no amount keeps its text and its error', async () => {
    const wrapper = await owedDialog();
    const amount = field('change-owed-amount');

    await type(amount, '3x');
    await leave(amount);
    expect(amount.value).toBe('3x');
    expect(wrapper.get('[data-testid="change-owed-amount-error"]').text()).toBe(
      'Type an amount, such as 0, 35 or 35.50.',
    );
    await focus(amount);
    expect(amount.value).toBe('3x');
  });
});
