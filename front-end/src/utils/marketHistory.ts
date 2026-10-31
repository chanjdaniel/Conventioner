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
import { IntakeMode, type FormField, type RejectionQuestion } from '@/assets/types/datatypes';
import {
  ESSENTIAL_KEY_PREFIX,
  TABLE_SHARE_ALSO_KEY,
  TABLE_SHARE_ANSWER_KEY,
  TABLE_SHARE_EMAIL_KEY,
  answerLabel,
  essentialAnswerText,
  essentialLabel,
  inFormOrder,
} from '@/utils/essentialFields';
import { pathPhaseLabel } from '@/utils/marketGuide';
import {
  DISCORD_STATES,
  discordStateFrom,
  discordStateLabel,
  type DiscordState,
} from '@/utils/discordCheck';
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
 * The Discord card's fields as the history names them (E46/F01/S02), each by the name it was
 * recorded with: the server's and the role's names and the question's label, never Discord's ids
 * or the question's key (T127 review 6 note 30). Each id is recorded beside its name, and left out.
 */
const DISCORD_FIELDS: Array<[string, string]> = [
  ['guild_name', 'server'],
  ['role_name', 'role'],
  ['username_question', 'username question'],
  ['invite_link', 'invite link'],
];

/** The card's fields an entry changed, in the card's order: a question by its key or its label. */
function discordFields(...sides: Detail[]): Array<[string, string]> {
  const keys = new Set(sides.flatMap((side) => Object.keys(side)));
  return DISCORD_FIELDS.filter(
    ([key]) => keys.has(key) || (key === 'username_question' && keys.has(`${key}_label`)),
  );
}

/** A side's username question as the form names it: its recorded label, else the form's label for
 * its key, else the key and that the form no longer has it. */
function discordQuestion(side: Detail, fields: readonly FormField[]): string {
  const label = str(side.username_question_label);
  if (label) return label;
  const key = str(side.username_question);
  if (!key) return 'none';
  const question = fields.find((field) => field.key === key);
  return question ? question.label : `“${key}” (no longer on the form)`;
}

/** One vendor a Discord check changed: their address, and their state before and after. */
interface CheckedVendor {
  vendor: string;
  before: DiscordState | null;
  after: DiscordState | null;
}

/**
 * The vendors a check changed, in the entry's order, each by their application's id: its address
 * too, since the entry's vendors leave out an application with none and so do not pair by position.
 */
function checkedVendors(entry: MarketHistoryEntry): CheckedVendor[] {
  const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
  const detail = asDetail(entry.detail);
  return ids.map((id) => ({
    vendor: str(asDetail(detail.addresses)[str(id)]),
    before: discordStateFrom(asDetail(detail.before)[str(id)]),
    after: discordStateFrom(asDetail(detail.after)[str(id)]),
  }));
}

function checkedState(state: DiscordState | null): string {
  return state ? discordStateLabel(state) : 'not checked';
}

/** One application a deal moved: its vendor, and whom it was dealt to before and after. */
interface DealtShare {
  vendor: string;
  before: string | null;
  after: string | null;
  /** A removed reviewer's follow-up, handed on: who owned it before, and who owns it now. */
  followUp: { before: string | null; after: string | null } | null;
}

/**
 * The applications a deal moved (E38/F07/S02). The entry names their vendors and their ids in the
 * same order, and its detail holds each one's reviewer before and after, by id, and a follow-up's
 * owner beside it.
 */
function dealtShares(entry: MarketHistoryEntry): DealtShare[] {
  const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
  const detail = asDetail(entry.detail);
  const share = (side: unknown, id: unknown) => asDetail(asDetail(side)[str(id)]);
  return ids.map((id, index) => {
    const before = share(detail.before, id);
    const after = share(detail.after, id);
    return {
      vendor: str(entry.vendors[index]),
      before: str(before.reviewer) || null,
      after: str(after.reviewer) || null,
      followUp:
        'follow_up_owner' in after
          ? {
              before: str(before.follow_up_owner) || null,
              after: str(after.follow_up_owner) || null,
            }
          : null,
    };
  });
}

