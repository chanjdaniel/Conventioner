/**
 * Manage market, meeting "market changed" from a role write, re-reads who has access (ADR 0024);
 * from a change to the permission table or a rename, it re-reads the market the same way.
 *
 * Giving, changing and taking a role each hold the roles they read; when another organizer changed
 * them first, the server stores nothing and answers its one 409, `{"error": <the sentence>, "code":
 * "market_changed"}`. Manage market keeps a copy of the market of its own, so it re-reads that copy,
 * and the sentence stands where that action's refusal has always stood: under the add form, in the
 * removal's confirmation, under the person's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import {
  MarketPhase,
  MarketRole,
  type Market,
  type PermissionTableRow,
  type PersonWithAccess,
} from '@/assets/types/datatypes';
import { MARKET_CHANGED_CODE } from '@/utils/api';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const EMAIL = 'walk390@example.com';
const OTHER = 'added-meanwhile@example.com';

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

const OWNER = person({
  userId: 'u-owner',
  email: 'owner@example.com',
  role: MarketRole.Owner,
  marketRole: MarketRole.Owner,
});

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
    permissionTable: [],
    peopleWithAccess: [OWNER, ...people],
  } as unknown as Market;
}

/** The 409 a role write answers when another organizer left the market with `people` first. */
function changedMeanwhile(people: PersonWithAccess[]) {
  return async () => {
    served = market(people);
    throw Object.assign(new AxiosError('refused'), {
      response: { status: 409, data: { error: SENTENCE, code: MARKET_CHANGED_CODE } },
    });
  };
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const marketReads = () => api.get.mock.calls.filter(([url]) => url === '/markets/market-1').length;
const shownEmails = () =>
  [...document.querySelectorAll('[data-testid="manage-market-person"] .user-email')].map((cell) =>
    cell.textContent?.trim(),
  );

let served: Market;

async function open() {
  const wrapper = mount(ManageMarketOverlay, {
    props: { manageOpen: true, market: served },
    attachTo: document.body,
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  document.body.innerHTML = '';
  served = market([person()]);
  api.get.mockImplementation(async (url: string) =>
    url === '/markets/market-1'
      ? { data: { market: served } }
      : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
  );
});

describe('Manage market meets a market that changed under a role write', () => {
  it('re-reads who has access after a refused add, and says the sentence under the form', async () => {
    api.post.mockImplementation(
      changedMeanwhile([person(), person({ userId: 'u-o', email: OTHER })]),
    );
    await open();
    byTestId('manage-market-add-user-button')!.click();
    await flushPromises();
    const input = byTestId('manage-market-add-user-input') as HTMLInputElement;
    input.value = 'newcomer@example.com';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-add-user-submit')!.click();
    await flushPromises();

    expect(byTestId('manage-market-add-user-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(marketReads()).toBe(readsBefore + 1);
    expect(shownEmails()).toContain(OTHER);
    // What was typed stays, so making the change again is one press.
    expect((byTestId('manage-market-add-user-input') as HTMLInputElement).value).toBe(
      'newcomer@example.com',
    );
  });

  it('reads nothing again after an add refused for any other reason', async () => {
    api.post.mockRejectedValue(
      Object.assign(new AxiosError('refused'), {
        response: { status: 400, data: { error: 'User not found' } },
      }),
    );
    await open();
    byTestId('manage-market-add-user-button')!.click();
    await flushPromises();
    const input = byTestId('manage-market-add-user-input') as HTMLInputElement;
    input.value = 'nobody@example.com';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-add-user-submit')!.click();
    await flushPromises();

    expect(byTestId('manage-market-add-user-error')!.textContent?.trim()).toBe('User not found');
    expect(marketReads()).toBe(readsBefore);
  });

  it('re-reads who has access after a refused removal, and says the sentence in its confirmation', async () => {
    // Someone else made them an Admin first: they still hold a role, so the take is refused.
    api.delete.mockImplementation(
      changedMeanwhile([person({ role: MarketRole.Admin, marketRole: MarketRole.Admin })]),
    );
    await open();
    byTestId('manage-market-remove-user-button')!.click();
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-remove-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-remove-window')).not.toBeNull();
    expect(byTestId('manage-market-remove-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(byTestId('manage-market-remove-submit-button')!.hasAttribute('disabled')).toBe(false);
    expect(marketReads()).toBe(readsBefore + 1);
    expect(
      (document.querySelector('[data-testid="manage-market-role-select"]') as HTMLSelectElement)
        .value,
    ).toBe(MarketRole.Admin);
  });

  it('re-reads who has access after a refused change, and says the sentence under the row', async () => {
    api.put.mockImplementation(
      changedMeanwhile([person({ role: MarketRole.Viewer, marketRole: MarketRole.Viewer })]),
    );
    await open();
    const select = byTestId('manage-market-role-select') as HTMLSelectElement;
    select.focus();
    select.value = MarketRole.Admin;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-role-change-submit-button')!.click();
    await flushPromises();

    expect(byTestId('manage-market-user-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(marketReads()).toBe(readsBefore + 1);
    expect((byTestId('manage-market-role-select') as HTMLSelectElement).value).toBe(
      MarketRole.Viewer,
    );
  });
});

function tableRow(role: MarketRole): PermissionTableRow {
  return {
    id: 'check-in',
    group: 'The door',
    label: 'Check vendors in',
    role,
    default: MarketRole.Editor,
    source: role === MarketRole.Editor ? 'built-in' : 'market',
    fixed: false,
    mayWhat: 'check vendors in at this market',
  };
}

/** A market whose one table row is held at `role`, in `phase`. */
function withTable(role: MarketRole, phase = MarketPhase.Applications): Market {
  return { ...market([person()]), phase, permissionTable: [tableRow(role)] } as Market;
}

/** The 409 any write answers when another organizer left the market as `then` first. */
function refusedOver(then: Market) {
  return async () => {
    served = then;
    throw Object.assign(new AxiosError('refused'), {
      response: { status: 409, data: { error: SENTENCE, code: MARKET_CHANGED_CODE } },
    });
  };
}

async function openPermissions() {
  byTestId('manage-market-permissions-open')!.click();
  await flushPromises();
}

const shownRole = () =>
  (byTestId('manage-market-permission-select') as HTMLSelectElement | null)?.value;

describe('Manage market meets a market that changed under a change to the table', () => {
  beforeEach(() => {
    served = withTable(MarketRole.Admin);
  });

  it("re-reads the market after a refused row's change, and says the sentence in its confirmation", async () => {
    api.put.mockImplementation(refusedOver(withTable(MarketRole.Viewer)));
    await open();
    await openPermissions();
    const select = byTestId('manage-market-permission-select') as HTMLSelectElement;
    select.focus();
    select.value = MarketRole.Owner;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-permission-confirm-submit-button')!.dispatchEvent(
      new Event('submit', { bubbles: true }),
    );
    await flushPromises();

    expect(byTestId('manage-market-permission-confirm-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(marketReads()).toBe(readsBefore + 1);
    expect(shownRole()).toBe(MarketRole.Viewer);
    // The confirmation asks about the row as it now stands, never the one first read.
    expect(byTestId('manage-market-permission-confirm-change')!.textContent).toContain(
      'Check vendors in: Viewer and above to Owner only.',
    );

    byTestId('manage-market-permission-confirm-cancel-button')!.click();
    await flushPromises();
    expect(byTestId('manage-market-permission-confirm-window')).toBeNull();
    expect(shownRole()).toBe(MarketRole.Viewer);
  });

  it("closes a refused row's change the market now holds, and says the sentence in Permissions", async () => {
    api.put.mockImplementation(refusedOver(withTable(MarketRole.Owner)));
    await open();
    await openPermissions();
    const select = byTestId('manage-market-permission-select') as HTMLSelectElement;
    select.focus();
    select.value = MarketRole.Owner;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    byTestId('manage-market-permission-confirm-submit-button')!.dispatchEvent(
      new Event('submit', { bubbles: true }),
    );
    await flushPromises();

    expect(byTestId('manage-market-permission-confirm-window')).toBeNull();
    expect(byTestId('manage-market-permissions-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(shownRole()).toBe(MarketRole.Owner);
  });

  it('re-reads the market after a refused reset, and says the sentence in its confirmation', async () => {
    api.delete.mockImplementation(refusedOver(withTable(MarketRole.Viewer)));
    await open();
    await openPermissions();
    byTestId('manage-market-permissions-reset')!.click();
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-permissions-reset-confirm-submit-button')!.dispatchEvent(
      new Event('submit', { bubbles: true }),
    );
    await flushPromises();

    expect(byTestId('manage-market-permissions-reset-confirm-error')!.textContent?.trim()).toBe(
      SENTENCE,
    );
    expect(marketReads()).toBe(readsBefore + 1);
    expect(shownRole()).toBe(MarketRole.Viewer);
    // It lists what a reset would return as the rows now stand.
    expect(byTestId('manage-market-permissions-reset-changes')!.textContent?.trim()).toBe(
      'Check vendors in: Viewer and above to Editor and above',
    );
  });

  it('closes a refused reset with nothing left to reset, and says the sentence in Permissions', async () => {
    api.delete.mockImplementation(refusedOver(withTable(MarketRole.Editor)));
    await open();
    await openPermissions();
    // Opened from the keyboard, so Reset is what focus goes back to.
    byTestId('manage-market-permissions-reset')!.focus();
    byTestId('manage-market-permissions-reset')!.click();
    await flushPromises();
    const confirm = byTestId('manage-market-permissions-reset-confirm-submit-button')!;
    confirm.focus();

    confirm.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(byTestId('manage-market-permissions-reset-confirm-window')).toBeNull();
    expect(byTestId('manage-market-permissions-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(shownRole()).toBe(MarketRole.Editor);
    // Reset, which opened the confirmation, is disabled now, so focus is kept in Permissions.
    expect(byTestId('manage-market-permissions-reset')!.hasAttribute('disabled')).toBe(true);
    expect(byTestId('manage-market-permissions-window')!.contains(document.activeElement)).toBe(
      true,
    );

    // The next change asked for ends the sentence.
    const select = byTestId('manage-market-permission-select') as HTMLSelectElement;
    select.focus();
    select.value = MarketRole.Admin;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect(byTestId('manage-market-permissions-error')).toBeNull();
  });

  it("re-reads the market after a refused copy of the organization's defaults", async () => {
    api.post.mockImplementation(refusedOver(withTable(MarketRole.Viewer)));
    await open();
    await openPermissions();
    byTestId('manage-market-permissions-copy')!.click();
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-permissions-copy-confirm-submit-button')!.dispatchEvent(
      new Event('submit', { bubbles: true }),
    );
    await flushPromises();

    expect(byTestId('manage-market-permissions-copy-confirm-error')!.textContent?.trim()).toBe(
      SENTENCE,
    );
    expect(marketReads()).toBe(readsBefore + 1);
    expect(shownRole()).toBe(MarketRole.Viewer);
  });

  it('reads nothing again after a change refused for any other reason', async () => {
    api.put.mockRejectedValue(
      Object.assign(new AxiosError('refused'), {
        response: { status: 403, data: { error: 'Only the owner changes these.' } },
      }),
    );
    await open();
    await openPermissions();
    const select = byTestId('manage-market-permission-select') as HTMLSelectElement;
    select.focus();
    select.value = MarketRole.Owner;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-permission-confirm-submit-button')!.dispatchEvent(
      new Event('submit', { bubbles: true }),
    );
    await flushPromises();

    expect(byTestId('manage-market-permission-confirm-error')!.textContent?.trim()).toBe(
      'Only the owner changes these.',
    );
    expect(marketReads()).toBe(readsBefore);
  });
});

describe('Manage market meets a market that changed under a rename', () => {
  it('re-reads the market after a refused rename, and no longer offers the name it cannot change', async () => {
    served = withTable(MarketRole.Editor, MarketPhase.Draft);
    api.put.mockImplementation(refusedOver(withTable(MarketRole.Editor)));
    await open();
    const input = byTestId('manage-market-rename-input') as HTMLInputElement;
    input.value = 'Autumn Market';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    const readsBefore = marketReads();

    byTestId('manage-market-rename-save-button')!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(byTestId('manage-market-rename-error')!.textContent?.trim()).toBe(SENTENCE);
    expect(marketReads()).toBe(readsBefore + 1);
    expect(byTestId('manage-market-rename-input')).toBeNull();
    expect(byTestId('manage-market-rename-fixed')).not.toBeNull();
  });
});
