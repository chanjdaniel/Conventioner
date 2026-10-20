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
 * - **The next step** (E31/F02/S02). One sentence for the market's phase and intake path, from
 *   `utils/marketGuide.ts`, linking to where it is done. A move the server would refuse is drawn
 *   disabled and the sentence is its first blocker, so the rail says no before the click.
 *
 * Sized for 1920x1080, which is the target: the prototype measured the labelled spine against a
 * 69-character check-in URL and found it clean at and above 1440, colliding below. Narrower than
 * that the spine wraps rather than compressing, because labels painting over each other is worse
 * than a rail two lines tall.
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { hasAssignment } from '@/utils/marketPage';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { useMarketStore } from '@/stores/market';
import BlockerPanel from '@/components/BlockerPanel.vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import AppDialog from '@/components/AppDialog.vue';
import { marketPath, resolutionPath } from '@/utils/market';
import {
  blockersFor,
  forwardFrom,
  intakeModeOf,
  landingPage,
  movesOf,
  nextStep,
  pathPhaseLabel,
  pathTransitionLabel,
  spineFor,
} from '@/utils/marketGuide';
import { OFF_SPINE_PHASES, transitionDirection, transitionNeedsConfirmation } from '@/utils/phase';

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

const marketStore = useMarketStore();
const router = useRouter();

const currentPhase = computed(() => props.market?.phase ?? MarketPhase.Draft);

/** The stages this market's rail draws (`spineFor` says why `offers` is usually not one). */
const spine = computed(() => spineFor(currentPhase.value, props.market?.phasesPassedThrough));

const currentIndex = computed(() => spine.value.indexOf(currentPhase.value));
const isArchived = computed(() => currentPhase.value === MarketPhase.Archived);

/**
 * Where this market has been, from the phase history the server keeps (E26/F06/S03).
 *
 * It used to be read off evidence - a stored assignment meant Assignment, a published form meant
 * Applications Open - and no evidence told "assigned, then archived" from "published, ran, then
 * archived", so a market that ran was told no check-in page ever went on the air (bug 8).
 */
const reached = computed(() => new Set(props.market?.phasesReached ?? []));
/**
 * Whether a stage missing from `reached` was never reached, or only is not known to have been: a
 * market that predates the record is served what it can prove, and says no more than that.
 */
const recordComplete = computed(() => props.market?.phaseRecordComplete === true);

/** Did it run - is there a check-in page that archiving would turn into a record? */
const ran = computed(
  () => currentPhase.value === MarketPhase.MarketDays || reached.value.has(MarketPhase.MarketDays),
);

/** An archived market froze at the furthest stage it reached. */
const frozenAtIndex = computed(() => {
  let furthest = 0;
  spine.value.forEach((phase, index) => {
    if (phase !== MarketPhase.Archived && reached.value.has(phase)) furthest = index;
  });
  return furthest;
});

/**
 * What became of an archived market, in words.
 *
 * The prototype settled this: strikethrough alone reads as *stopped*, not as *archived* - a
 * reader cannot tell a deliberately-ended rail from a broken one. Words are the fix and the
 * strikethrough stays as reinforcement. Only a whole record may say what did NOT happen.
 */
const frozenNote = computed(() => {
  if (!isArchived.value) return '';
  const has = (...phases: MarketPhase[]) => phases.some((phase) => reached.value.has(phase));
  const whole = recordComplete.value;
  if (has(MarketPhase.MarketDays)) return 'It was published and ran its market days.';
  if (has(MarketPhase.Assignment, MarketPhase.Offers)) {
    return whole
      ? 'It was assigned but never published, so no check-in page went on the air.'
      : 'It was assigned.';
  }
  if (has(MarketPhase.ApplicationsOpen, MarketPhase.ApplicationsClosed, MarketPhase.Review)) {
    return whole ? 'It opened applications but was never assigned.' : 'It opened applications.';
  }
  return whole ? 'It was abandoned before it opened applications.' : '';
});

function stepState(index: number): 'done' | 'current' | 'todo' | 'frozen' {
  if (isArchived.value) {
    if (spine.value[index] === MarketPhase.Archived) return 'current';
    if (index <= frozenAtIndex.value) return 'done';
    // Struck through only when the record says it was never reached; otherwise it is unknown,
    // and striking it would be the guess this replaced.
    return recordComplete.value ? 'frozen' : 'todo';
  }
  if (index < currentIndex.value) return 'done';
  if (index === currentIndex.value) return 'current';
  return 'todo';
}

