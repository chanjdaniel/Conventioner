/**
 * Giving the market's role (E46/F01/S04): "Give roles" on the Vendors page confirms first, by the
 * role's name and how many vendors hold a seat, then asks the server, and the last run's report
 * reads by group for every reader.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import VendorsView from '@/views/VendorsView.vue';
import type { Market, ServedDiscordVendor } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import {
  giveRolesQuestion,
  mayGiveRoles,
  rolesStillNeed,
  roleRunCounts,
  roleRunGroups,
  roleRunPossibleMatches,
  roleRunSummary,
} from '@/utils/discordRoles';
import { hasAssignment } from '@/utils/marketPage';
import { answersRefusing } from './support/servedAnswers';
import { MARKET_ID, serveMarket } from './support/marketScreen';
import { tryEveryClose } from './support/dialogCloses';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const route = vi.hoisted(() => ({
  name: 'market-vendors',
  params: { marketId: 'market-1' },
  query: {} as Record<string, string>,
  matched: [],
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
        ListFrame: false,
        GiveRolesDialog: false,
        AppDialog: false,
        ScrollBox: false,
        // What holds a `scroll="body"` dialog's title and body; a stub would drop them.
        Unwrapped: false,
        // What draws a dialog's title; a stub would leave it blank.
        EmailAddress: false,
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

/** "Show who" opens the groups in a dialog. */
async function openWho(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="vendors-role-report-open"]').trigger('click');
}

async function click(wrapper: VueWrapper, testid: string) {
  await wrapper.find(`[data-testid="${testid}"]`).trigger('click');
}

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

