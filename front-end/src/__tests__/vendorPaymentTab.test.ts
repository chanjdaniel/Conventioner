/**
 * The drawer's Payment tab (E44/F01/S01): a line per table-day, the payments, the totals and how
 * they compare; "Record payment" only for whoever the row allows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import VendorPaymentTab from '@/components/VendorPaymentTab.vue';
import type { VendorAccount } from '@/utils/payments';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const LINE = {
  tableCode: 'Atrium 1',
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

const ACCOUNT: VendorAccount = {
  currency: 'CAD',
  lines: [
    { ...LINE, date: '2099-05-07' },
    {
      ...LINE,
      date: '2099-05-08',
      freed: true,
      freedAt: '2099-04-20T12:00:00+00:00',
      freedBy: 'editor@example.com',
    },
  ],
  payments: [
    {
      id: 'p1',
      cents: 3500,
      method: 'cash',
      paidOn: '2099-04-01',
      note: 'At the info desk',
      recordedBy: 'editor@example.com',
      recordedAt: '2099-04-01T18:00:00+00:00',
    },
  ],
  owedCents: 7000,
  paidCents: 3500,
};

async function tab(canRecord: boolean, account: VendorAccount = ACCOUNT) {
  api.get.mockResolvedValue({ data: account });
  const wrapper = mount(VendorPaymentTab, {
    props: { marketId: 'market-1', email: 'ana@example.com', canRecord },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

describe('the Payment tab', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('reads one vendor’s account', async () => {
    await tab(true);

    expect(api.get).toHaveBeenCalledWith('/markets/market-1/payments/ana%40example.com');
  });

  it('heads the tab with both totals and how they compare', async () => {
    const wrapper = await tab(true);

    expect(wrapper.get('[data-testid="payment-owed"]').text()).toBe('$70');
    expect(wrapper.get('[data-testid="payment-paid"]').text()).toBe('$35');
    expect(wrapper.get('[data-testid="payment-balance"]').text()).toBe('Owes $35');
  });

  it('keeps a freed table’s line, still owed, saying it was freed and when', async () => {
    const wrapper = await tab(true);

    const lines = wrapper.findAll('[data-testid="payment-line"]');
    expect(lines).toHaveLength(2);
    expect(lines[0].get('[data-testid="payment-line-source"]').text()).toBe(
      'Atrium 1, Gold, full table',
    );
    expect(lines[1].get('[data-testid="payment-line-source"]').text()).toBe(
      'Atrium 1, Gold, full table - table freed Apr 20, 2099',
    );
    expect(lines[1].get('[data-testid="payment-line-owed"]').text()).toBe('$35');
  });

  it('says who recorded each payment', async () => {
    const wrapper = await tab(true);

    const entry = wrapper.get('[data-testid="payment-entry"]');
    expect(entry.text()).toContain('Cash, paid');
    expect(entry.text()).toContain('At the info desk');
    expect(entry.get('[data-testid="payment-entry-who"]').text()).toContain(
      'Recorded by editor@example.com',
    );
  });

  it('offers Record payment to whoever the row allows, and no one else', async () => {
    expect((await tab(true)).find('[data-testid="payment-record"]').exists()).toBe(true);
    expect((await tab(false)).find('[data-testid="payment-record"]').exists()).toBe(false);
  });

  it('records a payment and reads the account it answers', async () => {
    const wrapper = await tab(true);
    api.post.mockResolvedValue({ data: { ...ACCOUNT, paidCents: 7000 } });

    await wrapper.get('[data-testid="payment-record"]').trigger('click');
    await flushPromises();
    const amount = document.querySelector<HTMLInputElement>(
      '[data-testid="record-payment-amount"]',
    );
    amount!.value = '35';
    amount!.dispatchEvent(new Event('input'));
    document.querySelector<HTMLInputElement>('[data-testid="record-payment-method-cash"]')!.click();
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="record-payment-submit-button"]')!
      .click();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      '/markets/market-1/payments/ana%40example.com',
      expect.objectContaining({ cents: 3500, method: 'cash', note: '' }),
    );
    expect(wrapper.get('[data-testid="payment-balance"]').text()).toBe('Paid in full');
    expect(document.querySelector('[data-testid="record-payment-window"]')).toBeNull();
    wrapper.unmount();
  });

  it('says a vendor with no table owes nothing', async () => {
    const wrapper = await tab(false, {
      currency: 'CAD',
      lines: [],
      payments: [],
      owedCents: 0,
      paidCents: 0,
    });

    expect(wrapper.text()).toContain('No table yet, so nothing is owed.');
    expect(wrapper.text()).toContain('No payments recorded.');
    expect(wrapper.get('[data-testid="payment-balance"]').text()).toBe('Nothing owed');
  });
});
