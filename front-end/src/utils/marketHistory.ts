/**
 * Every change on a market, as a person reads it (E40/F01/S03).
 *
 * The back end stores each entry structured - the table's action, a finer kind, the vendors, a
 * subject and a detail of the fields before and after (`back-end/history.py`,
 * `docs/implementation/data/history.md`) - and the wording is here, so a sentence can change
 * without a migration or a back-end release, as `placementHistory.ts` words the assignment
 * history. The organizer's words: assign and allocate tables, never place, seat or run.
 * The detail and the subject are served as stored, snake_case, since their keys are data.
 */
import { getRoleDisplayName } from '@/utils/permissions';
import { phaseLabel } from '@/utils/phase';
import { getFormattedTimestamp, getShortDate } from '@/utils/utils';
import { statusLabel } from '@/utils/verdicts';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';

type Detail = Record<string, unknown>;

/** One entry of the market's history, as `GET /markets/:id/history` serves it. */
export interface MarketHistoryEntry {
  id: string;
  /** Who made the change: an organizer's address, an applicant's for their own, or null. */
  actor: string | null;
  at: string;
  /** The id of the table's row the change asked, or `apply` for an applicant's own. */
  action: string;
  kind: string | null;
  vendors: string[];
  subject: Detail;
  detail: Detail | null;
}

/** A group of the table, the kinds of change the history is narrowed by. */
export interface MarketHistoryGroup {
  group: string;
  actions: Array<{ id: string; label: string }>;
}

/** One piece of an entry's sentence: words, or a vendor, who links to their drawer. */
export type MarketHistoryPart =
  { kind: 'text'; text: string } | { kind: 'vendor'; name: string; email: string };

function asDetail(value: unknown): Detail {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Detail) : {};
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function day(value: unknown): string {
  return value ? getShortDate(String(value)) : '';
}

function table(value: unknown): string {
  const at = asDetail(value);
  const code = str(at.table_code);
  return at.table_choice ? `${code} (${str(at.table_choice)})` : code;
}

/** Market Setup's fields, as the setup's cards name them. */
const SETUP_FIELDS: Record<string, string> = {
  market_dates: 'market dates',
  tiers: 'tiers',
  locations: 'locations',
  sections: 'sections',
  floorplans: 'floorplans',
  floorplan_ids: 'floorplans',
  intake_mode: 'how vendors apply',
  name: 'name',
};

