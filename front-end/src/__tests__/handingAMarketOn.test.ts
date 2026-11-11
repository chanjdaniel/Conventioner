/**
 * A market's Owner hands the market on from Manage market (T283).
 *
 * "Hand this market on" stands for whoever the table lets take its row, the Owner alone by its fixed
 * default, between "Rename market" and "Delete market". Its "Hand on" opens a destructive dialog
 * whose picker offers everyone with access but the Owner, found by address, and says what the other
 * person gains and what the Owner keeps once one is chosen. Confirmed, it sends one request, closes,
 * re-reads the market, so the section goes and Users with access shows both new roles, and puts
 * focus on that list. A refusal stays in the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import ManageMarketOverlay from '@/views/ManageMarketOverlay.vue';
import {
  MarketPhase,
  MarketRole,
  type Market,
  type PersonWithAccess,
} from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { ADMIN_ANSWERS, answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

function person(
  userId: string,
  email: string,
  role: MarketRole,
  overrides: Partial<PersonWithAccess> = {},
): PersonWithAccess {
  return {
    userId,
    email,
    role,
    marketRole: role,
    organizationRole: null,
    fromOrganization: false,
    ...overrides,
  };
}

const OWNER = person('u-owner', 'owner@example.com', MarketRole.Owner);
const ADMIN = person('u-admin', 'admin@example.com', MarketRole.Admin);
const MEMBER = person('u-member', 'member@example.com', MarketRole.Viewer, {
  marketRole: null,
  organizationRole: 'member',
  fromOrganization: true,
});

function market(people: PersonWithAccess[], overrides: Partial<Market> = {}): Market {
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
    peopleWithAccess: people,
    ...overrides,
  } as unknown as Market;
}

/** The market as the read serves it to the old Owner once the Admin owns it. */
const HANDED_ON = market(
  [
    person('u-admin', 'admin@example.com', MarketRole.Owner),
    person('u-owner', 'owner@example.com', MarketRole.Admin),
    MEMBER,
  ],
  { actionRefusals: ADMIN_ANSWERS },
);

