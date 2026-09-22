<script setup lang="ts">
/**
 * The market's lifecycle, as a band below its header (`E10/F01`).
 *
 * This replaces `PhaseControlPanel`, which floated above the card as a strip of coloured pills
 * with an invisible "Current Phase:" label beside them, and drew every transition as an advance -
 * including `Reopen for Editing`, the one unambiguously backwards edge in the machine.
 *
 * Three parts:
 *
 * - **The spine.** The lifecycle in order, derived from `VALID_TRANSITIONS` rather than listed
 *   beside it, with the market's position marked and completed stages filled.
 * - **The actions.** One prominent forward action; back and destructive edges behind a menu.
 *   Which is which is read off the spine, not special-cased per phase.
 * - **The check-in URL.** Publishing puts a public page on the air and nothing in the product has
 *   ever told the organizer that URL exists (`E10/F01/S02`).
 *
 * Sized for 1920x1080, which is the target: the prototype measured the labelled spine against a
 * 69-character check-in URL and found it clean at and above 1440, colliding below. Narrower than
 * that the spine wraps rather than compressing, because labels painting over each other is worse
 * than a rail two lines tall.
 */
import { computed, ref } from 'vue';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import BlockerPanel from '@/components/BlockerPanel.vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useModalRoot } from '@/utils/useModalRoot';
import {
  VALID_TRANSITIONS,
  phaseLabel,
  phaseSpine,
  transitionDirection,
  transitionNeedsConfirmation,
} from '@/utils/phase';

const props = defineProps<{
  market: Market | null;
  /**
   * Run before any transition is posted, and awaited.
   *
   * Every guard reads the market as the SERVER holds it. The plan editor saves itself on a
   * debounce (E10/F02/S01), so an organizer who types a date and immediately presses Open
   * Applications would be refused by `FormHasFieldsGuard` reading a plan that has not landed yet
   * - blocked by their own unsaved work.
   */
  beforeTransition?: () => Promise<void> | void;
}>();

const emit = defineEmits<{ phaseAdvanced: [market: Market] }>();

const lifecycle = phaseSpine();
const currentPhase = computed(() => props.market?.phase ?? MarketPhase.Draft);

/**
 * The stages this market's rail draws.
 *
 * Normally the lifecycle, which leaves `offers` off - nothing sets `assignment_sent`, so drawing
 * it would show a stage no market will reach. A market that IS in such a phase is the exception,
 * and it gets its stage back, at the place the transition table puts it: a rail with no marker on
 * it says nothing about where the market stands, which is worse than one extra step that only
 * that market ever sees.
 */
const spine = computed(() => {
  if (lifecycle.includes(currentPhase.value)) return lifecycle;
  const arrivedFrom = VALID_TRANSITIONS.find(
    ([from, to]) => to === currentPhase.value && lifecycle.includes(from),
  );
  const at = arrivedFrom ? lifecycle.indexOf(arrivedFrom[0]) + 1 : lifecycle.length - 1;
  return [...lifecycle.slice(0, at), currentPhase.value, ...lifecycle.slice(at)];
});

const currentIndex = computed(() => spine.value.indexOf(currentPhase.value));
const isArchived = computed(() => currentPhase.value === MarketPhase.Archived);

/**
 * An archived market froze; the rail says so at the stage it can evidence reaching.
 *
 * There is no record of which phases a market passed through, so this is read off what it holds:
 * a stored assignment means it reached `assignment`, a published application form means it
 * reached `applications_open`, and otherwise it never left `draft`. Evidence, not history - which
 * is why the words beside the spine carry the meaning and the spine only reinforces them.
 */
const frozenAtIndex = computed(() => {
  const market = props.market;
  if (!market) return 0;
  if ((market.assignmentObject?.vendorAssignments?.length ?? 0) > 0) {
    return spine.value.indexOf(MarketPhase.Assignment);
  }
  if (market.applicationForm?.publishedAt) {
    return spine.value.indexOf(MarketPhase.ApplicationsOpen);
  }
  return 0;
});

/**
 * What became of an archived market, in words.
 *
 * The prototype settled this: strikethrough alone reads as *stopped*, not as *archived* - a
 * reader cannot tell a deliberately-ended rail from a broken one. Words are the fix and the
 * strikethrough stays as reinforcement.
 */
const frozenNote = computed(() => {
  if (!isArchived.value) return '';
  const reached = spine.value[frozenAtIndex.value];
  if (reached === MarketPhase.Assignment) {
    return 'It was assigned but never published, so no check-in page went on the air.';
  }
  if (reached === MarketPhase.ApplicationsOpen) {
    return 'It took applications but was never assigned.';
  }
  return 'It was abandoned before it ran.';
});

