/**
 * The door's words: a vendor checked in, or their check-in undone, by an organizer or on the
 * check-in page.
 *
 * Reads:
 * - `check-in/checked_in`
 * - `check-in/check_in_undone`
 */
import { sentence, type HistoryReaders } from './shared';

export const readers: HistoryReaders = {
  'check-in/checked_in': {
    parts(entry, context) {
      const { actor, text, vendor, onDay } = sentence(entry, context);
      return entry.actor
        ? [actor, text('checked '), vendor, text(` in${onDay(entry.subject.date)}`)]
        : [vendor, text(` checked in on the check-in page${onDay(entry.subject.date)}`)];
    },
  },
  'check-in/check_in_undone': {
    parts(entry, context) {
      const { actor, text, vendor, onDay } = sentence(entry, context);
      return entry.actor
        ? [actor, text('undid the check-in of '), vendor, text(onDay(entry.subject.date))]
        : [vendor, text(` undid their check-in on the check-in page${onDay(entry.subject.date)}`)];
    },
  },
};
