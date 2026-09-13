// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import MarketHomeView from '@/views/MarketHomeView.vue';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

const fetchPublicApplicationForm = vi.fn();
vi.mock('@/utils/publicApplicationForm', () => ({
  fetchPublicApplicationForm: (slug: string) => fetchPublicApplicationForm(slug),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { marketSlug: 'spring-market' } }),
}));

function served(marketName: string) {
  return {
    marketName,
    fields: [],
    essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
    phaseLabel: 'Applications Open',
    isOpen: true,
    failed: false,
    notFound: false,
  };
}

/** The applicant surface answered: no such market, or one whose vendors are imported. */
const notServed = {
  marketName: '',
  fields: [],
  essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
  phaseLabel: '',
  isOpen: false,
  failed: true,
  notFound: true,
};

/** The request never answered at all. A different thing, and it must read as a different thing. */
const neverAnswered = { ...notServed, notFound: false };

async function mountView() {
  const wrapper = mount(MarketHomeView);
  await flushPromises();
  return wrapper;
}

describe('MarketHomeView', () => {
  beforeEach(() => {
    fetchPublicApplicationForm.mockReset();
  });

  it('asks the applicant surface about the market rather than trusting the URL', async () => {
    fetchPublicApplicationForm.mockResolvedValue(served('Spring Market'));
    await mountView();

    expect(fetchPublicApplicationForm).toHaveBeenCalledWith('spring-market');
  });

  it('renders the market home when the market takes applications online', async () => {
    fetchPublicApplicationForm.mockResolvedValue(served('Spring Market'));
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="market-home-not-found"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Spring Market');
  });

  it('renders not found when the market does not answer the applicant surface', async () => {
    // A CSV market and an unknown slug both land here: the gate answers identically for both.
    fetchPublicApplicationForm.mockResolvedValue(notServed);
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="market-home-not-found"]').exists()).toBe(true);
  });

  it('tells a stranger nothing about whether the market exists', async () => {
    fetchPublicApplicationForm.mockResolvedValue(notServed);
    const wrapper = await mountView();
    const text = wrapper.text().toLowerCase();

    expect(text).not.toContain('spring-market');
    expect(text).not.toContain('application');
    expect(text).not.toContain('import');
  });

  it('never prints the slug back before it knows the market is real', async () => {
    let resolve!: (value: unknown) => void;
    fetchPublicApplicationForm.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const wrapper = mount(MarketHomeView);

    expect(wrapper.text()).not.toContain('spring-market');

    resolve(notServed);
    await flushPromises();
  });

  it('does not call a market missing when the request never answered', async () => {
    fetchPublicApplicationForm.mockResolvedValue(neverAnswered);
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="market-home-not-found"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="market-home-load-failed"]').exists()).toBe(true);
  });

  it('offers a retry when the request never answered', async () => {
    fetchPublicApplicationForm.mockResolvedValue(neverAnswered);
    const wrapper = await mountView();

    await wrapper.find('[data-testid="market-home-retry-button"]').trigger('click');

    expect(fetchPublicApplicationForm).toHaveBeenCalledTimes(2);
  });
});