function stepState(index: number): 'done' | 'current' | 'todo' | 'frozen' {
  if (isArchived.value) {
    if (spine.value[index] === MarketPhase.Archived) return 'current';
    return index <= frozenAtIndex.value ? 'done' : 'frozen';
  }
  if (index < currentIndex.value) return 'done';
  if (index === currentIndex.value) return 'current';
  return 'todo';
}

// ── The check-in URL (E10/F01/S02) ────────────────────────────────────────────

/** Only a published market has one. Before that it would be a link to a 404. */
const checkInUrl = computed(() => {
  if (currentPhase.value !== MarketPhase.MarketDays) return '';
  const slug = props.market?.slug;
  if (!slug) return '';
  return `${window.location.origin}/${slug}/check-in`;
});

// ── The public application URL (E18/F04/S02) ─────────────────────────────────

/**
 * A form-intake market's own address, from the moment it has one.
 *
 * Much wider than the check-in chip, which appears only once the market is running: this shows
 * before applications open, while they are open, and after they close, because the apply page has
 * a real answer in each - it names the phase and says the market is not currently taking
 * applications. Seeing that is the point.
 *
 * NOT in draft, though, and the walk's plan said otherwise (ticket 09). A draft market is not
 * published, so the applicant lookup treats it as one that does not exist: the URL redirects to a
 * login that shows the SLUG rather than the market, revealing nothing - correctly, because a draft
 * must not be discoverable. A chip pointing there would hand the organizer a link to a page that
 * deliberately tells them nothing. The threshold is the same reasoning the check-in chip uses,
 * with a different phase.
 *
 * A CSV market shows nothing at all, in any phase. Its `/apply` URL answers exactly as a market
 * that does not exist, and a chip here would be the one place the product admitted it was real.
 */
const applyUrl = computed(() => {
  if (props.market?.intakeMode !== IntakeMode.Form) return '';
  if (currentPhase.value === MarketPhase.Draft) return '';
  const slug = props.market?.slug;
  if (!slug) return '';
  return `${window.location.origin}/${slug}/apply`;
});

/** Which chip last confirmed a copy, so two chips do not share one "Copied". */
const copiedUrl = ref('');

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    copiedUrl.value = url;
    window.setTimeout(() => {
      if (copiedUrl.value === url) copiedUrl.value = '';
    }, 2000);
  } catch {
    // Clipboard access can be refused, and the URL is on screen either way - so the copy is a
    // convenience, never the only way to get it.
    copiedUrl.value = '';
  }
}

// ── The actions ───────────────────────────────────────────────────────────────

const TRANSITION_LABELS: Record<string, string> = {
  [MarketPhase.Draft]: 'Reopen for Editing',
  [MarketPhase.ApplicationsOpen]: 'Open Applications',
  [MarketPhase.ApplicationsClosed]: 'Close Applications',
  [MarketPhase.Review]: 'Begin Review',
  [MarketPhase.Assignment]: 'Begin Assignment',
  [MarketPhase.Offers]: 'Send Offers',
  [MarketPhase.MarketDays]: 'Publish Market',
  [MarketPhase.Archived]: 'Archive Market',
};

function transitionLabel(toPhase: string): string {
  if (toPhase === MarketPhase.Archived) return 'Archive Market';
  // Named for what the organizer wants to do, not for the phase. Going back to draft exists so
  // the application form becomes editable again.
  if (toPhase === MarketPhase.Draft) return 'Reopen for Editing';
  if (toPhase === MarketPhase.ApplicationsOpen) {
    return currentPhase.value === MarketPhase.Draft ? 'Open Applications' : 'Reopen Applications';
  }
  if (toPhase === MarketPhase.ApplicationsClosed) {
    return currentPhase.value === MarketPhase.ApplicationsOpen
      ? 'Close Applications'
      : 'Return to Applications Closed';
  }
  return TRANSITION_LABELS[toPhase] ?? `Move to ${phaseLabel(toPhase)}`;
}

const availableTransitions = computed(() =>
  props.market
    ? VALID_TRANSITIONS.filter(([from]) => from === currentPhase.value).map(([, to]) => to)
    : [],
);

/** The one step onward, when there is one. Everything else goes in the menu. */
const forwardTransition = computed(
  () =>
    availableTransitions.value.find(
      (to) => transitionDirection(currentPhase.value, to, spine.value) === 'forward',
    ) ?? null,
);

const otherTransitions = computed(() =>
  availableTransitions.value.filter((to) => to !== forwardTransition.value),
);

