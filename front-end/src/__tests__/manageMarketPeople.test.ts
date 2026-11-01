/**
 * Manage market's "Users with access" lists everyone with access (E38/F12/S01): the organization's
 * admins and members too, each at the role that counts and saying where it comes from, with no
 * control that would change nothing; the organization line says what its admins and members do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import { MarketPhase, MarketRole, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="JSON.stringify(to)"><slot /></a>',
};

const OWNER_ANSWERS = answersRefusing();
const VIEWER_ANSWERS = answersRefusing(
  ...Object.values(MarketAction).filter((action) => action !== MarketAction.Read),
);

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Applications,
    organizationId: 'org-1',
    organizationName: 'Seed Test Org',
    roles: {},
    inOrganization: true,
    actionRefusals: OWNER_ANSWERS,
    // In the order the read serves them: the owner first, then by the role that counts.
    peopleWithAccess: [
      {
        userId: 'u-owner',
        email: 'owner@example.com',
        role: MarketRole.Owner,
        marketRole: MarketRole.Owner,
        organizationRole: 'admin',
        fromOrganization: false,
      },
      {
        userId: 'u-admin',
        email: 'admin@example.com',
        role: MarketRole.Admin,
        marketRole: MarketRole.Editor,
        organizationRole: 'admin',
        fromOrganization: true,
      },
      {
        userId: 'u-new',
        email: 'added@example.com',
        role: MarketRole.Editor,
        marketRole: MarketRole.Editor,
        organizationRole: null,
        fromOrganization: false,
      },
      {
        userId: 'u-member',
        email: 'member@example.com',
        role: MarketRole.Viewer,
        marketRole: null,
        organizationRole: 'member',
        fromOrganization: true,
      },
    ],
    ...overrides,
  } as unknown as Market;
}

async function open(served: Market) {
  api.get.mockImplementation(async (url: string) =>
    url === '/markets/market-1'
      ? { data: { market: served } }
      : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
  );
  const wrapper = mount(ManageMarketOverlay, {
    props: { manageOpen: true, market: served },
    global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
  });
  await flushPromises();
  return wrapper;
}

const rows = (wrapper: Awaited<ReturnType<typeof open>>) =>
  wrapper.findAll('[data-testid="manage-market-person"]');

const row = (wrapper: Awaited<ReturnType<typeof open>>, email: string) => {
  const found = rows(wrapper).find((r) => r.text().includes(email));
  if (!found) throw new Error(`no row for ${email}`);
  return found;
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.delete.mockReset();
});

describe('Users with access', () => {
  it('lists everyone in the order the read serves them, the owner first', async () => {
    const wrapper = await open(market());

    expect(rows(wrapper).map((r) => r.find('.user-email').text())).toEqual([
      'owner@example.com',
      'admin@example.com',
      'added@example.com',
      'member@example.com',
    ]);
  });

  it("says where an organization's role comes from, and offers no select or Remove for it", async () => {
    const wrapper = await open(market());
    const member = row(wrapper, 'member@example.com');

    expect(member.get('[data-testid="manage-market-role"]').text()).toBe(
      'Viewer, through Seed Test Org',
    );
    expect(member.find('[data-testid="manage-market-role-select"]').exists()).toBe(false);
    expect(member.find('[data-testid="manage-market-remove-user-button"]').exists()).toBe(false);
  });

  it('lists an organization admin also given Editor once, at Admin, with a Remove for the market role', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = await open(market());
    const admin = row(wrapper, 'admin@example.com');

    expect(admin.get('[data-testid="manage-market-role"]').text()).toBe(
      'Admin, through Seed Test Org',
    );
    expect(admin.get('[data-testid="manage-market-also"]').text()).toBe(
      'Also Editor on this market: this adds nothing while they are an admin of Seed Test Org.',
    );
    expect(admin.find('[data-testid="manage-market-role-select"]').exists()).toBe(false);

    await admin.get('[data-testid="manage-market-remove-user-button"]').trigger('click');
    expect(api.delete).toHaveBeenCalledWith('/markets/market-1/roles/u-admin');
  });

  it('keeps the select and Remove for a person whose market role is the higher', async () => {
    const wrapper = await open(market());
    const added = row(wrapper, 'added@example.com');

    expect(added.find('[data-testid="manage-market-role-select"]').exists()).toBe(true);
    expect(added.find('[data-testid="manage-market-remove-user-button"]').exists()).toBe(true);
    expect(added.find('[data-testid="manage-market-also"]').exists()).toBe(false);
  });

  it('points to Manage organization, as a link for someone in it', async () => {
    const wrapper = await open(market());
    const note = wrapper.get('[data-testid="manage-market-organization-people"]');

    expect(note.text()).toBe('Organization admins and members are managed in Manage organization.');
    expect(JSON.parse(note.get('a').attributes('href')!)).toEqual({
      name: 'organizations',
      query: { manage: 'org-1' },
    });
  });

  it('names Manage organization without a link for someone outside it', async () => {
    const wrapper = await open(market({ inOrganization: false }));
    const note = wrapper.get('[data-testid="manage-market-organization-people"]');

    expect(note.text()).toBe('Organization admins and members are managed in Manage organization.');
    expect(note.find('a').exists()).toBe(false);
  });

  it("says nothing of the organization's people when no row comes through it", async () => {
    const wrapper = await open(
      market({
        actionRefusals: VIEWER_ANSWERS,
        inOrganization: false,
        peopleWithAccess: [
          {
            userId: 'u-owner',
            email: 'owner@example.com',
            role: MarketRole.Owner,
            marketRole: MarketRole.Owner,
            organizationRole: null,
            fromOrganization: false,
          },
        ],
      }),
    );

    expect(wrapper.find('[data-testid="manage-market-organization-people"]').exists()).toBe(false);
  });

  it('says what the organization’s admins and members may do', async () => {
    const wrapper = await open(market());

    expect(wrapper.get('[data-testid="manage-market-organization"]').text()).toBe(
      'Belongs to Seed Test Org. Its admins run it; its members can view it.',
    );
  });
});
