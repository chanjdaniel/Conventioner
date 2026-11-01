/**
 * The Lifecycle group's words: the phase, taking applications, and the results.
 *
 * Reads:
 * - `move-phase/`
 * - `stop-applications/`
 * - `publish-results/`
 */
import { pathPhaseLabel } from '@/utils/marketGuide';
import { plural, sentence, str, type HistoryReaders } from './shared';

export const readers: HistoryReaders = {
  'move-phase/': {
    parts(entry, context) {
      const { path } = context;
      const { actor, text, detail, before, after } = sentence(entry, context);
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
    },
  },
  'stop-applications/': {
    parts(entry, context) {
      const { actor, text, after } = sentence(entry, context);
      return [
        actor,
        text(
          after.applications_stopped ? 'stopped taking applications' : 'took applications again',
        ),
      ];
    },
  },
  'publish-results/': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('published the results')];
    },
  },
};
