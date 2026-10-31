/**
 * Who is in the server (E46/F01/S03): the Vendors page shows each vendor's Discord state, as the
 * last "Check Discord" found it, with a filter, and offers the check to whoever the table's
 * "Connect Discord and give roles" row allows on a market connected to a server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import VendorsView from '@/views/VendorsView.vue';
import VendorIdentity from '@/components/VendorIdentity.vue';
import type { Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import {
  checkedAgo,
  discordStateFrom,
  discordStateLabel,
  discordStates,
  mayCheckDiscord,
} from '@/utils/discordCheck';
import { answersRefusing } from './support/servedAnswers';
import { MARKET_ID, serveMarket } from './support/marketScreen';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const route = vi.hoisted(() => ({
  name: 'market-vendors',
  params: { marketId: 'market-1' },
  query: {} as Record<string, string>,
}));
const replace = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useRoute: () => route,
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: vi.fn(() =>
      Promise.resolve(
        ['ana', 'ben', 'cy', 'dee', 'eve'].map((name) => ({
          id: `app-${name}`,
          applicantEmail: `${name}@thistle.test`,
          status: 'reviewer_approved',
          formData: {},
        })),
      ),
    ),
  };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'owner@market.test' }));

const CHECKED_AT = '2026-10-31T12:00:00+00:00';

function market(overrides: Partial<Market> = {}, refusal: string | null = null): Market {
  return {
    id: MARKET_ID,
    name: 'Riverside Spring',
    phase: 'market_days',
    roles: {},
    setupObject: { marketDates: [], tiers: [], locations: [], sections: [], priority: [] },
    assignmentObject: { vendorAssignments: [], assignmentDate: null },
    applicationForm: { fields: [] },
    discordSetUp: true,
    discord: {
      guildId: '2909267986263572999',
      guildName: 'Riverside Makers',
      usernameQuestion: 'discord_username',
      checkedAt: CHECKED_AT,
      vendorStates: [
        { applicationId: 'app-ana', state: 'has_role' },
        { applicationId: 'app-ben', state: 'in_server' },
        { applicationId: 'app-cy', state: 'not_found' },
        { applicationId: 'app-dee', state: 'no_username' },
        { applicationId: 'app-eve', state: 'not_found' },
      ],
    },
    actionRefusals: { ...answersRefusing(), [MarketAction.ConnectDiscord]: refusal },
    ...overrides,
  } as unknown as Market;
}

async function mounted(served: Market) {
  serveMarket(api.get, served as unknown as Record<string, unknown>);
  const wrapper = mount(VendorsView, { shallow: true, global: { stubs: { MarketFrame: false } } });
  await vi.waitFor(() => {
    expect(wrapper.findAll('[data-testid="vendors-list-item"]')).toHaveLength(5);
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.post.mockReset();
  replace.mockReset();
  route.query = {};
});

describe('a vendor as the check found them', () => {
  it('reads each state in words', () => {
    expect(discordStateLabel('has_role')).toBe('Has the role');
    expect(discordStateLabel('in_server')).toBe('In the server');
    expect(discordStateLabel('not_found')).toBe('Not found');
    expect(discordStateLabel('no_username')).toBe('No username');
  });

  it('is kept by application, and a state this build does not know is none', () => {
    const states = discordStates({
      discord: {
        vendorStates: [
          { applicationId: 'app-ana', state: 'has_role' },
          { applicationId: 'app-ben', state: 'a_later_state' },
        ],
      },
    } as unknown as Market);

    expect(states.get('app-ana')).toBe('has_role');
    expect(states.has('app-ben')).toBe(false);
  });

  it('says when it was checked', () => {
    const at = Date.parse(CHECKED_AT);
    expect(checkedAgo(CHECKED_AT, at + 20_000)).toBe('Checked just now');
    expect(checkedAgo(CHECKED_AT, at + 5 * 60_000)).toBe('Checked 5 minutes ago');
    expect(checkedAgo(CHECKED_AT, at + 60 * 60_000)).toBe('Checked 1 hour ago');
    expect(checkedAgo(CHECKED_AT, at + 50 * 60 * 60_000)).toBe('Checked 2 days ago');
  });

  it('is filtered by a state in the address, and nothing else is a filter', () => {
    expect(discordStateFrom('not_found')).toBe('not_found');
    expect(discordStateFrom('nobody')).toBeNull();
    expect(discordStateFrom(undefined)).toBeNull();
  });
});

describe('who may check', () => {
  it('is whoever the row allows, on a connected market with a username question', () => {
    expect(mayCheckDiscord(market())).toBe(true);
    expect(mayCheckDiscord(market({}, 'Only an Admin or the owner may.'))).toBe(false);
    expect(mayCheckDiscord(market({ discord: { usernameQuestion: 'discord_username' } }))).toBe(
      false,
    );
    expect(mayCheckDiscord(market({ discordSetUp: false }))).toBe(false);
  });
});

describe('the Vendors page', () => {
  it('shows each vendor’s state in its Discord column', async () => {
    const wrapper = await mounted(market());

    expect(
      wrapper.findAll('[data-testid="vendors-list-discord"]').map((chip) => chip.text()),
    ).toEqual([
      // Said as Discord's to a screen reader, which reads the chip without its column.
      'Discord: Has the role',
      'Discord: In the server',
      'Discord: Not found',
      'Discord: No username',
      'Discord: Not found',
    ]);
    expect(wrapper.find('[data-testid="vendors-discord-checked"]').text()).toMatch(/^Checked /);
  });

  it('lists exactly the vendors not found, under that filter', async () => {
    route.query = { discord: 'not_found' };
    const wrapper = await mountedFiltered(market());

    expect(
      wrapper.findAllComponents(VendorIdentity).map((identity) => identity.props('email')),
    ).toEqual(['cy@thistle.test', 'eve@thistle.test']);
    expect(wrapper.find('[data-testid="vendors-summary"]').text()).toMatch(
      /2\s+of\s+5\s+vendors shown/,
    );
  });

  it('puts the chosen state in the address', async () => {
    const wrapper = await mounted(market());

    await wrapper.find('[data-testid="vendors-discord-filter"]').setValue('no_username');

    expect(replace).toHaveBeenCalledWith({ query: { discord: 'no_username' } });
  });

  it('shows no Discord column or filter before a check', async () => {
    const wrapper = await mounted(
      market({ discord: { guildId: '2909267986263572999', usernameQuestion: 'discord_username' } }),
    );

    expect(wrapper.find('[data-testid="vendors-list-discord"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendors-discord-filter"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendors-discord-check"]').exists()).toBe(true);
  });

  it('checks, then reads the market again', async () => {
    const wrapper = await mounted(market());
    api.post.mockResolvedValue({ data: { counts: {}, checkedAt: CHECKED_AT } });
    const reads = api.get.mock.calls.filter(([url]) => url === `/markets/${MARKET_ID}`).length;

    await wrapper.find('[data-testid="vendors-discord-check"]').trigger('click');

    expect(api.post).toHaveBeenCalledWith(`/markets/${MARKET_ID}/discord/check`);
    await vi.waitFor(() => {
      expect(api.get.mock.calls.filter(([url]) => url === `/markets/${MARKET_ID}`).length).toBe(
        reads + 1,
      );
    });
  });

  it('says why a check was refused, in the server’s words', async () => {
    const wrapper = await mounted(market());
    api.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'Choose the username question again.' } },
    });

    await wrapper.find('[data-testid="vendors-discord-check"]').trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="vendors-discord-error"]').text()).toBe(
        'Choose the username question again.',
      );
    });
  });

  it('offers no check to someone the row refuses', async () => {
    const wrapper = await mounted(market({}, 'Only an Admin or the owner may.'));

    expect(wrapper.find('[data-testid="vendors-discord-check"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="vendors-list-discord"]')).toHaveLength(5);
  });
});

/** The page mounted with a filter set: fewer rows than the market's five. */
async function mountedFiltered(served: Market) {
  serveMarket(api.get, served as unknown as Record<string, unknown>);
  const wrapper = mount(VendorsView, { shallow: true, global: { stubs: { MarketFrame: false } } });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="vendors-list-item"]').exists()).toBe(true);
  });
  return wrapper;
}
