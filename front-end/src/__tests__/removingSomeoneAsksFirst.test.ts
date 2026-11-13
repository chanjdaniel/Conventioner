/**
 * Removing someone asks first, and says what they lose (E38/F15/S01).
 *
 * Each row's Remove in Manage organization and Manage market removed at once, from a filled red
 * button on every row. It now opens a confirmation naming the person and what they lose: the
 * organization's markets, less any they hold a role on of their own, or the market role, and the
 * organization's place they keep. Cancel and Escape change nothing; confirming removes and the list
 * updates in place, the dialog open, and focus goes to the list.
 *
 * Someone another organizer already removed answers a 404 (T181): the row asked about is gone, so
 * the confirmation reads it as done, re-reads the list and closes. Any other refusal stays in it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import ManageOrgOverlay from '@/views/ManageOrgOverlay.vue';
import {
  MarketPhase,
  MarketRole,
  type Market,
  type Organization,
  type PersonWithAccess,
} from '@/assets/types/datatypes';
import { organizationRemoval } from '@/utils/organizations';
import { marketRemoval } from '@/utils/peopleWithAccess';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const EMAIL = 'walk390@example.com';

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Seed Test Org',
    owner: 'u-owner',
    admins: ['u-admin'],
    members: ['u-walk'],
    ownerEmail: 'owner@example.com',
    adminPeople: [{ userId: 'u-admin', email: 'admin@example.com' }],
    memberPeople: [{ userId: 'u-walk', email: EMAIL }],
    userRole: 'owner',
    marketCount: 11,
    marketsWithOwnRole: {},
    ...overrides,
  };
}

function person(overrides: Partial<PersonWithAccess> = {}): PersonWithAccess {
  return {
    userId: 'u-walk',
    email: EMAIL,
    role: MarketRole.Editor,
    marketRole: MarketRole.Editor,
    organizationRole: null,
    fromOrganization: false,
    ...overrides,
  };
}

describe('what removing someone from an organization says', () => {
  it('names them, the organization and its markets', () => {
    expect(organizationRemoval(org(), 'u-walk', EMAIL)).toEqual({
      title: 'Remove walk390@example.com from Seed Test Org?',
      loses: 'They lose access to its 11 markets.',
    });
    expect(organizationRemoval(org({ marketCount: 1 }), 'u-walk', EMAIL).loses).toBe(
      'They lose access to its 1 market.',
    );
  });

  it('says which markets they keep through a role of their own', () => {
    const keepsTwo = org({ marketsWithOwnRole: { 'u-walk': 2, 'u-admin': 5 } });
    expect(organizationRemoval(keepsTwo, 'u-walk', EMAIL).loses).toBe(
      'They lose access to 9 of its 11 markets, and keep the 2 they hold a role on of their own.',
    );
    const keepsOne = org({ marketsWithOwnRole: { 'u-walk': 1 } });
    expect(organizationRemoval(keepsOne, 'u-walk', EMAIL).loses).toBe(
      'They lose access to 10 of its 11 markets, and keep the 1 they hold a role on of their own.',
    );
    const keepsAll = org({ marketCount: 3, marketsWithOwnRole: { 'u-walk': 3 } });
    expect(organizationRemoval(keepsAll, 'u-walk', EMAIL).loses).toBe(
      'They keep its 3 markets, each through a role of their own.',
    );
  });

  it('says so when it has no markets', () => {
    expect(organizationRemoval(org({ marketCount: 0 }), 'u-walk', EMAIL).loses).toBe(
      'It has no markets yet.',
    );
  });
});

describe('what removing someone from a market says', () => {
  it('names the role they lose', () => {
    expect(marketRemoval(person(), 'Spring Market', 'Seed Test Org')).toEqual({
      title: 'Remove walk390@example.com from Spring Market?',
      loses: 'They lose their Editor role on it.',
      keeps: '',
    });
  });

  it('says what they keep through the organization', () => {
    const member = person({ organizationRole: 'member' });
    expect(marketRemoval(member, 'Spring Market', 'Seed Test Org').keeps).toBe(
      'They can still view it as a member of Seed Test Org.',
    );
    // An organization admin also given Editor: Remove takes only the Editor role.
    const admin = person({
      role: MarketRole.Admin,
      organizationRole: 'admin',
      fromOrganization: true,
    });
    expect(marketRemoval(admin, 'Spring Market', 'Seed Test Org')).toEqual({
      title: 'Remove walk390@example.com from Spring Market?',
      loses: 'They lose their Editor role on it.',
      keeps: 'They can still run it as an admin of Seed Test Org.',
    });
  });
});

const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

/**
 * Every wording the confirmation shows, render by render, until it closes: a MutationObserver
 * reads the window after each change Vue makes to the page.
 */