// ── The check-in URL (E10/F01/S02) ────────────────────────────────────────────

/**
 * Only a published market has one. Before that it would be a link to a 404. An archived market
 * that ran keeps it: the page stays up as the record its archive dialog promises (E30/F01/S03).
 */
const checkInUrl = computed(() => {
  const running = currentPhase.value === MarketPhase.MarketDays;
  const aRecord = isArchived.value && reached.value.has(MarketPhase.MarketDays);
  if (!running && !aRecord) return '';
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
  // Archived, the page takes nobody anywhere: the check-in record is the address that stays.
  if (currentPhase.value === MarketPhase.Draft || isArchived.value) return '';
  const slug = props.market?.slug;
  if (!slug) return '';
  return `${window.location.origin}/${slug}/apply`;
});

/**
 * An address as the chip shows it: without its scheme, which every one of them shares, so the part
 * that names this market is what shows when the chip is too narrow for all of it. The link, its
 * hover text and Copy carry the whole address.
 */
function shown(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

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
    // Clipboard access can be refused, and the URL is the link and its hover text either way - so
    // the copy is a convenience, never the only way to get it.
    copiedUrl.value = '';
  }
}

// ── The actions ───────────────────────────────────────────────────────────────

const path = computed(() => intakeModeOf(props.market));

/** A stage as this market's path names it: a CSV market imports its Google Form. */
function phaseLabel(phase: string): string {
  return pathPhaseLabel(phase, path.value);
}

/** A move as this market's path names it, for what the organizer wants to do. */
function transitionLabel(toPhase: string): string {
  return pathTransitionLabel(currentPhase.value, toPhase, path.value);
}

/** What would refuse a move, as the market read served it; the first is the one said. */
function firstBlocker(toPhase: string): PreconditionResult | null {
  return props.market ? (blockersFor(props.market, toPhase)[0] ?? null) : null;
}

/** The rail's sentence: the next step, or why it cannot be taken yet. */
const step = computed(() => (props.market ? nextStep(props.market) : null));
const route = useRoute();
/** A page of this market as an address, unless it is the one the organizer is already on. */
function elsewhere(relative: string | null | undefined): string | null {
  if (!props.market || !relative) return null;
  const link = resolutionPath(props.market.id, relative);
  return route?.path === link ? null : link;
}

/** Where the step is done, unless that is where the organizer already is. */
const stepLink = computed(() => elsewhere(step.value?.page));

/**
 * The moves this person may make. None when moving the phase is not theirs to do (bug 37): an
 * Editor or a Viewer was offered every move, and each failed with a 403 in small red text under
 * the rail. The rail still says where the market stands.
 */
const availableTransitions = computed(() =>
  props.market && !props.market.adminActionsReason
    ? movesOf(props.market).filter(
        // The moves the server judged for the market's own path, which may step through a phase it
        // never stops in (E32/F02/S01). Never into a phase the spine leaves out: nothing can get a
        // market there, so "Send Offers" sat in the menu and always refused (E30/F01/S04). A
        // market in one keeps its ways out, which are not into it.
        (to) => !OFF_SPINE_PHASES.includes(to),
      )
    : [],
);

/**
 * The one step onward, when there is one. Everything else goes in the menu. Read from the guide,
 * so a running market whose last day has passed is offered archiving here (E31/F02/S03).
 */
const forwardTransition = computed(() => {
  const forward = props.market ? forwardFrom(props.market) : null;
  return forward && availableTransitions.value.includes(forward) ? forward : null;
});

/**
 * The work the step onward waits on, as the rail's main button (E32/F01/S02): named by the guard
 * that refuses it ("Add a location") and leading to the page that resolves it. Only for someone who
 * may make the move, and not on that page itself, where the work is already in front of them. A
 * reason no one page resolves has no fix to offer, and the sentence says it.
 */
const fix = computed(() => {
  // The move's own first blocker, the one its disabled state is read from - not the sentence's,
  // which before a run says "run the assignment" in its own words and names no blocker.
  const blocker = forwardTransition.value ? firstBlocker(forwardTransition.value) : null;
  const to = elsewhere(blocker?.resolutionLink);
  return blocker?.resolutionLabel && to ? { label: blocker.resolutionLabel, to } : null;
});

const otherTransitions = computed(() =>
  availableTransitions.value.filter((to) => to !== forwardTransition.value),
);

/*
 * "More…" is a menu (bug 44): a menu button that opens into its items, whose arrow keys walk them,
 * and whose Escape - or a click anywhere else - closes it and hands focus back. It opened a list of
 * plain buttons that a screen reader announced as nothing in particular, and stayed open until
 * the button was pressed again.
 */
