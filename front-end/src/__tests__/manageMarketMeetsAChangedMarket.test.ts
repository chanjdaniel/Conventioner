/**
 * Manage market, meeting "market changed" from a role write, re-reads who has access (ADR 0024).
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
