/**
 * Manage market's Permissions section (E39/F01/S04), as a person meets it.
 *
 * The review of its first build found its captions wearing the global `.note` primitive, a rule
 * down each of about 25 lines; focus left on the page's body after a reset, since the button that
 * opened it is disabled once nothing is held; and further notes this file pins one by one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketPermissions from '@/components/MarketPermissions.vue';
import {
  type Market,
  MarketPhase,
  MarketRole,
  type PermissionTableRow,
} from '@/assets/types/datatypes';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));

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
    id: 'move-phase',
    group: 'Lifecycle',
    label: 'Move the phase',
    role: MarketRole.Admin,
    default: MarketRole.Admin,
    mayWhat: "move this market's phase",
  }),
  row({}),
];

const HELD = BUILT_IN.map((r) =>
  r.id === 'check-in' ? { ...r, role: MarketRole.Admin, source: 'market' as const } : r,
);

function market(table: PermissionTableRow[]): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Review,
    actionRefusals: answersRefusing(),
    permissionTable: table,
  } as unknown as Market;
}

let wrapper: VueWrapper | null = null;

async function openSection(table: PermissionTableRow[]): Promise<VueWrapper> {
  // The dialog's copy of the market takes the table a write answers, as Manage market does.
  const mounted = mount(MarketPermissions, {
    props: {
      market: market(table),
      onChanged: (answered: PermissionTableRow[]) =>
        void mounted.setProps({ market: market(answered) }),
    },
    attachTo: document.body,
  });
  wrapper = mounted;
  await wrapper.get('[data-testid="manage-market-permissions-toggle"]').trigger('click');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
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
  it('does not wear the global note primitive on its captions, a rule down each line', async () => {
    const section = await openSection(HELD);

    expect(section.findAll('.note')).toHaveLength(0);
    expect(section.findAll('[data-testid="manage-market-permission-source"]')).toHaveLength(3);
  });
});

describe('resetting every row', () => {
  it('leaves focus on the section, since the button that opened it is disabled once nothing is held', async () => {
    const section = await openSection(HELD);
    api.delete.mockResolvedValue({ data: { permissionTable: BUILT_IN } });

    const reset = section.get<HTMLButtonElement>('[data-testid="manage-market-permissions-reset"]');
    reset.element.focus();
    await reset.trigger('click');
    await flushPromises();
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-testid="manage-market-permissions-reset-confirm-submit-button"]',
    )!;
    confirm.click();
    await flushPromises();

    expect(reset.element.disabled).toBe(true);
    expect(document.activeElement).toBe(
      section.get('[data-testid="manage-market-permissions-toggle"]').element,
    );
  });
});
