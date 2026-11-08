// @vitest-environment happy-dom
/**
 * Markets and Organizations at the size an organizer's account can grow to (T223, L12): each offers
 * its search once it holds more than 12, and shows 50 at a time.
 *
 * Markets keeps its own finder, its search drawn only past the threshold or with words in it, and
 * its frame finds nothing itself. Organizations, which had no search, takes the whole frame, its
 * words in the address as `search`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const fetchMarkets = vi.fn();
vi.mock('@/utils/market', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/market')>()),
  fetchMarkets: () => fetchMarkets(),
}));
const fetchOrganizations = vi.fn();
vi.mock('@/utils/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/organizations')>()),
  fetchOrganizations: () => fetchOrganizations(),
}));

import MarketsView from '@/views/MarketsView.vue';
import OrganizationsView from '@/views/OrganizationsView.vue';

const pad = (n: number) => String(n).padStart(2, '0');

/** `count` markets, named in the order the Name sort puts them. */
function marketsOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `market-${i + 1}`,
    name: `Example Market ${pad(i + 1)}`,
    phase: 'draft',
    organizationId: 'org-1',
    creationDate: `2026-04-01T00:${pad(i % 60)}:00Z`,
  }));
}

function organizationsOf(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `org-${i + 1}`,
    name: `Example Collective ${pad(i + 1)}`,
    userRole: 'owner',
    marketCount: 0,
  }));
}

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

async function mountAt(address: string): Promise<{ router: Router; page: VueWrapper }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/markets', name: 'markets', component: MarketsView },
      { path: '/organizations', name: 'organizations', component: OrganizationsView },
    ],
  });
  await router.push(address);
  await router.isReady();
  const view = address.startsWith('/markets') ? MarketsView : OrganizationsView;
  wrapper = mount(view, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        NewMarketOverlay: true,
        ManageMarketOverlay: true,
        ManageOrgOverlay: true,
        RouterLink: RouterLinkStub,
      },
    },
  });
  await flushPromises();
  return { router, page: wrapper };
}

const has = (page: VueWrapper, testid: string) => page.find(`[data-testid="${testid}"]`).exists();
const cards = (page: VueWrapper, testid: string) => page.findAll(`[data-testid="${testid}"]`);

describe('Markets, as an account grows', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMarkets.mockReset();
    fetchOrganizations.mockReset();
    fetchOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Example Collective' }]);
  });

  it('offers no search at 12 markets, its filters and sort all there', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(12));
    const { page } = await mountAt('/markets');

    expect(has(page, 'markets-search-input')).toBe(false);
    expect(has(page, 'markets-org-select')).toBe(true);
    expect(has(page, 'markets-sort-select')).toBe(true);
    expect(has(page, 'markets-phase-toggle-draft')).toBe(true);
    expect(page.get('[data-testid="markets-result-count"]').text()).toBe('12 markets');
    expect(cards(page, 'market-card')).toHaveLength(12);
  });

  it('offers its search at 13', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(13));
    const { page } = await mountAt('/markets');

    expect(has(page, 'markets-search-input')).toBe(true);
    expect(cards(page, 'market-card')).toHaveLength(13);
  });

  it('offers its search at 12 while the address holds words, so they can be cleared', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(12));
    const { page } = await mountAt('/markets?q=03');

    const search = page.get<HTMLInputElement>('[data-testid="markets-search-input"]');
    expect(search.element.value).toBe('03');
    expect(page.get('[data-testid="markets-result-count"]').text()).toBe('1 of 12 markets');
  });

  it('keeps its search under the caret as the words are cleared', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(12));
    const { page } = await mountAt('/markets?q=03');

    const search = page.get<HTMLInputElement>('[data-testid="markets-search-input"]');
    search.element.focus();
    await search.trigger('focus');
    await search.setValue('');
    await flushPromises();

    expect(has(page, 'markets-search-input')).toBe(true);
    expect(document.activeElement).toBe(search.element);
    expect(cards(page, 'market-card')).toHaveLength(12);
  });

  it('shows 50 of 51, and its count still names them all', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(51));
    const { page } = await mountAt('/markets?sort=name');

    expect(cards(page, 'market-card')).toHaveLength(50);
    expect(page.get('[data-testid="markets-result-count"]').text()).toBe('51 markets');
    expect(page.get('[data-testid="markets-list-count"]').text()).toBe('Showing 50 of 51');
    const more = page.get('[data-testid="markets-list-more"]');
    expect(more.text()).toBe('Show 1 more');

    await more.trigger('click');
    await flushPromises();

    const shown = cards(page, 'market-card');
    expect(shown).toHaveLength(51);
    expect(shown.at(-1)!.text()).toContain('Example Market 51');
    expect(document.activeElement).toBe(shown.at(-1)!.element);
    expect(has(page, 'markets-list-more')).toBe(false);
    expect(has(page, 'markets-list-count')).toBe(false);
  });

  it('makes each card a row the frame can hand the focus to', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(13));
    const { page } = await mountAt('/markets');

    for (const card of cards(page, 'market-card')) {
      expect(card.attributes('data-list-row')).toBe('');
      expect(card.attributes('tabindex')).toBe('-1');
    }
  });

  it('goes back to one page when a filter, the order or the words change', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(120));
    const { page } = await mountAt('/markets');

    await page.get('[data-testid="markets-list-more"]').trigger('click');
    await flushPromises();
    expect(cards(page, 'market-card')).toHaveLength(100);

    await page.get('[data-testid="markets-sort-select"]').setValue('name');
    await flushPromises();
    expect(cards(page, 'market-card')).toHaveLength(50);

    await page.get('[data-testid="markets-list-more"]').trigger('click');
    await flushPromises();
    await page.get('[data-testid="markets-search-input"]').setValue('Example');
    await flushPromises();
    expect(cards(page, 'market-card')).toHaveLength(50);
    expect(page.get('[data-testid="markets-result-count"]').text()).toBe('120 of 120 markets');
  });

  it('keeps its place when a dialog closing reads the list again', async () => {
    fetchMarkets.mockResolvedValue(marketsOf(120));
    const { page } = await mountAt('/markets');
    await page.get('[data-testid="markets-list-more"]').trigger('click');
    await flushPromises();

    page.findComponent({ name: 'ManageMarketOverlay' }).vm.$emit('manageClose');
    await flushPromises();

    expect(fetchMarkets).toHaveBeenCalledTimes(2);
    expect(cards(page, 'market-card')).toHaveLength(100);
  });
});

