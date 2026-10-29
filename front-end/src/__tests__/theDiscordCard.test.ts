/**
 * The Discord card on Market Setup (E46/F01/S02).
 *
 * An Admin connects the market to a server through Discord's approval screen, then picks the role
 * to give and the form's question that holds each vendor's username. Anyone the table's "Connect
 * Discord and give roles" row refuses reads the card and changes nothing; a Conventioner without
 * Discord's values says so and offers nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import MarketDiscordCard from '@/components/market/MarketDiscordCard.vue';
import type { DiscordConnection, Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const CONNECTED: DiscordConnection = {
  guildId: '2909267986263572999',
  guildName: 'Market Vendors',
};
const ROLES = [
  { id: 'r-mod', name: 'Moderator', belowBot: false },
  { id: 'r-vendor', name: 'Vendor Test', belowBot: true },
];
const FIELDS = [
  { key: 'shop', label: 'Shop name', type: 'text', required: true, options: [], order: 0 },
  {
    key: 'discord_username',
    label: 'Discord Username',
    type: 'text',
    required: false,
    options: [],
    order: 1,
  },
  { key: 'days', label: 'Days', type: 'select', required: true, options: ['One'], order: 2 },
];

function market(overrides: Partial<Market> = {}, ...refused: MarketAction[]): Market {
  return {
    id: 'market-123',
    name: 'Riverside Spring',
    phase: 'market_days',
    roles: {},
    applicationForm: { fields: FIELDS },
    discordSetUp: true,
    actionRefusals: answersRefusing(...refused),
    ...overrides,
  } as unknown as Market;
}

function card(props: Market) {
  return mount(MarketDiscordCard, { props: { market: props }, attachTo: document.body });
}

const find = (wrapper: ReturnType<typeof card>, id: string) =>
  wrapper.find(`[data-testid="${id}"]`);

beforeEach(() => {
  for (const call of Object.values(api)) call.mockReset();
  api.get.mockResolvedValue({ data: { roles: ROLES } });
  api.put.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});

describe('a Conventioner without Discord', () => {
  it('says Discord is not set up and offers nothing', async () => {
    const wrapper = card(market({ discordSetUp: false }));
    await flushPromises();

    expect(find(wrapper, 'discord-not-set-up').text()).toBe(
      'Discord is not set up on this Conventioner.',
    );
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('a market not connected', () => {
  it('offers Connect Discord, which opens Discord`s approval screen', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.post.mockResolvedValue({ data: { url: 'https://discord.com/oauth2/authorize?state=s' } });
    const wrapper = card(market());

    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith('/markets/market-123/discord/authorization');
    expect(assign).toHaveBeenCalledWith('https://discord.com/oauth2/authorize?state=s');
    vi.unstubAllGlobals();
  });

  it('says why to someone the row refuses, and offers no Connect', async () => {
    const wrapper = card(market({}, MarketAction.ConnectDiscord));

    expect(find(wrapper, 'discord-connect-button').exists()).toBe(false);
    expect(find(wrapper, 'discord-refusal').text()).toBe(
      `Only someone else may ${MarketAction.ConnectDiscord}.`,
    );
  });
});

describe('a market connected, for an Admin', () => {
  it('names the server and offers the server`s roles', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    expect(find(wrapper, 'discord-server').text()).toContain('Market Vendors');
    expect(api.get).toHaveBeenCalledWith('/markets/market-123/discord/roles');
    const options = find(wrapper, 'discord-role-select').findAll('option');
    expect(options.map((option) => option.attributes('value'))).toEqual(['', 'r-mod', 'r-vendor']);
  });

  it('marks a role above the bot`s with the move-the-role hint', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, roleId: 'r-mod', roleName: 'Moderator' } }),
    );
    await flushPromises();

    expect(find(wrapper, 'discord-role-select').find('option[value="r-mod"]').text()).toContain(
      'above Conventioner',
    );
    expect(find(wrapper, 'discord-role-hint').text()).toBe(
      "Move the Conventioner role above this one in your server's settings.",
    );
  });

  it('gives no hint for a role below the bot`s', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, roleId: 'r-vendor', roleName: 'Vendor Test' } }),
    );
    await flushPromises();

    expect(find(wrapper, 'discord-role-hint').exists()).toBe(false);
  });

  it('saves a role chosen, and tells the page to re-read the market', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    await find(wrapper, 'discord-role-select').setValue('r-vendor');
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', { roleId: 'r-vendor' });
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('offers only the form`s text questions for the username', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, usernameQuestion: 'discord_username' } }),
    );
    await flushPromises();

    const select = find(wrapper, 'discord-question-select');
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual([
      '',
      'shop',
      'discord_username',
    ]);
    expect((select.element as HTMLSelectElement).value).toBe('discord_username');
  });

  it('saves the invite link when the field is left', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    await find(wrapper, 'discord-invite-input').setValue('https://discord.gg/abc123');
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', {
      inviteLink: 'https://discord.gg/abc123',
    });
  });

  it('says why a save was refused, beneath its field', async () => {
    api.put.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'An invite link is a web address.' } },
    });
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    await find(wrapper, 'discord-invite-input').setValue('discord.gg/abc');
    await flushPromises();

    expect(find(wrapper, 'discord-save-error').text()).toBe('An invite link is a web address.');
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it('says so when the server`s roles cannot be read', async () => {
    api.get.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { error: 'Conventioner`s bot can no longer reach this server.' },
      },
    });
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    expect(find(wrapper, 'discord-roles-error').text()).toBe(
      'Conventioner`s bot can no longer reach this server.',
    );
  });

  it('disconnects only once confirmed', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    await find(wrapper, 'discord-disconnect-button').trigger('click');
    expect(api.delete).not.toHaveBeenCalled();
    await find(wrapper, 'discord-disconnect-submit-button').trigger('click');
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith('/markets/market-123/discord/connection');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('a market connected, for someone the row refuses', () => {
  it('reads the server, the role, the question and the link, and changes nothing', async () => {
    const wrapper = card(
      market(
        {
          discord: {
            ...CONNECTED,
            roleId: 'r-vendor',
            roleName: 'Vendor Test',
            usernameQuestion: 'discord_username',
            inviteLink: 'https://discord.gg/abc123',
          },
        },
        MarketAction.ConnectDiscord,
      ),
    );
    await flushPromises();

    expect(find(wrapper, 'discord-server').text()).toContain('Market Vendors');
    expect(find(wrapper, 'discord-role-value').text()).toBe('Vendor Test');
    expect(find(wrapper, 'discord-question-value').text()).toBe('Discord Username');
    expect(find(wrapper, 'discord-invite-value').text()).toBe('https://discord.gg/abc123');
    expect(wrapper.findAll('button, select, input')).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });
});
