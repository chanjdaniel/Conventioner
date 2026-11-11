/**
 * A payment is recorded once per press of Record, however often it is pressed (T270).
 *
 * The dialog makes a request key as it opens to record, and sends that one key on every press of
 * the opening, so pressing Record again after an answer that never came records nothing new; a new
 * opening makes a new key, and an edit sends none. When the server refuses a press that differs
 * from the entry first recorded with the key, the refusal carries the account as it stands: the
 * dialog keeps its error shown, and the Payment tab behind it shows that entry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import RecordPaymentDialog from '@/components/RecordPaymentDialog.vue';
import VendorPaymentTab from '@/components/VendorPaymentTab.vue';
import type { Payment, VendorAccount } from '@/utils/payments';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const EMPTY: VendorAccount = {
  currency: 'CAD',
  lines: [],
  payments: [],
  owedCents: 0,
  paidCents: 0,
};

const ENTRY: Payment = {
  id: 'p1',
  kind: 'payment',
  cents: 3500,
  method: 'e-transfer',
  paidOn: '2099-04-01',
  note: '',
  recordedBy: 'editor@example.com',
  recordedAt: '2099-04-01T18:00:00+00:00',
  editedBy: null,
  editedAt: null,
  removedBy: null,
  removedAt: null,
};

const RECORDED: VendorAccount = { ...EMPTY, payments: [ENTRY], paidCents: 3500 };
const ALREADY =
  'This payment was already recorded, as it was first sent. Close this and edit it if it should read differently.';

/** A request that never got its answer, as axios rejects it. */
function lost() {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} });
}

/** The server's refusal of a press that differs from the entry its key recorded. */
function alreadyRecorded(account: VendorAccount) {
  return Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { error: ALREADY, account } },
  });
}

let mounted: VueWrapper | null = null;

function el<T extends HTMLElement>(testid: string): T {
  const found = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!found) throw new Error(`no ${testid}`);
  return found;
}

async function type(amount: string): Promise<void> {
  const input = el<HTMLInputElement>('record-payment-amount');
  input.value = amount;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

async function press(): Promise<void> {
  el<HTMLButtonElement>('record-payment-submit-button').click();
  await flushPromises();
}

async function dialog(props: Record<string, unknown> = {}) {
  mounted = mount(RecordPaymentDialog, {
    props: {
      open: true,
      marketId: 'market-1',
      email: 'ana@example.com',
      currency: 'CAD',
      mode: 'payment',
      ...props,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return mounted;
}

function sentKeys(calls: unknown[][]): unknown[] {
  return calls.map(([, body]) => (body as { requestKey?: unknown }).requestKey);
}

describe('a payment is recorded once per press', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('sends the same key on a second press after an answer that never came', async () => {
    const wrapper = await dialog();
    api.post.mockRejectedValueOnce(lost()).mockResolvedValueOnce({ data: RECORDED });

    await type('35');
    await press();
    expect(el('record-payment-error').textContent).toContain('offline');
    await press();

    const [first, second] = sentKeys(api.post.mock.calls);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    expect(wrapper.emitted('saved')).toEqual([[RECORDED]]);
  });

  it('makes a new key on each opening', async () => {
    const wrapper = await dialog();
    api.post.mockResolvedValue({ data: RECORDED });
    await type('35');
    await press();

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await type('35');
    await press();

    const [first, second] = sentKeys(api.post.mock.calls);
    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect(second).not.toBe(first);
  });

  it('sends a refund with its key, the same on a second press', async () => {
    await dialog({ mode: 'refund' });
    api.post.mockRejectedValueOnce(lost()).mockResolvedValueOnce({ data: RECORDED });

    await type('35');
    await press();
    await press();

    expect(api.post.mock.calls.map(([url]) => url)).toEqual([
      '/markets/market-1/payments/ana%40example.com/refunds',
      '/markets/market-1/payments/ana%40example.com/refunds',
    ]);
    const [first, second] = sentKeys(api.post.mock.calls);
    expect(typeof first).toBe('string');
    expect(second).toBe(first);
  });

  it('sends no key on an edit', async () => {
    await dialog({ mode: 'edit', entry: ENTRY });
    api.put.mockResolvedValue({ data: RECORDED });

    await press();

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][1]).not.toHaveProperty('requestKey');
  });

  it('keeps the refusal shown and hands on the account it carries', async () => {
    const wrapper = await dialog();
    api.post.mockRejectedValueOnce(alreadyRecorded(RECORDED));

    await type('30');
    await press();

    expect(el('record-payment-error').textContent).toBe(ALREADY);
    expect(wrapper.emitted('refreshed')).toEqual([[RECORDED]]);
    expect(wrapper.emitted('saved')).toBeUndefined();
  });

  it('shows the entry already recorded behind the dialog on the Payment tab', async () => {
    api.get.mockResolvedValue({ data: EMPTY });
    const tab = mount(VendorPaymentTab, {
      props: { marketId: 'market-1', email: 'ana@example.com', canRecord: true },
      attachTo: document.body,
    });
    mounted = tab;
    await flushPromises();
    expect(tab.findAll('[data-testid="payment-entry"]')).toHaveLength(0);

    await tab.get('[data-testid="payment-record"]').trigger('click');
    await flushPromises();
    api.post.mockRejectedValueOnce(alreadyRecorded(RECORDED));
    await type('30');
    await press();

    expect(el('record-payment-window')).toBeTruthy();
    expect(el('record-payment-error').textContent).toBe(ALREADY);
    expect(tab.findAll('[data-testid="payment-entry"]')).toHaveLength(1);
    expect(tab.get('[data-testid="payment-paid"]').text()).toBe('$35.00');
    expect(tab.emitted('changed')).toHaveLength(1);
  });
});