/** The share of the vendor whose own history this is, when the deal moved theirs. */
function ownShare(entry: MarketHistoryEntry, own: string): DealtShare | undefined {
  const vendor = own.trim().toLowerCase();
  return vendor
    ? dealtShares(entry).find((share) => share.vendor.toLowerCase() === vendor)
    : undefined;
}

function addresses(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str) : [];
}

/**
 * Whose share a decided application was, when it was someone other than who decided it
 * (E38/F07/S02); empty when they decided their own, or it was never dealt.
 */
function someoneElses(entry: MarketHistoryEntry, reviewer: unknown): string {
  const address = str(reviewer).trim();
  return address.toLowerCase() === str(entry.actor).trim().toLowerCase() ? '' : address;
}

/** ", dealt to <address>" after a verdict on someone else's share, else nothing. */
function dealtTo(entry: MarketHistoryEntry, reviewer: unknown): string {
  const theirs = someoneElses(entry, reviewer);
  return theirs ? `, dealt to ${theirs}` : '';
}

/**
 * What happened, in one sentence, as parts: who did it, and a vendor as a part of their own, so
 * the screen draws them as a link to their drawer. `labels` names each of the table's actions, for
 * a change this file has no words for yet; `path` is how the market's vendors arrive, so a phase
 * reads as that market's other screens name it ("Review" on a Google Form market), and absent is a
 * Google Form market's, as `intakeModeOf` reads a market with none. `own` is the vendor whose own
 * history this is, if it is one: an entry about many vendors reads as that vendor's line.
 */
