/**
 * "Show who" on a report of every vendor (T223, L9): the dialog finds one by name or address and
 * draws 50 at a time, each group's outcome, whole count, reason and possible-match line standing over
 * its first drawn row. The real report, dialog and `ListFrame`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import DiscordRoleReport from '@/components/DiscordRoleReport.vue';
import type { DiscordRoleRun } from '@/assets/types/datatypes';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {} }),
}));

const pad = (n: number) => String(n).padStart(3, '0');
const idOf = (n: number) => `app-${pad(n)}`;
const emailOf = (n: number) => `vendor-${pad(n)}@role-report.test`;
const ROLE_ABOVE = 'Conventioner’s role is below Vendor Nov 2026.';

/** 1 to 30 given, 31 to 70 not found, 71 to 120 failed for one reason, and one since removed. */
function outcomeOf(n: number) {
  if (n <= 30) return { applicationId: idOf(n), outcome: 'given', reason: null };
  if (n <= 70) return { applicationId: idOf(n), outcome: 'not_found', reason: null };
  return { applicationId: idOf(n), outcome: 'failed', reason: ROLE_ABOVE };
}

function runOf(count: number, removed = true): DiscordRoleRun {
  const outcomes = Array.from({ length: count }, (_, i) => outcomeOf(i + 1));
  if (removed) outcomes.push({ applicationId: 'app-removed', outcome: 'given', reason: null });
  return { ranAt: '2026-10-31T12:00:00+00:00', roleName: 'Vendor Nov 2026', outcomes };
}

function addressesOf(count: number): Map<string, string> {
  return new Map(Array.from({ length: count }, (_, i) => [idOf(i + 1), emailOf(i + 1)]));
}

/** Every vendor named Vendor and their number, the tenth going by another name on the page. */
function namesOf(count: number) {
  const names: Record<string, string> = {};
  const legalNames: Record<string, string> = {};
  for (let n = 1; n <= count; n += 1) {
    names[emailOf(n)] = n % 10 ? `Vendor ${pad(n)}` : `Goesby ${pad(n)}`;
    legalNames[emailOf(n)] = `Vendor ${pad(n)} Legalname`;
  }
  return { names, legalNames };
}

let wrapper: VueWrapper | undefined;

function mounted(count: number, { removed = true, offered = [] as string[] } = {}) {
  const { names, legalNames } = namesOf(count);
  wrapper = mount(DiscordRoleReport, {
    attachTo: document.body,
    props: {
      run: runOf(count, removed),
      addresses: addressesOf(count),
      names,
      legalNames,
      now: Date.parse('2026-10-31T12:05:00+00:00'),
      offered: new Set(offered),
    },
  });
  return wrapper;
}