const menuOpen = ref(false);
useEscapeToClose(menuOpen, () => (menuOpen.value = false));

function directionOf(toPhase: string): string {
  return transitionDirection(currentPhase.value, toPhase, spine.value);
}

// ── Firing one ────────────────────────────────────────────────────────────────

const showingArchiveConfirm = ref(false);
const showingPublishConfirm = ref(false);

/**
 * Modal: the page behind goes out of the tab order, not just out of reach of the mouse.
 *
 * One call each rather than one call over both. They are mutually exclusive today, but a single
 * call would only say so in a comment - and its watcher, seeing the same `true` either side of a
 * swap, would not re-run. `useInertBehind` counts its marks, so two live calls cost nothing.
 */
const publishConfirmRoot = useModalRoot(showingPublishConfirm);
const archiveConfirmRoot = useModalRoot(showingArchiveConfirm);
const pendingPhase = ref('');
const transitionError = ref('');
const transitionBlockers = ref<PreconditionResult[]>([]);
const transitioning = ref(false);

async function doTransition(toPhase: string) {
  if (!props.market) return;
  transitioning.value = true;
  transitionError.value = '';
  transitionBlockers.value = [];

  try {
    await props.beforeTransition?.();
    const response = await api.post(`/markets/${encodeURIComponent(props.market.id)}/transition`, {
      toPhase,
    });
    const updatedMarket = {
      ...props.market,
      phase: response.data.phase,
      isDraft: response.data.phase === MarketPhase.Draft,
    };

    try {
      const full = await api.get(`/markets/${encodeURIComponent(props.market.id)}`);
      const fresh = parseMarketFromApi(full.data.market);
      localStorage.setItem('market', JSON.stringify(fresh));
      emit('phaseAdvanced', fresh);
    } catch {
      localStorage.setItem('market', JSON.stringify(updatedMarket));
      emit('phaseAdvanced', updatedMarket);
    }
  } catch (err: unknown) {
    const response =
      err && typeof err === 'object' && 'response' in err
        ? (
            err as {
              response?: {
                status?: number;
                data?: { error?: string; blockers?: PreconditionResult[] };
              };
            }
          ).response
        : undefined;

    if (response?.status === 409 && response.data?.blockers) {
      transitionBlockers.value = response.data.blockers;
    } else {
      transitionError.value = response?.data?.error || 'Failed to advance market phase.';
    }
  } finally {
    transitioning.value = false;
  }
}

function handleTransitionClick(toPhase: string) {
  menuOpen.value = false;
  if (!transitionNeedsConfirmation(toPhase)) {
    doTransition(toPhase);
    return;
  }
  pendingPhase.value = toPhase;
  if (toPhase === MarketPhase.Archived) showingArchiveConfirm.value = true;
  else showingPublishConfirm.value = true;
}

function confirmPending() {
  showingPublishConfirm.value = false;
  showingArchiveConfirm.value = false;
  doTransition(pendingPhase.value);
}

function cancelPending() {
  showingPublishConfirm.value = false;
  showingArchiveConfirm.value = false;
  pendingPhase.value = '';
}
</script>

