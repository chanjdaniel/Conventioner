/**
 * Manage organization's "Default permissions for new markets" (E39/F02/S01), as a person meets it:
 * a section's line and a button, with the rows in a dialog of their own (T217). Its owner and admins
 * change a row after a confirmation saying the change reaches only markets created from now on, its
 * members read it, and every change is listed under it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';

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
    adminPeople: [{ userId: 'user-admin', email: 'admin@ember.test' }],
    memberPeople: [{ userId: 'user-member', email: 'member@ember.test' }],
    marketCount: 0,
    marketsWithOwnRole: {},
    userRole,
    defaultPermissionTable: table,
  };
}

let wrapper: VueWrapper | null = null;

const OPEN = '[data-testid="manage-org-permissions-open"]';
const WINDOW = '[data-testid="manage-org-permissions-window"]';
const select = '[data-testid="manage-org-permission-select"]';

/** The dialog is teleported to the body, so what it holds is read from there. */
const body = () => new DOMWrapper(document.body);

function mountSection(
  table: PermissionTableRow[],
  userRole: OrganizationRoleType = 'admin',
): VueWrapper {
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
  return mounted;
}

async function openDialog(
  table: PermissionTableRow[],
  userRole: OrganizationRoleType = 'admin',
): Promise<VueWrapper> {
  const mounted = mountSection(table, userRole);
  const opener = mounted.get<HTMLButtonElement>(OPEN);
  opener.element.focus();
  await opener.trigger('click');
  await flushPromises();
  return mounted;
}

const confirmWindow = () =>
  document.querySelector('[data-testid="manage-org-permission-confirm-window"]');

