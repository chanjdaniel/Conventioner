/**
 * Manage market's "Users with access" lists everyone with access (E38/F12/S01): the organization's
 * admins and members too, each at the role that counts and saying where it comes from, with no
 * control that would change nothing; the organization line says what its admins and members do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
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
  // In the document, since a select the re-read took away tells by leaving it.
  const wrapper = mount(ManageMarketOverlay, {
    props: { manageOpen: true, market: served },
    attachTo: document.body,
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

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
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

    // Remove asks first (E38/F15/S01), then takes only the market role.
    await admin.get('[data-testid="manage-market-remove-user-button"]').trigger('click');
    expect(api.delete).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="manage-market-remove-submit-button"]').trigger('submit');
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

describe('Users with access at 154 people', () => {
  const address = (n: number) => `person-${String(n).padStart(3, '0')}@people-at-scale.test`;
  const editor = (n: number) => ({
    userId: `u-${n}`,
    email: address(n),
    role: MarketRole.Editor,
    marketRole: MarketRole.Editor,
    organizationRole: null,
    fromOrganization: false,
  });
  const people = (count = 154) => Array.from({ length: count }, (_, at) => editor(at + 1));

  type Opened = Awaited<ReturnType<typeof open>>;
  const field = (wrapper: Opened) => wrapper.find('[data-testid="manage-market-access-find"]');
  const count = (wrapper: Opened) =>
    wrapper.get('[data-testid="manage-market-access-count"]').text();
  const showMore = (wrapper: Opened) =>
    wrapper.get('[data-testid="manage-market-access-more"]').trigger('click');
  const addresses = (wrapper: Opened) => rows(wrapper).map((r) => r.get('.user-email').text());

  async function find(wrapper: Opened, words: string) {
    await field(wrapper).setValue(words);
    await flushPromises();
  }

  /** The read answers with these people from now on. */
  function serves(served: Market, next: ReturnType<typeof people>) {
    served.peopleWithAccess = next;
  }

  async function changeRole(wrapper: Opened, email: string, role: MarketRole) {
    const select = row(wrapper, email).get('[data-testid="manage-market-role-select"]');
    await select.setValue(role);
    await wrapper.get('[data-testid="manage-market-role-change-submit-button"]').trigger('submit');
    await flushPromises();
  }

  async function addUser(wrapper: Opened, email: string) {
    await wrapper.get('[data-testid="manage-market-add-user-button"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="manage-market-add-user-input"]').setValue(email);
    await wrapper.get('.add-user-form').trigger('submit');
    await flushPromises();
  }

  it('reads the first 50, the count and "Show N more"', async () => {
    const wrapper = await open(market({ peopleWithAccess: people() }));

    expect(count(wrapper)).toBe('Showing 50 of 154');
    expect(rows(wrapper)).toHaveLength(50);
    expect(wrapper.get('[data-testid="manage-market-access-more"]').text()).toBe('Show 50 more');
  });

  it('names its find field for the section', async () => {
    const wrapper = await open(market({ peopleWithAccess: people() }));

    const label = wrapper.get('[data-testid="manage-market-access"] label');
    expect(label.text()).toBe('Find in users with access');
    expect(label.attributes('for')).toBe(field(wrapper).attributes('id'));
  });

  it('shows no find field on a list of 12', async () => {
    const wrapper = await open(market({ peopleWithAccess: people(12) }));

    expect(field(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(12);
  });

  it('finds by the words, case-folded, anywhere in the address', async () => {
    const wrapper = await open(market({ peopleWithAccess: people() }));

    await find(wrapper, 'SON-007');
    expect(addresses(wrapper)).toEqual([address(7)]);
    expect(count(wrapper)).toBe('1 of 154 matches "SON-007"');

    await find(wrapper, 'at-scale');
    expect(count(wrapper)).toBe('154 of 154 match "at-scale"');

    await find(wrapper, 'zzz');
    expect(count(wrapper)).toBe('Nothing matches "zzz"');
    expect(rows(wrapper)).toHaveLength(0);
  });

  it('keeps the shown count through a role change and its re-read', async () => {
    api.put.mockResolvedValue({ data: {} });
    const wrapper = await open(market({ peopleWithAccess: people() }));
    await showMore(wrapper);
    expect(rows(wrapper)).toHaveLength(100);

    await changeRole(wrapper, address(70), MarketRole.Viewer);

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/roles/u-70', {
      role: MarketRole.Viewer,
    });
    expect(count(wrapper)).toBe('Showing 100 of 154');
    expect(rows(wrapper)).toHaveLength(100);
  });

  it('keeps the words through a role change and its re-read', async () => {
    api.put.mockResolvedValue({ data: {} });
    const wrapper = await open(market({ peopleWithAccess: people() }));
    await find(wrapper, 'person-00');

    await changeRole(wrapper, address(7), MarketRole.Viewer);

    expect((field(wrapper).element as HTMLInputElement).value).toBe('person-00');
    expect(count(wrapper)).toBe('9 of 154 match "person-00"');
  });

  it('keeps the shown count through a removal, and takes the focus to the list', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const served = market({ peopleWithAccess: people() });
    const wrapper = await open(served);
    await showMore(wrapper);
    await row(wrapper, address(70))
      .get('[data-testid="manage-market-remove-user-button"]')
      .trigger('click');
    await flushPromises();
    serves(
      served,
      people().filter((person) => person.userId !== 'u-70'),
    );

    await wrapper.get('[data-testid="manage-market-remove-submit-button"]').trigger('submit');
    await flushPromises();

    expect(count(wrapper)).toBe('Showing 100 of 153');
    expect(addresses(wrapper)).not.toContain(address(70));
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="manage-market-people"]').element,
    );
  });

  it('says a refused change under its row, with the words kept', async () => {
    api.put.mockRejectedValue(new Error('refused'));
    const wrapper = await open(market({ peopleWithAccess: people() }));
    await find(wrapper, 'person-007');

    await changeRole(wrapper, address(7), MarketRole.Viewer);

    expect(row(wrapper, address(7)).find('[data-testid="manage-market-user-error"]').exists()).toBe(
      true,
    );
    expect(count(wrapper)).toBe('1 of 154 matches "person-007"');
  });

  it('finds the person a refusal names when the re-read moved them out of what is shown', async () => {
    api.put.mockRejectedValue(new Error('refused'));
    const served = market({ peopleWithAccess: people() });
    const wrapper = await open(served);
    const moved = people();
    moved.push(moved.splice(6, 1)[0]!);
    serves(served, moved);

    await changeRole(wrapper, address(7), MarketRole.Viewer);

    expect(addresses(wrapper)).toEqual([address(7)]);
    expect(row(wrapper, address(7)).find('[data-testid="manage-market-user-error"]').exists()).toBe(
      true,
    );
    expect((field(wrapper).element as HTMLInputElement).value).toBe(address(7));
  });

  it('shows someone just added as the one row, and clearing the field shows everyone', async () => {
    api.post.mockResolvedValue({ data: {} });
    const served = market({ peopleWithAccess: people() });
    const wrapper = await open(served);
    await showMore(wrapper);
    const added = editor(155);
    serves(served, [...people(), added]);

    await addUser(wrapper, ` ${added.email.toUpperCase()} `);

    expect(addresses(wrapper)).toEqual([added.email]);
    expect(count(wrapper)).toBe(`1 of 155 matches "${added.email.toUpperCase()}"`);

    await find(wrapper, '');
    expect(count(wrapper)).toBe('Showing 50 of 155');
  });

  it('shows the field for someone added as the list passes 12', async () => {
    api.post.mockResolvedValue({ data: {} });
    const served = market({ peopleWithAccess: people(12) });
    const wrapper = await open(served);
    serves(served, people(13));

    await addUser(wrapper, address(13));

    expect(addresses(wrapper)).toEqual([address(13)]);
  });

  it('leaves a short list whole when someone is added, with no field to appear', async () => {
    api.post.mockResolvedValue({ data: {} });
    const served = market({ peopleWithAccess: people(3) });
    const wrapper = await open(served);
    serves(served, people(4));

    await addUser(wrapper, address(4));

    expect(field(wrapper).exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(4);
  });

  it('never keeps words that would hide someone added to a list now short', async () => {
    api.post.mockResolvedValue({ data: {} });
    const served = market({ peopleWithAccess: people(20) });
    const wrapper = await open(served);
    await find(wrapper, 'person-001');
    serves(served, [...people(3), editor(155)]);

    await addUser(wrapper, editor(155).email);

    expect(addresses(wrapper)).toEqual([editor(155).email]);
  });

  it('forgets the words when the dialog closes', async () => {
    const served = market({ peopleWithAccess: people() });
    const wrapper = await open(served);
    await find(wrapper, 'person-007');

    await wrapper.setProps({ manageOpen: false });
    await flushPromises();
    await wrapper.setProps({ manageOpen: true });
    await flushPromises();

    expect(count(wrapper)).toBe('Showing 50 of 154');
  });
});