const byTestid = (testid: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const allByTestid = (testid: string) => [
  ...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`),
];
const groups = () => allByTestid('vendors-role-report-group');
const vendors = () => allByTestid('vendors-role-report-vendor');
const field = () => byTestid('vendors-role-report-list-find') as HTMLInputElement | null;
const count = () => byTestid('vendors-role-report-list-count')?.textContent?.trim();

async function open(report: VueWrapper) {
  await report.find('[data-testid="vendors-role-report-open"]').trigger('click');
  await nextTick();
}

async function type(words: string) {
  const input = field()!;
  input.value = words;
  input.dispatchEvent(new Event('input'));
  await nextTick();
}

/** Each drawn group as its outcome, its count, its reason and its matches line, then its rows. */
function drawnGroups() {
  return groups().map((group) => ({
    head: [...group.querySelectorAll('.role-report-group-head > span')]
      .map((part) => part.textContent!.trim())
      .join(' '),
    reason: group.querySelector('[data-testid="vendors-role-report-reason"]')?.textContent?.trim(),
    matches: group
      .querySelector('[data-testid="vendors-role-report-matches"]')
      ?.textContent?.trim(),
    rows: group.querySelectorAll('[data-testid="vendors-role-report-vendor"]').length,
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe('"Show who" on a report of 121 vendors', () => {
  it('draws 50, each group over its first drawn row with its whole count, and none undrawn', async () => {
    const report = mounted(120, { offered: [idOf(31), idOf(32)] });
    await open(report);

    expect(field()).not.toBeNull();
    expect(document.querySelector(`label[for="${field()!.id}"]`)?.textContent).toBe(
      'Find by name or address',
    );
    expect(count()).toBe('Showing 50 of 121');
    expect(vendors()).toHaveLength(50);
    expect(drawnGroups()).toEqual([
      { head: 'Given 31', reason: undefined, matches: undefined, rows: 31 },
      {
        head: 'Not found 40',
        reason: undefined,
        matches: '2 have a possible match to confirm or decline.',
        rows: 19,
      },
    ]);
    expect(byTestid('vendors-role-report-list-more')?.textContent?.trim()).toBe('Show 50 more');
  });

  it('draws the vendor no longer listed with no words typed, in its group', async () => {
    const report = mounted(120);
    await open(report);

    const given = groups()[0]!;
    expect(given.textContent).toContain('A vendor no longer listed');
    expect(given.textContent).toContain(emailOf(1));
  });

  it('hands the focus to the first new row on "Show 50 more", inside the dialog', async () => {
    const report = mounted(120);
    await open(report);

    byTestid('vendors-role-report-list-more')!.click();
    await nextTick();
    await nextTick();

    expect(vendors()).toHaveLength(100);
    const fifty = vendors()[50]!;
    expect(document.activeElement).toBe(fifty);
    expect(fifty.hasAttribute('data-list-row')).toBe(true);
    expect(fifty.getAttribute('tabindex')).toBe('-1');
    expect(byTestid('vendors-role-report-who-window')!.contains(fifty)).toBe(true);
    // The failures' group stands over its first row now, its reason said once.
    expect(drawnGroups().map(({ head, reason, rows }) => ({ head, reason, rows }))).toEqual([
      { head: 'Given 31', reason: undefined, rows: 31 },
      { head: 'Not found 40', reason: undefined, rows: 40 },
      { head: 'Failed 50', reason: ROLE_ABOVE, rows: 29 },
    ]);
  });

  it('finds one by name, by address and by the name on their identification', async () => {
    const report = mounted(120, { offered: [idOf(45)] });
    await open(report);

    await type('vendor 101');
    expect(count()).toBe('1 of 121 matches "vendor 101"');
    expect(drawnGroups()).toEqual([
      { head: 'Failed 50', reason: ROLE_ABOVE, matches: undefined, rows: 1 },
    ]);
    expect(vendors()[0]!.textContent).toContain(emailOf(101));

    await type(emailOf(45));
    expect(drawnGroups()).toEqual([
      {
        head: 'Not found 40',
        reason: undefined,
        matches: '1 has a possible match to confirm or decline.',
        rows: 1,
      },
    ]);

    // The tenth go by another name on the page, and are found by the one on their identification.
    await type('vendor 040 legalname');
    expect(vendors()).toHaveLength(1);
    expect(vendors()[0]!.textContent).toContain('Goesby 040');
  });

  it('finds the vendor no longer listed by no words, and says when nothing matches', async () => {
    const report = mounted(120);
    await open(report);

    for (const words of ['no longer listed', 'vendor no longer', 'app-removed']) {
      await type(words);
      expect(vendors(), words).toHaveLength(0);
    }
    expect(count()).toBe('Nothing matches "app-removed"');
    expect(groups()).toHaveLength(0);
  });

  it('forgets its words with the dialog', async () => {
    const report = mounted(120);
    await open(report);
    await type('vendor 101');
    expect(vendors()).toHaveLength(1);

    byTestid('vendors-role-report-who-close-button')!.click();
    await nextTick();
    await open(report);

    expect(field()!.value).toBe('');
    expect(vendors()).toHaveLength(50);
  });
});

describe('"Show who" at 12 vendors or fewer', () => {
  it('has no field and no count line, every group as it was', async () => {
    const report = mounted(12, { removed: false });
    await open(report);

    expect(field()).toBeNull();
    expect(byTestid('vendors-role-report-list-count')).toBeNull();
    expect(byTestid('vendors-role-report-list-more')).toBeNull();
    expect(drawnGroups()).toEqual([
      { head: 'Given 12', reason: undefined, matches: undefined, rows: 12 },
    ]);
  });

  it('takes the field at 13', async () => {
    const report = mounted(13, { removed: false });
    await open(report);

    expect(field()).not.toBeNull();
    expect(count()).toBe('13 vendors');
  });
});