const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTestId = (id: string) => [
  ...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const MARKET_CHANGED =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const text = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim();

function refusing(status: number, data: Record<string, string>): AxiosError {
  return Object.assign(new AxiosError('refused'), { response: { status, data } });
}

describe('handing a market on', () => {
  let served: Market;

  beforeEach(() => {
    setActivePinia(createPinia());
    // The Owner is the person looking: only they are let take the row.
    localStorage.setItem('user', JSON.stringify(OWNER.email));
    api.get.mockReset();
    api.post.mockReset();
    document.body.innerHTML = '';
    served = market([OWNER, ADMIN, MEMBER]);
    api.get.mockImplementation(async (url: string) =>
      url === '/markets/market-1'
        ? { data: { market: served } }
        : { data: { entries: [], next: null, vendorNames: {}, actors: [], groups: [] } },
    );
  });

  afterEach(() => localStorage.removeItem('user'));

  async function open() {
    const wrapper = mount(ManageMarketOverlay, {
      props: { manageOpen: true, market: served },
      attachTo: document.body,
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
  }

  async function openTheDialog() {
    byTestId('manage-market-hand-on-button')!.click();
    await flushPromises();
  }

  const field = () => byTestId('hand-on-market-picker-input') as HTMLInputElement;
  const submit = () => byTestId('hand-on-market-submit-button') as HTMLButtonElement;

  async function showChoices() {
    field().click();
    await flushPromises();
    return allByTestId('hand-on-market-picker-option');
  }

  async function choose(email: string) {
    await showChoices();
    allByTestId('hand-on-market-picker-option')
      .find((option) => option.dataset.value === email)!
      .click();
    await flushPromises();
  }

  it('stands between Rename market and Delete market, for the Owner', async () => {
    const wrapper = await open();

    const headings = [...document.body.querySelectorAll('h3')].map((h) => h.textContent?.trim());
    const at = headings.indexOf('Hand this market on');
    expect(headings[at - 1]).toBe('Rename market');
    expect(headings[at + 1]).toBe('Delete market');
    expect(text('manage-market-hand-on-line')).toBe(
      'Make someone with access its Owner. You stay on it as an Admin.',
    );
    expect(text('manage-market-hand-on-button')).toBe('Hand on');
    expect(byTestId('manage-market-hand-on-button')!.className).toContain('btn--secondary');
    wrapper.unmount();
  });

  it('is not there for anyone the row refuses', async () => {
    served = market([OWNER, ADMIN, MEMBER], { actionRefusals: ADMIN_ANSWERS });
    const wrapper = await open();

    expect(byTestId('manage-market-hand-on')).toBeNull();
    expect(byTestId('manage-market-hand-on-button')).toBeNull();
    wrapper.unmount();
  });

  it('asks the table, not a role: a market whose read refuses only this row shows no section', async () => {
    served = market([OWNER, ADMIN], {
      actionRefusals: answersRefusing(MarketAction.HandOnMarket),
    });
    const wrapper = await open();

    expect(byTestId('manage-market-hand-on')).toBeNull();
    expect(byTestId('manage-market-delete-button')).not.toBeNull();
    wrapper.unmount();
  });

  it('says to add someone first, with no button, when nobody else has access', async () => {
    served = market([OWNER]);
    const wrapper = await open();

    expect(text('manage-market-hand-on-nobody')).toBe(
      'Nobody else has access to this market yet. Add someone under Users with access first.',
    );
    expect(byTestId('manage-market-hand-on-button')).toBeNull();
    expect(byTestId('manage-market-hand-on-line')).toBeNull();
    wrapper.unmount();
  });

  it('opens a destructive dialog titled for the market, its button waiting for a choice', async () => {
    const wrapper = await open();
    await openTheDialog();

    expect(byTestId('hand-on-market-window')!.getAttribute('aria-label')).toBe(
      'Hand Spring Market on',
    );
    const label = document.body.querySelector(`label[for="${field().id}"]`);
    expect(label?.textContent?.trim()).toBe('New owner');
    expect(submit().textContent?.trim()).toBe('Hand on');
    expect(submit().className).toContain('btn--destructive');
    expect(submit().disabled).toBe(true);
    expect(byTestId('hand-on-market-consequence')).toBeNull();
    wrapper.unmount();
  });

  it('offers everyone with access but the Owner, each with the role that counts', async () => {
    const wrapper = await open();
    await openTheDialog();

    const choices = await showChoices();

    expect(choices.map((choice) => choice.dataset.value)).toEqual([
      'admin@example.com',
      'member@example.com',
    ]);
    const part = (selector: string) =>
      choices.map((choice) => choice.querySelector(selector)?.textContent?.trim());
    expect(part('.search-picker-option-label')).toEqual([
      'admin@example.com',
      'member@example.com',
    ]);
    expect(part('.search-picker-option-detail')).toEqual([
      'Admin',
      'Viewer, through Seed Test Org',
    ]);
    wrapper.unmount();
  });

  it('finds a person by part of their address', async () => {
    const wrapper = await open();
    await openTheDialog();

    field().value = 'MEMB';
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(allByTestId('hand-on-market-picker-option').map((o) => o.dataset.value)).toEqual([
      'member@example.com',
    ]);
    wrapper.unmount();
  });

  it('says what the other person gains and what the Owner keeps once a choice is made', async () => {
    const wrapper = await open();
    await openTheDialog();
    await choose('admin@example.com');

    expect(text('hand-on-market-consequence')).toBe(
      'admin@example.com becomes its Owner: only they can delete it, give and take Admin roles ' +
        'and change who may do what. You stay on it as an Admin, and cannot take it back yourself.',
    );
    expect(submit().disabled).toBe(false);
    wrapper.unmount();
  });

  it('sends one request, closes, re-reads, and the section goes as both new roles show', async () => {
    const wrapper = await open();
    await openTheDialog();
    await choose('admin@example.com');
    let answer: (value: unknown) => void = () => {};
    api.post.mockImplementation(() => new Promise((resolve) => (answer = resolve)));

    submit().click();
    await flushPromises();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/hand-on', { userId: 'u-admin' });
    // In flight: neither a second request nor a close.
    expect(submit().disabled).toBe(true);
    expect((byTestId('hand-on-market-close-button') as HTMLButtonElement | null)?.disabled).toBe(
      true,
    );

    served = HANDED_ON;
    answer({ data: { market: HANDED_ON } });
    await flushPromises();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(byTestId('hand-on-market-window')).toBeNull();
    expect(byTestId('manage-market-hand-on')).toBeNull();
    expect(byTestId('manage-market-delete-button')).toBeNull();
    const roles = allByTestId('manage-market-person').map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(roles[0]).toContain('admin@example.com');
    expect(roles[0]).toContain('Owner');
    expect(roles.some((row) => row?.includes('owner@example.com') && row.includes('Admin'))).toBe(
      true,
    );
    expect(document.activeElement).toBe(byTestId('manage-market-people'));
    wrapper.unmount();
  });

  it('keeps a refusal in the dialog, with the choice, and sends nothing more', async () => {
    const wrapper = await open();
    await openTheDialog();
    await choose('admin@example.com');
    api.post.mockRejectedValue(
      refusing(400, { error: 'You can hand this market only to someone who has access to it.' }),
    );
    const reads = api.get.mock.calls.length;

    submit().click();
    await flushPromises();

    expect(byTestId('hand-on-market-window')).not.toBeNull();
    expect(byTestId('hand-on-market-window')!.textContent).toContain(
      'You can hand this market only to someone who has access to it.',
    );
    expect(text('hand-on-market-consequence')).toContain('admin@example.com becomes its Owner');
    expect(submit().disabled).toBe(false);
    expect(api.get.mock.calls.length).toBe(reads);
    wrapper.unmount();
  });

  it('re-reads the market behind the dialog when it changed under the hand-on', async () => {
    const wrapper = await open();
    await openTheDialog();
    await choose('admin@example.com');
    api.post.mockRejectedValue(refusing(409, { error: MARKET_CHANGED, code: 'market_changed' }));
    const reads = api.get.mock.calls.filter(([url]) => url === '/markets/market-1').length;

    submit().click();
    await flushPromises();

    expect(byTestId('hand-on-market-window')!.textContent).toContain(MARKET_CHANGED);
    expect(api.get.mock.calls.filter(([url]) => url === '/markets/market-1').length).toBe(
      reads + 1,
    );
    wrapper.unmount();
  });

  it('opens on no choice again after a cancel', async () => {
    const wrapper = await open();
    await openTheDialog();
    await choose('admin@example.com');

    byTestId('hand-on-market-cancel-button')!.click();
    await flushPromises();
    expect(byTestId('hand-on-market-window')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    await openTheDialog();
    expect(field().value).toBe('');
    expect(submit().disabled).toBe(true);
    wrapper.unmount();
  });
});
