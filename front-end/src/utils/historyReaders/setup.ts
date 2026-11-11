/**
 * Market Setup's words: the setup, its prices and floorplans, the form and what hangs off it.
 *
 * Reads:
 * - `change-setup/renamed`
 * - `change-setup/plan`
 * - `change-setup/pricing`, its sentence and its rows
 * - `change-setup/floorplan`, a layout's save (T257) and the beta's (T272)
 * - `change-setup/floorplan_removed`, a layout taken with its location (T257)
 * - `change-setup/floorplan_image_deleted`
 * - `change-form/form`
 * - `change-form/review_highlights`
 * - `change-form/rejection_rules`
 * - `amend-form/`
 * - `amend-form/resumed`
 */
import type { IntakeMode, RejectionQuestion } from '@/assets/types/datatypes';
import type { ChangedField } from '@/utils/marketHistory';
import { formatPrice } from '@/utils/pricing';
import {
  asDetail,
  changedFields,
  fieldName,
  listed,
  plural,
  sentence,
  str,
  valueText,
  type Detail,
  type HistoryReaders,
} from './shared';

/** Whether a write turned the review setup's "none" on (T206): a detail holds only the fields
 * that changed, so a flag true after the write was false before it. */
function turnedTrue(detail: unknown, flag: string): boolean {
  return asDetail(asDetail(detail).after)[flag] === true;
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

/** What a saved floorplan holds, as its history entry counts it, in the wizard's words and order. */
const FLOORPLAN_COUNTS: Record<string, string> = {
  tables: 'Tables',
  walls: 'Walls',
  no_go_zones: 'Obstacle zones',
  table_types: 'Table types',
};

/** The digest a floorplan save records of the saved floorplan's layout: it differs whenever a
 * table, a wall, a zone, a type, the scale or the image does, and is never shown itself. */
const LAYOUT_DIGEST = 'layout_digest';

/**
 * A floorplan save's rows (T272): the plan's fields it changed as any setup change draws them, then
 * the saved floorplan's counts, then whether its layout moved, since a table moved changes no
 * count. The entry records a summary of the floorplan, never the floorplan itself.
 */
function floorplanChanges(before: Detail, after: Detail, path: IntakeMode): ChangedField[] {
  const summary = new Set([...Object.keys(FLOORPLAN_COUNTS), LAYOUT_DIGEST]);
  const planOnly = (side: Detail) =>
    Object.fromEntries(Object.entries(side).filter(([key]) => !summary.has(key)));
  const rows = changedFields(planOnly(before), planOnly(after), path);
  for (const [key, field] of Object.entries(FLOORPLAN_COUNTS)) {
    if (key in before || key in after) {
      rows.push({ field, before: valueText(before[key]), after: valueText(after[key]) });
    }
  }
  if (LAYOUT_DIGEST in before || LAYOUT_DIGEST in after) {
    const drawnBefore = Boolean(before[LAYOUT_DIGEST]);
    rows.push({
      field: 'Layout',
      before: drawnBefore ? 'as saved before' : 'none',
      after: after[LAYOUT_DIGEST] ? (drawnBefore ? 'changed' : 'drawn') : 'none',
    });
  }
  return rows;
}

/** Metres across, as the layout page reads its scale: "36.0 m". */
function metres(value: unknown): string {
  return typeof value === 'number' ? `${value.toFixed(1)} m` : 'none';
}

/**
 * Whether an entry is the beta's (T272): its detail the plan's and the floorplan's two sides. A
 * layout's save (T257) records what it did instead, `layout.describe_change`'s fields.
 */
function isBetaFloorplanEntry(detail: Detail): boolean {
  return 'before' in detail || 'after' in detail;
}

/** What a layout's save did, as clauses of one sentence, the location named in each. */
function layoutClauses(detail: Detail, location: string): string[] {
  const whose = location ? `${location}'s` : 'a';
  const clauses: string[] = [];
  if (detail.started === true) clauses.push(`started ${whose} layout`);
  if (detail.image === 'replaced') clauses.push(`replaced ${whose} floorplan image`);
  const scale = asDetail(detail.scale);
  if (typeof scale.after === 'number') {
    const verb = typeof scale.before === 'number' ? 'recalibrated' : 'calibrated';
    clauses.push(`${verb} ${whose} layout to ${metres(scale.after)} across`);
  }
  const where = location ? ` in ${location}` : '';
  clauses.push(...tableClauses(detail.added, 'added', 'to', where));
  clauses.push(...tableClauses(detail.removed, 'removed', 'from', where));
  if (typeof detail.moved === 'number' && detail.moved > 0) {
    clauses.push(`moved ${plural(detail.moved, 'table', 'tables')}${where}`);
  }
  if (typeof detail.turned === 'number' && detail.turned > 0) {
    clauses.push(`turned ${plural(detail.turned, 'table', 'tables')}${where}`);
  }
  // A section left or joined is renumbered to close the gap or to follow on, which the tables
  // added and removed already say; a renumbering said on its own is Renumber by position's.
  const renumbered = names(detail.renumbered);
  if (renumbered.length && !('added' in detail) && !('removed' in detail)) {
    clauses.push(`renumbered ${listed(renumbered)}${where}`);
  }
  clauses.push(...ofSections(detail.colours, 'changed', 'colour', 'colours', where));
  clauses.push(...ofSections(detail.labels, 'moved', 'label', 'labels', where));
  return clauses.length ? clauses : [`changed ${whose} layout`];
}

/** The section names a layout's save recorded under a field. */
function names(recorded: unknown): string[] {
  return Array.isArray(recorded)
    ? recorded.filter((name): name is string => typeof name === 'string')
    : [];
}

/** What a save did to a thing each section has: "changed Gold row's colour in Upper Hall", or
 * for several "changed the colours of Gold row and Silver aisle in Upper Hall". */
function ofSections(
  recorded: unknown,
  verb: string,
  one: string,
  many: string,
  where: string,
): string[] {
  const sections = names(recorded);
  if (!sections.length) return [];
  return sections.length === 1
    ? [`${verb} ${sections[0]}'s ${one}${where}`]
    : [`${verb} the ${many} of ${listed(sections)}${where}`];
}

/** The key `layout.describe_change` counts tables of no section under (`IN_NO_SECTION`). */
const IN_NO_SECTION = 'in no section';

/**
 * Tables added or removed, a clause for each section in the order recorded: "added 12 tables to
 * Silver aisle in Upper Hall", "removed 1 table from Gold row in Upper Hall", and for tables of no
 * section "added 2 tables in no section in Upper Hall".
 */
function tableClauses(counts: unknown, verb: string, link: string, where: string): string[] {
  return Object.entries(asDetail(counts)).flatMap(([section, count]) => {
    if (typeof count !== 'number' || count <= 0) return [];
    const tables = plural(count, 'table', 'tables');
    return section === IN_NO_SECTION
      ? [`${verb} ${tables} ${IN_NO_SECTION}${where}`]
      : [`${verb} ${tables} ${link} ${section}${where}`];
  });
}

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

/** A row's prices as the card shows them, in `currency`: "Gold $35.00, Silver $30.00". */
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
 * (`back-end/pricing.py`). A group added last, or in a removed one's place (a rename), has not moved,
 * unless two or more were renamed in one place.
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
  // Groups are matched by name, so a group renamed is one taken away and one added. A group's place
  // is how many kept groups stand before it: an added group in a removed one's place (a rename), or
  // after every kept group (added last), has not moved, and needs no order row. Where two or more
  // were taken away and two or more added in one place, which became which cannot be told, so the
  // row says where they went.
  const names = (groups: Detail[]) => groups.map((g) => str(g.name));
  const kept = new Set(names(was).filter((name) => named(now, name)));
  const inOrder = (groups: Detail[]) => names(groups).filter((name) => kept.has(name));
  const places = (groups: Detail[]) => {
    const counts = new Map<number, number>();
    let keptBefore = 0;
    for (const name of names(groups)) {
      if (kept.has(name)) keptBefore += 1;
      else counts.set(keptBefore, (counts.get(keptBefore) ?? 0) + 1);
    }
    return counts;
  };
  const removed = places(was);
  const unmoved =
    inOrder(was).join('\n') === inOrder(now).join('\n') &&
    [...places(now)].every(([place, added]) => {
      const gone = removed.get(place) ?? 0;
      if (gone >= 2 && added >= 2) return false;
      return added <= gone || place === kept.size;
    });
  if (!unmoved) {
    rows.push({
      field: 'Order of the groups',
      before: names(was).join('\n'),
      after: names(now).join('\n'),
    });
  }
  return rows;
}

