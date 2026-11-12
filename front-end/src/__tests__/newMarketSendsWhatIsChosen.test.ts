// @vitest-environment happy-dom
/**
 * Create new market posts only what the dialog asks for: the name, the organization, how vendors
 * apply, and when. The server starts every other field of a new market itself, and drops any key
 * outside `MARKET_CREATE_FIELDS` in `back-end/api/markets.py`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const push = vi.fn();
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}));

vi.mock('@/utils/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/organizations')>()),
  fetchOrganizations: () => Promise.resolve([{ id: 'org-1', name: 'Example Collective' }]),
}));

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api,
}));

import NewMarketOverlay from '@/views/NewMarketOverlay.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

it('posts the name, the organization, how vendors apply and the date, and nothing else', async () => {
  api.post.mockResolvedValue({ data: { market_id: 'market-1' } });
  const wrapper = mount(NewMarketOverlay, {
    props: { newOpen: true },
    global: { stubs: { RouterLink: true } },
    attachTo: document.body,
  });
  await flushPromises();

  await wrapper.get('[data-testid="new-market-name-input"]').setValue('Spring Fair');
  await wrapper.get('[data-testid="new-market-path-form"] input').setValue(true);
  await wrapper.get('form').trigger('submit');
  await flushPromises();

  expect(api.post).toHaveBeenCalledTimes(1);
  const [url, body] = api.post.mock.calls[0];
  expect(url).toBe('/markets');
  expect(Object.keys(body).sort()).toEqual([
    'creationDate',
    'intakeMode',
    'name',
    'organizationId',
  ]);
  expect(body).toMatchObject({ name: 'Spring Fair', organizationId: 'org-1', intakeMode: 'form' });
  expect(push).toHaveBeenCalledWith(expect.stringContaining('market-1'));
  wrapper.unmount();
});