const menuOpen = ref(false);
const menuButton = ref<HTMLButtonElement | null>(null);
const menuList = ref<HTMLElement | null>(null);

function closeMenu(returnFocus: boolean) {
  menuOpen.value = false;
  if (returnFocus) void nextTick(() => menuButton.value?.focus());
}
useEscapeToClose(menuOpen, () => closeMenu(true));

function menuItems(): HTMLButtonElement[] {
  return Array.from(menuList.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

watch(menuOpen, (open) => {
  if (open) void nextTick(() => menuItems()[0]?.focus());
});

function onMenuKey(event: KeyboardEvent) {
  const items = menuItems();
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const last = items.length - 1;
  const to =
    event.key === 'ArrowDown'
      ? (at + 1) % items.length
      : event.key === 'ArrowUp'
        ? (at + last) % items.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;
  if (event.key === 'Tab') {
    closeMenu(false);
    return;
  }
  if (to === null) return;
  event.preventDefault();
  items[to]?.focus();
}

/** A press outside the menu closes it, as it would any menu. */
function onPointerDown(event: PointerEvent) {
  const menu = menuButton.value?.parentElement;
  if (menu && !menu.contains(event.target as Node)) closeMenu(false);
}
watch(menuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onPointerDown);
  else document.removeEventListener('pointerdown', onPointerDown);
});
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown));

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
    await api.post(`/markets/${encodeURIComponent(props.market.id)}/transition`, { toPhase });
    // A transition is a write, so the one store re-reads the market (E21/F02). The rail used to
    // fetch its own copy, write it into `localStorage` and hand it to the screen to splice in;
    // every screen shows the market from the store now, so the re-read is all any of them needs.
    await marketStore.refresh();
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
    return;
  } finally {
    transitioning.value = false;
  }
  // A move is the next step, so it lands where that step's work is (E32/F01/S01): the guide's page
  // for the phase entered, which the market's own address and the tab's dot already name. Begin
  // Review once left the import's result on screen, and Publish never reached the door. Outside the
  // `try`, so a navigation that goes wrong is never reported as a move that failed.
  //
  // Read off the phase moved to rather than the re-read market's: the move is done once the server
  // answered, and a re-read that failed in transit leaves the store holding the market as it was
  // before it. Whether a run is stored, which no move changes, can come from either.
  const moved = marketStore.market ?? props.market;
  await router.push(
    marketPath(props.market.id, landingPage(toPhase, hasAssignment(moved), path.value)),
  );
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

      <!-- The rail's end: the public addresses and the actions travel together, so a row that cannot
           hold them all gives them a second row of their own rather than leaving a lone button
           beside an empty band (bug 11, claims-and-room 07). -->
      <div
        class="phase-rail-end"
        :class="{
          'phase-rail-end--addresses': applyUrl || checkInUrl,
          'phase-rail-end--both': applyUrl && checkInUrl,
        }"
      >
        <!-- Publishing put a public page on the air and nothing has ever said so (E10/F01/S02). -->
        <div v-if="applyUrl" class="url-chip" data-testid="phase-rail-apply">
          <span class="url-chip-label">Application page</span>
          <a
            class="url-chip-url"
            :href="applyUrl"
            :title="applyUrl"
            target="_blank"
            rel="noopener"
            >{{ shown(applyUrl) }}</a
          >
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
          <a
            class="url-chip-url"
            :href="checkInUrl"
            :title="checkInUrl"
            target="_blank"
            rel="noopener"
            >{{ shown(checkInUrl) }}</a
          >
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
          <RouterLink
            v-if="fix"
            :to="fix.to"
            class="btn btn--primary rail-button--forward"
            data-testid="phase-rail-fix"
            >{{ fix.label }}</RouterLink
          >
          <!-- While its fix is offered, the move waits beside it, disabled, as the step after. -->
          <button
            v-if="forwardTransition"
            type="button"
            class="btn"
            :class="fix ? 'btn--secondary' : 'btn--primary rail-button--forward'"
            :disabled="transitioning || !!firstBlocker(forwardTransition)"
            :aria-describedby="firstBlocker(forwardTransition) ? 'phase-rail-next' : undefined"
            :data-testid="`phase-transition-${forwardTransition}`"
            @click="handleTransitionClick(forwardTransition)"
          >
            {{ transitionLabel(forwardTransition) }}
          </button>

          <div v-if="otherTransitions.length" class="rail-menu">
            <button
              id="phase-rail-menu-button"
              ref="menuButton"
              type="button"
              class="btn btn--secondary"
              aria-haspopup="menu"
              aria-controls="phase-rail-menu"
              :aria-expanded="menuOpen"
              data-testid="phase-rail-menu-button"
              @click="menuOpen = !menuOpen"
            >
              More…
            </button>
            <div
              v-if="menuOpen"
              id="phase-rail-menu"
              ref="menuList"
              class="rail-menu-list"
              role="menu"
              aria-labelledby="phase-rail-menu-button"
              data-testid="phase-rail-menu"
              @keydown="onMenuKey"
            >
              <button
                v-for="toPhase in otherTransitions"
                :key="toPhase"
                type="button"
                role="menuitem"
                tabindex="-1"
                class="rail-menu-item"
                :class="`rail-menu-item--${directionOf(toPhase)}`"
                :aria-disabled="transitioning || !!firstBlocker(toPhase)"
                :data-direction="directionOf(toPhase)"
                :data-testid="`phase-transition-${toPhase}`"
                @click="!firstBlocker(toPhase) && !transitioning && handleTransitionClick(toPhase)"
              >
                {{ transitionLabel(toPhase) }}
                <!-- Why not, said in the menu itself: "Reopen for Editing" was offered with sixteen
                     applications in and refused only after the click (E31/F02/S01). -->
                <span
                  v-if="firstBlocker(toPhase)"
                  class="rail-menu-item-reason"
                  data-testid="phase-transition-reason"
                  >{{ firstBlocker(toPhase)!.message }}</span
                >
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- The next step, or why it cannot be taken yet (E31/F02/S02). An archived market has the
         frozen note below instead, which says what became of it. -->
    <p
      v-if="step && !isArchived"
      id="phase-rail-next"
      class="phase-rail-next"
      :class="{ 'phase-rail-next--blocked': step.blocker }"
      data-testid="phase-rail-next"
    >
      {{ step.text }}
      <RouterLink
        v-if="stepLink && !fix"
        :to="stepLink"
        class="phase-rail-next-link"
        data-testid="phase-rail-next-link"
        >{{ step.blocker?.resolutionLabel ?? 'Go there' }}</RouterLink
      >
    </p>

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
      :marketId="market.id"
      data-testid="phase-rail-blockers"
    />
  </div>

  <Teleport to="body">
    <!-- Publishing. It asked "Begin Market Days? No offers are pending", counted from an endpoint
         whose answer is always 0 because offers are out of MVP scope: a dialog answering a
         question the organizer never asked, about a feature the product does not have. -->
    <AppDialog
      :open="showingPublishConfirm"
      title="Publish Market?"
      testid="sweep-confirm"
      confirm-label="Publish Market"
      :confirm-disabled="transitioning"
      @close="cancelPending"
      @submit="confirmPending"
    >
      <p class="rail-confirm-text">
        Publishing puts this market's check-in page on the air: every vendor you placed can look
        themselves up and check in on the day. The assignment they see is the one you have now.
      </p>
      <p class="rail-confirm-text">A published market cannot be returned to an earlier phase.</p>
    </AppDialog>

    <!--
      THE ONE IRREVERSIBLE ACTION IN THE PRODUCT, and it has been invisible before: `--mm-text-red`
      was referenced in seven rules and defined nowhere, so this button rendered as white text on a
      white dialog with no border. It wears `btn--destructive` now, which is a token-defined fill
      the contrast contract covers - and `E20/F01/S03` required this dialog to be opened and looked
      at rather than swept.
    -->
    <AppDialog
      :open="showingArchiveConfirm"
      title="Archive this market?"
      testid="archive-confirm"
      confirm-label="Archive"
      destructive
      :confirm-disabled="transitioning"
      @close="cancelPending"
      @submit="confirmPending"
    >
      <p class="rail-confirm-text">
        Archiving is permanent. Once archived, a market cannot be returned to an active phase. This
        action cannot be undone.
      </p>
      <!-- What happens to the one public page a market that ran has (bug 9): said here, before
           it happens, rather than discovered at the door. -->
      <p v-if="ran" class="rail-confirm-text" data-testid="archive-confirm-check-in">
        Its check-in page stays up as a record: vendors can still look up where they were placed,
        but nobody can check in.
      </p>
    </AppDialog>
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
  gap: var(--space-3) var(--space-6);
  /* Wraps rather than compressing the spine, whose labels then paint over each other - which the
     prototype measured at 1366 and below. Two rows beat an unreadable smear; what goes onto the
     second is the rail's end as a whole (below). */
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

