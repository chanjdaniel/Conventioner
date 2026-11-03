/**
 * The Discord card on the Tools tab (E46/F01/S02).
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
import { announceDiscordConnected, announceDiscordNotConnected } from '@/utils/discordConnected';
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

/** The answer of a save the server refused, in its own words. */
const refusedWith = (error: string) => ({
  isAxiosError: true,
  response: { status: 400, data: { error } },
});

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
  /** A tab `window.open` hands back, before it is sent anywhere. */
  function blankTab() {
    return { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  }

  it('offers Connect Discord, which opens Discord`s approval screen in a new tab', async () => {
    const tab = blankTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    api.post.mockResolvedValue({ data: { url: 'https://discord.com/oauth2/authorize?state=s' } });
    const wrapper = card(market());

    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();

    // Opened in the click itself, so the browser does not take it for a pop-up, and cut from this
    // tab before it goes to Discord.
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/markets/market-123/discord/authorization');
    expect(tab.location.href).toBe('https://discord.com/oauth2/authorize?state=s');
    expect(find(wrapper, 'discord-connect-waiting').text()).toBe(
      'Discord opened in a new tab. Choose a server there, and this card shows it.',
    );
    open.mockRestore();
  });

  it('closes the new tab and says so when connecting cannot start', async () => {
    const tab = blankTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    api.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { error: 'Discord is not set up on this Conventioner.' } },
    });
    const wrapper = card(market());

    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();

    expect(tab.close).toHaveBeenCalled();
    expect(find(wrapper, 'discord-connect-error').text()).toBe(
      'Discord is not set up on this Conventioner.',
    );
    expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(false);
    open.mockRestore();
  });

  it('starts nothing when the browser blocks the new tab, and says how to allow it', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = card(market());

    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();

    expect(api.post).not.toHaveBeenCalled();
    expect(find(wrapper, 'discord-connect-error').text()).toBe(
      'Your browser blocked the tab for Discord. Allow pop-ups for Conventioner, then connect again.',
    );
    open.mockRestore();
  });

  it('stops saying Discord is open once the tab Discord returned to says it was not connected', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(blankTab() as unknown as Window);
    api.post.mockResolvedValue({ data: { url: 'https://discord.com/oauth2/authorize?state=s' } });
    const wrapper = card(market());
    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();
    expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(true);

    announceDiscordNotConnected('another-market');
    announceDiscordNotConnected('market-123');

    await vi.waitFor(() => expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(false));
    expect(wrapper.emitted('changed')).toBeUndefined();
    wrapper.unmount();
    open.mockRestore();
  });

  it('stops saying Discord is open when this tab is shown again', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(blankTab() as unknown as Window);
    api.post.mockResolvedValue({ data: { url: 'https://discord.com/oauth2/authorize?state=s' } });
    const wrapper = card(market());
    await find(wrapper, 'discord-connect-button').trigger('click');
    await flushPromises();
    expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(true);

    // Discord's tab closed, or left, and the organizer back on the market.
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(document.visibilityState).toBe('visible');
    expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(false);
    wrapper.unmount();
    open.mockRestore();
  });

  it('re-reads the market when the tab Discord returned to connects it', async () => {
    const wrapper = card(market());

    announceDiscordConnected('another-market');
    announceDiscordConnected('market-123');

    await vi.waitFor(() => expect(wrapper.emitted('changed')).toHaveLength(1));
    wrapper.unmount();
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
  it('reads the server`s roles once the market it shows becomes connected', async () => {
    const wrapper = card(market());
    await flushPromises();
    expect(api.get).not.toHaveBeenCalled();

    await wrapper.setProps({ market: market({ discord: CONNECTED }) });
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith('/markets/market-123/discord/roles');
    expect(find(wrapper, 'discord-connect-waiting').exists()).toBe(false);
  });

  it('names the server and offers the server`s roles', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    expect(find(wrapper, 'discord-server-name').text()).toBe('Market Vendors');
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
    const warning = find(wrapper, 'discord-role-warning');
    expect(warning.attributes('role')).toBe('alert');
    expect(warning.find('strong').text()).toBe('Conventioner cannot give Moderator yet');
    expect(warning.findAll('li').map((step) => step.text())).toEqual([
      'In Discord, open Server Settings, then Roles.',
      'Drag the Conventioner role above Moderator, and save.',
      'Check again here.',
    ]);
  });

  it('checks the roles again once moved, and drops the warning when the bot is above', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, roleId: 'r-mod', roleName: 'Moderator' } }),
    );
    await flushPromises();
    api.get.mockResolvedValue({
      data: { roles: ROLES.map((role) => ({ ...role, belowBot: true })) },
    });

    await find(wrapper, 'discord-role-check-again').trigger('click');
    await flushPromises();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(find(wrapper, 'discord-role-warning').exists()).toBe(false);
  });

  it('says so when the role is still above the bot`s after checking again', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, roleId: 'r-mod', roleName: 'Moderator' } }),
    );
    await flushPromises();

    await find(wrapper, 'discord-role-check-again').trigger('click');
    await flushPromises();

    expect(find(wrapper, 'discord-role-still').text()).toBe(
      'Checked: the Conventioner role is still below Moderator.',
    );
  });

  it('gives no hint for a role below the bot`s', async () => {
    const wrapper = card(
      market({ discord: { ...CONNECTED, roleId: 'r-vendor', roleName: 'Vendor Test' } }),
    );
    await flushPromises();

    expect(find(wrapper, 'discord-role-warning').exists()).toBe(false);
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

  it('says why a role was not saved, under the choices', async () => {
    api.put.mockRejectedValue(refusedWith('That role is not one Conventioner can give.'));
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();

    await find(wrapper, 'discord-role-select').setValue('r-vendor');
    await flushPromises();

    expect(find(wrapper, 'discord-save-error').text()).toBe(
      'That role is not one Conventioner can give.',
    );
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
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

describe('a refused invite link', () => {
  const REFUSAL =
    'An invite link is a web address starting https://, like https://discord.gg/abc123.';

  /** A card whose first save of a half-typed link was refused. */
  async function refused(discord: DiscordConnection = CONNECTED) {
    api.put.mockRejectedValueOnce(refusedWith(REFUSAL));
    const wrapper = card(market({ discord }));
    await flushPromises();
    await invite(wrapper).setValue('discord.gg/abc');
    await flushPromises();
    return wrapper;
  }

  const invite = (wrapper: ReturnType<typeof card>) => find(wrapper, 'discord-invite-input');
  const typed = (wrapper: ReturnType<typeof card>) =>
    (invite(wrapper).element as HTMLInputElement).value;

  it('says its words under the choices and stays in the field to be finished', async () => {
    const wrapper = await refused();

    expect(find(wrapper, 'discord-invite-error').text()).toBe(REFUSAL);
    expect(find(wrapper, 'discord-save-error').exists()).toBe(false);
    expect(typed(wrapper)).toBe('discord.gg/abc');
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it('points the field at its words while it stands refused', async () => {
    const wrapper = await refused();

    expect(invite(wrapper).attributes('aria-invalid')).toBe('true');
    expect(invite(wrapper).attributes('aria-describedby')).toBe(
      find(wrapper, 'discord-invite-error').attributes('id'),
    );
  });

  it('keeps the text over a stored link, which it has not replaced', async () => {
    const wrapper = await refused({ ...CONNECTED, inviteLink: 'https://discord.gg/stored' });

    expect(typed(wrapper)).toBe('discord.gg/abc');
    expect(find(wrapper, 'discord-invite-error').text()).toBe(REFUSAL);
  });

  it('loses the words once the finished link saves, and shows the link as stored', async () => {
    const wrapper = await refused();

    await invite(wrapper).setValue('https://discord.gg/abc');
    await flushPromises();

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-123/discord', {
      inviteLink: 'https://discord.gg/abc',
    });
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
    expect(invite(wrapper).attributes('aria-invalid')).toBe('false');
    expect(wrapper.emitted('changed')).toHaveLength(1);

    await wrapper.setProps({
      market: market({ discord: { ...CONNECTED, inviteLink: 'https://discord.gg/abc' } }),
    });
    expect(typed(wrapper)).toBe('https://discord.gg/abc');
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
  });

  it('keeps the text and the words when a role is chosen meanwhile', async () => {
    const wrapper = await refused();

    await find(wrapper, 'discord-role-select').setValue('r-vendor');
    await flushPromises();
    // The page re-reads the market after the role saved: the stored link is as it was.
    await wrapper.setProps({
      market: market({ discord: { ...CONNECTED, roleId: 'r-vendor', roleName: 'Vendor Test' } }),
    });

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-123/discord', { roleId: 'r-vendor' });
    expect(typed(wrapper)).toBe('discord.gg/abc');
    expect(find(wrapper, 'discord-invite-error').text()).toBe(REFUSAL);
  });

  it('keeps a role`s refusal when the link saves, each saying only its own', async () => {
    const wrapper = await refused();
    api.put.mockRejectedValueOnce(refusedWith('That role is not one Conventioner can give.'));
    await find(wrapper, 'discord-role-select').setValue('r-vendor');
    await flushPromises();
    expect(find(wrapper, 'discord-save-error').exists()).toBe(true);
    expect(find(wrapper, 'discord-invite-error').text()).toBe(REFUSAL);

    await invite(wrapper).setValue('https://discord.gg/abc');
    await flushPromises();

    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
    expect(find(wrapper, 'discord-save-error').text()).toBe(
      'That role is not one Conventioner can give.',
    );
  });

  it('clears the stored link and the words when the text is cleared', async () => {
    const wrapper = await refused({ ...CONNECTED, inviteLink: 'https://discord.gg/stored' });

    await invite(wrapper).setValue('');
    await flushPromises();

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-123/discord', { inviteLink: '' });
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
  });

  it('is forgotten when the market is disconnected, though the stored link never changed', async () => {
    const wrapper = await refused();

    await wrapper.setProps({ market: market({ discord: undefined }) });
    await wrapper.setProps({ market: market({ discord: CONNECTED }) });

    expect(typed(wrapper)).toBe('');
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
  });
});

describe('the invite field and a market read again', () => {
  const STORED = { ...CONNECTED, inviteLink: 'https://discord.gg/stored' };
  const invite = (wrapper: ReturnType<typeof card>) =>
    find(wrapper, 'discord-invite-input').element as HTMLInputElement;

  it('opens on the stored link', async () => {
    const wrapper = card(market({ discord: STORED }));
    await flushPromises();

    expect(invite(wrapper).value).toBe('https://discord.gg/stored');
  });

  it('shows a stored link read after the card opened', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();
    expect(invite(wrapper).value).toBe('');

    await wrapper.setProps({ market: market({ discord: STORED }) });

    expect(invite(wrapper).value).toBe('https://discord.gg/stored');
  });

  it('leaves what is being typed alone when the stored link is as it was', async () => {
    const wrapper = card(market({ discord: STORED }));
    await flushPromises();

    invite(wrapper).value = 'https://discord.gg/half';
    await find(wrapper, 'discord-invite-input').trigger('input');
    await wrapper.setProps({ market: market({ discord: { ...STORED } }) });

    expect(invite(wrapper).value).toBe('https://discord.gg/half');
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('a market connected, for someone the row refuses', () => {
  it('does not tell them when the card may be changed', () => {
    const wrapper = card(market({ discord: CONNECTED }, MarketAction.ConnectDiscord));

    expect(find(wrapper, 'discord-lead').text()).toBe(
      "Give this market's vendors a role in your Discord server.",
    );
  });

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

    expect(find(wrapper, 'discord-server-name').text()).toBe('Market Vendors');
    expect(find(wrapper, 'discord-role-value').text()).toBe('Vendor Test');
    expect(find(wrapper, 'discord-question-value').text()).toBe('Discord Username');
    expect(find(wrapper, 'discord-invite-value').text()).toBe('https://discord.gg/abc123');
    expect(wrapper.findAll('button, select, input')).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });
});
