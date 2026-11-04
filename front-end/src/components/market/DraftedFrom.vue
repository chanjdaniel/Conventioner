<script setup lang="ts">
/**
 * What the start from a Google Form just did, said once on the Questions tab it lands on
 * (T205/F20, F09): it drafted the market from a responses file and imported no one.
 *
 * On a Google Form market (the stored intake, absent read as `csv`) it goes on to say the import
 * comes next and where, and, while the first import waits on anything, what: each blocker's
 * resolution label as a link to where it is done, by the one link rule (`blockerLink`, T142), or
 * its message where this reader is offered no link. It reads the same served blockers as the
 * import's refusal and the rail, so the three cannot disagree, and a blocker fixed elsewhere drops
 * from the line on the market's next read.
 */
import { computed } from 'vue';
import { IntakeMode, type Market } from '@/assets/types/datatypes';
import { blockerLink } from '@/utils/blockerLink';
import { firstImportBlockers } from '@/utils/importPhase';
import { intakeModeOf } from '@/utils/marketGuide';

const props = defineProps<{
  market: Market;
  /** The responses file the market was drafted from. */
  fileName: string;
}>();

/** One run of the line: words, or a link's words and where it leads. */
type Part = { text: string; to?: string };

const IMPORT_NEXT =
  "Import them with Import responses, the next step at the top of the market's pages";

const parts = computed((): Part[] => {
  const line: Part[] = [{ text: `Drafted from ${props.fileName}. No responses were imported.` }];
  if (intakeModeOf(props.market) !== IntakeMode.Csv) return line;

  const blockers = firstImportBlockers(props.market);
  if (!blockers.length) return [...line, { text: ` ${IMPORT_NEXT}.` }];

  line.push({ text: ` ${IMPORT_NEXT}, once the market is ready. Still needed before the import:` });
  // The links read as one list, joined by commas; a blocker offered no link is a sentence of its
  // own (the guard's message), after them.
  const linked = blockers.flatMap((blocker) => {
    const to = blockerLink(props.market, blocker);
    return to && blocker.resolutionLabel ? [{ text: blocker.resolutionLabel, to }] : [];
  });
  linked.forEach((link, index) => {
    line.push({ text: index ? ', ' : ' ' }, link);
  });
  if (linked.length) line.push({ text: '.' });
  for (const blocker of blockers) {
    const to = blockerLink(props.market, blocker);
    if (!(to && blocker.resolutionLabel)) line.push({ text: ` ${blocker.message}` });
  }
  return line;
});
</script>

<template>
  <!-- A notice, not an error: nothing has gone wrong, so it is the informational tone. -->
  <p class="drafted-from" role="status" data-testid="drafted-from">
    <template v-for="(part, index) in parts" :key="index"
      ><router-link
        v-if="part.to"
        :to="part.to"
        class="drafted-from-link"
        data-testid="drafted-from-link"
        >{{ part.text }}</router-link
      ><template v-else>{{ part.text }}</template></template
    >
  </p>
</template>

<style scoped>
.drafted-from {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  background: var(--mm-chip-informational);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-black);
}

/* A link is one label: "Add tables" never breaks between its words at a line's end. */
.drafted-from-link {
  color: var(--mm-blue);
  text-decoration: underline;
  white-space: nowrap;
}
</style>