function recordConfirmation(prefix: string): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const read = () => {
    const window = byTestId(`${prefix}-window`);
    if (!window) return;
    const words = [
      window.getAttribute('aria-label'),
      byTestId(`${prefix}-consequence`)?.textContent?.trim(),
      byTestId(`${prefix}-keeps`)?.textContent?.trim() ?? '',
    ].join(' | ');
    if (seen[seen.length - 1] !== words) seen.push(words);
  };
  read();
  const observer = new MutationObserver(read);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return { seen, stop: () => observer.disconnect() };
}

function refusing(status: number, error: string): AxiosError {
  return Object.assign(new AxiosError('refused'), { response: { status, data: { error } } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.delete.mockReset();
  document.body.innerHTML = '';
});

describe('Manage organization asks before it removes', () => {
  let served: Organization;

  function mountDialog(overrides: Partial<Organization> = {}): VueWrapper {
    served = org(overrides);
    api.get.mockImplementation(async (url: string) =>
      url === '/organizations'
        ? { data: { organizations: [served] } }
        : { data: { entries: [], next: null } },
    );
    return mount(ManageOrgOverlay, {
      props: { manageOpen: true, org: served },
      attachTo: document.body,
    });
  }

  it('says what they lose, and Cancel and Escape remove nothing', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    // jsdom focuses nothing on a click; a browser focuses the button, which the shell takes as the
    // confirmation's opener.
    const remove = byTestId('manage-org-remove-member-button')!;
    remove.focus();
    remove.click();
    await flushPromises();
    const confirm = byTestId('manage-org-remove-window')!;
    expect(confirm.getAttribute('aria-label')).toBe(
      'Remove walk390@example.com from Seed Test Org?',
    );
    expect(byTestId('manage-org-remove-consequence')!.textContent?.trim()).toBe(
      'They lose access to its 11 markets.',
    );
    // A destructive confirmation opens on Cancel.
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'manage-org-remove-cancel-button',
    );

    byTestId('manage-org-remove-cancel-button')!.click();
    await flushPromises();
    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(document.activeElement).toBe(remove);

    remove.focus();
    remove.click();
    await flushPromises();
    escape();
    await flushPromises();
    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(document.activeElement).toBe(remove);
    // Escape closed the confirmation only, not Manage organization beneath it.
    expect(byTestId('manage-org-window')).not.toBeNull();
    expect(api.delete).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('removes on confirm, in place, the dialog open, and focus on the list', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = mountDialog();
    await flushPromises();

    byTestId('manage-org-remove-member-button')!.click();
    await flushPromises();
    served = { ...served, members: [], memberPeople: [] };
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith('/organizations/org-1/users/u-walk');
    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(byTestId('manage-org-window')).not.toBeNull();
    expect(byTestId('manage-org-member-email')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-members');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.emitted('manageClose')).toBeUndefined();
    wrapper.unmount();
  });

  it('says the same words until it closes, though the re-read changes the count', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = mountDialog({ marketsWithOwnRole: { 'u-walk': 1 } });
    await flushPromises();

    byTestId('manage-org-remove-member-button')!.click();
    await flushPromises();
    const record = recordConfirmation('manage-org-remove');
    // The re-read organization no longer counts their own role: they are no longer in it.
    served = { ...served, members: [], memberPeople: [], marketsWithOwnRole: {} };
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();
    record.stop();

    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(record.seen).toEqual([
      'Remove walk390@example.com from Seed Test Org? | They lose access to 10 of its 11 markets, ' +
        'and keep the 1 they hold a role on of their own. | ',
    ]);
    wrapper.unmount();
  });

  it('stays busy until it closes, so a second click sends no second removal', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = mountDialog();
    await flushPromises();

    byTestId('manage-org-remove-member-button')!.click();
    await flushPromises();
    // The re-read after the removal waits until it is let go.
    let reread!: () => void;
    const held = new Promise<void>((resolve) => (reread = resolve));
    const answer = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => {
      if (url === '/organizations') await held;
      return answer(url);
    });
    served = { ...served, members: [], memberPeople: [] };
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();

    const submit = byTestId('manage-org-remove-submit-button')!;
    expect(submit.hasAttribute('disabled')).toBe(true);
    submit.click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledTimes(1);

    reread();
    await flushPromises();
    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(byTestId('manage-org-remove-error')).toBeNull();
    wrapper.unmount();
  });

  it('removes the person whose row was pressed, when an account before them is gone', async () => {
    api.delete.mockResolvedValue({ data: {} });
    // The stored ids still name a deleted account; the read serves each person with their own id.
    const wrapper = mountDialog({
      admins: ['u-ada', 'u-gone-admin', 'u-admin'],
      adminPeople: [
        { userId: 'u-ada', email: 'ada@example.com' },
        { userId: 'u-admin', email: 'admin@example.com' },
      ],
      members: ['u-ana', 'u-gone', 'u-walk'],
      memberPeople: [
        { userId: 'u-ana', email: 'ana@example.com' },
        { userId: 'u-walk', email: EMAIL },
      ],
    });
    await flushPromises();

    const members = [
      ...document.body.querySelectorAll('[data-testid="manage-org-members"] .user-card'),
    ];
    expect(members.map((row) => row.querySelector('.user-email')?.textContent)).toEqual([
      'ana@example.com',
      EMAIL,
    ]);
    members[1]!
      .querySelector<HTMLElement>('[data-testid="manage-org-remove-member-button"]')!
      .click();
    await flushPromises();
    expect(byTestId('manage-org-remove-window')!.getAttribute('aria-label')).toBe(
      'Remove walk390@example.com from Seed Test Org?',
    );
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();
    expect(api.delete).toHaveBeenLastCalledWith('/organizations/org-1/users/u-walk');

    const admins = [
      ...document.body.querySelectorAll('[data-testid="manage-org-admins"] .user-card'),
    ];
    admins[1]!.querySelector<HTMLElement>('[data-testid="manage-org-remove-user-button"]')!.click();
    await flushPromises();
    expect(byTestId('manage-org-remove-window')!.getAttribute('aria-label')).toBe(
      'Remove admin@example.com from Seed Test Org?',
    );
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();
    expect(api.delete).toHaveBeenLastCalledWith('/organizations/org-1/users/u-admin');
    wrapper.unmount();
  });

  it('says a refusal in the confirmation, and removes nothing from the list', async () => {
    api.delete.mockRejectedValue(
      Object.assign(new AxiosError('refused'), {
        response: { status: 403, data: { error: 'Only owner can remove admins' } },
      }),
    );
    const wrapper = mountDialog();
    await flushPromises();

    byTestId('manage-org-remove-user-button')!.click();
    await flushPromises();
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-org-remove-error')?.textContent?.trim()).toBe(
      'Only owner can remove admins',
    );
    expect(byTestId('manage-org-admin-email')).not.toBeNull();
    // Refused, it is ready to be asked again.
    expect(byTestId('manage-org-remove-submit-button')!.hasAttribute('disabled')).toBe(false);
    wrapper.unmount();
  });

  it('reads someone already removed elsewhere as removed: re-read, closed, focus on the list', async () => {
    api.delete.mockRejectedValue(refusing(404, 'They are no longer in this organization.'));
    const wrapper = mountDialog();
    await flushPromises();

    byTestId('manage-org-remove-member-button')!.click();
    await flushPromises();
    // Another admin removed them first: the re-read finds them gone.
    served = { ...served, members: [], memberPeople: [] };
    api.get.mockClear();
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith('/organizations');
    expect(byTestId('manage-org-remove-window')).toBeNull();
    expect(byTestId('manage-org-window')).not.toBeNull();
    expect(byTestId('manage-org-member-email')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-members');
    expect(byTestId('manage-org-error')).toBeNull();
    wrapper.unmount();
  });

  it('keeps any other refusal, a 400, in the confirmation with Remove enabled again', async () => {
    api.delete.mockRejectedValue(
      refusing(400, "They own this organization, so they can't be removed from it."),
    );
    const wrapper = mountDialog();
    await flushPromises();

    byTestId('manage-org-remove-member-button')!.click();
    await flushPromises();
    byTestId('manage-org-remove-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-org-remove-error')?.textContent?.trim()).toBe(
      "They own this organization, so they can't be removed from it.",
    );
    expect(byTestId('manage-org-member-email')).not.toBeNull();
    const submit = byTestId('manage-org-remove-submit-button')!;
    expect(submit.hasAttribute('disabled')).toBe(false);
    submit.click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('wears the quieter destructive style on each row, and still opens on no Remove', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    for (const id of ['manage-org-remove-user-button', 'manage-org-remove-member-button']) {
      expect(byTestId(id)!.className).toBe('btn btn--secondary btn--destructive');
    }
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-add-admin-button');
    wrapper.unmount();
  });
});