<template>
  <div v-if="market" class="phase-rail" data-testid="phase-rail">
    <div class="phase-rail-row">
      <ol class="phase-spine" data-testid="phase-rail-spine">
        <li
          v-for="(phase, index) in spine"
          :key="phase"
          class="phase-step"
          :class="`phase-step--${stepState(index)}`"
          :data-phase="phase"
          :data-state="stepState(index)"
          :data-testid="stepState(index) === 'current' ? 'phase-rail-current' : 'phase-rail-step'"
          :aria-current="stepState(index) === 'current' ? 'step' : undefined"
        >
          <span class="phase-step-dot" aria-hidden="true"></span>
          <span class="phase-step-label">{{ phaseLabel(phase) }}</span>
        </li>
      </ol>

      <!-- Publishing put a public page on the air and nothing has ever said so (E10/F01/S02). -->
      <div v-if="applyUrl" class="url-chip" data-testid="phase-rail-apply">
        <span class="url-chip-label">Application page</span>
        <a class="url-chip-url" :href="applyUrl" target="_blank" rel="noopener">{{ applyUrl }}</a>
        <button
          type="button"
          class="url-chip-copy"
          data-testid="phase-rail-apply-copy"
          @click="copyUrl(applyUrl)"
        >
          {{ copiedUrl === applyUrl ? 'Copied' : 'Copy' }}
        </button>
      </div>

      <div v-if="checkInUrl" class="url-chip" data-testid="phase-rail-checkin">
        <span class="url-chip-label">Check-in page</span>
        <a class="url-chip-url" :href="checkInUrl" target="_blank" rel="noopener">{{
          checkInUrl
        }}</a>
        <button
          type="button"
          class="url-chip-copy"
          data-testid="phase-rail-checkin-copy"
          @click="copyUrl(checkInUrl)"
        >
          {{ copiedUrl === checkInUrl ? 'Copied' : 'Copy' }}
        </button>
      </div>

      <div class="phase-rail-actions">
        <button
          v-if="forwardTransition"
          type="button"
          class="rail-button rail-button--forward"
          :disabled="transitioning"
          :data-testid="`phase-transition-${forwardTransition}`"
          @click="handleTransitionClick(forwardTransition)"
        >
          {{ transitionLabel(forwardTransition) }}
        </button>

        <div v-if="otherTransitions.length" class="rail-menu">
          <button
            type="button"
            class="rail-button rail-button--menu"
            :aria-expanded="menuOpen"
            data-testid="phase-rail-menu-button"
            @click="menuOpen = !menuOpen"
          >
            More…
          </button>
          <div v-if="menuOpen" class="rail-menu-list" data-testid="phase-rail-menu">
            <button
              v-for="toPhase in otherTransitions"
              :key="toPhase"
              type="button"
              class="rail-menu-item"
              :class="`rail-menu-item--${directionOf(toPhase)}`"
              :disabled="transitioning"
              :data-direction="directionOf(toPhase)"
              :data-testid="`phase-transition-${toPhase}`"
              @click="handleTransitionClick(toPhase)"
            >
              {{ transitionLabel(toPhase) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Strikethrough alone reads as "stopped", not as "archived". The words are the signal. -->
    <p v-if="isArchived" class="phase-rail-frozen" data-testid="phase-rail-frozen">
      <strong>This market is archived.</strong> {{ frozenNote }}
    </p>

    <p v-if="transitionError" class="phase-rail-error" data-testid="phase-rail-error">
      {{ transitionError }}
    </p>

    <BlockerPanel
      v-if="transitionBlockers.length"
      :blockers="transitionBlockers"
      data-testid="phase-rail-blockers"
    />
  </div>

  <Teleport to="body">
    <!-- Publishing. It asked "Begin Market Days? No offers are pending", counted from an endpoint
         whose answer is always 0 because offers are out of MVP scope: a dialog answering a
         question the organizer never asked, about a feature the product does not have. -->
    <div
      v-if="showingPublishConfirm"
      ref="publishConfirmRoot"
      class="rail-confirm-overlay"
      data-testid="sweep-confirm-overlay"
    >
      <div class="rail-confirm-dialog" data-testid="sweep-confirm-dialog">
        <h3>Publish Market?</h3>
        <p>
          Publishing puts this market's check-in page on the air: every vendor you placed can look
          themselves up and check in on the day. The assignment they see is the one you have now.
        </p>
        <p>A published market cannot be returned to an earlier phase.</p>
        <div class="rail-confirm-buttons">
          <button
            class="confirm-publish-button"
            :disabled="transitioning"
            data-testid="sweep-confirm-confirm"
            @click="confirmPending"
          >
            Publish Market
          </button>
          <button
            class="cancel-confirm-button"
            :disabled="transitioning"
            data-testid="sweep-confirm-cancel"
            @click="cancelPending"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showingArchiveConfirm"
      ref="archiveConfirmRoot"
      class="rail-confirm-overlay"
      data-testid="archive-confirm-overlay"
    >
      <div class="rail-confirm-dialog" data-testid="archive-confirm-dialog">
        <h3>Archive this market?</h3>
        <p>
          Archiving is permanent. Once archived, a market cannot be returned to an active phase.
          This action cannot be undone.
        </p>
        <div class="rail-confirm-buttons">
          <button
            class="confirm-archive-button"
            :disabled="transitioning"
            data-testid="archive-confirm-confirm"
            @click="confirmPending"
          >
            Archive
          </button>
          <button
            class="cancel-confirm-button"
            :disabled="transitioning"
            data-testid="archive-confirm-cancel"
            @click="cancelPending"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* A band inside the card, directly below the market header - not a strip floating above it. */
.phase-rail {
  width: 100%;
  padding: 12px 24px 14px;
  border-bottom: 1px solid var(--mm-border);
  /* White, not the white this used to be. --mm-green is measured at 4.59 on WHITE; on that
     off-white it rendered 4.43, so the current-phase label failed AA on every market screen -
     a token is only AA on the ground it was measured against (E16/F01/S03). */
  background: white;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phase-rail-row {
  display: flex;
  align-items: center;
  gap: 24px;
  /* Wraps rather than compressing. The spine is the flexible element on the row, so without this
     the check-in URL takes its pixels and the labels paint over each other - which the prototype
     measured at 1366 and below. Two lines tall beats an unreadable smear. */
  flex-wrap: wrap;
}

.phase-spine {
  display: flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
  /* Never below its content width: shrinking is what makes labels collide. */
  flex: 0 0 auto;
}

.phase-step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 0;
  font-size: var(--text-xs);
  white-space: nowrap;
  color: var(--mm-text-muted);
}

.phase-step + .phase-step {
  border-left: 1px solid var(--mm-border);
  padding-left: 10px;
}

.phase-step-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--mm-border);
  background: white;
  flex: 0 0 auto;
}

