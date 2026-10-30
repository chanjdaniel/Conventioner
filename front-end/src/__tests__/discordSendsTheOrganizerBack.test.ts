/**
 * Discord's approval screen sends the organizer back to `/discord/connected` (E46/F01/S02), in the
 * tab Connect Discord opened, with a code and the state it began. The page finishes connecting the
 * market the state names, tells the market's own tab, and says the outcome and that this tab can
 * be closed; or says what went wrong, with a link to the market's Tools, and tells the market's tab
 * that connecting ended without a connection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';

import DiscordConnectedView from '@/views/DiscordConnectedView.vue';
import { DISCORD_CHANNEL } from '@/utils/discordConnected';

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

/** What the market's other tabs hear. */
let heard: unknown[] = [];
let listener: BroadcastChannel | null = null;

beforeEach(() => {
  api.post.mockReset();
  router.replace.mockReset();
  heard = [];
  listener?.close();
  listener = new BroadcastChannel(DISCORD_CHANNEL);
  listener.onmessage = (event) => heard.push(event.data);
});

describe('Discord sends the organizer back', () => {
  it('finishes connecting the market the state names, tells its tab, and says so', async () => {
    route.query = { code: 'a-code', state: 'market-123.nonce', guild_id: '29092679' };
    api.post.mockResolvedValue({ data: { marketId: 'market-123' } });

    const wrapper = page();
    await flushPromises();
    await vi.waitFor(() => expect(heard).toEqual([{ connected: 'market-123' }]));

    expect(api.post).toHaveBeenCalledWith('/markets/market-123/discord/connection', {
      code: 'a-code',
      state: 'market-123.nonce',
    });
    expect(wrapper.find('[data-testid="discord-connected-done"]').text()).toBe(
      "Discord is connected. You can close this tab: the market's Tools tab shows the server.",
    );
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets/market-123/tools');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("says why the server refused, and links to the market's Tools", async () => {
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
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets/market-123/tools');
    expect(wrapper.text()).toContain('You can close this tab.');
    // The market's tab stops saying Discord is open.
    await vi.waitFor(() => expect(heard).toEqual([{ notConnected: 'market-123' }]));
  });

  it('says nothing was connected when the organizer cancelled on Discord', async () => {
    route.query = { error: 'access_denied', state: 'market-123.nonce' };

    const wrapper = page();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="discord-connected-error"]').text()).toBe(
      'Discord was not connected: the approval was cancelled.',
    );
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets/market-123/tools');
    await vi.waitFor(() => expect(heard).toEqual([{ notConnected: 'market-123' }]));
  });

  it('sends a page reached with no state to the markets', async () => {
    route.query = {};

    const wrapper = page();
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/markets');
  });
});
