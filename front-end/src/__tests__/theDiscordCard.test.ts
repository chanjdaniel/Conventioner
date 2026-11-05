/**
 * The Discord card on the Tools tab (E46/F01/S02).
 *
 * An Admin connects the market to a server through Discord's approval screen, then picks the role
 * to give and the form's question that holds each vendor's username. Anyone the table's "Connect
 * Discord and give roles" row refuses reads the card and changes nothing; a Conventioner without
 * Discord's values says so and offers nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';

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
  return mount(MarketDiscordCard, {
    props: { market: props },
    attachTo: document.body,
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

const find = (wrapper: ReturnType<typeof card>, id: string) =>
  wrapper.find(`[data-testid="${id}"]`);

const invite = (wrapper: ReturnType<typeof card>) => find(wrapper, 'discord-invite-input');
const typed = (wrapper: ReturnType<typeof card>) =>
  (invite(wrapper).element as HTMLInputElement).value;
/** Type into the field without leaving it, so nothing saves. */
async function typeInvite(wrapper: ReturnType<typeof card>, text: string): Promise<void> {
  (invite(wrapper).element as HTMLInputElement).value = text;
  await invite(wrapper).trigger('input');
}

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

describe('a server of many roles', () => {
  const manyRoles = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      id: `r-${at}`,
      name: `Role ${at}`,
      belowBot: at !== 7,
    }));
  const CONNECTED_AT = market({ discord: CONNECTED });
  const input = (wrapper: ReturnType<typeof card>, id: string) => find(wrapper, `${id}-input`);
  const list = (wrapper: ReturnType<typeof card>, id: string) => find(wrapper, `${id}-list`);
  const row = (wrapper: ReturnType<typeof card>, id: string, value: string) =>
    wrapper.find(`[data-testid="${id}-option"][data-value="${value}"]`);
  const ROLE = 'discord-role-select';

  async function withRoles(count: number, on: Market = CONNECTED_AT) {
    api.get.mockResolvedValue({ data: { roles: manyRoles(count) } });
    const wrapper = card(on);
    await flushPromises();
    return wrapper;
  }

  it('keeps its select at 12 roles, with its empty row', async () => {
    const wrapper = await withRoles(12);
    expect(find(wrapper, ROLE).element.tagName).toBe('SELECT');
    expect(find(wrapper, ROLE).findAll('option')).toHaveLength(13);
    expect(find(wrapper, ROLE).attributes('id')).toBe('discord-role');
    wrapper.unmount();
  });

  describe.each([13, 250])('at %i roles', (count) => {
    it('is a field its label still names, offering "Choose a role"', async () => {
      const wrapper = await withRoles(count);
      expect(wrapper.find(`select[data-testid="${ROLE}"]`).exists()).toBe(false);
      expect(input(wrapper, ROLE).attributes('id')).toBe('discord-role');
      expect(wrapper.get('label[for="discord-role"]').text()).toBe('Role to give');
      expect(input(wrapper, ROLE).attributes('placeholder')).toBe('Choose a role');
      wrapper.unmount();
    });

    it('finds a role by typing, writing nothing until it is taken, then re-reads', async () => {
      const wrapper = await withRoles(count);
      await input(wrapper, ROLE).setValue('role 12');
      await flushPromises();
      expect(api.put).not.toHaveBeenCalled();
      expect(row(wrapper, ROLE, 'r-12').exists()).toBe(true);
      expect(row(wrapper, ROLE, 'r-3').exists()).toBe(false);

      await row(wrapper, ROLE, 'r-12').trigger('click');
      await flushPromises();
      expect(api.put).toHaveBeenCalledOnce();
      expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', { roleId: 'r-12' });
      expect(wrapper.emitted('changed')).toHaveLength(1);
      wrapper.unmount();
    });

    it('marks a role above the bot`s, and warns once it is the chosen one', async () => {
      const wrapper = await withRoles(
        count,
        market({ discord: { ...CONNECTED, roleId: 'r-7', roleName: 'Role 7' } }),
      );
      expect((input(wrapper, ROLE).element as HTMLInputElement).value).toBe(
        "Role 7 (above Conventioner's role)",
      );
      expect(find(wrapper, 'discord-role-warning').text()).toContain(
        'Conventioner cannot give Role 7 yet',
      );
      expect(find(wrapper, 'discord-role-check-again').text()).toBe('Check again');
      wrapper.unmount();
    });

    it('still offers and shows a stored role the server no longer lists', async () => {
      const wrapper = await withRoles(
        count,
        market({ discord: { ...CONNECTED, roleId: 'r-gone', roleName: 'Old vendors' } }),
      );
      const field = input(wrapper, ROLE);
      expect((field.element as HTMLInputElement).value).toBe('Old vendors');
      await field.setValue('old ven');
      await flushPromises();
      expect(row(wrapper, ROLE, 'r-gone').text()).toBe('Old vendors');
      expect(find(wrapper, 'discord-role-warning').exists()).toBe(false);
      wrapper.unmount();
    });

    it('says a choice that fails was not saved', async () => {
      api.put.mockRejectedValue(refusedWith('The bot could not read that role.'));
      const wrapper = await withRoles(count);
      await input(wrapper, ROLE).setValue('role 4');
      await flushPromises();
      await row(wrapper, ROLE, 'r-4').trigger('click');
      await flushPromises();
      expect(find(wrapper, 'discord-save-error').text()).toBe('The bot could not read that role.');
      expect(wrapper.emitted('changed')).toBeUndefined();
      wrapper.unmount();
    });

    it('writes nothing when the role it holds is taken again, as a select never fires for it', async () => {
      const wrapper = await withRoles(
        count,
        market({ discord: { ...CONNECTED, roleId: 'r-4', roleName: 'Role 4' } }),
      );
      await input(wrapper, ROLE).trigger('click');
      await input(wrapper, ROLE).trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(api.put).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('goes back to the role it holds when the choice is refused', async () => {
      api.put.mockRejectedValue(refusedWith('The bot could not read that role.'));
      const wrapper = await withRoles(
        count,
        market({ discord: { ...CONNECTED, roleId: 'r-4', roleName: 'Role 4' } }),
      );
      await input(wrapper, ROLE).setValue('role 5');
      await flushPromises();
      await row(wrapper, ROLE, 'r-5').trigger('click');
      await flushPromises();
      expect(find(wrapper, 'discord-save-error').exists()).toBe(true);
      expect((input(wrapper, ROLE).element as HTMLInputElement).value).toBe('Role 4');
      wrapper.unmount();
    });

    it('lets the role it holds go, as the select`s empty row does', async () => {
      const held = { ...CONNECTED, roleId: 'r-4', roleName: 'Role 4' };
      const wrapper = await withRoles(count, market({ discord: held }));
      await input(wrapper, ROLE).trigger('click');
      await flushPromises();
      expect(wrapper.findAll(`[data-testid="${ROLE}-option"]`)[0]!.text()).toBe('No role');

      await row(wrapper, ROLE, '').trigger('click');
      await flushPromises();
      expect(api.put).toHaveBeenCalledOnce();
      expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', { roleId: null });

      await wrapper.setProps({ market: market({ discord: { ...CONNECTED, roleId: null } }) });
      await flushPromises();
      const field = input(wrapper, ROLE);
      expect((field.element as HTMLInputElement).value).toBe('');
      expect(field.attributes('placeholder')).toBe('Choose a role');
      await field.trigger('click');
      await flushPromises();
      // Nothing holds, so there is nothing to let go.
      expect(row(wrapper, ROLE, '').exists()).toBe(false);
      wrapper.unmount();
    });

    it('opens on the card`s link, with the focus in the field and the label as it is', async () => {
      const wrapper = await withRoles(count);
      await find(wrapper, 'discord-giving-needs-role').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(input(wrapper, ROLE).element);
      expect(list(wrapper, ROLE).exists()).toBe(true);
      expect(wrapper.find('[data-responding]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  it('at the select too, goes back to the role it holds when the choice is refused', async () => {
    api.put.mockRejectedValue(refusedWith('The bot could not read that role.'));
    const wrapper = await withRoles(
      12,
      market({ discord: { ...CONNECTED, roleId: 'r-4', roleName: 'Role 4' } }),
    );
    await find(wrapper, ROLE).setValue('r-5');
    await flushPromises();
    expect(find(wrapper, 'discord-save-error').exists()).toBe(true);
    expect((find(wrapper, ROLE).element as HTMLSelectElement).value).toBe('r-4');
    wrapper.unmount();
  });

  it('draws 50 of 250, and says how many more', async () => {
    const wrapper = await withRoles(250);
    await input(wrapper, ROLE).trigger('click');
    expect(wrapper.findAll(`[data-testid="${ROLE}-option"]`)).toHaveLength(50);
    expect(find(wrapper, `${ROLE}-more`).text()).toBe('200 more, type to narrow');
    wrapper.unmount();
  });

  describe('a form of many text questions', () => {
    const QUESTION = 'discord-question-select';
    const manyQuestions = market({
      discord: CONNECTED,
      applicationForm: {
        fields: Array.from({ length: 30 }, (_, at) => ({
          key: `q-${at}`,
          label: `Question ${at}`,
          type: 'text',
          required: false,
          options: [],
          order: at,
        })),
      },
    } as Partial<Market>);

    it('lets the question it holds go, as the select`s empty row does', async () => {
      const wrapper = card(
        market({
          ...manyQuestions,
          discord: { ...CONNECTED, usernameQuestion: 'q-4' },
        }),
      );
      await flushPromises();
      const field = find(wrapper, `${QUESTION}-input`);
      expect((field.element as HTMLInputElement).value).toBe('Question 4');
      await field.trigger('click');
      await flushPromises();
      const none = wrapper.find(`[data-testid="${QUESTION}-option"][data-value=""]`);
      expect(none.text()).toBe('No question');
      await none.trigger('click');
      await flushPromises();
      expect(api.put).toHaveBeenCalledOnce();
      expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', {
        usernameQuestion: null,
      });
      wrapper.unmount();
    });

    it('finds the username question by typing, writes it as taken, and opens on its link', async () => {
      const wrapper = card(manyQuestions);
      await flushPromises();
      expect(input(wrapper, QUESTION).attributes('id')).toBe('discord-question');
      expect(input(wrapper, QUESTION).attributes('placeholder')).toBe('Choose a question');

      await find(wrapper, 'discord-giving-needs-question').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(input(wrapper, QUESTION).element);
      expect(list(wrapper, QUESTION).exists()).toBe(true);

      await input(wrapper, QUESTION).setValue('question 22');
      await flushPromises();
      expect(api.put).not.toHaveBeenCalled();
      await row(wrapper, QUESTION, 'q-22').trigger('click');
      await flushPromises();
      expect(api.put).toHaveBeenCalledWith('/markets/market-123/discord', {
        usernameQuestion: 'q-22',
      });
      wrapper.unmount();
    });

    it('offers no choice for a stored question the form no longer asks, and names none', async () => {
      const wrapper = card({
        ...manyQuestions,
        discord: { ...CONNECTED, usernameQuestion: 'gone' },
      } as Market);
      await flushPromises();
      expect((input(wrapper, QUESTION).element as HTMLInputElement).value).toBe('');
      wrapper.unmount();
    });
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

  it('is forgotten on another market connected to the same server', async () => {
    const wrapper = await refused();

    await wrapper.setProps({
      market: {
        ...market({ discord: { ...CONNECTED, inviteLink: 'https://discord.gg/other' } }),
        id: 'market-456',
      },
    });

    expect(typed(wrapper)).toBe('https://discord.gg/other');
    expect(find(wrapper, 'discord-invite-error').exists()).toBe(false);
  });
});

describe('the invite field and a market read again', () => {
  const STORED = { ...CONNECTED, inviteLink: 'https://discord.gg/stored' };

  it('opens on the stored link', async () => {
    const wrapper = card(market({ discord: STORED }));
    await flushPromises();

    expect(typed(wrapper)).toBe('https://discord.gg/stored');
  });

  it('shows a stored link read after the card opened', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();
    expect(typed(wrapper)).toBe('');

    await wrapper.setProps({ market: market({ discord: STORED }) });

    expect(typed(wrapper)).toBe('https://discord.gg/stored');
  });

  it('leaves what is being typed alone when the stored link is as it was', async () => {
    const wrapper = card(market({ discord: STORED }));
    await flushPromises();

    await typeInvite(wrapper, 'https://discord.gg/half');
    await wrapper.setProps({ market: market({ discord: { ...STORED } }) });

    expect(typed(wrapper)).toBe('https://discord.gg/half');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('keeps what was typed after a save when that save`s re-read arrives', async () => {
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();
    await invite(wrapper).setValue('https://discord.gg/first');
    await flushPromises();

    await typeInvite(wrapper, 'https://discord.gg/second');
    await wrapper.setProps({
      market: market({ discord: { ...CONNECTED, inviteLink: 'https://discord.gg/first' } }),
    });

    expect(typed(wrapper)).toBe('https://discord.gg/second');
  });

  it('keeps a refused link and its words when someone else stores another', async () => {
    api.put.mockRejectedValueOnce(refusedWith('An invite link is a web address.'));
    const wrapper = card(market({ discord: CONNECTED }));
    await flushPromises();
    await invite(wrapper).setValue('discord.gg/abc');
    await flushPromises();

    await wrapper.setProps({ market: market({ discord: STORED }) });

    expect(typed(wrapper)).toBe('discord.gg/abc');
    expect(find(wrapper, 'discord-invite-error').text()).toBe('An invite link is a web address.');
  });
});

describe('the "Giving roles" block', () => {
  const ROLE_CHOSEN = { roleId: 'r-vendor', roleName: 'Vendor Test' };
  const QUESTION_CHOSEN = { usernameQuestion: 'discord_username' };
  const ASSIGNED = {
    assignmentObject: { vendorAssignments: [{ email: 'e2e-fern@example.com' }] },
  } as unknown as Partial<Market>;
  const SENTENCE = 'Check who is in the server and give roles on the Vendors page.';
  const NEEDS = {
    role: 'discord-giving-needs-role',
    question: 'discord-giving-needs-question',
    assignment: 'discord-giving-needs-assignment',
  };

  const block = (wrapper: ReturnType<typeof card>) => find(wrapper, 'discord-giving');
  const items = (wrapper: ReturnType<typeof card>) =>
    block(wrapper)
      .findAll('li')
      .map((item) => item.text());
  const routedTo = (wrapper: ReturnType<typeof card>, id: string) =>
    find(wrapper, id).getComponent(RouterLinkStub).props('to');

  /** A click the handler may stop, so the test can read whether the address would have changed. */
  function clickLink(wrapper: ReturnType<typeof card>, id: string): MouseEvent {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    find(wrapper, id).element.dispatchEvent(click);
    return click;
  }
  const withPicker = (wrapper: ReturnType<typeof card>, id: string, showPicker: () => void) =>
    Object.defineProperty(find(wrapper, id).element, 'showPicker', { value: showPicker });

  describe('with everything missing', () => {
    it('says where roles are given, then what is missing, in order, each a link', async () => {
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();

      expect(block(wrapper).text()).toContain('Giving roles');
      expect(block(wrapper).text()).toContain(SENTENCE);
      expect(block(wrapper).text()).toContain('Still needed:');
      expect(items(wrapper)).toEqual([
        'Choose the role to give',
        'Choose the question that asks their Discord username',
        'Make the assignment',
      ]);
      expect(
        block(wrapper)
          .findAll('li a')
          .map((link) => link.attributes('data-testid')),
      ).toEqual([NEEDS.role, NEEDS.question, NEEDS.assignment]);
      expect(find(wrapper, 'discord-giving-vendors').exists()).toBe(false);
      wrapper.unmount();
    });

    it('stands after the choices and the refusal lines', async () => {
      api.put.mockRejectedValueOnce(refusedWith('An invite link is a web address.'));
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();
      await invite(wrapper).setValue('discord.gg/abc');
      await flushPromises();

      const follows = find(wrapper, 'discord-invite-error').element.compareDocumentPosition(
        block(wrapper).element,
      );
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      wrapper.unmount();
    });
  });

  describe('a link to a select on this card', () => {
    it.each([
      [NEEDS.role, 'discord-role-select', '#discord-role'],
      [NEEDS.question, 'discord-question-select', '#discord-question'],
    ])('%s focuses the select and opens it, leaving the address', async (link, select, href) => {
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();
      const showPicker = vi.fn();
      withPicker(wrapper, select, showPicker);

      expect(find(wrapper, link).attributes('href')).toBe(href);
      expect(find(wrapper, select).attributes('id')).toBe(href.slice(1));
      const click = clickLink(wrapper, link);

      expect(click.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(find(wrapper, select).element);
      expect(showPicker).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    describe('where the list cannot open', () => {
      const RESPONSE_MS = 1500;
      const withNoPicker = (wrapper: ReturnType<typeof card>, id: string) =>
        withPicker(wrapper, id, undefined as unknown as () => void);
      /** Its label reads in the link ink; the field itself draws nothing (the design language). */
      const respondsOn = (wrapper: ReturnType<typeof card>, id: string) =>
        wrapper.get(`label[for="${id}"]`).element.closest('[data-responding]') !== null;

      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        [NEEDS.role, 'discord-role-select', 'discord-role', 'discord-question'],
        [NEEDS.question, 'discord-question-select', 'discord-question', 'discord-role'],
      ])(
        '%s focuses the select, and its label alone responds for a moment',
        async (link, select, label, otherLabel) => {
          const wrapper = card(market({ discord: CONNECTED }));
          await flushPromises();
          withNoPicker(wrapper, select);

          clickLink(wrapper, link);
          await nextTick();

          expect(document.activeElement).toBe(find(wrapper, select).element);
          expect(respondsOn(wrapper, label)).toBe(true);
          expect(respondsOn(wrapper, otherLabel)).toBe(false);

          await vi.runAllTimersAsync();
          expect(respondsOn(wrapper, label)).toBe(false);
          wrapper.unmount();
        },
      );

      it('responds the same when the browser refuses to open it', async () => {
        const wrapper = card(market({ discord: CONNECTED }));
        await flushPromises();
        withPicker(wrapper, 'discord-role-select', () => {
          throw new DOMException('Refused', 'NotAllowedError');
        });

        expect(() => clickLink(wrapper, NEEDS.role)).not.toThrow();
        await nextTick();

        expect(document.activeElement).toBe(find(wrapper, 'discord-role-select').element);
        expect(respondsOn(wrapper, 'discord-role')).toBe(true);
        wrapper.unmount();
      });

      it('lasts its full moment from the last click', async () => {
        const wrapper = card(market({ discord: CONNECTED }));
        await flushPromises();
        withNoPicker(wrapper, 'discord-role-select');

        clickLink(wrapper, NEEDS.role);
        await vi.advanceTimersByTimeAsync(RESPONSE_MS - 1);
        clickLink(wrapper, NEEDS.role);
        await vi.advanceTimersByTimeAsync(RESPONSE_MS - 1);
        expect(respondsOn(wrapper, 'discord-role')).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(respondsOn(wrapper, 'discord-role')).toBe(false);
        wrapper.unmount();
      });

      it('moves to the other label at once when the other link is clicked', async () => {
        const wrapper = card(market({ discord: CONNECTED }));
        await flushPromises();
        withNoPicker(wrapper, 'discord-role-select');
        withNoPicker(wrapper, 'discord-question-select');

        clickLink(wrapper, NEEDS.role);
        await nextTick();
        clickLink(wrapper, NEEDS.question);
        await nextTick();

        expect(respondsOn(wrapper, 'discord-role')).toBe(false);
        expect(respondsOn(wrapper, 'discord-question')).toBe(true);
        wrapper.unmount();
      });

      it('leaves no timer running once the card is gone', async () => {
        const wrapper = card(market({ discord: CONNECTED }));
        await flushPromises();
        withNoPicker(wrapper, 'discord-role-select');

        clickLink(wrapper, NEEDS.role);
        wrapper.unmount();

        expect(vi.getTimerCount()).toBe(0);
      });
    });

    it('leaves the label as it is where the list opens', async () => {
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();
      withPicker(wrapper, 'discord-role-select', vi.fn());

      clickLink(wrapper, NEEDS.role);
      await nextTick();

      expect(wrapper.find('[data-responding]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('the username question', () => {
    it('sends a form with no text question to the form page, not an empty select', async () => {
      const wrapper = card(
        market({
          discord: CONNECTED,
          applicationForm: { fields: FIELDS.filter((field) => field.type !== 'text') },
        } as Partial<Market>),
      );
      await flushPromises();

      expect(find(wrapper, NEEDS.question).text()).toBe(
        'Add a question that asks their Discord username',
      );
      expect(routedTo(wrapper, NEEDS.question)).toBe('/markets/market-123/form');
      wrapper.unmount();
    });

    it('reads a market with no form as one with no text question', async () => {
      const wrapper = card(market({ discord: CONNECTED, applicationForm: null }));
      await flushPromises();

      expect(routedTo(wrapper, NEEDS.question)).toBe('/markets/market-123/form');
      wrapper.unmount();
    });

    it.each([
      ['gone from the form', 'left_the_form'],
      ['no longer a text question', 'days'],
    ])('is back on the list when the chosen one is %s, as the select reads it', async (_, key) => {
      const wrapper = card(market({ discord: { ...CONNECTED, usernameQuestion: key } }));
      await flushPromises();

      expect(find(wrapper, NEEDS.question).text()).toBe(
        'Choose the question that asks their Discord username',
      );
      expect((find(wrapper, 'discord-question-select').element as HTMLSelectElement).value).toBe(
        '',
      );
      wrapper.unmount();
    });
  });

  describe('the assignment', () => {
    it.each(['draft', 'applications', 'assignment', 'offers', 'market_days'])(
      'links to the Settings page in %s',
      async (phase) => {
        const wrapper = card(market({ discord: CONNECTED, phase } as Partial<Market>));
        await flushPromises();

        expect(find(wrapper, NEEDS.assignment).text()).toBe('Make the assignment');
        expect(routedTo(wrapper, NEEDS.assignment)).toBe('/markets/market-123/settings');
        wrapper.unmount();
      },
    );

    it('reads an assignment with nobody placed as none', async () => {
      const wrapper = card(
        market({
          discord: CONNECTED,
          assignmentObject: { vendorAssignments: [] },
        } as unknown as Partial<Market>),
      );
      await flushPromises();

      expect(find(wrapper, NEEDS.assignment).exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('as the choices are made', () => {
    it('lists only what is missing', async () => {
      const wrapper = card(market({ discord: { ...CONNECTED, ...ROLE_CHOSEN }, ...ASSIGNED }));
      await flushPromises();

      expect(items(wrapper)).toEqual(['Choose the question that asks their Discord username']);
      wrapper.unmount();
    });

    it('takes the role off once its save has re-read the market, with no reload', async () => {
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();

      await find(wrapper, 'discord-role-select').setValue('r-vendor');
      await flushPromises();
      expect(wrapper.emitted('changed')).toHaveLength(1);
      expect(find(wrapper, NEEDS.role).exists()).toBe(true);

      await wrapper.setProps({ market: market({ discord: { ...CONNECTED, ...ROLE_CHOSEN } }) });

      expect(find(wrapper, NEEDS.role).exists()).toBe(false);
      expect(items(wrapper)).toEqual([
        'Choose the question that asks their Discord username',
        'Make the assignment',
      ]);
      wrapper.unmount();
    });

    it('takes the question off once its save has re-read the market', async () => {
      const wrapper = card(market({ discord: CONNECTED }));
      await flushPromises();

      await find(wrapper, 'discord-question-select').setValue('discord_username');
      await flushPromises();
      await wrapper.setProps({
        market: market({ discord: { ...CONNECTED, ...QUESTION_CHOSEN } }),
      });

      expect(items(wrapper)).toEqual(['Choose the role to give', 'Make the assignment']);
      wrapper.unmount();
    });

    it('counts a role above the bot`s as chosen, and leaves that to its warning', async () => {
      const wrapper = card(
        market({ discord: { ...CONNECTED, roleId: 'r-mod', roleName: 'Moderator' } }),
      );
      await flushPromises();

      expect(find(wrapper, 'discord-role-warning').exists()).toBe(true);
      expect(find(wrapper, NEEDS.role).exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('with nothing missing', () => {
    const complete = (overrides: Partial<Market> = {}) =>
      market({
        discord: { ...CONNECTED, ...ROLE_CHOSEN, ...QUESTION_CHOSEN },
        ...ASSIGNED,
        ...overrides,
      });

    it('has no list, and one link to the Vendors page', async () => {
      const wrapper = card(complete());
      await flushPromises();

      expect(block(wrapper).text()).toContain(SENTENCE);
      expect(block(wrapper).text()).not.toContain('Still needed:');
      expect(block(wrapper).find('li').exists()).toBe(false);
      expect(find(wrapper, 'discord-giving-vendors').text()).toBe('Give roles on Vendors');
      expect(routedTo(wrapper, 'discord-giving-vendors')).toBe('/markets/market-123/vendors');
      wrapper.unmount();
    });

    it('returns to the list when the assignment goes', async () => {
      const wrapper = card(complete());
      await flushPromises();

      await wrapper.setProps({ market: complete({ assignmentObject: undefined }) });

      expect(items(wrapper)).toEqual(['Make the assignment']);
      expect(find(wrapper, 'discord-giving-vendors').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('who reads no block', () => {
    const CHOSEN = { ...CONNECTED, ...ROLE_CHOSEN, ...QUESTION_CHOSEN };

    it.each([
      ['someone the row refuses', market({ discord: CHOSEN }, MarketAction.ConnectDiscord)],
      [
        'an archived market',
        market(
          { discord: CHOSEN, phase: 'archived' } as Partial<Market>,
          MarketAction.ConnectDiscord,
        ),
      ],
      ['a Conventioner without Discord`s values', market({ discord: CHOSEN, discordSetUp: false })],
      ['a market not connected', market()],
    ])('%s', async (_, served) => {
      const wrapper = card(served);
      await flushPromises();

      expect(block(wrapper).exists()).toBe(false);
      wrapper.unmount();
    });
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