describe('Organizations, as an account grows', () => {
  beforeEach(() => {
    fetchOrganizations.mockReset();
  });

  it('offers no field at 12 organizations, and counts them', async () => {
    fetchOrganizations.mockResolvedValue(organizationsOf(12));
    const { page } = await mountAt('/organizations');

    expect(has(page, 'organizations-list-find')).toBe(false);
    expect(cards(page, 'organization-card')).toHaveLength(12);
    expect(page.get('[data-testid="organizations-list-count"]').text()).toBe('12 organizations');
  });

  it('offers "Find an organization" at 13, which finds by name, accents and capitals aside', async () => {
    fetchOrganizations.mockResolvedValue([
      ...organizationsOf(12),
      { id: 'org-cafe', name: 'Café Makers', userRole: 'owner', marketCount: 0 },
    ]);
    const { router, page } = await mountAt('/organizations');

    const find = page.get<HTMLInputElement>('[data-testid="organizations-list-find"]');
    expect(page.get(`label[for="${find.attributes('id')}"]`).text()).toBe('Find an organization');

    await find.setValue('CAFE');
    await flushPromises();

    expect(cards(page, 'organization-card').map((card) => card.find('h2').text())).toEqual([
      'Café Makers',
    ]);
    expect(router.currentRoute.value.query.search).toBe('CAFE');
    expect(page.get('[data-testid="organizations-list-count"]').text()).toBe(
      '1 of 13 matches "CAFE"',
    );
  });

  it('opens on the words the address holds', async () => {
    fetchOrganizations.mockResolvedValue(organizationsOf(13));
    const { page } = await mountAt('/organizations?search=Collective%2007');

    expect(
      page.get<HTMLInputElement>('[data-testid="organizations-list-find"]').element.value,
    ).toBe('Collective 07');
    expect(cards(page, 'organization-card')).toHaveLength(1);
  });

  it('shows 50 of 51, and hands the focus to the one more', async () => {
    fetchOrganizations.mockResolvedValue(organizationsOf(51));
    const { page } = await mountAt('/organizations');

    expect(cards(page, 'organization-card')).toHaveLength(50);
    expect(page.get('[data-testid="organizations-list-count"]').text()).toBe('Showing 50 of 51');

    await page.get('[data-testid="organizations-list-more"]').trigger('click');
    await flushPromises();

    const shown = cards(page, 'organization-card');
    expect(shown).toHaveLength(51);
    expect(shown.at(-1)!.attributes('data-list-row')).toBe('');
    expect(document.activeElement).toBe(shown.at(-1)!.element);
  });

  it('says it is loading, then that there are none, as it did', async () => {
    let answer!: (orgs: unknown[]) => void;
    fetchOrganizations.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { page } = await mountAt('/organizations');
    expect(page.text()).toContain('Loading organizations');

    answer([]);
    await flushPromises();
    expect(page.text()).toContain('No organizations found');
    expect(has(page, 'organizations-list-count')).toBe(false);
  });
});
