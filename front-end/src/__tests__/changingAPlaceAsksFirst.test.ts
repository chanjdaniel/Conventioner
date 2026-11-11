/**
 * The owner makes an admin a member, or a member an admin, from their row, and it asks first (T283).
 *
 * An admin could be made a member again only by removing them and adding them back. Manage
 * organization now gives its owner "Make member" on each admin's row and "Make admin" on each
 * member's, each opening a confirmation that says what the person gains or loses on the
 * organization's markets. Confirmed, the place changes through `PUT /organizations/<id>/users/<id>`,
 * the organization is read again, and focus goes to the list the person now stands in.
 *
 * A 404 is someone removed meanwhile, read as done, as Remove reads it. Every other refusal stays in
 * the confirmation, and one that met another change to the same people (the 409
 * `organization_changed`) is read again behind it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import ManageOrgOverlay from '@/views/ManageOrgOverlay.vue';
import { type Organization, type OrganizationRoleType } from '@/assets/types/datatypes';
import { ORGANIZATION_CHANGED_CODE } from '@/utils/api';
import { organizationPlaceChange } from '@/utils/organizations';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const CHANGED =
  'This organization changed while you were working on it, so your change was not saved. ' +
  'Check its people as they are now, then make your change again.';

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Seed Test Org',
    owner: 'u-owner',
    admins: ['u-admin', 'u-second'],
    members: ['u-member'],
    ownerEmail: 'owner@example.com',
    adminPeople: [
      { userId: 'u-admin', email: 'admin@example.com' },
      { userId: 'u-second', email: 'second@example.com' },
    ],
    memberPeople: [{ userId: 'u-member', email: 'member@example.com' }],
    userRole: 'owner',
    marketCount: 3,
    marketsWithOwnRole: {},
    ...overrides,
  };
}

/** The organization once the first admin is a member. */
const ADMIN_MADE_A_MEMBER: Partial<Organization> = {
  admins: ['u-second'],
  members: ['u-admin', 'u-member'],
  adminPeople: [{ userId: 'u-second', email: 'second@example.com' }],
  memberPeople: [
    { userId: 'u-admin', email: 'admin@example.com' },
    { userId: 'u-member', email: 'member@example.com' },
  ],
};

/** The organization once the member is an admin. */
const MEMBER_MADE_AN_ADMIN: Partial<Organization> = {
  admins: ['u-admin', 'u-second', 'u-member'],
  members: [],
  adminPeople: [
    { userId: 'u-admin', email: 'admin@example.com' },
    { userId: 'u-second', email: 'second@example.com' },
    { userId: 'u-member', email: 'member@example.com' },
  ],
  memberPeople: [],
};

function failure(status: number, data: unknown): AxiosError {
  return Object.assign(new AxiosError('refused'), { response: { status, data } });
}

