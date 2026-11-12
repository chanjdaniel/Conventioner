/**
 * The Applications group's words: imports, verdicts and follow-ups, the reviewers, and a deal of
 * applications among them, under whichever action dealt them.
 *
 * Reads:
 * - `import-applications/imported`
 * - `import-applications/started`
 * - `give-verdicts/verdict`
 * - `give-verdicts/verdicts`
 * - `give-verdicts/verdict_undone`
 * - `give-verdicts/verdicts_undone`
 * - `give-verdicts/follow_up_owner`
 * - `change-verdicts/verdict`
 * - `change-verdicts/verdicts`
 * - `choose-reviewers/reviewers`, its sentence and its rows
 * - `dealt` under any action, keyed with a star for its action, its sentence and its rows
 *
 * Names the stored value `status` for `fieldValue`.
 */
import type { MarketHistoryEntry, MarketHistoryPart } from '@/utils/marketHistory';
import { plural } from '@/utils/utils';
import { statusLabel } from '@/utils/verdicts';
import {
  asDetail,
  listed,
  sentence,
  str,
  valueText,
  type HistoryArea,
  type HistoryReaders,
  type ReaderContext,
} from './shared';

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

/** A selection's verdicts, given or changed: how many, to what when they are all alike, and each
 * vendor, with whose share it was when someone else's. */
function verdicts(entry: MarketHistoryEntry, context: ReaderContext): MarketHistoryPart[] {
  const { actor, text, who, detail, after } = sentence(entry, context);
  const statuses = Object.values(after).map((state) => statusLabel(str(asDetail(state).status)));
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

export const readers: HistoryReaders = {
  'import-applications/imported': {
    parts(entry, context) {
      const { actor, text, detail } = sentence(entry, context);
      return [
        actor,
        text(`imported ${plural(Number(detail.row_count ?? 0), 'row', 'rows')} of applications`),
      ];
    },
  },
  'import-applications/started': {
    parts(entry, context) {
      const { actor, text, detail } = sentence(entry, context);
      return [
        actor,
        text(
          `started the market from a CSV of ${plural(Number(detail.row_count ?? 0), 'row', 'rows')}`,
        ),
      ];
    },
  },
  'give-verdicts/verdict': {
    parts(entry, context) {
      const { actor, text, vendor, detail, after } = sentence(entry, context);
      return [
        actor,
        text('set '),
        vendor,
        text(` to ${statusLabel(str(after.status))}${dealtTo(entry, detail.dealt_to)}`),
      ];
    },
  },
  // A verdict already given, changed (E38/F06/S01): what it was is the point of the entry.
  'change-verdicts/verdict': {
    parts(entry, context) {
      const { actor, text, vendor, detail, before, after } = sentence(entry, context);
      return [
        actor,
        text('changed '),
        vendor,
        text(
          ` from ${statusLabel(str(before.status))} to ${statusLabel(str(after.status))}` +
            dealtTo(entry, detail.dealt_to),
        ),
      ];
    },
  },
  'give-verdicts/verdicts': { parts: verdicts },
  'change-verdicts/verdicts': { parts: verdicts },
  // A verdict taken back by its giver within the window (E38/F10/S01): what it was, and what the
  // application went back to.
  'give-verdicts/verdict_undone': {
    parts(entry, context) {
      const { actor, text, vendor, detail, before, after } = sentence(entry, context);
      return [
        actor,
        text('undid their verdict on '),
        vendor,
        text(
          `: ${statusLabel(str(before.status))} back to ${statusLabel(str(after.status))}` +
            dealtTo(entry, detail.dealt_to),
        ),
      ];
    },
  },
  'give-verdicts/verdicts_undone': {
    parts(entry, context) {
      const { actor, text, who } = sentence(entry, context);
      const parts: MarketHistoryPart[] = [
        actor,
        text(
          `undid their verdicts on ${plural(entry.vendors.length, 'application', 'applications')}: `,
        ),
      ];
      entry.vendors.forEach((email, index) => {
        if (index) parts.push(text(', '));
        parts.push(who(email));
      });
      return parts;
    },
  },
  'give-verdicts/follow_up_owner': {
    parts(entry, context) {
      const { actor, text, vendor, after } = sentence(entry, context);
      return [
        actor,
        text('handed the follow-up on '),
        vendor,
        text(` to ${str(after.follow_up_owner)}`),
      ];
    },
  },
  'choose-reviewers/reviewers': {
    parts(entry, context) {
      const { actor, text, before, after } = sentence(entry, context);
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
    },
    changes(entry) {
      const detail = asDetail(entry.detail);
      // One address a line, so no address is broken across two.
      const team = (side: unknown) => valueText(addresses(asDetail(side).reviewers).join('\n'));
      return {
        changed: [{ field: 'Reviewers', before: team(detail.before), after: team(detail.after) }],
        recorded: [],
      };
    },
  },
  // A deal is worded by its kind whatever action dealt it: a change of reviewers, or an arrival.
  '*/dealt': {
    parts(entry, context) {
      const { own } = context;
      const { actor, text, who } = sentence(entry, context);
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
    },
    changes(entry, { own }) {
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
    },
  },
};

/** A status, in the words the screens use. */
export const namedValues: HistoryArea['namedValues'] = {
  status: statusLabel,
};
