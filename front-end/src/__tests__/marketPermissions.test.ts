/**
 * Manage market's Permissions (E39/F01/S04), as a person meets it: a section's line and a button,
 * with the rows in a dialog of their own (T217).
 *
 * The review of its first build found its captions wearing the global `.note` primitive, a rule
 * down each of about 25 lines; focus left on the page's body after a reset, since the button that
 * opened it is disabled once nothing is held; and further notes this file pins one by one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import MarketPermissions from '@/components/MarketPermissions.vue';
import {
  type Market,
  MarketPhase,
  MarketRole,
  type PermissionTableRow,
} from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

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

function market(table: PermissionTableRow[], refused: MarketAction[] = []): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    organizationId: 'org-1',
    phase: MarketPhase.Applications,
    actionRefusals: answersRefusing(...refused),
    permissionTable: table,
  } as unknown as Market;
}

let wrapper: VueWrapper | null = null;

const OPEN = '[data-testid="manage-market-permissions-open"]';
const WINDOW = '[data-testid="manage-market-permissions-window"]';
const select = '[data-testid="manage-market-permission-select"]';

const body = () => new DOMWrapper(document.body);

function mountSection(table: PermissionTableRow[], refused: MarketAction[] = []): VueWrapper {
  // The dialog's copy of the market takes the table a write answers, as Manage market does.
  const mounted = mount(MarketPermissions, {
    props: {
      market: market(table, refused),
      onChanged: (answered: PermissionTableRow[]) =>
        void mounted.setProps({ market: market(answered, refused) }),
    },
    attachTo: document.body,
  });
  wrapper = mounted;
  return mounted;
}

/** The dialog is teleported to the body, so what it holds is read from there. */
async function openDialog(
  table: PermissionTableRow[],
  refused: MarketAction[] = [],
): Promise<DOMWrapper<HTMLElement>> {
  const opener = mountSection(table, refused).get<HTMLButtonElement>(OPEN);
  opener.element.focus();
  await opener.trigger('click');
  await flushPromises();
  return body();
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.get.mockReset().mockResolvedValue({ data: { entries: [] } });
  api.put.mockReset();
  api.delete.mockReset();
  api.post.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the rows', () => {
  it('do not wear the global note primitive on their captions, a rule down each line', async () => {
    const page = await openDialog(HELD);

    expect(page.findAll('.note')).toHaveLength(0);
    expect(page.findAll('[data-testid="manage-market-permission-source"]')).toHaveLength(3);
  });
});

