/**
 * Discord's words: the card, a check of who is in the server, a run that gives the role, and a
 * possible match declined for a vendor.
 *
 * Reads:
 * - `connect-discord/discord_connected`
 * - `connect-discord/discord_disconnected`
 * - `connect-discord/discord`
 * - `connect-discord/discord_checked`, its sentence and its rows
 * - `connect-discord/discord_roles_given`, its sentence and its rows
 * - `connect-discord/*`, the card's rows of any other kind
 * - `update-vendor-info/discord_match_declined`, its sentence and its rows
 */
import type { FormField } from '@/assets/types/datatypes';
import {
  DISCORD_STATES,
  discordStateFrom,
  discordStateLabel,
  type DiscordState,
} from '@/utils/discordCheck';
import { ROLE_OUTCOMES, roleOutcomeLabel } from '@/utils/discordRoles';
import type { MarketHistoryEntry } from '@/utils/marketHistory';
import {
  asDetail,
  fieldName,
  listed,
  sentence,
  str,
  valueText,
  type Detail,
  type HistoryReaders,
} from './shared';

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

/** The application ids a "Give roles" run gave the role to (E46/F01/S04). */
function givenIds(entry: MarketHistoryEntry): Set<string> {
  const given = asDetail(entry.detail).given;
  return new Set(Array.isArray(given) ? given.map(str) : []);
}

/** A vendor of a run, as checked and as the run left them: given the role, or their state. */
function ranVendors(entry: MarketHistoryEntry): Array<CheckedVendor & { given: boolean }> {
  const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
  const given = givenIds(entry);
  return checkedVendors(entry).map((each, i) => ({ ...each, given: given.has(str(ids[i])) }));
}

export const readers: HistoryReaders = {
  'connect-discord/discord_connected': {
    parts(entry, context) {
      const { actor, text, after } = sentence(entry, context);
      return [actor, text(`connected the market to the Discord server “${str(after.guild_name)}”`)];
    },
  },
  'connect-discord/discord_disconnected': {
    parts(entry, context) {
      const { actor, text, before } = sentence(entry, context);
      return [
        actor,
        text(`disconnected the market from the Discord server “${str(before.guild_name)}”`),
      ];
    },
  },
  'connect-discord/discord': {
    parts(entry, context) {
      const { actor, text, before, after } = sentence(entry, context);
      const fields = discordFields(before, after).map(([, words]) => words);
      return [actor, text(`changed the Discord card${fields.length ? `: ${listed(fields)}` : ''}`)];
    },
  },
  'connect-discord/discord_checked': {
    parts(entry, context) {
      const { own } = context;
      const { actor, text, detail } = sentence(entry, context);
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
    },
    changes(entry, { own }) {
      const detail = asDetail(entry.detail);
      const vendor = own.trim().toLowerCase();
      const vendors = checkedVendors(entry);
      const mine = vendor
        ? vendors.find((each) => each.vendor.toLowerCase() === vendor)
        : undefined;
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
    },
  },
  'connect-discord/discord_roles_given': {
    parts(entry, context) {
      const { own } = context;
      const { actor, text, detail } = sentence(entry, context);
      const role = `gave the Discord role “${str(detail.role_name)}”`;
      const vendor = own.trim().toLowerCase();
      const mine = vendor
        ? ranVendors(entry).find((each) => each.vendor.toLowerCase() === vendor)
        : undefined;
      if (mine?.given) return [actor, text(role)];
      if (mine) {
        return [actor, text(`${role} to the assigned vendors: ${checkedState(mine.after)}`)];
      }
      const counts = asDetail(detail.counts);
      const ended = ROLE_OUTCOMES.filter((outcome) => Number(counts[outcome] ?? 0) > 0).map(
        (outcome) => `${Number(counts[outcome])} ${roleOutcomeLabel(outcome).toLowerCase()}`,
      );
      return [actor, text(`${role}: ${ended.length ? ended.join(', ') : 'no assigned vendors'}`)];
    },
    changes(entry, { own }) {
      const detail = asDetail(entry.detail);
      const vendor = own.trim().toLowerCase();
      const vendors = ranVendors(entry);
      const mine = vendor
        ? vendors.find((each) => each.vendor.toLowerCase() === vendor)
        : undefined;
      const row = (each: CheckedVendor & { given: boolean }, field: string) => ({
        field,
        before: checkedState(each.before),
        after: each.given ? 'Given the role' : checkedState(each.after),
      });
      const counts = asDetail(detail.counts);
      return {
        changed: mine
          ? [row(mine, 'Discord')]
          : vendors.map((each) => row(each, each.vendor || 'A vendor with no address')),
        recorded: mine
          ? []
          : ROLE_OUTCOMES.filter((outcome) => outcome in counts).map((outcome) => ({
              field: roleOutcomeLabel(outcome),
              value: str(counts[outcome]),
            })),
      };
    },
  },
  'connect-discord/*': {
    changes(entry, { fields }) {
      const detail = asDetail(entry.detail);
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
    },
  },
  'update-vendor-info/discord_match_declined': {
    parts(entry, context) {
      const { actor, text, vendor, detail } = sentence(entry, context);
      // A member "Check Discord" offered as a possible match, said not to be the vendor (E46/F01/S05).
      return [actor, text(`said the Discord member @${str(detail.username)} is not `), vendor];
    },
    // A possible match declined (E46/F01/S05): the member, by their username and the names that
    // looked like the vendor's, and the username on file it was offered for. Nothing changed on the
    // vendor.
    changes(entry) {
      const detail = asDetail(entry.detail);
      const names = [...new Set([str(detail.nick), str(detail.display_name)].filter(Boolean))];
      return {
        changed: [],
        recorded: [
          {
            field: 'Discord member',
            value: `@${str(detail.username)}${names.length ? ` (${names.join(' · ')})` : ''}`,
          },
          { field: 'Username on file', value: str(detail.answer) || 'none' },
        ],
      };
    },
  },
};