/** Chooses a role on the row's select, as a person does, which asks first. */
async function choose(role: MarketRole) {
  const chosen = body()
    .get('[data-testid="manage-org-permission-row-check-in"]')
    .get<HTMLSelectElement>(select);
  chosen.element.focus();
  await chosen.setValue(role);
  await flushPromises();
  return chosen;
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
  it('is its heading, its line and a button that opens the rows, with no rows of its own', async () => {
    const section = mountSection(SET, 'member');

    expect(section.get('h3').text()).toBe('Default permissions for new markets');
    expect(section.get('[data-testid="manage-org-permissions-summary"]').text()).toBe(
      'Each market created in this organization starts with these. 1 row differs from the built-in defaults.',
    );
    expect(section.get(OPEN).attributes('aria-expanded')).toBeUndefined();
    expect(body().find(WINDOW).exists()).toBe(false);
    expect(body().find('[data-testid="manage-org-permission-row-check-in"]').exists()).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('follows the table a write answers, with its dialog open', async () => {
    const section = await openDialog(SET);
    api.put.mockResolvedValue({ data: { permissionTable: BUILT_IN } });

    await choose(MarketRole.Viewer);
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permission-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(section.get('[data-testid="manage-org-permissions-summary"]').text()).toContain(
      'Every row is at its built-in default.',
    );
  });
});

describe('the dialog', () => {
  it('is titled as the section is, and is teleported before the confirmations it opens, so they paint above it', async () => {
    await openDialog(SET);
    await body().get('[data-testid="manage-org-permissions-reset"]').trigger('click');
    await flushPromises();

    const permissions = body().get(WINDOW);
    const confirm = body().get('[data-testid="manage-org-permissions-reset-confirm-window"]');
    expect(permissions.get('h2').text()).toBe('Default permissions for new markets');
    expect(permissions.element.parentElement?.parentElement).toBe(document.body);
    expect(
      permissions.element.compareDocumentPosition(confirm.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('holds the rows and the changes in its body, and pins Reset at its foot', async () => {
    await openDialog(SET, 'owner');

    const scrolling = body().get('[data-testid="manage-org-permissions-body"]');
    expect(scrolling.find('[data-testid="manage-org-permission-row-check-in"]').exists()).toBe(
      true,
    );
    expect(scrolling.text()).toContain('Changes');
    expect(scrolling.find('[data-testid="manage-org-permissions-reset"]').exists()).toBe(false);
    expect(
      body().get(`${WINDOW} footer`).find('[data-testid="manage-org-permissions-reset"]').exists(),
    ).toBe(true);
  });

  it("reads the default's changes each time it opens, and names who set a row", async () => {
    api.get.mockResolvedValue({ data: { entries: [SET_ENTRY] } });
    const section = await openDialog(SET);

    expect(api.get).toHaveBeenCalledWith('/organizations/org-1/default-permission-history');
    expect(
      body()
        .get('[data-testid="manage-org-permission-row-check-in"]')
        .get('[data-testid="manage-org-permission-source"]')
        .text(),
    ).toBe(`Set for this organization by org-admin@example.com, ${getFormattedTimestamp(AT)}`);
    const [change] = body().findAll('[data-testid="manage-org-permission-change"]');
    expect(change!.text()).toContain('Check vendors in');
    expect(change!.text()).toContain('Editor to Admin');
    expect(change!.text()).toContain('org-admin@example.com');

    await body().get('[data-testid="manage-org-permissions-close-button"]').trigger('click');
    await flushPromises();
    await section.get(OPEN).trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('says beside the roles row that at Viewer a Viewer can make themself an Editor', async () => {
    await openDialog(BUILT_IN);

    expect(
      body().get('[data-testid="manage-org-permission-row-manage-editors-and-viewers"]').text(),
    ).toContain('At “Viewer and above”, any Viewer can make themself an Editor.');
  });

  it.each([
    ['its close', () => body().get('[data-testid="manage-org-permissions-close-button"]')],
    ['the backdrop', () => body().get('[data-testid="manage-org-permissions-background"]')],
  ])('gives focus back to the button that opened it, by %s', async (_way, control) => {
    await openDialog(BUILT_IN);
    await control().trigger('click');
    await flushPromises();

    expect(body().find(WINDOW).exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper!.get(OPEN).element);
  });

  it('gives focus back to the button that opened it, by Escape', async () => {
    await openDialog(BUILT_IN);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(body().find(WINDOW).exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper!.get(OPEN).element);
  });
});

describe("an admin's change", () => {
  it('confirms first, saying it reaches only markets created from now on, then sends it and stays open', async () => {
    const section = await openDialog(BUILT_IN);
    api.put.mockResolvedValue({ data: { permissionTable: SET } });

    await choose(MarketRole.Admin);

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
    expect(body().find(WINDOW).exists()).toBe(true);
  });

  it.each([
    [
      'Cancel',
      () =>
        body().get('[data-testid="manage-org-permission-confirm-cancel-button"]').trigger('click'),
    ],
    [
      'the backdrop',
      () => body().get('[data-testid="manage-org-permission-confirm-background"]').trigger('click'),
    ],
    [
      'Escape',
      () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    ],
  ])(
    '%s closes only the confirmation, puts the select back and sends nothing',
    async (_way, close) => {
      await openDialog(BUILT_IN);
      const chosen = await choose(MarketRole.Owner);
      expect(confirmWindow()).not.toBe(null);

      await close();
      await flushPromises();

      expect(confirmWindow()).toBe(null);
      expect(body().find(WINDOW).exists()).toBe(true);
      expect(chosen.element.value).toBe('editor');
      expect(document.activeElement).toBe(chosen.element);
      expect(api.put).not.toHaveBeenCalled();
    },
  );

  it('warns that a Viewer could make themself an Editor when giving those roles is lowered to Viewer', async () => {
    await openDialog(BUILT_IN);

    await body()
      .get('[data-testid="manage-org-permission-row-manage-editors-and-viewers"]')
      .get('select')
      .setValue('viewer');

    expect(
      document.querySelector('[data-testid="manage-org-permission-confirm-warning"]')?.textContent,
    ).toContain('A Viewer could then make themself an Editor.');
  });

  it("resets every row in one write, after a destructive confirmation saying what it reaches, then puts focus on the dialog's first control", async () => {
    await openDialog(SET, 'owner');
    api.delete.mockResolvedValue({ data: { permissionTable: BUILT_IN } });

    const resetButton = body().get<HTMLButtonElement>(
      '[data-testid="manage-org-permissions-reset"]',
    );
    resetButton.element.focus();
    await resetButton.trigger('click');
    await flushPromises();
    const reset = document.querySelector(
      '[data-testid="manage-org-permissions-reset-confirm-window"]',
    );
    expect(reset?.textContent).toContain('Check vendors in: Admin and above to Editor and above');
    expect(reset?.textContent).toContain('Markets created from now on start with this.');
    expect(
      document.querySelector('[data-testid="manage-org-permissions-reset-confirm-body"]'),
      'a line per row reset, so only its body scrolls',
    ).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-org-permissions-reset-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/default-permissions');
    expect(resetButton.element.disabled).toBe(true);
    expect(body().find(WINDOW).exists()).toBe(true);
    expect(document.activeElement).toBe(body().get(select).element);
  });
});

describe("a member's dialog", () => {
  it('is read-only: a chip for every row, the owner-and-admins line, and no foot', async () => {
    await openDialog(SET, 'member');

    expect(body().get('[data-testid="manage-org-permissions-read-only"]').text()).toBe(
      "Only the organization's owner and its admins change these.",
    );
    expect(body().findAll(select)).toHaveLength(0);
    expect(body().findAll('[data-testid="manage-org-permission-role"]')).toHaveLength(3);
    expect(body().find('[data-testid="manage-org-permissions-reset"]').exists()).toBe(false);
    expect(body().find(`${WINDOW} footer`).exists()).toBe(false);
  });
});

describe('Manage organization', () => {
  it("holds the section, and a change in its dialog re-reads the organization's History", async () => {
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

    document.querySelector<HTMLButtonElement>(OPEN)!.click();
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
      marketCount: 0,
      marketsWithOwnRole: {},
    });

    expect(parsed.defaultPermissionTable).toEqual(SET);
  });
});
