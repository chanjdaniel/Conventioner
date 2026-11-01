/**
 * The applicant's own words: their application submitted, or edited, under `apply`, the one verb
 * no row of the table asks.
 *
 * Reads:
 * - `apply/submitted`, its sentence and its rows
 * - `apply/edited`, its sentence and its rows
 *
 * `apply/dealt`, their application dealt as it arrived, is the Applications group's.
 */
import { sentence, vendorAnswers, type HistoryReaders } from './shared';

export const readers: HistoryReaders = {
  'apply/submitted': {
    parts(entry, context) {
      const { text, vendor } = sentence(entry, context);
      return [vendor, text(' applied')];
    },
    changes: vendorAnswers,
  },
  'apply/edited': {
    parts(entry, context) {
      const { text, vendor } = sentence(entry, context);
      return [vendor, text(' edited their application')];
    },
    changes: vendorAnswers,
  },
};
