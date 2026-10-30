/**
 * The organization's history (E40/F02/S01): its own changes, worded as the market's are, read in
 * Manage organization's History section by its owner, its admins and its members.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ManageOrgOverlay from '@/views/ManageOrgOverlay.vue';
import type { Organization } from '@/assets/types/datatypes';
import { entryChanges, entryParts, type MarketHistoryEntry } from '@/utils/marketHistory';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

function entry(overrides: Partial<MarketHistoryEntry>): MarketHistoryEntry {
  return {
    id: 'e1',
    actor: 'olive@ember.test',
    at: '2026-11-01T10:00:00+00:00',
    action: 'change-organization',
    kind: 'renamed',
    vendors: [],
    subject: {},
    detail: {},
    ...overrides,
  };
}

function sentence(overrides: Partial<MarketHistoryEntry>, labels = {}): string {
  return entryParts(entry(overrides), {}, labels)
    .map((part) => (part.kind === 'text' ? part.text : part.email))
    .join('');
}

const PERSON = { user_id: 'user-ada', email: 'ada@ember.test' };

describe('what an organization’s entry says', () => {
  it('words a rename by both names', () => {
    expect(
      sentence({ detail: { before: { name: 'Ember Markets' }, after: { name: 'Ember Fairs' } } }),
    ).toBe('olive@ember.test renamed the organization from "Ember Markets" to "Ember Fairs"');
  });

  it('words a person given, changed and taken a place, as a market’s roles are', () => {
    expect(
      sentence({
        action: 'manage-organization-admins',
        kind: 'role_given',
        subject: PERSON,
        detail: { before: { role: null }, after: { role: 'admin' } },
      }),
    ).toBe('olive@ember.test gave ada@ember.test the Admin role');
    expect(
      sentence({
        action: 'manage-organization-admins',
        kind: 'role_changed',
        subject: PERSON,
        detail: { before: { role: 'member' }, after: { role: 'admin' } },
      }),
    ).toBe('olive@ember.test changed ada@ember.test from Member to Admin');
    expect(
      sentence({
        action: 'manage-organization-members',
        kind: 'role_taken',
        subject: PERSON,
        detail: { before: { role: 'member' }, after: { role: null } },
      }),
    ).toBe('olive@ember.test took the Member role from ada@ember.test');
  });

  it('words ownership handed on by who has it now', () => {
    expect(
      sentence({
        action: 'transfer-organization',
        kind: null,
        subject: PERSON,
        detail: { before: { owner: 'olive@ember.test' }, after: { owner: 'ada@ember.test' } },
      }),
    ).toBe('olive@ember.test handed the organization to ada@ember.test');
  });

  it('words a market created in it by its name', () => {
    expect(
      sentence({
        action: 'create-market',
        kind: null,
        subject: { market_id: 'm-1' },
        detail: { before: { name: null }, after: { name: 'Winter Fair' } },
      }),
    ).toBe('olive@ember.test created the market "Winter Fair"');
  });

  it('words a market deleted from it by its name', () => {
    expect(
      sentence({
        action: 'delete-market',
        kind: null,
        subject: { market_id: 'm-1' },
        detail: { before: { name: 'Winter Fair' }, after: { name: null } },
      }),
    ).toBe('olive@ember.test deleted the market "Winter Fair"');
  });

  it('words a floorplan template added, changed and removed by its name', () => {
    const template = (kind: string) =>
      sentence({
        action: 'manage-floorplan-templates',
        kind,
        subject: { template_id: 't-1', name: 'Main hall' },
        detail: { before: { aisles: {} }, after: { aisles: { wallBufferMm: 900 } } },
      });
    expect(template('template_added')).toBe(
      'olive@ember.test added the floorplan template "Main hall"',
    );
    expect(template('template_changed')).toBe(
      'olive@ember.test changed the floorplan template "Main hall"',
    );
    expect(template('template_removed')).toBe(
      'olive@ember.test removed the floorplan template "Main hall"',
    );
  });

  it('words a floorplan template moved out of it, or into it, without naming the other', () => {
    const moved = (kind: string) =>
      sentence({
        action: 'manage-floorplan-templates',
        kind,
        subject: { template_id: 't-1', name: 'Main hall' },
        detail: {},
      });
    expect(moved('template_moved_out')).toBe(
      'olive@ember.test moved the floorplan template "Main hall" out of the organization',
    );
    expect(moved('template_moved_in')).toBe(
      'olive@ember.test moved the floorplan template "Main hall" into the organization',
    );
  });

  it('opens a template’s change to its table types and aisles in words, never JSON', () => {
    const { changed } = entryChanges(
      entry({
        action: 'manage-floorplan-templates',
        kind: 'template_changed',
        subject: { template_id: 't-1', name: 'Main hall' },
        detail: {
          before: { table_types: [], aisles: {} },
          after: {
            table_types: [
              { id: 'tt-1', name: 'Full', widthMm: 1830, heightMm: 760, maxCapacity: 1 },
              { id: 'tt-2', name: 'Half', widthMm: 915, heightMm: 760, maxCapacity: 1 },
            ],
            aisles: { wallBufferMm: 1500, tableSpacingMm: 1200, walkwayWidthMm: 2000 },
          },
        },
      }),
    );
    expect(changed).toEqual([
      {
        field: 'Table types',
        before: 'none',
        after: 'Full 1830\u00a0×\u00a0760\u00a0mm, Half 915\u00a0×\u00a0760\u00a0mm',
      },
      {
        field: 'Aisles',
        before: 'none',
        after: 'wall buffer 1500\u00a0mm, table spacing 1200\u00a0mm, walkway 2000\u00a0mm',
      },
    ]);
  });

  it('words a row of the default for new markets by its label', () => {
    const labels = { 'check-in': 'Check vendors in' };
    expect(
      sentence(
        {
          action: 'change-the-default',
          kind: 'permission_set',
          subject: { action: 'check-in' },
          detail: { before: { role: 'editor' }, after: { role: 'admin' } },
        },
        labels,
      ),
    ).toBe('olive@ember.test changed Check vendors in for new markets from Editor to Admin');
    expect(
      sentence(
        {
          action: 'change-the-default',
          kind: 'permission_reset',
          subject: { action: 'check-in' },
          detail: { before: { role: 'admin' }, after: { role: 'editor' } },
        },
        labels,
      ),
    ).toBe('olive@ember.test set Check vendors in for new markets back to its default, Editor');
  });

  it('words and opens a reset of every row of the default for new markets', () => {
    const labels = { 'check-in': 'Check vendors in', 'export-csv': 'Export CSV' };
    const reset = (rows: string[]) => ({
      action: 'change-the-default',
      kind: 'permission_table_reset',
      subject: {},
      detail: {
        before: Object.fromEntries(
          rows.map((id) => [id, { role: 'admin', source: 'organization' }]),
        ),
        after: Object.fromEntries(rows.map((id) => [id, { role: 'editor', source: 'built-in' }])),
      },
    });

    expect(sentence(reset(['check-in']), labels)).toBe(
      'olive@ember.test reset Check vendors in for new markets to its built-in default',
    );
    expect(sentence(reset(['check-in', 'export-csv']), labels)).toBe(
      'olive@ember.test reset Check vendors in and Export CSV for new markets to their built-in defaults',
    );
    expect(entryChanges(entry(reset(['check-in'])), labels).changed).toEqual([
      {
        field: 'Check vendors in',
        before: 'Admin, The organization’s default',
        after: 'Editor, Built in',
      },
    ]);
  });

  it('opens a place given to its role before and after', () => {
    expect(
      entryChanges(
        entry({
          action: 'manage-organization-admins',
          kind: 'role_given',
          subject: PERSON,
          detail: { before: { role: null }, after: { role: 'admin' } },
        }),
      ).changed,
    ).toEqual([{ field: 'Role', before: 'none', after: 'Admin' }]);
  });
});

function renamed(id: string, minutes: number, name: string): MarketHistoryEntry {
  return entry({
    id,
    at: new Date(Date.UTC(2026, 10, 1, 9, minutes)).toISOString(),
    detail: { before: { name: `${name} (old)` }, after: { name } },
  });
}

function serve(...pages: Array<{ entries: MarketHistoryEntry[]; next: string | null }>) {
  const asked: string[] = [];
  api.get.mockImplementation(async (url: string) => {
    asked.push(url);
    return { data: pages[Math.min(asked.length - 1, pages.length - 1)] };
  });
  return asked;
}

const ORG: Organization = {
  id: 'org-1',
  name: 'Ember Fairs',
  owner: 'user-olive',
  admins: [],
  members: [],
  markets: [],
  ownerEmail: 'olive@ember.test',
  adminEmails: [],
  memberEmails: [],
  userRole: 'owner',
};

function mountDialog(org: Organization = ORG) {
  return mount(ManageOrgOverlay, {
    props: { manageOpen: true, org },
    attachTo: document.body,
  });
}

const within = () => document.body;
const sentences = () =>
  [...within().querySelectorAll('[data-testid="org-history-sentence"]')].map((p) =>
    p.textContent?.trim(),
  );
const byTestId = (id: string) => within().querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  api.get.mockReset();
  document.body.innerHTML = '';
});

describe('the History section of Manage organization', () => {
  it('is closed, and reads nothing, until its heading opens it', async () => {
    const asked = serve({ entries: [renamed('e1', 1, 'Ember Fairs')], next: null });
    const wrapper = mountDialog();
    await flushPromises();

    expect(byTestId('manage-org-history-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(asked).toEqual([]);

    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();

    expect(asked).toEqual(['/organizations/org-1/history']);
    expect(sentences()).toEqual([
      'olive@ember.test renamed the organization from "Ember Fairs (old)" to "Ember Fairs"',
    ]);
    wrapper.unmount();
  });

  it('shows the newest page, and Load more adds the older ones beneath it', async () => {
    const asked = serve(
      { entries: [renamed('e3', 3, 'Three'), renamed('e2', 2, 'Two')], next: 'cursor-2' },
      { entries: [renamed('e1', 1, 'One')], next: null },
    );
    const wrapper = mountDialog();
    await flushPromises();
    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();

    byTestId('org-history-load-more')!.click();
    await flushPromises();

    expect(asked[1]).toBe('/organizations/org-1/history?before=cursor-2');
    expect(within().querySelectorAll('[data-testid="org-history-entry"]')).toHaveLength(3);
    expect(byTestId('org-history-load-more')).toBeNull();
    wrapper.unmount();
  });

  it('opens an entry to its before and after', async () => {
    serve({ entries: [renamed('e1', 1, 'Ember Fairs')], next: null });
    const wrapper = mountDialog();
    await flushPromises();
    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();

    byTestId('org-history-toggle')!.click();
    await flushPromises();

    expect(byTestId('org-history-changes')?.textContent).toContain('Ember Fairs (old)');
    wrapper.unmount();
  });

  it('reads its first page again after a change made in the same dialog', async () => {
    const asked = serve({ entries: [renamed('e1', 1, 'Ember Fairs')], next: null });
    api.put.mockResolvedValue({ data: {} });
    const wrapper = mountDialog();
    await flushPromises();
    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();

    const input = byTestId('manage-org-rename-input') as HTMLInputElement;
    input.value = 'Ember Collective';
    input.dispatchEvent(new Event('input'));
    input.form!.requestSubmit();
    await flushPromises();

    expect(asked).toEqual(['/organizations/org-1/history', '/organizations/org-1/history']);
    wrapper.unmount();
  });

  it('says so when nothing has changed yet', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog();
    await flushPromises();
    byTestId('manage-org-history-toggle')!.click();
    await flushPromises();

    expect(byTestId('org-history-empty')?.textContent).toContain(
      'Nothing has changed on this organization yet.',
    );
    wrapper.unmount();
  });

  it('is a member’s to read, beside the owner, and the people they may not manage are not', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog({ ...ORG, userRole: 'member' });
    await flushPromises();

    expect(byTestId('manage-org-history')).not.toBeNull();
    expect(byTestId('manage-org-add-member-button')).toBeNull();
    expect(byTestId('manage-org-rename-input')).toBeNull();
    wrapper.unmount();
  });
});

describe('Manage organization holds together as Manage market does', () => {
  const WITH_AN_ADMIN: Organization = {
    ...ORG,
    admins: ['user-ada'],
    adminEmails: ['ada@ember.test'],
  };

  it('puts focus in the field an add opens, and back on its button when the row closes', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog();
    await flushPromises();

    for (const who of ['admin', 'member']) {
      byTestId(`manage-org-add-${who}-button`)!.click();
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-testid')).toBe(
        `manage-org-add-${who}-input`,
      );
      byTestId(`manage-org-add-${who}-cancel`)!.click();
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-testid')).toBe(
        `manage-org-add-${who}-button`,
      );
    }
    wrapper.unmount();
  });

  it('offers an admin no rename, which is the owner’s alone', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog({ ...ORG, userRole: 'admin' });
    await flushPromises();

    expect(byTestId('manage-org-rename-input')).toBeNull();
    expect(byTestId('manage-org-add-member-button')).not.toBeNull();
    expect(byTestId('manage-org-add-admin-button')).toBeNull();
    expect(byTestId('manage-org-delete-button')).toBeNull();
    wrapper.unmount();
  });

  it('opens on its first control that is not a Remove', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog(WITH_AN_ADMIN);
    await flushPromises();

    expect(document.activeElement?.getAttribute('data-testid')).toBe('manage-org-add-admin-button');
    wrapper.unmount();
  });

  it('adds someone in one row with its own Cancel, the opening button out of the way', async () => {
    serve({ entries: [], next: null });
    const wrapper = mountDialog();
    await flushPromises();
    const add = byTestId('manage-org-add-admin-button')!;
    expect(add.className).toBe('btn btn--secondary');

    add.click();
    await flushPromises();
    expect(byTestId('manage-org-add-admin-button')).toBeNull();

    byTestId('manage-org-add-admin-cancel')!.click();
    await flushPromises();
    expect(byTestId('manage-org-add-admin-input')).toBeNull();
    expect(byTestId('manage-org-add-admin-button')).not.toBeNull();
    expect(byTestId('manage-org-add-member-button')!.className).toBe('btn btn--secondary');
    wrapper.unmount();
  });
});
