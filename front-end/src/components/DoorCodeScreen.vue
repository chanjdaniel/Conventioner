<script setup lang="ts">
/**
 * The door code, full screen (ADR 0022): what stands at the entrance on market day, on a tablet or
 * a laptop, or printed as a poster.
 *
 * The market's name, its QR code as large as the window allows, the typed code in two groups of
 * three, and one line of instructions. A vendor scans it with their phone's own camera, which opens
 * their vendor page with the code. "Print" lays the same poster on one page, with nothing of the
 * app around it; "New code" asks first, then ends the old code and every poster of it.
 *
 * A modal over the whole window rather than an `AppDialog`, which is a small window over the page:
 * it holds the page behind inert, takes Escape while it is on top, and gives focus back to what
 * opened it, as every modal here does ([dialogs](docs/implementation/conventions/dialogs.md)). Its
 * one confirmation is an `AppDialog`, teleported beside it, so it is a sibling and not a window
 * inside a window.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import EmailAddress from '@/components/EmailAddress.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import { getApiErrorMessage } from '@/utils/api';
import { doorCodeInWords, makeDoorCode, readDoorCode, type DoorCode } from '@/utils/doorCode';
import { qrDrawing } from '@/utils/qrDrawing';
import { signedInEmail } from '@/utils/signedIn';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useFocusGoesBack } from '@/utils/useFocusGoesBack';
import { useModalRoot } from '@/utils/useModalRoot';
import { getFormattedTimestamp } from '@/utils/utils';

const props = defineProps<{ marketId: string; marketName: string }>();
const emit = defineEmits<{ close: [] }>();

const door = ref<DoorCode | null>(null);
const readError = ref('');
const makeError = ref('');
const making = ref(false);
const confirming = ref(false);

const closeButton = ref<HTMLButtonElement | null>(null);
const printButton = ref<HTMLButtonElement | null>(null);

const modalRoot = useModalRoot(() => true);
useEscapeToClose(
  () => true,
  () => emit('close'),
);
useFocusGoesBack(() => true);

const live = computed(() => (door.value?.code ? door.value : null));
const drawing = computed(() => (live.value ? qrDrawing(live.value.url) : null));

const madeBy = computed(() => {
  const by = live.value?.madeBy ?? '';
  return by.toLowerCase() === (signedInEmail() ?? '').toLowerCase() ? 'you' : by;
});

async function load(): Promise<void> {
  readError.value = '';
  try {
    door.value = await readDoorCode(props.marketId);
  } catch (err: unknown) {
    readError.value = getApiErrorMessage(err, 'The door code could not be loaded.');
  }
}

/** The first code, or a new one that ends the old. The view shows what the server answered. */
async function make(): Promise<boolean> {
  making.value = true;
  makeError.value = '';
  try {
    door.value = await makeDoorCode(props.marketId);
    return true;
  } catch (err: unknown) {
    makeError.value = getApiErrorMessage(err, 'No new door code was made.');
    return false;
  } finally {
    making.value = false;
  }
}

async function makeFirst(): Promise<void> {
  if (!(await make())) return;
  // The button pressed is gone with the empty state, so focus goes to what comes next.
  await nextTick();
  printButton.value?.focus();
}

async function confirmNew(): Promise<void> {
  if (await make()) confirming.value = false;
}

function cancelNew(): void {
  confirming.value = false;
  makeError.value = '';
}

function print(): void {
  window.print();
}