const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTestId = (id: string) => [
  ...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const texts = (id: string) => allByTestId(id).map((element) => element.textContent?.trim());
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
const historyReads = () =>
  api.get.mock.calls.filter(([url]) => String(url).includes('/history')).length;

describe('what changing a place in an organization says', () => {
  it('making an admin a member says they will read its markets instead of running them', () => {
    expect(organizationPlaceChange(org(), 'admin@example.com', 'member')).toEqual({
      title: 'Make admin@example.com a member?',
      text:
        'They will read every market of Seed Test Org instead of running it, unless a market ' +
        'gives them a role of its own.',
      confirmLabel: 'Make member',
    });
  });

  it('making a member an admin says they will run its markets', () => {
    expect(organizationPlaceChange(org(), 'member@example.com', 'admin')).toEqual({
      title: 'Make member@example.com an admin?',
      text: 'They will run every market of Seed Test Org as its Admin.',
      confirmLabel: 'Make admin',
    });
  });
});

describe('Manage organization changes a place from its row', () => {
  let served: Organization;

  beforeEach(() => {
    setActivePinia(createPinia());
    for (const call of Object.values(api)) call.mockReset();
    document.body.innerHTML = '';
  });

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

  /** Open the confirmation from the row's button, focused first as a browser's click focuses it. */
  async function ask(button: HTMLElement) {
    button.focus();
    button.click();
    await flushPromises();
  }

  it('gives the owner "Make member" on each admin and "Make admin" on each member, each naming them', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    // Each reads "Make member" or "Make admin" on the screen, and names its person to a screen
    // reader in a visually hidden span, as the row's Remove does (the E2E spec reads the names).
    const named = (id: string) =>
      allByTestId(id).map((button) => [
        button.firstChild?.textContent?.trim(),
        button.querySelector('.visually-hidden')?.textContent?.trim(),
      ]);
    expect(named('manage-org-make-member-button')).toEqual([
      ['Make member', 'admin@example.com'],
      ['Make member', 'second@example.com'],
    ]);
    expect(named('manage-org-make-admin-button')).toEqual([['Make admin', 'member@example.com']]);
    for (const button of [
      ...allByTestId('manage-org-make-member-button'),
      ...allByTestId('manage-org-make-admin-button'),
    ]) {
      // Before the row's Remove, and not drawn as a destructive action.
      expect(button.nextElementSibling?.textContent?.trim()).toMatch(/^Remove/);
      expect(button.classList.contains('btn--destructive')).toBe(false);
      // Nor what Manage organization opens on: one stray Enter would ask to change a place.
      expect(button.hasAttribute('data-dialog-not-first')).toBe(true);
    }
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-add-admin-button');
    wrapper.unmount();
  });

  it.each<OrganizationRoleType>(['admin', 'member'])(
    'gives an organization %s neither button',
    async (role) => {
      const wrapper = mountDialog({ userRole: role });
      await flushPromises();

      expect(allByTestId('manage-org-make-member-button')).toEqual([]);
      expect(allByTestId('manage-org-make-admin-button')).toEqual([]);
      wrapper.unmount();
    },
  );

  it('asks before making an admin a member, and Cancel and Escape change nothing', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const make = allByTestId('manage-org-make-member-button')[0]!;
    await ask(make);
    expect(byTestId('manage-org-place-change-window')!.getAttribute('aria-label')).toBe(
      'Make admin@example.com a member?',
    );
    expect(byTestId('manage-org-place-change-text')!.textContent?.trim()).toBe(
      'They will read every market of Seed Test Org instead of running it, unless a market ' +
        'gives them a role of its own.',
    );
    expect(byTestId('manage-org-place-change-submit-button')!.textContent?.trim()).toBe(
      'Make member',
    );
    // Not destructive: another change undoes it.
    expect(
      byTestId('manage-org-place-change-submit-button')!.classList.contains('btn--destructive'),
    ).toBe(false);

    byTestId('manage-org-place-change-cancel-button')!.click();
    await flushPromises();
    expect(byTestId('manage-org-place-change-window')).toBeNull();
    expect(document.activeElement).toBe(make);

    await ask(make);
    escape();
    await flushPromises();
    expect(byTestId('manage-org-place-change-window')).toBeNull();
    expect(document.activeElement).toBe(make);
    // Escape closed the confirmation only, not Manage organization beneath it.
    expect(byTestId('manage-org-window')).not.toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('asks before making a member an admin, in its own words', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    await ask(byTestId('manage-org-make-admin-button')!);

    expect(byTestId('manage-org-place-change-window')!.getAttribute('aria-label')).toBe(
      'Make member@example.com an admin?',
    );
    expect(byTestId('manage-org-place-change-text')!.textContent?.trim()).toBe(
      'They will run every market of Seed Test Org as its Admin.',
    );
    expect(byTestId('manage-org-place-change-submit-button')!.textContent?.trim()).toBe(
      'Make admin',
    );
    wrapper.unmount();
  });

  it('makes an admin a member on confirm: re-read, closed, focus on Members, History read again', async () => {
    api.put.mockImplementation(async () => {
      served = { ...served, ...ADMIN_MADE_A_MEMBER };
      return { data: { message: 'Place changed' } };
    });
    const wrapper = mountDialog();
    await flushPromises();
    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();
    expect(historyReads()).toBe(1);

    await ask(allByTestId('manage-org-make-member-button')[0]!);
    byTestId('manage-org-place-change-submit-button')!.click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/organizations/org-1/users/u-admin', {
      place: 'member',
    });
    expect(byTestId('manage-org-place-change-window')).toBeNull();
    expect(byTestId('manage-org-window')).not.toBeNull();
    expect(texts('manage-org-admin-email')).toEqual(['second@example.com']);
    expect(texts('manage-org-member-email')).toEqual(['admin@example.com', 'member@example.com']);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-members');
    expect(historyReads()).toBe(2);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.emitted('manageClose')).toBeUndefined();
    wrapper.unmount();
  });

  it('makes a member an admin on confirm, and focus goes to Admins', async () => {
    api.put.mockImplementation(async () => {
      served = { ...served, ...MEMBER_MADE_AN_ADMIN };
      return { data: { message: 'Place changed' } };
    });
    const wrapper = mountDialog();
    await flushPromises();

    await ask(byTestId('manage-org-make-admin-button')!);
    byTestId('manage-org-place-change-submit-button')!.click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/organizations/org-1/users/u-member', {
      place: 'admin',
    });
    expect(byTestId('manage-org-place-change-window')).toBeNull();
    expect(texts('manage-org-admin-email')).toEqual([
      'admin@example.com',
      'second@example.com',
      'member@example.com',
    ]);
    expect(texts('manage-org-member-email')).toEqual([]);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-admins');
    wrapper.unmount();
  });

  it('reads someone removed meanwhile as done: re-read, closed, focus on the list they were in', async () => {
    api.put.mockImplementation(async () => {
      served = { ...served, admins: ['u-second'], adminPeople: [served.adminPeople[1]!] };
      throw failure(404, { error: 'They are no longer in this organization.' });
    });
    const wrapper = mountDialog();
    await flushPromises();

    await ask(allByTestId('manage-org-make-member-button')[0]!);
    byTestId('manage-org-place-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-org-place-change-window')).toBeNull();
    expect(texts('manage-org-admin-email')).toEqual(['second@example.com']);
    expect(texts('manage-org-member-email')).toEqual(['member@example.com']);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-admins');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps the confirmation open with the 409 sentence, the people read again behind it', async () => {
    api.put.mockImplementation(async () => {
      // Someone else made the member an admin meanwhile.
      served = { ...served, ...MEMBER_MADE_AN_ADMIN };
      throw failure(409, { error: CHANGED, code: ORGANIZATION_CHANGED_CODE });
    });
    const wrapper = mountDialog();
    await flushPromises();

    await ask(allByTestId('manage-org-make-member-button')[0]!);
    api.get.mockClear();
    byTestId('manage-org-place-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-org-place-change-window')).not.toBeNull();
    expect(byTestId('manage-org-place-change-error')?.textContent?.trim()).toBe(CHANGED);
    expect(api.get).toHaveBeenCalledWith('/organizations');
    expect(texts('manage-org-admin-email')).toEqual([
      'admin@example.com',
      'second@example.com',
      'member@example.com',
    ]);
    // Refused, it may be asked again.
    expect(byTestId('manage-org-place-change-submit-button')!.hasAttribute('disabled')).toBe(false);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps any other refusal in the confirmation, with no re-read', async () => {
    api.put.mockRejectedValue(
      failure(403, { error: "Only the organization's owner can change someone's place in it." }),
    );
    const wrapper = mountDialog();
    await flushPromises();

    await ask(byTestId('manage-org-make-admin-button')!);
    api.get.mockClear();
    byTestId('manage-org-place-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-org-place-change-window')).not.toBeNull();
    expect(byTestId('manage-org-place-change-error')?.textContent?.trim()).toBe(
      "Only the organization's owner can change someone's place in it.",
    );
    expect(api.get).not.toHaveBeenCalledWith('/organizations');
    expect(wrapper.emitted('changed')).toBeUndefined();
    wrapper.unmount();
  });

  it('sends one change however often its confirm is pressed while it is in flight', async () => {
    let answer: (value: unknown) => void = () => {};
    api.put.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const wrapper = mountDialog();
    await flushPromises();

    await ask(byTestId('manage-org-make-admin-button')!);
    const submit = byTestId('manage-org-place-change-submit-button')!;
    submit.click();
    await flushPromises();
    expect(submit.hasAttribute('disabled')).toBe(true);
    submit.click();
    await flushPromises();

    expect(api.put).toHaveBeenCalledTimes(1);
    answer({ data: { message: 'Place changed' } });
    await flushPromises();
    wrapper.unmount();
  });
});
