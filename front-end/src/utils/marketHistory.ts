/**
 * Every change on a market, as a person reads it (E40/F01/S03), and an organization's own changes
 * (E40/F02/S01), which the same history keeps and Manage organization reads.
 *
 * The back end stores each entry structured - the table's action, a finer kind, the vendors, a
 * subject and a detail of the fields before and after (`back-end/history.py`,
 * `docs/implementation/data/history.md`) - and the wording is here, so a sentence can change
 * without a migration or a back-end release. A placement is worded by `placementHistory.ts`, the
 * assignment history's own words, so the two screens say it alike. The organizer's words: assign
 * and allocate tables, never place, seat or run.
 * The detail and the subject are served as stored, snake_case, since their keys are data.
 */
import { IntakeMode, type RejectionQuestion } from '@/assets/types/datatypes';
import { pathPhaseLabel } from '@/utils/marketGuide';
import { getRoleDisplayName } from '@/utils/permissions';
import { formatPrice } from '@/utils/pricing';
import {
  historyDate,
  historyParts,
  isPlacementKind,
  type PlacementHistoryEntry,
  type PlacementHistoryKind,
} from '@/utils/placementHistory';
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

/** The Pricing card's fields, in the card's order and words (`pricing_fields` in
 * `back-end/pricing.py`, which stores them in another order). */
const PRICING_FIELDS: Record<string, string> = {
  groups: 'price groups',
  everyone_else: '"Everyone else"',
  half_table_percent: "half table's share",
  currency: 'currency',
};

/** The pricing fields a change set, in the card's order, any the card does not know after them. */
function pricingKeys(...sides: Detail[]): string[] {
  const keys = new Set(sides.flatMap((side) => Object.keys(side)));
  return [
    ...Object.keys(PRICING_FIELDS).filter((key) => keys.has(key)),
    ...[...keys].filter((key) => !(key in PRICING_FIELDS)),
  ];
}

/** A row's prices as the card shows them, in `currency`: "Gold $35, Silver $30". */
function tierPrices(value: unknown, currency: string): string {
  const prices = Array.isArray(value) ? value.map(asDetail) : [];
  return prices
    .map((price) => `${str(price.tier)} ${formatPrice(Number(price.cents), currency)}`)
    .join(', ');
}

/** A field of the Pricing card as it stood, in words and money; "none" where it was empty. */
function pricingValue(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined) return 'none';
  if (key === 'everyone_else') return tierPrices(value, currency) || 'none';
  if (key === 'half_table_percent') return `${str(value)}%`;
  return valueText(value);
}

/**
 * A group's condition as the card words it: the question's label and the answers ticked, from the
 * market's choice questions (`rejectionQuestions`); the stored key and value only for a question or
 * an answer the form no longer has.
 */
function conditionText(value: unknown, questions: readonly RejectionQuestion[]): string {
  const condition = asDetail(value);
  const key = str(condition.key);
  const question = questions.find((q) => q.key === key);
  // Quoted, as the rules' reasons quote them (`Rulebook.rejecting`), so a label that is itself a
  // question reads apart from the sentence around it.
  const label = question ? `“${question.label}”` : `“${key}” (no longer on the form)`;
  const answers = (Array.isArray(condition.answers) ? condition.answers : []).map((answer) => {
    const offered = question?.answers.find((a) => a.value === str(answer));
    return `“${offered ? offered.label : str(answer)}”`;
  });
  if (!answers.length) return `${label} has no answer ticked yet, so it prices nobody`;
  return `${label} includes ${answers.join(' or ')}`;
}

/** A group as it stood: its prices on one line, then each condition on its own. */
function groupText(value: unknown, currency: string, questions: readonly RejectionQuestion[]) {
  const group = asDetail(value);
  const conditions = (Array.isArray(group.conditions) ? group.conditions : []).map(
    (condition, i) => `${i ? 'and' : 'when'} ${conditionText(condition, questions)}`,
  );
  return [
    tierPrices(group.prices, currency) || 'no price',
    ...(conditions.length ? conditions : ['no condition yet, so it prices nobody']),
  ].join('\n');
}