function listed(words: string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique.join('');
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * What happened, in one sentence, as parts: who did it, and a vendor as a part of their own, so
 * the screen draws them as a link to their drawer. `labels` names each of the table's actions, for
 * a change this file has no words for yet.
 */
export function entryParts(
  entry: MarketHistoryEntry,
  names: VendorNames,
  labels: Readonly<Record<string, string>> = {},
): MarketHistoryPart[] {
  const text = (words: string): MarketHistoryPart => ({ kind: 'text', text: words });
  const who = (email: unknown): MarketHistoryPart => ({
    kind: 'vendor',
    name: vendorName(str(email), names),
    email: str(email).trim(),
  });
  const detail = asDetail(entry.detail);
  const before = asDetail(detail.before);
  const after = asDetail(detail.after);
  const vendor = who(entry.vendors[0]);
  const actor = text(`${entry.actor || 'Someone'} `);
  const onDay = (value: unknown) => (value ? ` on ${day(value)}` : '');

  switch (`${entry.action}/${entry.kind ?? ''}`) {
    case 'assign/placed': {
      const on = onDay(detail.date);
      const to = table(detail);
      if (detail.before && table(detail.before) !== to) {
        return [actor, text('moved '), vendor, text(` from ${table(detail.before)} to ${to}${on}`)];
      }
      return [actor, text('assigned '), vendor, text(` at ${to}${on}`)];
    }
    case 'assign/freed':
      return [
        actor,
        text(`freed ${str(detail.table_code)}${onDay(detail.date)}, leaving `),
        vendor,
        text(' with no table'),
      ];
    case 'assign/swapped': {
      const seats = Array.isArray(detail.seats) ? detail.seats.map(asDetail) : [];
      const [first, second] = seats.length === 2 ? seats : [];
      if (!first || !second) {
        return [
          actor,
          text('swapped '),
          who(entry.vendors[0]),
          text(' and '),
          who(entry.vendors[1]),
        ];
      }
      return [
        actor,
        text('swapped '),
        who(first.email),
        text(' and '),
        who(second.email),
        text(
          `${onDay(detail.date)} - now at ${str(first.table_code)} and ${str(second.table_code)}`,
        ),
      ];
    }
    case 'assign/assigned': {
      const written = Number(detail.placements_written ?? 0);
      const pins = Number(detail.pins_preserved ?? 0);
      return [
        actor,
        text(
          `allocated tables: ${plural(written, 'assignment', 'assignments')} written` +
            (pins ? `, ${plural(pins, 'pin', 'pins')} kept` : ''),
        ),
      ];
    }
    case 'assign/rules':
      return [actor, text('changed the assignment rules')];
    case 'change-setup/renamed':
      return [actor, text(`renamed the market from "${str(before.name)}" to "${str(after.name)}"`)];
    case 'change-setup/plan': {
      const fields = Object.keys(after).map((key) => SETUP_FIELDS[key] ?? key);
      return [actor, text(`changed Market Setup${fields.length ? `: ${listed(fields)}` : ''}`)];
    }
    case 'change-setup/floorplan':
      return [actor, text('saved a floorplan to the market')];
    case 'change-setup/floorplan_image_deleted':
      return [actor, text('deleted a floorplan image')];
    case 'change-form/form':
      return [actor, text('changed the application form')];
    case 'change-form/review_highlights':
      return [actor, text('changed the review highlights')];
    case 'change-form/rejection_rules':
      return [actor, text('changed the automatic rejections')];
    case 'amend-form/':
      return [actor, text('amended the locked form')];
    case 'amend-form/resumed':
      return [actor, text('finished amending the locked form')];
    case 'import-applications/imported':
      return [
        actor,
        text(`imported ${plural(Number(detail.row_count ?? 0), 'row', 'rows')} of applications`),
      ];
    case 'import-applications/started':
      return [
        actor,
        text(
          `started the market from a CSV of ${plural(Number(detail.row_count ?? 0), 'row', 'rows')}`,
        ),
      ];
    case 'give-verdicts/verdict':
      return [actor, text('set '), vendor, text(` to ${statusLabel(str(after.status))}`)];
    case 'give-verdicts/verdicts': {
      const statuses = Object.values(after).map((state) =>
        statusLabel(str(asDetail(state).status)),
      );
      const parts: MarketHistoryPart[] = [
        actor,
        text(`set ${plural(entry.vendors.length, 'application', 'applications')}`),
        text(statuses.length && new Set(statuses).size === 1 ? ` to ${statuses[0]}: ` : ': '),
      ];
      entry.vendors.forEach((email, index) => {
        if (index) parts.push(text(', '));
        parts.push(who(email));
      });
      return parts;
    }
    case 'give-verdicts/follow_up_owner':
      return [
        actor,
        text('handed the follow-up on '),
        vendor,
        text(` to ${str(after.follow_up_owner)}`),
      ];
    case 'move-phase/': {
      const swept = Number(detail.swept ?? 0);
      return [
        actor,
        text(
          `moved the market from ${phaseLabel(str(before.phase))} to ${phaseLabel(str(after.phase))}` +
            (swept
              ? `, turning ${plural(swept, 'unanswered offer', 'unanswered offers')} to refusals`
              : ''),
        ),
      ];
    }
    case 'publish-results/':
      return [actor, text('published the results')];
    case 'add-vendor/':
      return [actor, text('added '), vendor, text(' as a vendor')];
    case 'write-vendor-notes/note':
      return [actor, text('changed the note on '), vendor];
    case 'write-vendor-notes/request_handled':
      return [
        actor,
        text('marked the request from '),
        vendor,
        text(after.handled ? ' handled' : ' not handled'),
      ];
    case 'check-in/checked_in':
      return entry.actor
        ? [actor, text('checked '), vendor, text(` in${onDay(entry.subject.date)}`)]
        : [vendor, text(` checked in on the check-in page${onDay(entry.subject.date)}`)];
    case 'check-in/check_in_undone':
      return entry.actor
        ? [actor, text('undid the check-in of '), vendor, text(onDay(entry.subject.date))]
        : [vendor, text(` undid their check-in on the check-in page${onDay(entry.subject.date)}`)];
    case 'manage-editors-and-viewers/role_given':
    case 'manage-admins/role_given':
      return [
        actor,
        text(`gave ${str(entry.subject.email)} the ${getRoleDisplayName(str(after.role))} role`),
      ];
    case 'manage-editors-and-viewers/role_changed':
    case 'manage-admins/role_changed':
      return [
        actor,
        text(
          `changed ${str(entry.subject.email)} from ${getRoleDisplayName(str(before.role))} to ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    case 'manage-editors-and-viewers/role_taken':
    case 'manage-admins/role_taken':
      return [
        actor,
        text(
          `took the ${getRoleDisplayName(str(before.role))} role from ${str(entry.subject.email)}`,
        ),
      ];
    case 'change-the-table/permission_set':
      return [
        actor,
        text(
          `changed ${rowLabel(entry, labels)} from ${getRoleDisplayName(str(before.role))} to ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    case 'change-the-table/permission_reset':
      return [
        actor,
        text(
          `set ${rowLabel(entry, labels)} back to its default, ${getRoleDisplayName(str(after.role))}`,
        ),
      ];
    case 'apply/submitted':
      return [vendor, text(' applied')];
    case 'apply/edited':
      return [vendor, text(' edited their application')];
    default: {
      const parts: MarketHistoryPart[] = [
        actor,
        text(`made a change: ${labels[entry.action] ?? entry.action}`),
      ];
      if (entry.vendors.length) parts.push(text(', about '), vendor);
      return parts;
    }
  }
}

/** The row of the permission table a change to it is about, by its label, else by its id. */
function rowLabel(entry: MarketHistoryEntry, labels: Readonly<Record<string, string>>): string {
  const id = str(entry.subject.action);
  return labels[id] ?? id;
}

/** When it happened, as a moment, in the reader's own timezone. */
export function entryWhen(entry: MarketHistoryEntry): string {
  return getFormattedTimestamp(entry.at) || entry.at;
}

/** A field's name in words: `follow_up_owner` reads "Follow up owner". */
export function fieldName(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The longest a value is drawn before it is cut: a whole plan is a page of JSON. */
const LONGEST_VALUE = 240;

/** A stored value as a line of text: "none" for nothing, JSON for a list or an object. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const words = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return words.length > LONGEST_VALUE ? `${words.slice(0, LONGEST_VALUE)}…` : words;
}

/** Where a row of the permission table came from, in words. */
const PERMISSION_SOURCES: Record<string, string> = {
  'built-in': 'Built in',
  organization: 'The organization’s default',
  market: 'This market',
};

/** The stored values the screens already name: a phase, a status and a role, in their words. */
const NAMED_VALUES: Partial<Record<string, (value: string) => string>> = {
  phase: phaseLabel,
  status: statusLabel,
  role: getRoleDisplayName,
  source: (source) => PERMISSION_SOURCES[source] ?? source,
};

/** A field's value as the screens name it, else as `valueText` draws it. */
export function fieldValue(key: string, value: unknown): string {
  const name = NAMED_VALUES[key];
  return name && typeof value === 'string' && value ? name(value) : valueText(value);
}

/** A field the change set, as it was and as it is. */
export interface ChangedField {
  field: string;
  before: string;
  after: string;
}

/** Something else the entry recorded about the change: a count, a date, where it was made. */
export interface RecordedField {
  field: string;
  value: string;
}

/**
 * What an entry opens to: the fields the change set, before and after, and whatever else it
 * recorded. An assignment's table is its before and after: the table left, when the entry knows
 * it, and the table taken.
 */
export function entryChanges(entry: MarketHistoryEntry): {
  changed: ChangedField[];
  recorded: RecordedField[];
} {
  const detail = asDetail(entry.detail);
  if (entry.action === 'assign' && entry.kind === 'placed') {
    const left = 'before' in detail ? (detail.before ? table(detail.before) : 'none') : 'unknown';
    return {
      changed: [{ field: 'Table', before: left, after: table(detail) }],
      recorded: detail.date ? [{ field: 'Date', value: day(detail.date) }] : [],
    };
  }
  const changes =
    detail.before && detail.after && typeof detail.after === 'object'
      ? { before: asDetail(detail.before), after: asDetail(detail.after) }
      : null;
  const changed = changes
    ? [...new Set([...Object.keys(changes.before), ...Object.keys(changes.after)])].map((key) => ({
        field: fieldName(key),
        before: fieldValue(key, changes.before[key]),
        after: fieldValue(key, changes.after[key]),
      }))
    : [];
  const recorded = Object.entries(detail)
    .filter(([key]) => !changes || (key !== 'before' && key !== 'after'))
    .map(([key, value]) => ({
      field: fieldName(key),
      value: key === 'date' ? day(value) : valueText(value),
    }));
  return { changed, recorded };
}

/** The instant a day starts in the reader's timezone, as the history's `since` reads it. */
export function dayStarts(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00`).toISOString();
}

/** The instant the day after `isoDay` starts, so a range "to" a day keeps all of it. */
export function dayEnds(isoDay: string): string {
  const next = new Date(`${isoDay}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}