describe('what is still needed before a run', () => {
  const TEXT_QUESTION = { key: 'discord_username', label: 'Discord Username', type: 'text' };
  const form = { applicationForm: { fields: [TEXT_QUESTION] } } as Partial<Market>;
  const GUILD = { guildId: '2909267986263572999', guildName: 'Riverside Makers' };

  it('is nothing on a market ready to run, for whoever reads it', () => {
    expect(rolesStillNeed(market(form))).toEqual([]);
    expect(rolesStillNeed(market(form, 'Only an Admin or the owner may.'))).toEqual([]);
  });

  it('is each thing missing, and only that', () => {
    expect(
      rolesStillNeed(market({ ...form, discord: GUILD, assignmentObject: undefined })),
    ).toEqual(['role', 'question', 'assignment']);
    expect(rolesStillNeed(market({ ...form, discord: { ...GUILD, roleId: 'r' } }))).toEqual([
      'question',
    ]);
    expect(
      rolesStillNeed(
        market({ ...form, discord: { ...GUILD, usernameQuestion: 'discord_username' } }),
      ),
    ).toEqual(['role']);
    expect(rolesStillNeed(market({ ...form, assignmentObject: undefined }))).toEqual([
      'assignment',
    ]);
  });

  it('reads a question gone from the form as missing, though the run is still offered', () => {
    const left = market({ applicationForm: { fields: [] } } as Partial<Market>);

    expect(rolesStillNeed(left)).toEqual(['question']);
    expect(mayGiveRoles(left)).toBe(true);
  });

  it('reads a market with no form as no question, and no market as nothing yet', () => {
    expect(rolesStillNeed(market({ applicationForm: null }))).toEqual(['question']);
    expect(rolesStillNeed(null)).toEqual(['role', 'question', 'assignment']);
  });

  it('with nothing missing, is what Vendors offers the run on, for someone the row allows', () => {
    const ready = market(form);

    expect(rolesStillNeed(ready)).toEqual([]);
    expect(mayGiveRoles(ready) && hasAssignment(ready)).toBe(true);
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
      'A run asks Discord for under a minute, and Discord was still pacing it. ' +
      'Give roles again to finish.';
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

  it('says how many not found have a possible match since, beside the count', () => {
    const missed = {
      ...RUN,
      outcomes: [
        { applicationId: 'app-ana', outcome: 'given', reason: null },
        { applicationId: 'app-ben', outcome: 'not_found', reason: null },
        { applicationId: 'app-cy', outcome: 'not_found', reason: null },
      ],
    };
    const offered = new Set(['app-ben', 'app-ana']);

    expect(roleRunPossibleMatches(missed, offered)).toBe(1);
    expect(roleRunSummary(roleRunCounts(missed), 1)).toBe(
      '1 given, 2 not found (1 possible match)',
    );
    expect(roleRunSummary(roleRunCounts(missed), 2)).toBe(
      '1 given, 2 not found (2 possible matches)',
    );
    expect(roleRunSummary(roleRunCounts(missed), 0)).toBe('1 given, 2 not found');
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

  it('keeps the confirmation open while a run gives the role, so its refusal is never hidden', async () => {
    const wrapper = await mounted(market());
    api.post.mockReturnValue(new Promise(() => {}));

    await wrapper.find('[data-testid="vendors-discord-give"]').trigger('click');
    (document.querySelector('[data-testid="give-roles-submit-button"]') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="give-roles-submit-button"]')?.textContent,
      ).toContain('Giving roles…');
    });

    await tryEveryClose('give-roles');
    expect(document.querySelector('[data-testid="give-roles-window"]')).not.toBeNull();
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

  it('titles the report by when it last ran, not as given, since a run may give nobody', async () => {
    const nobody = {
      ...RUN,
      outcomes: [{ applicationId: 'app-ben', outcome: 'failed', reason: ROLE_ABOVE }],
    };
    const wrapper = await mounted(
      market({ discord: { ...market().discord, roleRun: nobody } } as Partial<Market>),
    );

    const title = wrapper.find('[data-testid="vendors-role-report-title"]').text();
    expect(title).toMatch(/^Vendor Nov 2026, last run /);
    expect(title).not.toContain('given');
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
    await openWho(wrapper);

    const groups = wrapper.findAll('[data-testid="vendors-role-report-group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0].text()).toContain('Given');
    expect(groups[0].text()).toContain('1');
    expect(groups[0].text()).toContain('ana@thistle.test');
    expect(groups[1].text()).toContain('Failed');
    expect(groups[1].text()).toContain('2');
    expect(groups[1].findAll('[data-testid="vendors-role-report-reason"]')).toHaveLength(1);
    expect(groups[1].text()).toContain('ben@thistle.test');
    expect(groups[1].text()).toContain('cy@thistle.test');
    // Three vendors read at a glance: no field to find one, and no count over the groups (T223).
    expect(wrapper.find('[data-testid="vendors-role-report-list-find"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendors-role-report-list-count"]').exists()).toBe(false);
  });

  it('says so of a vendor the page no longer lists', async () => {
    const gone = {
      ...RUN,
      outcomes: [
        { applicationId: 'app-ana', outcome: 'given', reason: null },
        { applicationId: 'app-removed', outcome: 'given', reason: null },
      ],
    };
    const wrapper = await mounted(
      market({ discord: { ...market().discord, roleRun: gone } } as Partial<Market>),
    );

    await openWho(wrapper);

    const given = wrapper.find('[data-testid="vendors-role-report-group"]');
    expect(given.text()).toContain('ana@thistle.test');
    expect(given.text()).toContain('A vendor no longer listed');
  });

  it('says a vendor it did not find has a possible match, as their row does', async () => {
    const missed = {
      ...RUN,
      outcomes: [
        { applicationId: 'app-ana', outcome: 'given', reason: null },
        { applicationId: 'app-ben', outcome: 'not_found', reason: null },
        { applicationId: 'app-cy', outcome: 'not_found', reason: null },
      ],
    };
    const shown = (applicationId: string, what: string): ServedDiscordVendor => ({
      applicationId,
      state: what === 'in_server' ? 'in_server' : 'not_found',
      shown: what,
      possibleMatches: [],
      moreMatches: 0,
    });
    const wrapper = await mounted(
      market({
        discord: { ...market().discord, checkedAt: RAN_AT, roleRun: missed },
        discordVendors: [
          shown('app-ana', 'in_server'),
          shown('app-ben', 'possible_match'),
          shown('app-cy', 'not_found'),
        ],
      } as Partial<Market>),
    );
    const report = wrapper.find('[data-testid="vendors-role-report"]');

    expect(report.find('[data-testid="vendors-role-report-summary"]').text()).toBe(
      '1 given, 2 not found (1 possible match)',
    );
    await openWho(wrapper);

    const notFound = wrapper.findAll('[data-testid="vendors-role-report-group"]')[1];
    expect(notFound.text()).toContain('Not found');
    expect(notFound.find('[data-testid="vendors-role-report-matches"]').text()).toBe(
      '1 has a possible match to confirm or decline.',
    );
  });
});

describe('"Show who"', () => {
  const withARun = () =>
    market({ discord: { ...market().discord, roleRun: RUN } } as Partial<Market>);
  const whoWindow = (wrapper: VueWrapper) =>
    wrapper.find('[data-testid="vendors-role-report-who-window"]');

  it('keeps the report’s line, its summary and the button, folding nothing open in the page', async () => {
    const wrapper = await mounted(withARun());
    const report = wrapper.find('[data-testid="vendors-role-report"]');
    const button = report.find('[data-testid="vendors-role-report-open"]');

    expect(report.find('[data-testid="vendors-role-report-title"]').text()).toMatch(
      /^Vendor Nov 2026, last run /,
    );
    expect(report.find('[data-testid="vendors-role-report-summary"]').text()).toBe(
      '1 given, 2 failed',
    );
    expect(button.text()).toBe('Show who');
    expect(button.attributes('aria-expanded')).toBeUndefined();
    expect(button.attributes('aria-controls')).toBeUndefined();
    expect(whoWindow(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendors-role-report-group"]').exists()).toBe(false);

    await openWho(wrapper);

    // The button keeps its word, and the report's line stays beneath the dialog.
    expect(button.text()).toBe('Show who');
    expect(report.find('[data-testid="vendors-role-report-summary"]').text()).toBe(
      '1 given, 2 failed',
    );
  });

  it('opens a wide dialog that scrolls its body, titled with the report’s own line', async () => {
    const wrapper = await mounted(withARun());

    await openWho(wrapper);

    const line = wrapper.find('[data-testid="vendors-role-report-title"]').text();
    const dialog = whoWindow(wrapper);
    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-label')).toBe(line);
    expect(dialog.classes()).toContain('dialog-window--wide');
    expect(dialog.classes()).toContain('dialog-window--body');
    expect(dialog.find('h2').text()).toBe(line);
    expect(dialog.find('[data-testid="vendors-role-report-who-body"]').text()).toContain('Given');
  });

  it('offers no button on a run with no group to show', async () => {
    const wrapper = await mounted(
      market({
        discord: { ...market().discord, roleRun: { ...RUN, outcomes: [] } },
      } as Partial<Market>),
    );

    expect(wrapper.find('[data-testid="vendors-role-report"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="vendors-role-report-open"]').exists()).toBe(false);
  });

  it.each([
    ['its close', (wrapper: VueWrapper) => click(wrapper, 'vendors-role-report-who-close-button')],
    ['its backdrop', (wrapper: VueWrapper) => click(wrapper, 'vendors-role-report-who-background')],
    [
      'Escape',
      () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return Promise.resolve();
      },
    ],
  ])('closes by %s, with focus back on "Show who"', async (_way, close) => {
    const wrapper = await mounted(withARun());
    const button = wrapper.find('[data-testid="vendors-role-report-open"]');
    (button.element as HTMLElement).focus();

    await openWho(wrapper);
    expect(whoWindow(wrapper).exists()).toBe(true);
    await vi.waitFor(() => {
      expect(whoWindow(wrapper).element.contains(document.activeElement)).toBe(true);
    });

    await close(wrapper);

    await vi.waitFor(() => {
      expect(whoWindow(wrapper).exists()).toBe(false);
      expect(document.activeElement).toBe(button.element);
    });
  });
});