describe('Manage market asks before it removes', () => {
  function market(people: PersonWithAccess[]): Market {
    return {
      id: 'market-1',
      name: 'Spring Market',
      phase: MarketPhase.Applications,
      organizationId: 'org-1',
      organizationName: 'Seed Test Org',
      roles: {},
      inOrganization: true,
      actionRefusals: answersRefusing(),
      peopleWithAccess: [
        person({
          userId: 'u-owner',
          email: 'owner@example.com',
          role: MarketRole.Owner,
          marketRole: MarketRole.Owner,
        }),
        ...people,
      ],
    } as unknown as Market;
  }

  let served: Market;

  async function open(people: PersonWithAccess[]) {
    served = market(people);
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: served } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: served },
      attachTo: document.body,
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

  it('names the role they lose and the place they keep, and Cancel removes nothing', async () => {
    const wrapper = await open([person({ organizationRole: 'member' })]);

    const remove = byTestId('manage-market-remove-user-button')!;
    remove.focus();
    remove.click();
    await flushPromises();
    expect(byTestId('manage-market-remove-window')!.getAttribute('aria-label')).toBe(
      'Remove walk390@example.com from Spring Market?',
    );
    expect(byTestId('manage-market-remove-consequence')!.textContent?.trim()).toBe(
      'They lose their Editor role on it.',
    );
    expect(byTestId('manage-market-remove-keeps')!.textContent?.trim()).toBe(
      'They can still view it as a member of Seed Test Org.',
    );

    byTestId('manage-market-remove-cancel-button')!.click();
    await flushPromises();
    expect(byTestId('manage-market-remove-window')).toBeNull();
    expect(document.activeElement).toBe(remove);
    expect(api.delete).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('removes on confirm, in place, the dialog open, and focus on the list', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = await open([person()]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    expect(byTestId('manage-market-remove-keeps')).toBeNull();
    served = market([]);
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith('/markets/market-1/roles/u-walk');
    expect(byTestId('manage-market-remove-window')).toBeNull();
    expect(byTestId('manage-market-window')).not.toBeNull();
    expect(document.body.textContent).not.toContain(EMAIL);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-market-people');
    expect(wrapper.emitted('manageClose')).toBeUndefined();
    wrapper.unmount();
  });

  it('says the same words until it closes, though the re-read market reads differently', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = await open([person({ organizationRole: 'member' })]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    const record = recordConfirmation('manage-market-remove');
    // Renamed meanwhile, along with its organization: the confirmation said the old names.
    served = { ...market([]), name: 'Autumn Market', organizationName: 'Other Org' } as Market;
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();
    record.stop();

    expect(byTestId('manage-market-remove-window')).toBeNull();
    expect(record.seen).toEqual([
      'Remove walk390@example.com from Spring Market? | They lose their Editor role on it. | ' +
        'They can still view it as a member of Seed Test Org.',
    ]);
    wrapper.unmount();
  });

  it('stays busy until it closes, so a second click sends no second removal', async () => {
    api.delete.mockResolvedValue({ data: {} });
    const wrapper = await open([person()]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    // The re-read after the removal waits until it is let go.
    let reread!: () => void;
    const held = new Promise<void>((resolve) => (reread = resolve));
    const answer = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => {
      if (url === '/markets/market-1') await held;
      return answer(url);
    });
    served = market([]);
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    const submit = byTestId('manage-market-remove-submit-button')!;
    expect(submit.hasAttribute('disabled')).toBe(true);
    submit.click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledTimes(1);

    reread();
    await flushPromises();
    expect(byTestId('manage-market-remove-window')).toBeNull();
    expect(byTestId('manage-market-remove-error')).toBeNull();
    wrapper.unmount();
  });

  it('says a refusal in the confirmation, removes nothing, and may be asked again', async () => {
    api.delete.mockRejectedValue(
      Object.assign(new AxiosError('refused'), {
        response: { status: 403, data: { error: 'Only an admin can change roles' } },
      }),
    );
    const wrapper = await open([person()]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-remove-error')?.textContent?.trim()).toBe(
      'Only an admin can change roles',
    );
    expect(document.body.textContent).toContain(EMAIL);
    expect(byTestId('manage-market-remove-submit-button')!.hasAttribute('disabled')).toBe(false);
    wrapper.unmount();
  });

  it('reads a role already taken elsewhere as taken: re-read, closed, focus on the list', async () => {
    api.delete.mockRejectedValue(refusing(404, 'They no longer have a role on this market.'));
    const wrapper = await open([person()]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    // Another admin took the role first: the re-read finds it gone.
    served = market([]);
    api.get.mockClear();
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith('/markets/market-1');
    expect(byTestId('manage-market-remove-window')).toBeNull();
    expect(byTestId('manage-market-window')).not.toBeNull();
    expect(document.body.textContent).not.toContain(EMAIL);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-market-people');
    expect(wrapper.emitted('manageClose')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps any other refusal, a 400, in the confirmation with Remove enabled again', async () => {
    api.delete.mockRejectedValue(
      refusing(400, "The market's only Owner can't be removed. Transfer ownership first."),
    );
    const wrapper = await open([person()]);

    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-remove-error')?.textContent?.trim()).toBe(
      "The market's only Owner can't be removed. Transfer ownership first.",
    );
    expect(document.body.textContent).toContain(EMAIL);
    const submit = byTestId('manage-market-remove-submit-button')!;
    expect(submit.hasAttribute('disabled')).toBe(false);
    submit.click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("asks before taking an organization admin's market role, and says they still run it", async () => {
    const wrapper = await open([
      person({ role: MarketRole.Admin, organizationRole: 'admin', fromOrganization: true }),
    ]);

    const remove = byTestId('manage-market-remove-user-button')!;
    expect(remove.className).toBe('btn btn--secondary btn--destructive');
    remove.click();
    await flushPromises();
    expect(byTestId('manage-market-remove-consequence')!.textContent?.trim()).toBe(
      'They lose their Editor role on it.',
    );
    expect(byTestId('manage-market-remove-keeps')!.textContent?.trim()).toBe(
      'They can still run it as an admin of Seed Test Org.',
    );
    expect(api.delete).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
