/**
 * Giving the market's role (E46/F01/S04): "Give roles" on the Vendors page confirms first, by the
 * role's name and how many vendors hold a seat, then asks the server, and the last run's report
 * reads by group for every reader.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import VendorsView from '@/views/VendorsView.vue';
import type { Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import {
  giveRolesQuestion,
  mayGiveRoles,
  roleRunCounts,
  roleRunGroups,
  roleRunSummary,
} from '@/utils/discordRoles';
import { answersRefusing } from './support/servedAnswers';
import { MARKET_ID, serveMarket } from './support/marketScreen';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const route = vi.hoisted(() => ({
  name: 'market-vendors',
  params: { marketId: 'market-1' },
  query: {} as Record<string, string>,
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
        ['ana', 'ben', 'cy'].map((name) => ({
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

const RAN_AT = '2026-10-31T12:00:00+00:00';
const DATE = '2026-11-18';
const ROLE_ABOVE =
  'Conventioner’s role is below Vendor Nov 2026, or may not manage roles. In Discord, open ' +
  'Server Settings, then Roles, and drag the Conventioner role above it.';

function seat(email: string, table: string) {
  return {
    email,
    date: DATE,
    tableCode: table,
    tableChoice: 'Full Table',
    section: 'A',
    tier: 'Gold',
    location: 'Atrium',
    handPlaced: false,
  };
}

function market(overrides: Partial<Market> = {}, refusal: string | null = null): Market {
  return {
    id: MARKET_ID,
    name: 'Riverside Spring',
    phase: 'market_days',
    roles: {},
    setupObject: {
      marketDates: [{ date: DATE }],
      tiers: [{ name: 'Gold' }],
      locations: [{ name: 'Atrium' }],
      sections: [{ name: 'A', count: 2, tier: { name: 'Gold' }, location: { name: 'Atrium' } }],
      priority: [],
    },
    assignmentObject: {
      vendorAssignments: [seat('ana@thistle.test', 'A-1'), seat('ben@thistle.test', 'A-2')],
      assignmentDate: '2026-10-30T00:00:00+00:00',
    },
    applicationForm: { fields: [] },
    discordSetUp: true,
    discord: {
      guildId: '2909267986263572999',
      guildName: 'Riverside Makers',
      roleId: '2909267986263573001',
      roleName: 'Vendor Nov 2026',
      usernameQuestion: 'discord_username',
    },
    actionRefusals: { ...answersRefusing(), [MarketAction.ConnectDiscord]: refusal },
    ...overrides,
  } as unknown as Market;
}

const RUN = {
  ranAt: RAN_AT,
  roleName: 'Vendor Nov 2026',
  outcomes: [
    { applicationId: 'app-ana', outcome: 'given', reason: null },
    { applicationId: 'app-ben', outcome: 'failed', reason: ROLE_ABOVE },
    { applicationId: 'app-cy', outcome: 'failed', reason: ROLE_ABOVE },
  ],
};

async function mounted(served: Market) {
  const seats = served.assignmentObject?.vendorAssignments ?? [];
  serveMarket(api.get, served as unknown as Record<string, unknown>, (url) =>
    Promise.resolve({
      data: url.endsWith('/tables')
        ? {
            rows: seats.map((each) => ({ ...each, assignment: [each.email] })),
            vendorNames: {},
          }
        : {},
    }),
  );
  const wrapper = mount(VendorsView, {
    attachTo: document.body,
    shallow: true,
    global: {
      stubs: {
        MarketFrame: false,
        GiveRolesDialog: false,
        AppDialog: false,
        DiscordRoleReport: false,
        VendorIdentity: false,
      },
    },
  });
  await vi.waitFor(() => {
    expect(wrapper.findAll('[data-testid="vendors-list-item"]')).toHaveLength(3);
  });
  return wrapper;
}

const marketReads = () => api.get.mock.calls.filter(([url]) => url === `/markets/${MARKET_ID}`);

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.post.mockReset();
  route.query = {};
  document.body.innerHTML = '';
});

describe('who may give the role', () => {
  it('is whoever may check, on a market whose card names a role', () => {
    expect(mayGiveRoles(market())).toBe(true);
    expect(mayGiveRoles(market({}, 'Only an Admin or the owner may.'))).toBe(false);
    expect(
      mayGiveRoles(
        market({
          discord: { guildId: '2909267986263572999', usernameQuestion: 'discord_username' },
        }),
      ),
    ).toBe(false);
    expect(mayGiveRoles(market({ discordSetUp: false }))).toBe(false);
  });
});

describe('the confirmation', () => {
  it('names the role and how many hold a seat', () => {
    expect(giveRolesQuestion('Vendor Nov 2026', 54)).toBe(
      'Give Vendor Nov 2026 to 54 assigned vendors?',
    );
    expect(giveRolesQuestion('Vendor Nov 2026', 1)).toBe(
      'Give Vendor Nov 2026 to 1 assigned vendor?',
    );
    expect(giveRolesQuestion('Vendor Nov 2026', null)).toBe(
      'Give Vendor Nov 2026 to every assigned vendor?',
    );
  });
});

describe('the report', () => {
  it('groups the vendors by outcome, a shared failure said once', () => {
    expect(roleRunGroups(RUN)).toEqual([
      { outcome: 'given', reason: '', applicationIds: ['app-ana'] },
      { outcome: 'failed', reason: ROLE_ABOVE, applicationIds: ['app-ben', 'app-cy'] },
    ]);
  });

  it('counts each outcome in words', () => {
    expect(roleRunSummary(roleRunCounts(RUN))).toBe('1 given, 2 failed');
    expect(roleRunSummary(roleRunCounts({ ...RUN, outcomes: [] }))).toBe('no assigned vendors');
  });

  it('groups the vendors a run had no time for, its reason said once', () => {
    const NOT_YET =
      'Not given yet: a run asks Discord for a few seconds at most, and Discord was still ' +
      'pacing it. Give roles again to finish.';
    const stopped = {
      ...RUN,
      outcomes: [
        { applicationId: 'app-ana', outcome: 'given', reason: null },
        { applicationId: 'app-ben', outcome: 'not_yet', reason: NOT_YET },
        { applicationId: 'app-cy', outcome: 'not_yet', reason: NOT_YET },
      ],
    };

    expect(roleRunGroups(stopped)).toEqual([
      { outcome: 'given', reason: '', applicationIds: ['app-ana'] },
      { outcome: 'not_yet', reason: NOT_YET, applicationIds: ['app-ben', 'app-cy'] },
    ]);
    expect(roleRunSummary(roleRunCounts(stopped))).toBe('1 given, 2 not given yet');
  });

  it('leaves out an outcome this build does not know', () => {
    const later = { ...RUN, outcomes: [{ applicationId: 'app-ana', outcome: 'queued' }] };
    expect(roleRunGroups(later)).toEqual([]);
    expect(roleRunSummary(roleRunCounts(later))).toBe('no assigned vendors');
  });
});

describe('the Vendors page', () => {
  it('confirms by the role’s name and the vendors holding a seat, then gives', async () => {
    const wrapper = await mounted(market());
    api.post.mockResolvedValue({ data: { counts: {}, ranAt: RAN_AT } });
    const reads = marketReads().length;

    await wrapper.find('[data-testid="vendors-discord-give"]').trigger('click');

    const dialog = document.querySelector('[data-testid="give-roles-window"]');
    expect(dialog?.textContent).toContain('Give Vendor Nov 2026 to 2 assigned vendors?');
    expect(dialog?.textContent).toContain('never takes a role away');
    expect(api.post).not.toHaveBeenCalled();

    (document.querySelector('[data-testid="give-roles-submit-button"]') as HTMLElement).click();

    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(`/markets/${MARKET_ID}/discord/role-run`);
      expect(marketReads().length).toBe(reads + 1);
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="give-roles-window"]')).toBeNull();
    });
  });

  it('offers no run while a check reads the server', async () => {
    const wrapper = await mounted(market());
    api.post.mockReturnValue(new Promise(() => {}));

    await wrapper.find('[data-testid="vendors-discord-check"]').trigger('click');

    expect(
      wrapper.find('[data-testid="vendors-discord-give"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('offers no check while a run gives the role', async () => {
    const wrapper = await mounted(market());
    api.post.mockReturnValue(new Promise(() => {}));

    await wrapper.find('[data-testid="vendors-discord-give"]').trigger('click');
    (document.querySelector('[data-testid="give-roles-submit-button"]') as HTMLElement).click();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="vendors-discord-check"]').attributes('disabled')).toBe('');
    });
    expect(wrapper.find('[data-testid="vendors-discord-give"]').text()).toBe('Giving roles…');
  });

  it('says why a run was refused, in the server’s words, and reads the market again', async () => {
    const wrapper = await mounted(market());
    api.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'Choose the role to give on the Discord card.' } },
    });
    const reads = marketReads().length;

    await wrapper.find('[data-testid="vendors-discord-give"]').trigger('click');
    (document.querySelector('[data-testid="give-roles-submit-button"]') as HTMLElement).click();

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="give-roles-error"]')?.textContent).toContain(
        'Choose the role to give on the Discord card.',
      );
    });
    expect(marketReads().length).toBe(reads + 1);
  });

  it('offers no run to someone the row refuses, who still reads the report', async () => {
    const wrapper = await mounted(
      market(
        { discord: { ...market().discord, roleRun: RUN } } as Partial<Market>,
        'Only an Admin or the owner may.',
      ),
    );

    expect(wrapper.find('[data-testid="vendors-discord-give"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendors-role-report"]').text()).toContain('Vendor Nov 2026');
  });

  it('offers no run before anyone holds a seat', async () => {
    const wrapper = await mounted(
      market({ assignmentObject: { vendorAssignments: [], assignmentDate: null } } as never),
    );

    expect(wrapper.find('[data-testid="vendors-discord-give"]').exists()).toBe(false);
  });

  it('shows the last run’s report by group, each vendor named, a failure’s reason once', async () => {
    const wrapper = await mounted(
      market({ discord: { ...market().discord, roleRun: RUN } } as Partial<Market>),
    );
    const report = wrapper.find('[data-testid="vendors-role-report"]');

    expect(report.find('[data-testid="vendors-role-report-summary"]').text()).toBe(
      '1 given, 2 failed',
    );
    await report.find('[data-testid="vendors-role-report-toggle"]').trigger('click');

    const groups = report.findAll('[data-testid="vendors-role-report-group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0].text()).toContain('Given');
    expect(groups[0].text()).toContain('ana@thistle.test');
    expect(groups[1].text()).toContain('Failed');
    expect(groups[1].findAll('[data-testid="vendors-role-report-reason"]')).toHaveLength(1);
    expect(groups[1].text()).toContain('ben@thistle.test');
    expect(groups[1].text()).toContain('cy@thistle.test');
  });
});