export const readers: HistoryReaders = {
  'change-setup/renamed': {
    parts(entry, context) {
      const { actor, text, before, after } = sentence(entry, context);
      return [actor, text(`renamed the market from "${str(before.name)}" to "${str(after.name)}"`)];
    },
  },
  'change-setup/plan': {
    parts(entry, context) {
      const { actor, text, after } = sentence(entry, context);
      const fields = Object.keys(after).map((key) => SETUP_FIELDS[key] ?? key);
      return [actor, text(`changed Market Setup${fields.length ? `: ${listed(fields)}` : ''}`)];
    },
  },
  'change-setup/pricing': {
    parts(entry, context) {
      const { actor, text, after } = sentence(entry, context);
      const fields = pricingKeys(after).map((key) => PRICING_FIELDS[key] ?? key);
      return [actor, text(`changed the prices${fields.length ? `: ${listed(fields)}` : ''}`)];
    },
    changes(entry, { questions }) {
      const detail = asDetail(entry.detail);
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
    },
  },
  'change-setup/floorplan': {
    parts(entry, context) {
      const { actor, text, detail } = sentence(entry, context);
      if (isBetaFloorplanEntry(detail)) return [actor, text('saved a floorplan to the market')];
      return [actor, text(listed(layoutClauses(detail, str(entry.subject.location))))];
    },
    changes(entry, { path }) {
      const detail = asDetail(entry.detail);
      if (!isBetaFloorplanEntry(detail)) {
        const scale = asDetail(detail.scale);
        return {
          changed:
            'after' in scale
              ? [
                  {
                    field: 'Metres across',
                    before: metres(scale.before),
                    after: metres(scale.after),
                  },
                ]
              : [],
          recorded: [],
        };
      }
      return {
        changed: floorplanChanges(asDetail(detail.before), asDetail(detail.after), path),
        recorded: [],
      };
    },
  },
  'change-setup/floorplan_removed': {
    parts(entry, context) {
      const { actor, text, detail } = sentence(entry, context);
      const location = str(entry.subject.location);
      const tables = asDetail(detail.before).tables;
      const of =
        typeof tables === 'number' && tables > 0 ? ` of ${plural(tables, 'table', 'tables')}` : '';
      return [
        actor,
        text(`removed ${location ? `${location}'s` : 'a'} layout${of} with its location`),
      ];
    },
  },
  'change-setup/floorplan_image_deleted': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('deleted a floorplan image')];
    },
  },
  'change-form/form': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('changed the application form')];
    },
  },
  'change-form/review_highlights': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [
        actor,
        text(
          turnedTrue(entry.detail, 'nothing_leads_the_card')
            ? 'decided nothing leads the card'
            : 'changed the review highlights',
        ),
      ];
    },
  },
  'change-form/rejection_rules': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [
        actor,
        text(
          turnedTrue(entry.detail, 'no_automatic_rejections')
            ? 'decided no automatic rejections'
            : 'changed the automatic rejections',
        ),
      ];
    },
  },
  'amend-form/': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('amended the locked form')];
    },
  },
  'amend-form/resumed': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('finished amending the locked form')];
    },
  },
};