onMounted(async () => {
  await nextTick();
  closeButton.value?.focus();
  await load();
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="modalRoot"
      class="door-code"
      role="dialog"
      aria-modal="true"
      :aria-label="`Door code for ${marketName}`"
      data-testid="door-code"
    >
      <div class="door-code-controls">
        <button
          ref="closeButton"
          type="button"
          class="btn btn--secondary"
          data-testid="door-code-close"
          @click="emit('close')"
        >
          Close
        </button>
        <span v-if="live" class="door-code-actions">
          <button
            ref="printButton"
            type="button"
            class="btn btn--secondary"
            data-testid="door-code-print"
            @click="print"
          >
            Print
          </button>
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="door-code-new"
            @click="confirming = true"
          >
            New code
          </button>
        </span>
      </div>

      <div class="door-code-poster">
        <h1 class="door-code-market" data-testid="door-code-market">{{ marketName }}</h1>
        <ReadFailed v-if="readError" name="door-code" :message="readError" @retry="load" />
        <p v-else-if="!door" class="door-code-note">Loading…</p>
        <template v-else-if="live && drawing">
          <svg
            class="door-code-qr"
            :viewBox="`0 0 ${drawing.side} ${drawing.side}`"
            shape-rendering="crispEdges"
            role="img"
            aria-label="QR code to check in"
            :data-url="live.url"
            data-testid="door-code-qr"
          >
            <rect :width="drawing.side" :height="drawing.side" fill="white" />
            <path :d="drawing.path" fill="black" />
          </svg>
          <p class="door-code-value" data-testid="door-code-value">
            {{ doorCodeInWords(live.code) }}
          </p>
          <p class="door-code-instruction">Scan with your phone's camera to check in</p>
          <!-- Who made it and when, for whoever stands the screen at the door; not on the poster. -->
          <p class="door-code-made" data-testid="door-code-made">
            <EmailAddress :words="`Made ${getFormattedTimestamp(live.madeAt)} by ${madeBy}`" />
          </p>
        </template>
        <template v-else>
          <p class="door-code-note">
            This market has no door code yet. Make one, then show it at the entrance or print it as
            a poster.
          </p>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="making"
            data-testid="door-code-make"
            @click="makeFirst"
          >
            Make a door code
          </button>
        </template>
        <p v-if="makeError && !confirming" class="door-code-error" role="alert">
          {{ makeError }}
        </p>
      </div>
    </div>

    <AppDialog
      :open="confirming"
      title="Make a new door code?"
      testid="door-code-new-confirm"
      confirmLabel="Make a new code"
      :confirmDisabled="making"
      destructive
      :error="makeError"
      @close="cancelNew"
      @submit="confirmNew"
    >
      <p class="door-code-confirm">The current code and every printed poster of it stop working.</p>
    </AppDialog>
  </Teleport>
</template>

<style scoped>
/* The whole window, white, above the app's banner and drawers and under its dialogs (100). */
.door-code {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6) var(--space-6);
  overflow-y: auto;
  background: white;
  color: var(--mm-black);
}

.door-code-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

.door-code-made {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.door-code-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-inline-start: auto;
}

/* The poster: everything is centred, and the QR code takes whatever height the rest leaves. */
.door-code-poster {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-4);
  text-align: center;
}

.door-code-market {
  margin: 0;
  font-size: var(--text-xl);
  overflow-wrap: anywhere;
}

/* A square the width of the window, which gives up height where the rest needs it (a laptop's
   short window): the code is then drawn as large as the box allows, centred, `viewBox` keeping it
   square. */
.door-code-qr {
  flex: 0 1 auto;
  width: 100%;
  aspect-ratio: 1;
  min-height: 12rem;
}

/* The typed code, for a vendor whose camera will not read the QR code: the scale's display figure,
   spaced so that two groups of three read as such. */
.door-code-value {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.12em;
  white-space: nowrap;
}

.door-code-instruction {
  margin: 0;
  font-size: var(--text-lg);
}

.door-code-note {
  max-width: 32rem;
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-md);
}

.door-code-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.door-code-confirm {
  margin: 0;
}

@media (width <= 640px) {
  .door-code {
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .door-code-market {
    font-size: var(--text-lg);
  }

  /* One line at 390: at --text-lg it wrapped, and its last word fell to a line of its own. */
  .door-code-instruction {
    font-size: var(--text-md);
  }
}

/* The poster, on paper: the same screen laid on one page, at a size read from across a doorway. In
   this block, so each rule is as specific as the screen's own and wins after it. */
@media print {
  .door-code {
    position: static;
    overflow: visible;
    padding: 0;
    break-inside: avoid;
  }

  .door-code-controls,
  .door-code-made,
  .door-code-error {
    display: none;
  }

  .door-code-poster {
    gap: var(--space-6);
  }

  .door-code-market {
    font-size: 28pt;
  }

  .door-code-qr {
    flex: none;
    width: 14cm;
    height: 14cm;
    min-height: 0;
  }

  .door-code-value {
    font-size: 44pt;
  }

  .door-code-instruction {
    font-size: 18pt;
  }
}
</style>

<!-- Not scoped: the app is a sibling of this screen under `body`, so while it is open printing
     hides the app and the page carries the poster alone. -->
<style>
@media print {
  @page {
    /* stylelint-disable-next-line declaration-property-value-allowed-list -- the sheet's own margin, in print's units, not the screen's spacing */
    margin: 1.5cm;
  }

  body:has(> .door-code) > :not(.door-code) {
    display: none !important;
  }
}
</style>