export function entryParts(
  entry: MarketHistoryEntry,
  names: VendorNames,
  labels: Readonly<Record<string, string>> = {},
  path: IntakeMode = IntakeMode.Csv,
  own = '',
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

  // A deal is worded by its kind whatever action dealt it: a change of reviewers, or an arrival.
  if (entry.kind === 'dealt') {
    const shares = dealtShares(entry);
    const mine = ownShare(entry, own);
    const one = mine ?? (shares.length === 1 ? shares[0] : undefined);
    // An applicant's own save dealt their application: they arrived, and nobody dealt it by hand.
    if (entry.action === 'apply' && one?.after) {
      return mine
        ? [text(`The application was dealt to ${one.after} as it arrived`)]
        : [
            text('The application of '),
            who(one.vendor),
            text(` was dealt to ${one.after} as it arrived`),
          ];
    }
    if (one?.followUp) {
      const followUp = mine
        ? [text('the follow-up')]
        : [text('the follow-up of '), who(one.vendor)];
      return [
        actor,
        text('dealt '),
        ...followUp,
        text(` from ${one.followUp.before ?? 'nobody'} to ${one.followUp.after ?? 'nobody'}`),
      ];
    }
    if (one) {
      const application = mine
        ? [text('the application')]
        : [text('the application of '), who(one.vendor)];
      return one.after
        ? [actor, text('dealt '), ...application, text(` to ${one.after}`)]
        : [actor, text('returned '), ...application, text(' to first come, first served')];
    }
    const among = new Set(shares.map((share) => share.after).filter(Boolean)).size;
    const followUps = shares.filter((share) => share.followUp).length;
    const many =
      plural(shares.length - followUps, 'open application', 'open applications') +
      (followUps ? ` and ${plural(followUps, 'follow-up', 'follow-ups')}` : '');
    return among
      ? [actor, text(`dealt ${many} among ${plural(among, 'reviewer', 'reviewers')}`)]
      : [actor, text(`returned ${many} to first come, first served`)];
  }

  switch (`${entry.action}/${entry.kind ?? ''}`) {
    case 'connect-discord/discord_connected':
      return [actor, text(`connected the market to the Discord server “${str(after.guild_name)}”`)];
    case 'connect-discord/discord_disconnected':
      return [
        actor,
        text(`disconnected the market from the Discord server “${str(before.guild_name)}”`),
      ];
    case 'connect-discord/discord': {
      const fields = discordFields(before, after).map(([, words]) => words);
      return [actor, text(`changed the Discord card${fields.length ? `: ${listed(fields)}` : ''}`)];
    }
    case 'connect-discord/discord_checked': {
      const vendor = own.trim().toLowerCase();
      const mine = vendor
        ? checkedVendors(entry).find((each) => each.vendor.toLowerCase() === vendor)
        : undefined;
      if (mine) {
        return [actor, text(`checked who is in the Discord server: ${checkedState(mine.after)}`)];
      }
      const counts = asDetail(detail.counts);
      const found = DISCORD_STATES.filter((state) => Number(counts[state] ?? 0) > 0).map(
        (state) => `${Number(counts[state])} ${discordStateLabel(state).toLowerCase()}`,
      );
      return [
        actor,
        text(
          `checked who is in the Discord server: ${found.length ? found.join(', ') : 'no vendors'}`,
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
      return [
        actor,
        text('set '),
        vendor,
        text(` to ${statusLabel(str(after.status))}${dealtTo(entry, detail.dealt_to)}`),
      ];
    // A verdict already given, changed (E38/F06/S01): what it was is the point of the entry.
    case 'change-verdicts/verdict':
      return [
        actor,
        text('changed '),
        vendor,
        text(
          ` from ${statusLabel(str(before.status))} to ${statusLabel(str(after.status))}` +
            dealtTo(entry, detail.dealt_to),
        ),
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
      const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
      const dealt = asDetail(detail.dealt_to);
      entry.vendors.forEach((email, index) => {
        if (index) parts.push(text(', '));
        parts.push(who(email));
        const theirs = someoneElses(entry, dealt[str(ids[index])]);
        if (theirs) parts.push(text(` (dealt to ${theirs})`));
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
    case 'choose-reviewers/reviewers': {
      const was = addresses(before.reviewers);
      const now = addresses(after.reviewers);
      if (!now.length) return [actor, text('removed every reviewer')];
      if (!was.length) return [actor, text(`chose the reviewers: ${listed(now)}`)];
      const added = now.filter((address) => !was.includes(address));
      const removed = was.filter((address) => !now.includes(address));
      const changes = [
        ...(added.length ? [`added ${listed(added)}`] : []),
        ...(removed.length ? [`removed ${listed(removed)}`] : []),
      ];
      return [actor, text(`changed the reviewers: ${changes.join(', ')}`)];
    }
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
    case 'update-vendor-info/kept':
      // Saved as it stood over an answer the vendor changed since: the update is kept.
      return [actor, text('kept their update to the info of '), vendor];
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
    case 'change-the-table/permission_table_copied': {
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [actor, text(`copied the organization's defaults, changing ${listed(rows)}`)];
    }
    case 'stop-applications/':
      return [
        actor,
        text(
          after.applications_stopped ? 'stopped taking applications' : 'took applications again',
        ),
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
    case 'change-the-default/permission_table_reset': {
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [
        actor,
        text(
          rows.length === 1
            ? `reset ${rows[0]} for new markets to its built-in default`
            : `reset ${listed(rows)} for new markets to their built-in defaults`,
        ),
      ];
    }
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

/** The row of the permission table a change to it is about, by its label, else by its id. */
function rowLabel(entry: MarketHistoryEntry, labels: Readonly<Record<string, string>>): string {
  const id = str(entry.subject.action);
  return labels[id] ?? id;
}

/** When it happened, as a moment, in the reader's own timezone. */
export function entryWhen(entry: MarketHistoryEntry): string {
  return getFormattedTimestamp(entry.at) || entry.at;
}

/**
 * A field's name in words: `review_highlights` reads "Review highlights", a follow-up's owner
 * "Follow-up owner", the one spelling the screens use (E38/F07/S02); an essential question's
 * answer reads as the form asks it, "Tier preference" (E41/F01/S02).
 */
export function fieldName(key: string): string {
  if (key === 'follow_up_owner') return 'Follow-up owner';
  const label = essentialLabel(key);
  if (label !== key) return label;
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

/** A field's value as the screens name it, a phase as the market's `path` does, an essential
 * answer as the review card does, else as `valueText` draws it. */
export function fieldValue(key: string, value: unknown, path: IntakeMode = IntakeMode.Csv): string {
  if (key.startsWith(ESSENTIAL_KEY_PREFIX) && essentialLabel(key) !== key) {
    return essentialAnswerText(key, value).trim() || 'none';
  }
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

/** The table-share question is one answer stored as three keys: the words, the address read out of
 * them, and any further addresses named. The history reads it as one row under the question's
 * label, never as its storage keys. */
const TABLE_SHARE_KEYS = [TABLE_SHARE_EMAIL_KEY, TABLE_SHARE_ALSO_KEY, TABLE_SHARE_ANSWER_KEY];

/** The table-share answer as a person reads it: the vendor's own words where they were kept, else
 * the address the server read out of them. */
function tableShareAnswer(snapshot: Detail): unknown {
  const words = snapshot[TABLE_SHARE_ANSWER_KEY];
  return typeof words === 'string' && words.trim() ? words : snapshot[TABLE_SHARE_EMAIL_KEY];
}

/** Each update an organizer kept over what the vendor wrote since, under its question, the
 * table-share question's storage keys as one answer in the vendor's words. */
function keptFields(kept: Detail, path: IntakeMode, said: string): RecordedField[] {
  return changedFields(kept, kept, path, true).map((row) => ({
    field: `${said}: ${row.field}`,
    value: row.after,
  }));
}

/** The fields a before/after detail set, each as it was and as it is, the table-share question's
 * three storage keys collapsed into one row in the vendor's words; `listing` keeps a row that reads
 * the same on both sides, for a list of answers kept as they stood. */
function changedFields(
  before: Detail,
  after: Detail,
  path: IntakeMode,
  listing = false,
): ChangedField[] {
  const rows: ChangedField[] = [];
  let wroteTableShare = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (TABLE_SHARE_KEYS.includes(key)) {
      if (wroteTableShare) continue;
      wroteTableShare = true;
      const row = {
        field: fieldName(TABLE_SHARE_EMAIL_KEY),
        before: fieldValue(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(before), path),
        after: fieldValue(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(after), path),
      };
      // The further addresses are read out of the words, so they never change alone; a row that
      // reads the same before and after says nothing, unless it is a list of answers kept as they
      // stood.
      if (listing || row.before !== row.after) rows.push(row);
      continue;
    }
    rows.push({
      field: fieldName(key),
      before: fieldValue(key, before[key], path),
      after: fieldValue(key, after[key], path),
    });
  }
  return rows;
}

/** One thing an entry recorded beside its before and after, as rows: an update kept over what the
 * vendor wrote since, or now matching it, as each answer under its question; a selection's
 * `dealt_to` as each vendor's reviewer; a date as a day; anything else as `valueText` draws it. */
function recordedField(
  entry: MarketHistoryEntry,
  key: string,
  value: unknown,
  path: IntakeMode,
): RecordedField[] {
  if ((key === 'kept' || key === 'matched') && value && typeof value === 'object')
    return keptFields(value as Detail, path, key === 'kept' ? 'Kept' : 'Their answer now matches');
  if (key === 'dealt_to' && value && typeof value === 'object')
    return [{ field: fieldName(key), value: eachDealtTo(entry, asDetail(value)) }];
  return [{ field: fieldName(key), value: key === 'date' ? day(value) : valueText(value) }];
}

/** What an entry recorded beside its before and after (`recordedField`); `beside` leaves those two
 * out, as an entry that has them draws them as its table. */
function recordedFields(
  entry: MarketHistoryEntry,
  detail: Detail,
  path: IntakeMode,
  beside: boolean,
): RecordedField[] {
  return Object.entries(detail)
    .filter(([key]) => !beside || (key !== 'before' && key !== 'after'))
    .flatMap(([key, value]) => recordedField(entry, key, value, path));
}

/**
 * What an entry opens to: the fields the change set, before and after, and whatever else it
 * recorded. An assignment's table is its before and after: the table left, when the entry knows
 * it, and the table taken. A reset of a whole table, a market's or an organization's default, and a
 * market's copy of its organization's default are each row they changed, by its label in `labels`,
 * and a phase reads as the market's `path` names it. A deal is each vendor's reviewer, or the
 * `own` vendor's alone in their own history.
 */
export function entryChanges(
  entry: MarketHistoryEntry,
  labels: Readonly<Record<string, string>> = {},
  path: IntakeMode = IntakeMode.Csv,
  /** The market's choice questions (`rejectionQuestions`), which a price group's conditions name. */
  questions: readonly RejectionQuestion[] = [],
  own = '',
  /** The market's form, whose questions name a vendor's answers. */
  fields: readonly FormField[] = [],
): {
  changed: ChangedField[];
  recorded: RecordedField[];
} {
  const detail = asDetail(entry.detail);
  if (entry.kind === 'dealt') {
    const mine = ownShare(entry, own);
    const reviewer = (share: DealtShare, field: string) => ({
      field,
      before: valueText(share.before),
      after: valueText(share.after),
    });
    return {
      changed: mine
        ? [
            reviewer(mine, 'Reviewer'),
            ...(mine.followUp
              ? [
                  {
                    field: 'Follow-up owner',
                    before: valueText(mine.followUp.before),
                    after: valueText(mine.followUp.after),
                  },
                ]
              : []),
          ]
        : dealtShares(entry).map((share) => reviewer(share, share.vendor)),
      recorded: [],
    };
  }
  // A vendor's answers, as they applied or as an organizer updated them: each question as the form
  // asks it, in the form's order, each answer as the review card reads it, the table-share
  // question's three storage keys as one answer in the vendor's words, and never a stored key or
  // JSON (E38/F07/S02, E41/F01/S02). An answer that reads the same on both sides is no change.
  if (
    (entry.action === 'apply' && (entry.kind === 'submitted' || entry.kind === 'edited')) ||
    entry.action === 'update-vendor-info'
  ) {
    const before = asDetail(detail.before);
    const after = asDetail(detail.after);
    const reading = (key: string, value: unknown) =>
      essentialAnswerText(key, value).trim() || 'none';
    const changed: ChangedField[] = [];
    let wroteTableShare = false;
    for (const key of inFormOrder(
      [...new Set([...Object.keys(before), ...Object.keys(after)])],
      fields,
    )) {
      const share = TABLE_SHARE_KEYS.includes(key);
      if (share && wroteTableShare) continue;
      wroteTableShare ||= share;
      const row = share
        ? {
            field: answerLabel(TABLE_SHARE_EMAIL_KEY, fields),
            before: reading(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(before)),
            after: reading(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(after)),
          }
        : {
            field: answerLabel(key, fields),
            before: reading(key, before[key]),
            after: reading(key, after[key]),
          };
      if (row.before !== row.after) changed.push(row);
    }
    return { changed, recorded: recordedFields(entry, detail, path, true) };
  }
  if (entry.action === 'connect-discord' && entry.kind === 'discord_checked') {
    const vendor = own.trim().toLowerCase();
    const vendors = checkedVendors(entry);
    const mine = vendor ? vendors.find((each) => each.vendor.toLowerCase() === vendor) : undefined;
    const row = (each: CheckedVendor, field: string) => ({
      field,
      before: checkedState(each.before),
      after: checkedState(each.after),
    });
    const counts = asDetail(detail.counts);
    return {
      changed: mine
        ? [row(mine, 'Discord')]
        : vendors.map((each) => row(each, each.vendor || 'A vendor with no address')),
      recorded: mine
        ? []
        : DISCORD_STATES.filter((state) => state in counts).map((state) => ({
            field: discordStateLabel(state),
            value: str(counts[state]),
          })),
    };
  }
  if (entry.action === 'connect-discord') {
    const before = asDetail(detail.before);
    const after = asDetail(detail.after);
    const value = (side: Detail, key: string) =>
      key === 'username_question' ? discordQuestion(side, fields) : valueText(side[key]);
    return {
      changed: discordFields(before, after).map(([key, words]) => ({
        field: fieldName(words),
        before: value(before, key),
        after: value(after, key),
      })),
      recorded: [],
    };
  }
  if (entry.action === 'choose-reviewers' && entry.kind === 'reviewers') {
    // One address a line, so no address is broken across two.
    const team = (side: unknown) => valueText(addresses(asDetail(side).reviewers).join('\n'));
    return {
      changed: [{ field: 'Reviewers', before: team(detail.before), after: team(detail.after) }],
      recorded: [],
    };
  }
  // A whole table reset, or a market's replaced by its organization's default: each row it changed.
  if (
    entry.kind === 'permission_table_reset' ||
    (entry.action === 'change-the-table' && entry.kind === 'permission_table_copied')
  ) {
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
  const changed = changes ? changedFields(changes.before, changes.after, path) : [];
  return { changed, recorded: recordedFields(entry, detail, path, !!changes) };
}

/** A selection's `dealt_to`, by application id, as each vendor's address and whose share it was. */
function eachDealtTo(entry: MarketHistoryEntry, dealt: Detail): string {
  const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
  return ids
    .map((id, index) => [str(entry.vendors[index]), str(dealt[str(id)])])
    .filter(([, reviewer]) => reviewer)
    .map(([vendor, reviewer]) => `${vendor}: ${reviewer}`)
    .join(', ');
}

/**
 * The one value column an entry's before and after needs, when every Before is "none" - an
 * application arriving, a vendor added - so the value reads across the width a second column of
 * "none" took: "Answer" for an applicant's own answers (their submission or edit), "After" for
 * anything else, an arrival's deal under the applicant's action included. Null when any
 * Before carries a value, or nothing changed.
 */
export function soleColumn(
  entry: MarketHistoryEntry,
  changed: readonly ChangedField[],
): string | null {
  if (!changed.length || changed.some((row) => row.before !== 'none')) return null;
  return entry.action === 'apply' && (entry.kind === 'submitted' || entry.kind === 'edited')
    ? 'Answer'
    : 'After';
}

/** A piece of a value as drawn: words, or an address split at its "@". */
export type ValuePart =
  { kind: 'text'; text: string } | { kind: 'address'; local: string; domain: string };

const ADDRESS = /[^\s@,;()]+@[^\s@,;()]+\.[^\s@,;()]+/g;

/**
 * A value's pieces, each address apart, so the screen keeps the part before the "@" and the part
 * from it whole: an address breaks, if a column is too narrow for it, only before its "@", never at
 * a hyphen inside a name.
 */
export function addressParts(value: string): ValuePart[] {
  const parts: ValuePart[] = [];
  let at = 0;
  for (const match of value.matchAll(ADDRESS)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ kind: 'text', text: value.slice(at, start) });
    const split = match[0].indexOf('@');
    parts.push({ kind: 'address', local: match[0].slice(0, split), domain: match[0].slice(split) });
    at = start + match[0].length;
  }
  if (at < value.length) parts.push({ kind: 'text', text: value.slice(at) });
  return parts;
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