/**
 * A change of the price groups as a row for each group that changed, by its name: one added reads
 * "not on the card" before it, one taken away "removed" after it, and the groups that stood as they
 * were are left out, so the one change is not buried among them. A row's lines hang, so a wrapped
 * condition does not read as a line of its own. Where the groups stand in another order than they
 * did, a row of their names in each order follows, so a move or a group added between others says
 * where it went: the card's order decides which group a price names when two price a vendor alike
 * (`back-end/pricing.py`). A group added last, or in a removed one's place (a rename), has not moved.
 */
function groupChanges(
  before: unknown,
  after: unknown,
  currencies: { before: string; after: string },
  questions: readonly RejectionQuestion[],
): ChangedField[] {
  const list = (value: unknown) => (Array.isArray(value) ? value.map(asDetail) : []);
  const [was, now] = [list(before), list(after)];
  const named = (groups: Detail[], name: string) => groups.find((g) => str(g.name) === name);
  const read = (group: Detail, currency: string) => groupText(group, currency, questions);
  const row = (name: string, before: string, after: string): ChangedField => ({
    // Curly, as its conditions are quoted beside it.
    field: `Group “${name}”`,
    before,
    after,
    hanging: true,
  });
  const rows: ChangedField[] = [];
  for (const group of now) {
    const name = str(group.name);
    const old = named(was, name);
    const text = read(group, currencies.after);
    if (!old) rows.push(row(name, 'not on the card', text));
    else if (read(old, currencies.before) !== text)
      rows.push(row(name, read(old, currencies.before), text));
  }
  for (const group of was) {
    const name = str(group.name);
    if (!named(now, name)) rows.push(row(name, read(group, currencies.before), 'removed'));
  }
  // Where the groups stand other than where they were: moved, or a group added between others.
  // Groups are matched by name, so a group renamed is one taken away and one added; an added group
  // standing in a removed one's place, or added last, has not moved, and needs no order row.
  const names = (groups: Detail[]) => groups.map((g) => str(g.name));
  const added = names(now).filter((name) => !named(was, name));
  const kept = names(was).filter((name) => named(now, name));
  const inPlace = (() => {
    const waiting = [...added];
    const placed = names(was).flatMap((name) =>
      named(now, name) ? [name] : waiting.length ? [waiting.shift() as string] : [],
    );
    return [...placed, ...waiting];
  })();
  const unmoved = [[...kept, ...added], inPlace].some(
    (expected) => expected.join('\n') === names(now).join('\n'),
  );
  if (!unmoved) {
    rows.push({
      field: 'Order of the groups',
      before: names(was).join('\n'),
      after: names(now).join('\n'),
    });
  }
  return rows;
}

function listed(words: string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique.join('');
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * A placement in the placement trail's own words (`historyParts`), its first letter lowered to
 * follow who made it, and the day it is for after it, where the trail shows that day beside the
 * line. One wording for every screen, so they cannot drift; a move names the table left and the
 * table taken.
 */
function placementParts(
  entry: MarketHistoryEntry,
  kind: PlacementHistoryKind,
  names: VendorNames,
): MarketHistoryPart[] {
  const detail = asDetail(entry.detail);
  const trail: PlacementHistoryEntry = {
    id: entry.id,
    actor: str(entry.actor),
    at: entry.at,
    kind,
    vendors: entry.vendors,
    // The trail's detail as the placement history serves it, recased.
    detail: {
      date: detail.date ? str(detail.date) : undefined,
      tableCode: detail.table_code as string | undefined,
      tableChoice: detail.table_choice as string | undefined,
      before:
        detail.before && typeof detail.before === 'object'
          ? {
              tableCode: str(asDetail(detail.before).table_code),
              tableChoice: asDetail(detail.before).table_choice as string | null | undefined,
            }
          : null,
      seats: Array.isArray(detail.seats)
        ? detail.seats.map(asDetail).map((seat) => ({
            email: str(seat.email),
            tableCode: str(seat.table_code),
          }))
        : undefined,
      placementsWritten: detail.placements_written as number | undefined,
      pinsPreserved: detail.pins_preserved as number | undefined,
    },
  };
  const [first, ...rest] = historyParts(trail, names);
  const opening =
    first?.kind === 'text'
      ? { kind: 'text' as const, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) }
      : first;
  const date = historyDate(trail);
  return [
    ...(opening ? [opening] : []),
    ...rest,
    ...(date ? [{ kind: 'text' as const, text: ` on ${date}` }] : []),
  ];
}

