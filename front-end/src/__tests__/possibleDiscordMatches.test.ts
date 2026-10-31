/**
 * Possible matches, confirmed into an update (E46/F01/S05): a vendor the check did not find is
 * offered the members whose name looks like the username on file, each "Possible match: <name>
 * @<username>". Confirming saves the member's username as an update of the vendor's answer, the
 * ordinary one (E41/F01/S01); declining keeps them "Not found"; and a username updated since the
 * check reads "Check again" until the next check. Which of those a vendor shows is the server's
 * (`shown_vendors`, pinned in `back-end/tests/test_discord_connection.py`); this reads and says it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import VendorDiscordOffer from '@/components/VendorDiscordOffer.vue';
import {
  DISCORD_SHOWN,
  discordShownChip,
  discordShownFrom,
  discordShownLabel,
  discordVendors,
} from '@/utils/discordCheck';
import {
  ApplicationStatus,
  ApplicationType,
  type Application,
  type Market,
} from '@/assets/types/datatypes';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/stores/market', () => ({ useMarketStore: () => ({ refresh }) }));

const QUESTION = 'discord_username';
const FERN = { username: 'fern_studio_42', displayName: 'Fern Studio' };
const FERN_TOO = { username: 'fernstudio', nick: 'Fern' };

function app(id: string, answer?: string, overrides: Partial<Application> = {}): Application {
  return {
    id,
    marketId: 'market-1',
    applicantEmail: `${id}@thistle.test`,
    formData: answer === undefined ? {} : { [QUESTION]: answer },
    status: ApplicationStatus.ReviewerApproved,
    applicationType: ApplicationType.Main,
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const OFFERED = {
  applicationId: 'app-fern',
  state: 'not_found',
  shown: 'possible_match',
  possibleMatches: [FERN, FERN_TOO],
  moreMatches: 0,
};

function market(fern: Record<string, unknown> = {}): Market {
  return {
    id: 'market-1',
    applicationForm: {
      fields: [
        {
          key: QUESTION,
          label: 'Discord Username',
          type: 'text',
          required: false,
          options: [],
          order: 0,
        },
      ],
    },
    discord: {
      guildId: '2909267986263572999',
      guildName: 'Riverside Makers',
      usernameQuestion: QUESTION,
      checkedAt: '2026-10-31T12:00:00+00:00',
    },
    discordVendors: [
      { ...OFFERED, ...fern },
      {
        applicationId: 'app-oak',
        state: 'not_found',
        shown: 'not_found',
        possibleMatches: [],
        moreMatches: 0,
      },
      {
        applicationId: 'app-ash',
        state: 'in_server',
        shown: 'in_server',
        possibleMatches: [],
        moreMatches: 0,
      },
      {
        applicationId: 'app-elm',
        state: 'no_username',
        shown: 'check_again',
        possibleMatches: [],
        moreMatches: 0,
      },
      {
        applicationId: 'app-new',
        state: 'gone_fishing',
        shown: 'gone_fishing',
        possibleMatches: [],
        moreMatches: 0,
      },
    ],
  } as unknown as Market;
}

const APPS = [app('app-fern', 'Fern Studio'), app('app-oak', 'oak'), app('app-ash', 'ash')];

describe('what the page shows of each vendor', () => {
  it('is what the server says it shows, with the members it still offers', () => {
    const shown = discordVendors(market());

    expect(shown.get('app-fern')).toEqual({
      state: 'not_found',
      shown: 'possible_match',
      matches: [FERN, FERN_TOO],
      moreMatches: 0,
    });
    expect(shown.get('app-oak')?.shown).toBe('not_found');
    expect(shown.get('app-ash')?.shown).toBe('in_server');
    expect(shown.get('app-elm')?.shown).toBe('check_again');
  });

  it('leaves out a value this build does not know, and is empty before a check', () => {
    expect(discordVendors(market()).has('app-new')).toBe(false);
    expect(discordVendors({ ...market(), discordVendors: undefined }).size).toBe(0);
  });

  it('says each in words, and in the address', () => {
    expect(DISCORD_SHOWN.map(discordShownLabel)).toEqual([
      'Has the role',
      'In the server',
      'Possible match',
      'Not found',
      'No username',
      'Check again',
    ]);
    expect(discordShownChip('possible_match')).toBe('chip chip--attention');
    expect(discordShownChip('check_again')).toBe('chip chip--neutral');
    expect(discordShownFrom('possible_match')).toBe('possible_match');
    expect(discordShownFrom('check_again')).toBe('check_again');
    expect(discordShownFrom('nobody')).toBeNull();
  });
});

const testid = (id: string) => `[data-testid="${id}"]`;

function offer(
  props: Partial<{ market: Market; application: Application; canAnswer: boolean }> = {},
) {
  const m = props.market ?? market();
  const a = props.application ?? APPS[0];
  return mount(VendorDiscordOffer, {
    props: {
      market: m,
      application: a,
      vendor: discordVendors(m).get(a.id) ?? null,
      canAnswer: props.canAnswer ?? true,
    },
    attachTo: document.body,
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.put.mockReset();
  api.post.mockReset();
  refresh.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the drawer’s offer', () => {
  it('offers each member as “Possible match: <name> @<username>”, saying how many look alike', () => {
    const wrapper = offer();

    const matches = wrapper.findAll(testid('vendors-detail-discord-match'));
    expect(matches.map((m) => m.find('.discord-match-who').text())).toEqual([
      'Possible match: Fern Studio @fern_studio_42',
      'Possible match: Fern @fernstudio',
    ]);
    expect(wrapper.find('.discord-offer-lead').text()).toBe(
      'No member of Riverside Makers has the username “Fern Studio”. 2 members whose names look like it may be them.',
    );
    expect(wrapper.find(testid('vendors-detail-discord-more')).exists()).toBe(false);
    expect(wrapper.findAll(testid('vendors-detail-discord-confirm'))).toHaveLength(2);
    expect(wrapper.findAll(testid('vendors-detail-discord-decline'))).toHaveLength(2);
  });

  it('says “A member” for one alike', () => {
    const wrapper = offer({ market: market({ possibleMatches: [FERN] }) });

    expect(wrapper.find('.discord-offer-lead').text()).toBe(
      'No member of Riverside Makers has the username “Fern Studio”. A member whose name looks like it may be them.',
    );
  });

  it('counts the members alike past the five offered, and says how many are not shown', () => {
    const five = Array.from({ length: 5 }, (_, n) => ({
      username: `fern${n}`,
      displayName: 'Fern',
    }));
    const wrapper = offer({ market: market({ possibleMatches: five, moreMatches: 3 }) });

    expect(wrapper.findAll(testid('vendors-detail-discord-match'))).toHaveLength(5);
    expect(wrapper.find('.discord-offer-lead').text()).toContain(
      '8 members whose names look like it may be them.',
    );
    expect(wrapper.find(testid('vendors-detail-discord-more')).text()).toBe(
      'And 3 more not shown.',
    );
  });

  it('confirms in a dialog, then saves the member’s username as an update of their answer', async () => {
    api.put.mockResolvedValue({ data: { application: APPS[0] } });
    const wrapper = offer();

    await wrapper.find(testid('vendors-detail-discord-confirm')).trigger('click');
    const dialog = document.querySelector(testid('discord-match-confirm-window'));
    expect(dialog?.textContent).toContain('They wrote');
    expect(dialog?.textContent).toContain('Fern Studio');
    expect(dialog?.textContent).toContain('fern_studio_42');
    expect(api.put).not.toHaveBeenCalled();

    (document.querySelector(testid('discord-match-confirm-submit-button')) as HTMLElement).click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/applications/app-fern/answers', {
      answers: { [QUESTION]: 'fern_studio_42' },
    });
    expect(wrapper.emitted('confirmed')).toHaveLength(1);
  });

  it('cancelling the dialog saves nothing', async () => {
    const wrapper = offer();

    await wrapper.find(testid('vendors-detail-discord-confirm')).trigger('click');
    (document.querySelector(testid('discord-match-confirm-cancel-button')) as HTMLElement).click();
    await flushPromises();

    expect(api.put).not.toHaveBeenCalled();
    expect(wrapper.emitted('confirmed')).toBeUndefined();
  });

  it('says why a confirmation was refused, in the server’s words', async () => {
    api.put.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { error: 'Only an Editor, an Admin or the owner may.' } },
    });
    const wrapper = offer();

    await wrapper.find(testid('vendors-detail-discord-confirm')).trigger('click');
    (document.querySelector(testid('discord-match-confirm-submit-button')) as HTMLElement).click();
    await flushPromises();

    expect(document.querySelector(testid('discord-match-confirm-error'))?.textContent).toContain(
      'Only an Editor, an Admin or the owner may.',
    );
  });

  it('declines a member, then reads the market again', async () => {
    api.post.mockResolvedValue({ data: { message: 'Declined' } });
    const wrapper = offer();

    await wrapper.findAll(testid('vendors-detail-discord-decline'))[1].trigger('click');
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      '/markets/market-1/discord/possible-matches/app-fern/declined',
      { username: 'fernstudio' },
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('says why a decline was refused', async () => {
    api.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'That member is not offered.' } },
    });
    const wrapper = offer();

    await wrapper.find(testid('vendors-detail-discord-decline')).trigger('click');
    await flushPromises();

    expect(wrapper.find(testid('vendors-detail-discord-error')).text()).toBe(
      'That member is not offered.',
    );
  });

  it('shows the members without a control to someone who may not answer', () => {
    const wrapper = offer({ canAnswer: false });

    expect(wrapper.findAll(testid('vendors-detail-discord-match'))).toHaveLength(2);
    expect(wrapper.find(testid('vendors-detail-discord-confirm')).exists()).toBe(false);
    expect(wrapper.find(testid('vendors-detail-discord-decline')).exists()).toBe(false);
  });

  it('says to check again once the username was updated since the check', () => {
    const wrapper = offer({
      market: market({ shown: 'check_again', possibleMatches: [] }),
      application: app('app-fern', 'fern_studio_42'),
    });

    expect(wrapper.find(testid('vendors-detail-discord')).text()).toContain(
      'Their username was updated after the last check. Check Discord again to see whether they are in the server.',
    );
    expect(wrapper.find(testid('vendors-detail-discord-match')).exists()).toBe(false);
  });

  it('shows nothing for a vendor the check found', () => {
    const ash = APPS[2];
    const wrapper = offer({ application: ash });

    expect(wrapper.find(testid('vendors-detail-discord')).exists()).toBe(false);
  });
});
