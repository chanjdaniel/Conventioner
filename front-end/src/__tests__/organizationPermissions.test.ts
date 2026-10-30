/**
 * Manage organization's "Default permissions for new markets" (E39/F02/S01), as a person meets it:
 * its owner and admins change a row after a confirmation saying the change reaches only markets
 * created from now on, its members read it, and every change is listed under it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import OrganizationPermissions from '@/components/OrganizationPermissions.vue';
import ManageOrgOverlay from '@/views/ManageOrgOverlay.vue';
import {
  MarketRole,
  type Organization,
  type OrganizationRoleType,
  type PermissionTableRow,
} from '@/assets/types/datatypes';
import { getFormattedTimestamp } from '@/utils/utils';
import { parseOrgFromApi } from '@/utils/organizations';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

function row(overrides: Partial<PermissionTableRow>): PermissionTableRow {
  return {
    id: 'check-in',
    group: 'The door',
    label: 'Check vendors in',
    role: MarketRole.Editor,
    default: MarketRole.Editor,
    source: 'built-in',
    fixed: false,
    mayWhat: 'check vendors in at this market',
    ...overrides,
  };
}

const BUILT_IN = [
  row({
    id: 'read',
    group: 'Reading',
    label: 'Read the market',
    role: MarketRole.Viewer,
    default: MarketRole.Viewer,
    fixed: true,
  }),
  row({
    id: 'manage-editors-and-viewers',
    group: 'People',
    label: 'Give and take Editor and Viewer roles',
    role: MarketRole.Admin,
    default: MarketRole.Admin,
  }),
  row({}),
];

const SET = BUILT_IN.map((r) =>
  r.id === 'check-in' ? { ...r, role: MarketRole.Admin, source: 'organization' as const } : r,
);

const AT = '2026-11-02T18:20:00+00:00';
const SET_ENTRY = {
  id: 'entry-1',
  actor: 'org-admin@example.com',
  at: AT,
  action: 'change-the-default',
  kind: 'permission_set',
  subject: { action: 'check-in' },
  detail: {
    before: { role: 'editor', source: 'built-in' },
    after: { role: 'admin', source: 'organization' },
  },
};

function org(table: PermissionTableRow[], userRole: OrganizationRoleType): Organization {
  return {
    id: 'org-1',
    name: 'Ember Markets',
    owner: 'user-owner',
    admins: ['user-admin'],
    members: ['user-member'],
    markets: [],
    userRole,
    defaultPermissionTable: table,
  };
}

let wrapper: VueWrapper | null = null;

async function openSection(
  table: PermissionTableRow[],
  userRole: OrganizationRoleType = 'admin',
): Promise<VueWrapper> {
  // The dialog's copy of the organization takes the table a write answers, as Manage organization does.
  const mounted = mount(OrganizationPermissions, {
    props: {
      org: org(table, userRole),
      onChanged: (answered: PermissionTableRow[]) =>
        void mounted.setProps({ org: org(answered, userRole) }),
    },
    attachTo: document.body,
  });
  wrapper = mounted;
  await wrapper.get('[data-testid="manage-org-permissions-toggle"]').trigger('click');
  await flushPromises();
  return wrapper;
}

const confirmWindow = () =>
  document.querySelector('[data-testid="manage-org-permission-confirm-window"]');

async function choose(section: VueWrapper, role: MarketRole) {
  const select = section
    .get('[data-testid="manage-org-permission-row-check-in"]')
    .get<HTMLSelectElement>('[data-testid="manage-org-permission-select"]');
  await select.setValue(role);
  return select;
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { entries: [] } });
  api.put.mockReset();
  api.delete.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the section', () => {
  it('is closed until opened, and says whether any row differs', async () => {
    const mounted = mount(OrganizationPermissions, {
      props: { org: org(SET, 'member') },
      attachTo: document.body,
    });
    wrapper = mounted;

    expect(mounted.find('[data-testid="manage-org-permission-row-check-in"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="manage-org-permissions-summary"]').text()).toBe(
      'Each market created in this organization starts with these. 1 row differs from the built-in defaults.',
    );
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads the default's changes when it opens, and names who set a row", async () => {
    api.get.mockResolvedValue({ data: { entries: [SET_ENTRY] } });
    const section = await openSection(SET);

    expect(api.get).toHaveBeenCalledWith('/organizations/org-1/default-permission-history');
    expect(
      section
        .get('[data-testid="manage-org-permission-row-check-in"]')
        .get('[data-testid="manage-org-permission-source"]')
        .text(),
    ).toBe(`Set for this organization by org-admin@example.com, ${getFormattedTimestamp(AT)}`);
    const [change] = section.findAll('[data-testid="manage-org-permission-change"]');
    expect(change!.text()).toContain('Check vendors in');
    expect(change!.text()).toContain('Editor to Admin');
    expect(change!.text()).toContain('org-admin@example.com');
  });

  it('says beside the roles row that at Viewer a Viewer can make themself an Editor', async () => {
    const section = await openSection(BUILT_IN);

    expect(
      section.get('[data-testid="manage-org-permission-row-manage-editors-and-viewers"]').text(),
    ).toContain('At “Viewer and above”, any Viewer can make themself an Editor.');
  });
});

describe("an admin's change", () => {
  it('confirms first, saying it reaches only markets created from now on, then sends it', async () => {
    const section = await openSection(BUILT_IN);
    api.put.mockResolvedValue({ data: { permissionTable: SET } });

    await choose(section, MarketRole.Admin);

    expect(api.put).not.toHaveBeenCalled();
    expect(confirmWindow()?.textContent).toContain('Change “Check vendors in” for new markets?');
    expect(confirmWindow()?.textContent).toContain(
      'Markets created from now on start with this. The markets it already holds keep their own.',
    );
    expect(confirmWindow()?.textContent).toContain('Editors lose this.');
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permission-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/organizations/org-1/default-permissions/check-in', {
      role: 'admin',
    });
    expect(section.emitted('changed')).toEqual([[SET]]);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(confirmWindow()).toBe(null);
  });

  it('puts the select back when cancelled, and sends nothing', async () => {
    const section = await openSection(BUILT_IN);

    const select = await choose(section, MarketRole.Owner);
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permission-confirm-cancel-button"]',
      )!
      .click();
    await flushPromises();

    expect(select.element.value).toBe('editor');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('warns that a Viewer could make themself an Editor when giving those roles is lowered to Viewer', async () => {
    const section = await openSection(BUILT_IN);

    await section
      .get('[data-testid="manage-org-permission-row-manage-editors-and-viewers"]')
      .get('select')
      .setValue('viewer');

    expect(
      document.querySelector('[data-testid="manage-org-permission-confirm-warning"]')?.textContent,
    ).toContain('A Viewer could then make themself an Editor.');
  });

  it('resets every row in one write, after a destructive confirmation', async () => {
    const section = await openSection(SET, 'owner');
    api.delete.mockResolvedValue({ data: { permissionTable: BUILT_IN } });

    await section.get('[data-testid="manage-org-permissions-reset"]').trigger('click');
    const reset = document.querySelector(
      '[data-testid="manage-org-permissions-reset-confirm-window"]',
    );
    expect(reset?.textContent).toContain('Check vendors in: Admin and above to Editor and above');
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permissions-reset-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/default-permissions');
    expect(
      section.get<HTMLButtonElement>('[data-testid="manage-org-permissions-reset"]').element
        .disabled,
    ).toBe(true);
  });
});

describe("a member's section", () => {
  it('is read-only: a chip for every row, the owner-and-admins line, and no reset', async () => {
    const section = await openSection(SET, 'member');

    expect(section.get('[data-testid="manage-org-permissions-read-only"]').text()).toBe(
      "Only the organization's owner and its admins change these.",
    );
    expect(section.findAll('[data-testid="manage-org-permission-select"]')).toHaveLength(0);
    expect(section.findAll('[data-testid="manage-org-permission-role"]')).toHaveLength(3);
    expect(section.find('[data-testid="manage-org-permissions-reset"]').exists()).toBe(false);
  });
});

describe('Manage organization', () => {
  it("holds the section for a member, and a change re-reads the organization's History", async () => {
    api.get.mockImplementation(async (url: string) =>
      url.endsWith('/history')
        ? { data: { entries: [], next: null, rowLabels: {} } }
        : { data: { entries: [] } },
    );
    const mounted = mount(ManageOrgOverlay, {
      props: { manageOpen: true, org: org(BUILT_IN, 'admin') },
      attachTo: document.body,
    });
    wrapper = mounted;
    await flushPromises();

    expect(document.querySelector('[data-testid="manage-org-permissions"]')).not.toBe(null);
    document.querySelector<HTMLButtonElement>('[data-testid="manage-org-history-toggle"]')!.click();
    await flushPromises();
    const historyReads = () =>
      api.get.mock.calls.filter(([url]) => url === '/organizations/org-1/history').length;
    expect(historyReads()).toBe(1);

    document
      .querySelector<HTMLButtonElement>('[data-testid="manage-org-permissions-toggle"]')!
      .click();
    await flushPromises();
    api.put.mockResolvedValue({ data: { permissionTable: SET } });
    const select = document.querySelector<HTMLSelectElement>(
      '[data-testid="manage-org-permission-row-check-in"] select',
    )!;
    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permission-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(historyReads()).toBe(2);
    expect(
      document.querySelector('[data-testid="manage-org-permissions-summary"]')?.textContent,
    ).toContain('1 row differs');
    expect(mounted.emitted('changed')).toHaveLength(1);
  });
});

describe("the organizations list's answer", () => {
  it("carries each organization's default table into the dialog", () => {
    const parsed = parseOrgFromApi({
      id: 'org-1',
      name: 'Ember Markets',
      owner: 'user-owner',
      defaultPermissionTable: SET,
    });

    expect(parsed.defaultPermissionTable).toEqual(SET);
  });
});