/**
 * What happened, in one sentence, as parts: who did it, and a vendor as a part of their own, so
 * the screen draws them as a link to their drawer. `labels` names each of the table's actions, for
 * a change this file has no words for yet; `path` is how the market's vendors arrive, so a phase
 * reads as that market's other screens name it ("Review" on a Google Form market), and absent is a
 * Google Form market's, as `intakeModeOf` reads a market with none.
 */
export function entryParts(
  entry: MarketHistoryEntry,
  names: VendorNames,
  labels: Readonly<Record<string, string>> = {},
  path: IntakeMode = IntakeMode.Csv,
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

  if (entry.action === 'assign' && isPlacementKind(entry.kind)) {
    return [actor, ...placementParts(entry, entry.kind, names)];
  }

  switch (`${entry.action}/${entry.kind ?? ''}`) {
    case 'assign/rules':
      return [actor, text('changed the assignment rules')];
    case 'change-setup/renamed':
      return [actor, text(`renamed the market from "${str(before.name)}" to "${str(after.name)}"`)];
    case 'change-setup/plan': {
      const fields = Object.keys(after).map((key) => SETUP_FIELDS[key] ?? key);
      return [actor, text(`changed Market Setup${fields.length ? `: ${listed(fields)}` : ''}`)];
    }
    case 'change-setup/pricing': {
      const fields = pricingKeys(after).map((key) => PRICING_FIELDS[key] ?? key);
      return [actor, text(`changed the prices${fields.length ? `: ${listed(fields)}` : ''}`)];
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
    // A verdict already given, changed (E38/F06/S01): what it was is the point of the entry.
    case 'change-verdicts/verdict':
      return [
        actor,
        text('changed '),
        vendor,
        text(` from ${statusLabel(str(before.status))} to ${statusLabel(str(after.status))}`),
      ];
    case 'give-verdicts/verdicts':
    case 'change-verdicts/verdicts': {
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
          `moved the market from ${pathPhaseLabel(str(before.phase), path)} to ${pathPhaseLabel(str(after.phase), path)}` +
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
    case 'update-vendor-info/':
      // The vendor last: the address drawn after their name cannot carry a possessive.
      return [actor, text('updated the info of '), vendor];
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
    case 'manage-organization-admins/role_given':
    case 'manage-organization-members/role_given':
      return [
        actor,
        text(`gave ${str(entry.subject.email)} the ${getRoleDisplayName(str(after.role))} role`),
      ];
    case 'manage-editors-and-viewers/role_changed':
    case 'manage-admins/role_changed':
    case 'manage-organization-admins/role_changed':
      return [
        actor,
        text(
          `changed ${str(entry.subject.email)} from ${getRoleDisplayName(str(before.role))} to ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    case 'manage-editors-and-viewers/role_taken':
    case 'manage-admins/role_taken':
    case 'manage-organization-admins/role_taken':
    case 'manage-organization-members/role_taken':
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
    case 'change-the-table/permission_table_reset': {
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [
        actor,
        text(
          rows.length === 1
            ? `reset ${rows[0]} to its built-in default`
            : `reset ${listed(rows)} to their built-in defaults`,
        ),
      ];
    }
    case 'stop-applications/':
      return [
        actor,
        text(
          after.applications_stopped ? 'stopped taking applications' : 'took applications again',
        ),
      ];
    // A vendor's payments (E44/F01): the vendor last where a possessive would follow them.
    case 'record-payment/':
      return [actor, text(`recorded a payment of ${entryMoney(entry, after.cents)} from `), vendor];
    case 'adjust-paid/refund_recorded':
      return [
        actor,
        text(`recorded a refund of ${entryMoney(entry, Math.abs(Number(after.cents)))} to `),
        vendor,
      ];
    case 'adjust-paid/payment_edited':
      return [
        actor,
        text(isRefund(entry) ? 'changed a refund to ' : 'changed a payment from '),
        vendor,
      ];
    case 'adjust-paid/payment_removed':
      return [
        actor,
        text(isRefund(entry) ? 'removed a refund to ' : 'removed a payment from '),
        vendor,
      ];
    case 'change-owed/owed_set':
      return [
        actor,
        text('set what '),
        vendor,
        text(` owes${onDay(entry.subject.date)} to ${entryMoney(entry, after.owed_cents)}`),
      ];
    case 'change-owed/owed_calculated':
      return [
        actor,
        text('set what '),
        vendor,
        text(` owes${onDay(entry.subject.date)} back to the calculated price`),
      ];
    case 'change-organization/renamed':
      return [
        actor,
        text(`renamed the organization from "${str(before.name)}" to "${str(after.name)}"`),
      ];
    case 'transfer-organization/':
      return [actor, text(`handed the organization to ${str(entry.subject.email)}`)];
    case 'create-market/':
      return [actor, text(`created the market "${str(after.name)}"`)];
    case 'delete-market/':
      return [actor, text(`deleted the market "${str(before.name)}"`)];
    case 'manage-floorplan-templates/template_added':
      return [actor, text(`added the floorplan template "${str(entry.subject.name)}"`)];
    case 'manage-floorplan-templates/template_changed':
      return [actor, text(`changed the floorplan template "${str(entry.subject.name)}"`)];
    case 'manage-floorplan-templates/template_removed':
      return [actor, text(`removed the floorplan template "${str(entry.subject.name)}"`)];
    case 'manage-floorplan-templates/template_moved_out':
      return [
        actor,
        text(`moved the floorplan template "${str(entry.subject.name)}" out of the organization`),
      ];
    case 'manage-floorplan-templates/template_moved_in':
      return [
        actor,
        text(`moved the floorplan template "${str(entry.subject.name)}" into the organization`),
      ];
    case 'change-the-default/permission_set':
      return [
        actor,
        text(
          `changed ${rowLabel(entry, labels)} for new markets from ` +
            `${getRoleDisplayName(str(before.role))} to ${getRoleDisplayName(str(after.role))}`,
        ),
      ];
    case 'change-the-default/permission_reset':
      return [
        actor,
        text(
          `set ${rowLabel(entry, labels)} for new markets back to its default, ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    case 'apply/submitted':
      return [vendor, text(' applied')];
    case 'apply/edited':
      return [vendor, text(' edited their application')];
    default: {
      const parts: MarketHistoryPart[] = [
        actor,
        // A row this market's table no longer names reads as a change, never as its raw id.
        text(labels[entry.action] ? `made a change: ${labels[entry.action]}` : 'made a change'),
      ];
      if (entry.vendors.length) parts.push(text(', about '), vendor);
      return parts;
    }
  }
}

/** An amount of a payment entry, in the currency its subject names: "$35", or "-$15" for a refund. */
function entryMoney(entry: MarketHistoryEntry, cents: unknown): string {
  const amount = Number(cents);
  const money = formatPrice(Math.abs(amount), str(entry.subject.currency) || 'CAD');
  return amount < 0 ? `-${money}` : money;
}

/** A payment entry's fields, as the Payment tab names them (E44/F01). */
const PAYMENT_FIELDS: Record<string, string> = {
  cents: 'Amount',
  owed_cents: 'Amount owed',
  method: 'Paid by',
  paid_on: 'Paid on',
  note: 'Note',
};

/** A payment entry's field as the Payment tab writes it: money, a method, a day, or a note. */
function paymentValue(entry: MarketHistoryEntry, key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (key === 'cents' || key === 'owed_cents') return entryMoney(entry, value);
  if (key === 'method') return value === 'cash' ? 'Cash' : 'E-transfer';
  if (key === 'paid_on') return getShortDate(str(value));
  return valueText(value);
}

/** Whether an entry is about a refund: its subject says, since an edit records only the fields
 * it changed, and a refund's note changed alone carries no amount. */
function isRefund(entry: MarketHistoryEntry): boolean {
  return entry.subject.payment_kind === 'refund';
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

/** The stored values the screens already name: a status and a role, in their words. A phase is
 * named by the market's path (`fieldValue`). */
const NAMED_VALUES: Partial<Record<string, (value: string) => string>> = {
  status: statusLabel,
  role: getRoleDisplayName,
  source: (source) => PERMISSION_SOURCES[source] ?? source,
};

/** A floorplan template's aisle settings, in the order its layout reads them. */
const AISLES: Array<[string, string]> = [
  ['wallBufferMm', 'wall buffer'],
  ['tableSpacingMm', 'table spacing'],
  ['walkwayWidthMm', 'walkway'],
];

/** The stored values that are lists or objects, in words rather than JSON: a floorplan template's
 * table types, each its name and size, and its aisles. */
const WORDED_VALUES: Partial<Record<string, (value: unknown) => string>> = {
  table_types: (value) =>
    Array.isArray(value) && value.length
      ? value
          .map(asDetail)
          // A size never breaks across lines: "915 ×" over "760 mm" reads as two values.
          .map(
            (type) =>
              `${str(type.name)} ${str(type.widthMm)}\u00a0×\u00a0${str(type.heightMm)}\u00a0mm`,
          )
          .join(', ')
      : 'none',
  aisles: (value) => {
    const aisles = asDetail(value);
    const set = AISLES.filter(([key]) => aisles[key] !== undefined && aisles[key] !== null);
    return set.length
      ? set.map(([key, words]) => `${words} ${str(aisles[key])}\u00a0mm`).join(', ')
      : 'none';
  },
};

/** A field's value as the screens name it, a phase as the market's `path` does, else as
 * `valueText` draws it. */
export function fieldValue(key: string, value: unknown, path: IntakeMode = IntakeMode.Csv): string {
  const worded = WORDED_VALUES[key];
  if (worded) return worded(value);
  const name = key === 'phase' ? (phase: string) => pathPhaseLabel(phase, path) : NAMED_VALUES[key];
  return name && typeof value === 'string' && value ? name(value) : valueText(value);
}

/** A field the change set, as it was and as it is. */
export interface ChangedField {
  field: string;
  before: string;
  after: string;
  /** Its lines hang: each one's wrap is indented under it (a price group's conditions). */
  hanging?: boolean;
}

/** Something else the entry recorded about the change: a count, a date, where it was made. */
export interface RecordedField {
  field: string;
  value: string;
}

/** A row of the permission table as it stood: its role and where that came from, in words. */
function permissionState(value: unknown): string {
  const state = asDetail(value);
  return `${fieldValue('role', state.role)}, ${fieldValue('source', state.source)}`;
}

/**
 * What an entry opens to: the fields the change set, before and after, and whatever else it
 * recorded. An assignment's table is its before and after: the table left, when the entry knows
 * it, and the table taken. A reset of the whole table is each row it returned, by its label in
 * `labels`, and a phase reads as the market's `path` names it.
 */
export function entryChanges(
  entry: MarketHistoryEntry,
  labels: Readonly<Record<string, string>> = {},
  path: IntakeMode = IntakeMode.Csv,
  /** The market's choice questions (`rejectionQuestions`), which a price group's conditions name. */
  questions: readonly RejectionQuestion[] = [],
): {
  changed: ChangedField[];
  recorded: RecordedField[];
} {
  const detail = asDetail(entry.detail);
  if (entry.action === 'change-the-table' && entry.kind === 'permission_table_reset') {
    const before = asDetail(detail.before);
    const after = asDetail(detail.after);
    return {
      changed: Object.keys(after).map((id) => ({
        field: labels[id] ?? id,
        before: permissionState(before[id]),
        after: permissionState(after[id]),
      })),
      recorded: [],
    };
  }
  if (entry.action === 'change-setup' && entry.kind === 'pricing') {
    // The money is written in the market's currency, which the entry's subject names, and a
    // change of currency writes each side's prices in its own (E43/F01/S02).
    const before = asDetail(detail.before);
    const after = asDetail(detail.after);
    const currency = str(entry.subject.currency) || 'CAD';
    const currencies = {
      before: str(before.currency) || currency,
      after: str(after.currency) || currency,
    };
    return {
      changed: pricingKeys(before, after).flatMap((key) =>
        key === 'groups'
          ? groupChanges(before.groups, after.groups, currencies, questions)
          : [
              {
                field: fieldName(PRICING_FIELDS[key] ?? key),
                before: pricingValue(key, before[key], currencies.before),
                after: pricingValue(key, after[key], currencies.after),
              },
            ],
      ),
      recorded: [],
    };
  }
  if (['record-payment', 'adjust-paid', 'change-owed'].includes(entry.action)) {
    const before = asDetail(detail.before);
    const after = asDetail(detail.after);
    const keys = Object.keys(PAYMENT_FIELDS).filter((key) => key in before || key in after);
    return {
      changed: keys.map((key) => ({
        field: PAYMENT_FIELDS[key],
        before: paymentValue(entry, key, before[key]),
        after: paymentValue(entry, key, after[key]),
      })),
      recorded: entry.subject.date ? [{ field: 'Date', value: day(entry.subject.date) }] : [],
    };
  }
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
        before: fieldValue(key, changes.before[key], path),
        after: fieldValue(key, changes.after[key], path),
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
