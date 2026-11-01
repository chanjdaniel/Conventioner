/**
 * The Vendors group's words: a vendor added by hand, their info updated, their notes.
 *
 * Reads:
 * - `add-vendor/`
 * - `add-vendor/*`, the rows of any kind
 * - `update-vendor-info/`
 * - `update-vendor-info/kept`
 * - `update-vendor-info/*`, the rows of any kind (`discord_match_declined`'s are Discord's)
 * - `write-vendor-notes/note`
 * - `write-vendor-notes/request_handled`
 */
import { answerLabel, essentialAnswerText, inFormOrder } from '@/utils/essentialFields';
import {
  asDetail,
  changedFields,
  recordedFields,
  sentence,
  vendorAnswers,
  type HistoryReaders,
} from './shared';

export const readers: HistoryReaders = {
  'add-vendor/': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      return [actor, text('added '), vendor, text(' as a vendor')];
    },
  },
  // A vendor added by hand: their name and status, then the answers the price groups read, each
  // question as the form asks it (E43/F01/S03).
  'add-vendor/*': {
    changes(entry, { path, fields }) {
      const detail = asDetail(entry.detail);
      const before = asDetail(detail.before);
      const after = asDetail(detail.after);
      const beforeAnswers = asDetail(before.answers);
      const afterAnswers = asDetail(after.answers);
      const answers = inFormOrder(Object.keys(afterAnswers), fields).map((key) => ({
        field: answerLabel(key, fields),
        before: essentialAnswerText(key, beforeAnswers[key]).trim() || 'none',
        after: essentialAnswerText(key, afterAnswers[key]).trim() || 'none',
      }));
      return {
        changed: [
          ...changedFields(
            { name: before.name, status: before.status },
            { name: after.name, status: after.status },
            path,
          ),
          ...answers,
        ],
        recorded: recordedFields(entry, detail, path, true),
      };
    },
  },
  'update-vendor-info/': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      // The vendor last: the address drawn after their name cannot carry a possessive.
      return [actor, text('updated the info of '), vendor];
    },
  },
  'update-vendor-info/kept': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      // Saved as it stood over an answer the vendor changed since: the update is kept.
      return [actor, text('kept their update to the info of '), vendor];
    },
  },
  'update-vendor-info/*': { changes: vendorAnswers },
  'write-vendor-notes/note': {
    parts(entry, context) {
      const { actor, text, vendor } = sentence(entry, context);
      return [actor, text('changed the note on '), vendor];
    },
  },
  'write-vendor-notes/request_handled': {
    parts(entry, context) {
      const { actor, text, vendor, after } = sentence(entry, context);
      return [
        actor,
        text('marked the request from '),
        vendor,
        text(after.handled ? ' handled' : ' not handled'),
      ];
    },
  },
};