describe('the section', () => {
  it('is its heading, its line and a button that opens the rows, with no rows of its own', async () => {
    const section = mountSection(HELD);

    expect(section.get('h3').text()).toBe('Permissions');
    expect(section.get('[data-testid="manage-market-permissions-summary"]').text()).toContain(
      '1 row differs from the built-in defaults.',
    );
    expect(section.get(OPEN).attributes('aria-expanded')).toBeUndefined();
    expect(body().find(WINDOW).exists()).toBe(false);
    expect(body().find(select).exists()).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('follows the table a write answers, with its dialog open', async () => {
    const page = await openDialog(HELD);
    api.put.mockResolvedValue({
      data: { permissionTable: BUILT_IN },
    });

    await changeFirstRow(page, MarketRole.Viewer);

    expect(page.get('[data-testid="manage-market-permissions-summary"]').text()).toContain(
      'Every row is at its built-in default.',
    );
  });
});

/** Chooses a role on the row's select, as a person does, which asks first. */
async function chooseOnFirstRow(page: DOMWrapper<HTMLElement>, role: MarketRole) {
  const first = page.get<HTMLSelectElement>(select);
  first.element.focus();
  first.element.value = role;
  await first.trigger('change');
  await flushPromises();
  return first;
}

async function changeFirstRow(page: DOMWrapper<HTMLElement>, role: MarketRole) {
  await chooseOnFirstRow(page, role);
  await page
    .get('[data-testid="manage-market-permission-confirm-submit-button"]')
    .trigger('submit');
  await flushPromises();
}

describe('the dialog', () => {
  it('is teleported beside Manage market, before the confirmations it opens, so they paint above it', async () => {
    const page = await openDialog(HELD);
    await page.get('[data-testid="manage-market-permissions-reset"]').trigger('click');
    await flushPromises();

    const permissions = page.get(WINDOW).element;
    const confirm = page.get('[data-testid="manage-market-permissions-reset-confirm-window"]');
    expect(permissions.parentElement?.parentElement).toBe(document.body);
    expect(
      permissions.compareDocumentPosition(confirm.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('holds the rows and the changes in its body, and pins Reset and Copy at its foot', async () => {
    const page = await openDialog(HELD);

    const scrolling = page.get('[data-testid="manage-market-permissions-body"]');
    expect(scrolling.find('[data-testid="manage-market-permission-row-check-in"]').exists()).toBe(
      true,
    );
    expect(scrolling.text()).toContain('Changes');
    expect(scrolling.find('[data-testid="manage-market-permissions-reset"]').exists()).toBe(false);
    const foot = page.get(`${WINDOW} footer`);
    expect(foot.find('[data-testid="manage-market-permissions-reset"]').exists()).toBe(true);
    expect(foot.find('[data-testid="manage-market-permissions-copy"]').exists()).toBe(true);
  });

  it('reads the changes each time it opens, and not before', async () => {
    const opened = () =>
      api.get.mock.calls.filter(([url]) => url === '/markets/market-1/permission-history');
    const page = await openDialog(HELD);
    expect(opened()).toHaveLength(1);

    await page.get('[data-testid="manage-market-permissions-close-button"]').trigger('click');
    await flushPromises();
    await wrapper!.get(OPEN).trigger('click');
    await flushPromises();

    expect(opened()).toHaveLength(2);
  });

  it('says why to someone who may only read, with no select and no foot', async () => {
    const page = await openDialog(HELD, [MarketAction.ChangeTheTable]);

    expect(page.get('[data-testid="manage-market-permissions-read-only"]').text()).toBe(
      "Only the market's owner changes these.",
    );
    expect(page.find(select).exists()).toBe(false);
    expect(page.find(`${WINDOW} footer`).exists()).toBe(false);
  });

  it("says an archived market's own words, to its owner too, and nothing can be changed", async () => {
    const mounted = mount(MarketPermissions, {
      props: {
        market: {
          ...market(HELD, [MarketAction.ChangeTheTable]),
          phase: MarketPhase.Archived,
        },
      },
      attachTo: document.body,
    });
    wrapper = mounted;
    await mounted.get(OPEN).trigger('click');
    await flushPromises();

    expect(body().get('[data-testid="manage-market-permissions-read-only"]').text()).toBe(
      `Only someone else may ${MarketAction.ChangeTheTable}.`,
    );
    expect(body().find(select).exists()).toBe(false);
    expect(body().find(`${WINDOW} footer`).exists()).toBe(false);
  });

  it.each([
    ['its close', () => body().get('[data-testid="manage-market-permissions-close-button"]')],
    ['the backdrop', () => body().get('[data-testid="manage-market-permissions-background"]')],
  ])('gives focus back to the button that opened it, by %s', async (_way, control) => {
    await openDialog(HELD);
    await control().trigger('click');
    await flushPromises();

    expect(body().find(WINDOW).exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper!.get(OPEN).element);
  });

  it('gives focus back to the button that opened it, by Escape', async () => {
    await openDialog(HELD);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(body().find(WINDOW).exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper!.get(OPEN).element);
  });
});

describe("a row's change", () => {
  it.each([
    [
      'Cancel',
      () =>
        body()
          .get('[data-testid="manage-market-permission-confirm-cancel-button"]')
          .trigger('click'),
    ],
    [
      'the backdrop',
      () =>
        body().get('[data-testid="manage-market-permission-confirm-background"]').trigger('click'),
    ],
    [
      'Escape',
      () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    ],
  ])('%s closes only the confirmation and puts the select back', async (_way, close) => {
    const page = await openDialog(BUILT_IN);
    const first = await chooseOnFirstRow(page, MarketRole.Viewer);
    expect(page.find('[data-testid="manage-market-permission-confirm-window"]').exists()).toBe(
      true,
    );

    await close();
    await flushPromises();

    expect(page.find('[data-testid="manage-market-permission-confirm-window"]').exists()).toBe(
      false,
    );
    expect(page.find(WINDOW).exists()).toBe(true);
    expect(first.element.value).toBe(MarketRole.Admin);
    expect(document.activeElement).toBe(first.element);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('writes once and leaves the dialog open, with the table and the changes read again', async () => {
    const page = await openDialog(BUILT_IN);
    const changed = BUILT_IN.map((r) =>
      r.id === 'move-phase' ? { ...r, role: MarketRole.Viewer, source: 'market' as const } : r,
    );
    api.put.mockResolvedValue({ data: { permissionTable: changed } });
    api.get.mockClear();

    await changeFirstRow(page, MarketRole.Viewer);

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls.map(([url]) => url)).toContain(
      '/markets/market-1/permission-history',
    );
    expect(page.find(WINDOW).exists()).toBe(true);
    expect(page.get<HTMLSelectElement>(select).element.value).toBe(MarketRole.Viewer);
  });
});

describe('resetting every row', () => {
  it("puts focus on the dialog's first control, since the button that opened it is disabled once nothing is held", async () => {
    const page = await openDialog(HELD);
    api.delete.mockResolvedValue({ data: { permissionTable: BUILT_IN } });

    const reset = page.get<HTMLButtonElement>('[data-testid="manage-market-permissions-reset"]');
    reset.element.focus();
    await reset.trigger('click');
    await flushPromises();
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-testid="manage-market-permissions-reset-confirm-submit-button"]',
    )!;
    confirm.click();
    await flushPromises();

    expect(reset.element.disabled).toBe(true);
    expect(page.find(WINDOW).exists()).toBe(true);
    expect(document.activeElement).toBe(page.get(select).element);
  });
});

describe("a row's select", () => {
  it('opens its list on ArrowDown rather than stepping to the next role and asking about it', async () => {
    const section = await openDialog(BUILT_IN);
    const showPicker = vi.fn();
    const select = section.get<HTMLSelectElement>(
      '[data-testid="manage-market-permission-select"]',
    );
    Object.defineProperty(select.element, 'showPicker', { value: showPicker });

    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      select.element.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(true);
    }
    await flushPromises();

    expect(showPicker).toHaveBeenCalledTimes(6);
    expect(document.querySelector('[data-testid="manage-market-permission-confirm-window"]')).toBe(
      null,
    );
  });

  it('leaves Alt+ArrowDown, Tab and the rest to the browser', async () => {
    const section = await openDialog(BUILT_IN);
    const select = section.get<HTMLSelectElement>(
      '[data-testid="manage-market-permission-select"]',
    );

    for (const init of [{ key: 'ArrowDown', altKey: true }, { key: 'Tab' }, { key: ' ' }]) {
      const event = new KeyboardEvent('keydown', { ...init, cancelable: true, bubbles: true });
      select.element.dispatchEvent(event);
      expect(event.defaultPrevented, init.key).toBe(false);
    }
  });
});

describe('the selects', () => {
  it('each carry an id and a name, so the browser reports no unnamed form field', async () => {
    const section = await openDialog(BUILT_IN);
    const selects = section.findAll<HTMLSelectElement>(
      '[data-testid="manage-market-permission-select"]',
    );

    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.element.id).not.toBe('');
      expect(select.element.name).not.toBe('');
    }
    expect(new Set(selects.map((s) => s.element.id)).size).toBe(2);
  });
});

describe('the changes', () => {
  it('are shown ten at a time, newest first, as the market history is', async () => {
    const entries = Array.from({ length: 12 }, (_, n) => ({
      id: `entry-${n}`,
      actor: 'owner@example.com',
      at: `2026-11-${String(20 - n).padStart(2, '0')}T10:00:00+00:00`,
      action: 'change-the-table',
      kind: 'permission_set',
      subject: { action: 'check-in' },
      detail: {
        before: { role: 'editor', source: 'built-in' },
        after: { role: 'admin', source: 'market' },
      },
    }));
    api.get.mockResolvedValue({ data: { entries } });

    const section = await openDialog(HELD);
    const shown = () => section.findAll('[data-testid="manage-market-permission-change"]');
    expect(shown()).toHaveLength(10);

    await section.get('[data-testid="manage-market-permission-changes-more"]').trigger('click');
    await flushPromises();
    expect(shown()).toHaveLength(12);
    expect(section.find('[data-testid="manage-market-permission-changes-more"]').exists()).toBe(
      false,
    );
    // The button went with the last page, and its focus to the first new change.
    expect(document.activeElement).toBe(shown()[10].element);
  });

  it('are left out, and never asked for, for a person the history is not open to', async () => {
    // An owner may raise reading the history above a role that still sees this section.
    const section = await openDialog(HELD, [MarketAction.ReadHistory]);

    expect(section.get(WINDOW).text()).not.toContain('Changes');
    expect(section.find('[data-testid="manage-market-permission-changes"]').exists()).toBe(false);
    expect(section.find('.error').exists()).toBe(false);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain(
      '/markets/market-1/permission-history',
    );
    // A row this market changed still says so, without the history to say who.
    expect(
      section
        .get('[data-testid="manage-market-permission-row-check-in"]')
        .get('[data-testid="manage-market-permission-source"]')
        .text(),
    ).toBe('Changed on this market');
  });
});

describe("copying the organization's defaults again", () => {
  const COPIED = BUILT_IN.map((r) =>
    r.id === 'check-in' ? { ...r, role: MarketRole.Admin, source: 'organization' as const } : r,
  );

  it('is asked about, sent, and shows the copied rows as copied', async () => {
    const section = await openDialog(HELD);
    api.post.mockResolvedValue({ data: { permissionTable: COPIED } });

    await section.get('[data-testid="manage-market-permissions-copy"]').trigger('click');
    const confirm = document.querySelector(
      '[data-testid="manage-market-permissions-copy-confirm-window"]',
    );
    expect(confirm?.textContent).toContain('Rows changed on this market are replaced.');
    expect(api.post).not.toHaveBeenCalled();
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="manage-market-permissions-copy-confirm-submit-button"]',
      )!
      .click();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith('/markets/market-1/permissions/organization-default');
    expect(
      section
        .get('[data-testid="manage-market-permission-row-check-in"]')
        .get('[data-testid="manage-market-permission-source"]')
        .text(),
    ).toBe('Copied from the organization');
  });

  it('is offered to the owner alone', async () => {
    const section = await openDialog(HELD, [MarketAction.ChangeTheTable]);

    expect(section.find('[data-testid="manage-market-permissions-copy"]').exists()).toBe(false);
  });

  it('is not offered on a market of no organization', async () => {
    const mounted = mount(MarketPermissions, {
      props: { market: { ...market(HELD), organizationId: null } },
      attachTo: document.body,
    });
    wrapper = mounted;
    await mounted.get(OPEN).trigger('click');
    await flushPromises();

    expect(body().find('[data-testid="manage-market-permissions-copy"]').exists()).toBe(false);
    expect(body().find('[data-testid="manage-market-permissions-reset"]').exists()).toBe(true);
  });
});
