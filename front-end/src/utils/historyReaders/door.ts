/**
 * The door's words: a vendor checked in, or their check-in undone, by an organizer or on the
 * check-in page; and a door code made, which never names the code (ADR 0022).
 *
 * Reads:
 * - `check-in/checked_in`
 * - `check-in/check_in_undone`
 * - `check-in/door_code_made`
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
  'check-in/door_code_made': {
    parts(entry, context) {
      const { actor, text, detail } = sentence(entry, context);
      return detail.replaced
        ? [actor, text('made a new door code, which ended the old one and every poster of it')]
        : [actor, text('made the door code')];
    },
  },
};
