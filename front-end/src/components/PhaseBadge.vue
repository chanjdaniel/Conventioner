<script setup lang="ts">
/** One phase chip: the phase's name, in the tone its state calls for, wherever a phase is shown. */
import { computed } from 'vue';
import { MarketPhase, type IntakeMode } from '@/assets/types/datatypes';
import { effectivePhase } from '@/utils/phase';
import { intakeModeOf, pathPhaseLabel } from '@/utils/marketGuide';

/** The phase, named as the market's own path names it: the stage is Review on a Google Form market. */
const props = defineProps<{ phase?: string | null; intakeMode?: IntakeMode | string | null }>();

/**
 * A chip's colour carries the state's CHARACTER; its label carries the state's identity.
 *
 * The phases had eight bespoke solid fills - `#a46a07`, `#8558ec`, `#048197`, `#cd3f85` and the
 * rest - none of them in `base.css`, and two of them a different blue from the same state shown on
 * the triage card. The design language asks for one shape, one size and a small set of tones
 * (`docs/design-system.md`), so the phases map onto three:
 *
 *   - **neutral** - not running, and nothing is being asked of you (draft, archived).
 *   - **attention** - work is waiting on the organizer (the stage, assignment, offers).
 *   - **positive** - the market is on (market days).
 *
 * The tradeoff, recorded because it is real: the phases no longer have distinct colours on
 * the markets list, where the phase is what tells rows apart. The label still does, and the phase
 * rail still shows the whole spine. If per-phase colour turns out to be load-bearing there, it is
 * a follow-up rather than a reason to keep eight untokenised fills.
 */
const TONE: Record<string, string> = {
  [MarketPhase.Draft]: 'neutral',
  [MarketPhase.Applications]: 'attention',
  [MarketPhase.Assignment]: 'attention',
  [MarketPhase.Offers]: 'attention',
  [MarketPhase.MarketDays]: 'positive',
  [MarketPhase.Archived]: 'neutral',
};

const current = computed(() => effectivePhase(props.phase));
const label = computed(() =>
  pathPhaseLabel(current.value, intakeModeOf({ intakeMode: props.intakeMode as IntakeMode })),
);
/** A phase this build does not recognise is neutral rather than unstyled. */
const tone = computed(() => TONE[current.value] ?? 'neutral');
</script>

<template>
  <span
    class="chip phase-badge"
    :class="[`chip--${tone}`, `phase-${current}`]"
    data-testid="phase-badge"
  >
    {{ label }}
  </span>
</template>

<style scoped>
/* `.chip` carries the shape, the size, the radius and the tone. All that is local is the one
   thing a phase chip needs that a chip in general does not. */
.phase-badge {
  font-weight: 600;
}
</style>
