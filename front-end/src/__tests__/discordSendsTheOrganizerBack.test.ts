/**
 * Discord's approval screen sends the organizer back to `/discord/connected` (E46/F01/S02), with a
 * code and the state the market's Connect Discord began. The page finishes connecting the market
 * the state names and goes on to its Market Setup, or says what went wrong and links back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';

import DiscordConnectedView from '@/views/DiscordConnectedView.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));

vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => route }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const page = () =>
  mount(DiscordConnectedView, { global: { stubs: { RouterLink: RouterLinkStub } } });

beforeEach(() => {
  api.post.mockReset();
  router.replace.mockReset();
});

describe('Discord sends the organizer back', () => {
  it('finishes connecting the market the state names, and opens its Market Setup', async () => {
    route.query = { code: 'a-code', state: 'market-123.nonce', guild_id: '29092679' };
    api.post.mockResolvedValue({ data: { marketId: 'market-123' } });

    page();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith('/markets/market-123/discord/connection', {
      code: 'a-code',
      state: 'market-123.nonce',
    });
    expect(router.replace).toHaveBeenCalledWith('/markets/market-123/setup');
  });

  it('says why the server refused, and links back to Market Setup', async () => {
    route.query = { code: 'a-code', state: 'market-123.nonce' };
    api.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'This Discord connection was not started here.' } },
    });

    const wrapper = page();
    await flushPromises();

    expect(wrapper.find('[data-testid="discord-connected-error"]').text()).toBe(
      'This Discord connection was not started here.',
    );
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets/market-123/setup');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says nothing was connected when the organizer cancelled on Discord', async () => {
    route.query = { error: 'access_denied', state: 'market-123.nonce' };

    const wrapper = page();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="discord-connected-error"]').text()).toBe(
      'Discord was not connected: the approval was cancelled.',
    );
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets/market-123/setup');
  });

  it('sends a page reached with no state to the markets', async () => {
    route.query = {};

    const wrapper = page();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets');
  });
});