.phase-step--done {
  color: var(--mm-black);
}

.phase-step--done .phase-step-dot {
  background: var(--mm-green);
  border-color: var(--mm-green);
}

.phase-step--current {
  color: var(--mm-green);
  font-family: 'Merge One', sans-serif;
}

/*
 * The ring takes no part in layout (E17/F02/S02).
 *
 * An outline paints OUTSIDE the border box without occupying space, so this 2px ring at 2px of
 * offset ate 4px of the step's 6px gap and left about 2px between the dot and its label. The gap
 * grows by the ring's full extent, on the current step alone - the ordinary steps keep the gap they
 * have, which the walk found no fault with.
 */
.phase-step--current {
  gap: 10px;
}

.phase-step--current .phase-step-dot {
  background: var(--mm-green);
  border-color: var(--mm-green);
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

/* Reinforcement only: the sentence below the rail is what actually says the market is over. */
.phase-step--frozen {
  text-decoration: line-through;
  color: var(--mm-text-muted);
}

/* One chip, two users: the application page and the check-in page (E18/F04/S02). */
.url-chip {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  font-size: var(--text-xs);
  min-width: 0;
}

.url-chip-label {
  color: var(--mm-text-muted);
  white-space: nowrap;
}

.url-chip-url {
  color: var(--mm-text-link);
  overflow-wrap: anywhere;
}

.url-chip-copy {
  border: 1px solid var(--mm-border);
  background: white;
  border-radius: var(--radius-control);
  padding: 2px 8px;
  font: inherit;
  color: var(--mm-black);
  cursor: pointer;
  white-space: nowrap;
}

.url-chip-copy:hover {
  border-color: var(--mm-green);
}

/* Pushed to the end of the row, so the step the market is on and the step it takes next are at
   opposite ends rather than jostling. */
.phase-rail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.rail-button {
  padding: 7px 14px;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
}

.rail-button--forward {
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
}

.rail-button--menu {
  border: 1px solid var(--mm-border);
  background: white;
  color: var(--mm-black);
}

.rail-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.rail-menu {
  position: relative;
}

.rail-menu-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.rail-menu-item {
  border: none;
  background: white;
  padding: 9px 12px;
  text-align: left;
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
  white-space: nowrap;
}

.rail-menu-item:hover {
  background: var(--mm-beige);
}

/* Destructive reads as destructive wherever it appears, and going back does not read as going
   on: `Reopen for Editing` was drawn as an advance. */
.rail-menu-item--end {
  color: var(--mm-red);
}

.rail-menu-item--back::before {
  content: '← ';
  color: var(--mm-text-muted);
}

.phase-rail-frozen {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.phase-rail-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.rail-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 80;
}

.rail-confirm-dialog {
  width: 100%;
  max-width: 460px;
  background: white;
  border-radius: var(--radius-card);
  padding: 22px 24px 18px;
  box-shadow: var(--shadow-card);
  color: var(--mm-black);
}

.rail-confirm-dialog h3 {
  margin: 0 0 10px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  /* Not --mm-green. This is the heading of a permanent, irreversible confirmation, and the
     product's affirmative colour is the wrong thing to say over "cannot be undone" (E16/F01). */
  color: var(--mm-black);
}

.rail-confirm-dialog p {
  margin: 0 0 10px;
  font-size: var(--text-sm);
}

.rail-confirm-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 14px;
}

.confirm-publish-button,
.confirm-archive-button,
.cancel-confirm-button {
  padding: 8px 14px;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  cursor: pointer;
}

.confirm-publish-button {
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
}

.confirm-archive-button {
  border: 1px solid var(--mm-red);
  background: var(--mm-red);
  color: white;
}

.cancel-confirm-button {
  border: 1px solid var(--mm-border);
  background: white;
  color: var(--mm-black);
}
</style>