/* A phone, which only the door reaches (E29/F01): the spine keeps its full width - shrinking is
   what makes labels collide - and scrolls sideways inside the rail rather than widening the page. */
@media (width <= 640px) {
  .phase-rail {
    padding: var(--space-2) var(--space-4);
  }

  .phase-spine {
    flex: 1 1 100%;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .phase-step {
    flex-shrink: 0;
  }
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

/*
 * The addresses and the actions, as one item of the row (bug 11). With only actions it is as wide as
 * they are. With an address it asks for room enough to show a useful part of one beside them, and
 * takes a row of its own where the row has less - so at the workspace width the rail is one row, and
 * below it the second row is designed: addresses at its start, actions at its end. With both
 * addresses it asks for room to show each whole, which takes the second row: 34rem fitted beside
 * the spine and squeezed the two into "localhost:5…" (E30/F01/S03).
 */
.phase-rail-end {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex: 0 0 auto;
  /* No narrower than the address's floor beside the actions, so a row that cannot hold them moves
     the whole end onto a row of its own. At 0 it stayed beside the spine and its buttons ran out of
     the card: a form market assigning, with Run the assignment, Publish Market and More beside the
     application page, lost More off the edge at 1440. */
  min-width: min-content;
  margin-left: auto;
}

.phase-rail-end--addresses {
  flex: 1 1 34rem;
}

.phase-rail-end--both {
  flex-basis: auto;
  flex-wrap: wrap;
}

/* One chip, two users: the application page and the check-in page (E18/F04/S02). */
.url-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Never taller than the buttons beside it, and stretched to theirs: at 4px it was a pixel taller,
     so the rail grew by one whenever an address appeared. */
  padding: 3px 4px 3px 10px;
  align-self: stretch;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  font-size: var(--text-xs);
  /* The one part of the rail that gives way: its address shortens, and nothing else does - but
     never past the part that names the market (E30/F01/S03). */
  flex: 0 1 auto;
  /* A length, not min(18rem, 100%): a percentage cannot resolve while the rail's end measures its
     own narrowest, so it counted as nothing there and the end stayed beside the spine it could not
     fit beside. A phone, where 18rem may not fit, drops the floor below. */
  min-width: 18rem;
}

/* A phone has no room for that floor beside the actions: the address shortens, and Copy carries it
   whole. */
@media (width <= 640px) {
  .url-chip {
    min-width: 0;
  }

  .phase-rail-end {
    min-width: 0;
  }
}

.url-chip-label {
  color: var(--mm-text-muted);
  white-space: nowrap;
  flex: none;
}

.url-chip-url {
  color: var(--mm-text-link);
  min-width: 0;
  /* One line, ending in an ellipsis where it is cut - but breakable anywhere, so its narrowest is a
     character rather than the whole address. The rail's end measures its own narrowest to decide
     whether it fits beside the spine, and an unbreakable address made it never fit. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.url-chip-copy {
  flex: none;
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
  flex: none;
  margin-left: auto;
}

/*
 * The rail's buttons are the `.btn` primitive (E32/F01/S02); `rail-button--forward` marks the main
 * one and draws nothing. A refused menu move takes the one disabled state `primitives.css` gives
 * `.btn`: the control keeps its place and loses its affordance, on beige with the ink measured for
 * beige.
 */
.rail-menu-item[aria-disabled='true'],
.rail-menu-item[aria-disabled='true']:hover {
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
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

/* The next step, in the same voice as the frozen note: a sentence, not an alert. */
.phase-rail-next {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.phase-rail-next-link {
  margin-left: var(--space-2);
  color: var(--mm-text-link);
  font-weight: 600;
}

/* A move the server would refuse stays in the menu, disabled, with the reason under it. */
.rail-menu-item[aria-disabled='true'] {
  white-space: normal;
  max-width: 24rem;
}

.rail-menu-item[aria-disabled='true']::before,
.rail-menu-item-reason {
  color: var(--mm-text-muted-on-beige);
}

.rail-menu-item-reason {
  display: block;
  margin-top: var(--space-hairline);
  font-size: var(--text-xs);
}

.phase-rail-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

/* The scrim, window, title and buttons belong to `AppDialog` now (E20/F01/S03). The heading's
   colour went with them, and the reason it must not be `--mm-green` went into the shell's own
   title: the product's affirmative colour is the wrong thing to say over "cannot be undone". */
.rail-confirm-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
