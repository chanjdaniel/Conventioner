<script setup lang="ts">
/**
 * One application as Applications All draws its row for someone who decides, on the fixture: the
 * tick, who, the answers a reviewer reads first, its status and whose share it is. Today's every-row
 * list and the frame both draw this, so the two differ only in how many rows they draw. The look is
 * `ApplicationsAll.vue`'s, copied rather than shared, since no real screen changes here. A row there
 * opens the vendor drawer; here it emits `open`, and the entry reads that and the ticks out.
 */
import EmailAddress from '@/components/EmailAddress.vue';
import type { AddressPart } from '@/utils/addressParts';
import { statusChip, statusLabel } from '@/utils/verdicts';
import type { LibraryFixture } from '../fixture';

defineProps<{
  application: LibraryFixture['applications'][number];
  /** Whose share it is, as `reviewerLine` words it for the reader. */
  reviewer: AddressPart[];
  ticked: boolean;
}>();

defineEmits<{ open: []; tick: [on: boolean] }>();
</script>

<template>
  <div class="application-row">
    <!-- The box inside a square of its own, the target a thumb taps on a phone. -->
    <label class="application-row__tick">
      <input
        type="checkbox"
        :checked="ticked"
        :aria-label="`Select ${application.email}`"
        data-testid="library-application-tick"
        @change="$emit('tick', ($event.target as HTMLInputElement).checked)"
      />
    </label>
    <button
      type="button"
      class="application-row__open"
      data-testid="library-application-row"
      @click="$emit('open')"
    >
      <span class="application-row__who">
        <span class="application-row__name" data-testid="library-application-name">{{
          application.name
        }}</span>
        <span class="application-row__meta">{{ application.email }}</span>
      </span>
      <span class="application-row__leading"
        >{{ application.business }} · {{ application.sells }}</span
      >
      <span class="application-row__state">
        <span :class="statusChip(application.status)" data-testid="library-application-status">
          {{ statusLabel(application.status) }}
        </span>
        <span class="application-row__meta"><EmailAddress :words="reviewer" /></span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.application-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.application-row__tick {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  /* The label is the target, the box inside it. */
  min-height: var(--target-min);
}

.application-row__open {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) minmax(22rem, 1fr);
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  text-align: left;
  cursor: pointer;
}

.application-row__open:hover {
  border-color: var(--mm-green);
}

.application-row__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.application-row__name {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.application-row__meta {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.application-row__leading {
  overflow: hidden;
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.application-row__state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

/* One column on a phone, read down, as today's row. */
@media (width <= 640px) {
  .application-row__open {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-1);
  }

  /* Its width only here: at a desk a 24px square would push every row 11px right. */
  .application-row__tick {
    min-width: var(--target-min);
  }
}
</style>
