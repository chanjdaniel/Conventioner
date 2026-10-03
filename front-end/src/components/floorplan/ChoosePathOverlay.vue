<script setup lang="ts">
/**
 * How the organizer describes what their market offers: by hand, or from a floorplan (beta).
 *
 * The product's dialog (bug 44). It was an overlay of its own, which assistive technology did not
 * announce as a dialog, and which blurred the page behind it where every other dialog dims it.
 * AppDialog brings the role, the name, Escape, the close control and the inert page.
 *
 * Dismissing it IS choosing manual: the text-based setup is already rendered underneath, and
 * `handlePathChoice('manual')` does nothing but hide this.
 */
import AppDialog from '@/components/AppDialog.vue';

const emit = defineEmits<{
  select: [path: 'manual' | 'floorplan'];
}>();
</script>

<template>
  <AppDialog
    :open="true"
    title="Choose your setup path"
    testid="choose-path"
    wide
    @close="emit('select', 'manual')"
  >
    <p class="choose-subtitle">How would you like to describe what this market has to offer?</p>

    <div class="cards-row">
      <!-- A card is a large target for the pointer; its button is the control, so the keyboard
           reaches each path as itself. -->
      <div class="path-card" data-testid="choose-path-manual" @click="emit('select', 'manual')">
        <span class="chip chip--positive path-badge">Recommended</span>
        <i class="pi pi-list card-icon" aria-hidden="true" />
        <h3 class="card-title">Manual setup</h3>
        <p class="card-desc">
          Name your sections, tiers and locations, and how many tables each holds.
        </p>
        <ul class="card-features">
          <li>Sections, tiers and locations by name</li>
          <li>Full control over every detail</li>
          <li>All on one page</li>
        </ul>
        <button class="btn btn--primary card-action" type="button">Get started</button>
      </div>

      <!-- Nothing here may promise what the wizard does not do (bug 38): it called itself "AI" and
           offered to auto-detect walls, while it makes no model call and the walls are drawn by
           hand. The quieter of the two: this release assigns a single table type, so the variety
           a floorplan can express does not reach the assignment yet. -->
      <div
        class="path-card path-card--beta"
        data-testid="choose-path-floorplan"
        @click="emit('select', 'floorplan')"
      >
        <span class="chip chip--attention path-badge">Beta</span>
        <i class="pi pi-image card-icon" aria-hidden="true" />
        <h3 class="card-title">From a floorplan</h3>
        <p class="card-desc">Upload your floor plan, set its scale, and place tables on it.</p>
        <ul class="card-features">
          <li>Upload a floorplan image or PDF</li>
          <li>Draw walls and obstacles on it</li>
          <li>Auto-place as many tables as you need</li>
        </ul>
        <p class="card-caveat">
          This release places one table type, so a floorplan's table variety is not used in
          assignment yet.
        </p>
        <button class="btn btn--secondary card-action" type="button">Try the beta</button>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
.choose-subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.cards-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.path-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  cursor: pointer;
  transition: border-color 0.15s ease-in-out;
}

.path-card:hover {
  border-color: var(--mm-green);
}

/* The quieter of the two paths, and the beta it is. */
.path-card--beta {
  background: var(--mm-beige);
}

.path-card--beta:hover {
  border-color: var(--mm-yellow);
}

.path-badge {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

.card-icon {
  font-size: var(--text-lg);
  color: var(--mm-black);
}

.card-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.card-desc,
.card-caveat {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--mm-text-muted);
}

.path-card--beta .card-desc,
.path-card--beta .card-caveat {
  color: var(--mm-text-muted-on-beige);
}

.card-features {
  margin: 0;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-black);
}

/* At the foot of each card, whatever the card above it says. */
.card-action {
  margin-top: auto;
  align-self: stretch;
}
</style>
