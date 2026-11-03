<script setup lang="ts">
/**
 * The vendor page's sign-in (ADR 0022): an email address, then the six-digit code sent to it.
 *
 * Every address is sent a code, applied or not, so the words are the same for every address and
 * true for each. A right code signs the vendor in through the store, and the page, which watches
 * that, draws their own sections in place of this one.
 *
 * A code takes five tries (T191 F22): a wrong one clears the field and keeps it focused for
 * another; once the code no longer works - its tries used, or its ten minutes up - the field and
 * "Sign in" go, and "Send a new code", after its wait, is the step's one action.
 *
 * "Remember me on this device" (ADR 0022) sits under the code, unticked until ticked, and only
 * while the market has a date left (`rememberUntil`); it says the date it would last until.
 */
import { computed, nextTick, onUnmounted, ref } from 'vue';
import CodeInput from '@/components/CodeInput.vue';
import { useApplicationStore } from '@/stores/application';
import { getShortDate } from '@/utils/utils';

const props = defineProps<{ marketSlug: string }>();

const store = useApplicationStore();

const RESEND_COOLDOWN_SECONDS = 60;

const email = ref('');
const code = ref('');
const step = ref<'email' | 'code'>('email');
const submitting = ref(false);
const validationError = ref<string | null>(null);
const displayedError = computed(() => validationError.value || store.error);

const codeInput = ref<InstanceType<typeof CodeInput> | null>(null);
const remember = ref(false);
/** The date Remember me would last until, or null when the page offers none. */
const rememberUntil = computed(() => {
  const until = store.page?.rememberUntil;
  return until ? getShortDate(until) : null;
});
/** The code can no longer pass: only a new one is offered. */
const spent = computed(() => store.codeState === 'spent');

const requestedEmail = ref('');
const cooldownRemaining = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | undefined;

const cooldownApplies = computed(
  () => cooldownRemaining.value > 0 && requestedEmail.value === email.value.trim().toLowerCase(),
);

function startCooldown() {
  cooldownRemaining.value = RESEND_COOLDOWN_SECONDS;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldownRemaining.value -= 1;
    if (cooldownRemaining.value <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = undefined;
    }
  }, 1000);
}

onUnmounted(() => clearInterval(cooldownTimer));

async function requestCode() {
  if (!email.value.trim()) {
    validationError.value = 'Email address is required.';
    return;
  }
  if (cooldownApplies.value) {
    return;
  }
  validationError.value = null;
  store.error = null;
  submitting.value = true;
  const address = email.value.trim().toLowerCase();
  await store.requestCode(props.marketSlug, address);
  submitting.value = false;
  if (!store.error) {
    requestedEmail.value = address;
    startCooldown();
    code.value = '';
    step.value = 'code';
    await nextTick();
    codeInput.value?.focus();
  }
}

async function verifyCode() {
  if (!code.value.trim()) {
    validationError.value = 'Verification code is required.';
    return;
  }
  validationError.value = null;
  store.error = null;
  submitting.value = true;
  await store.verifyCode(
    props.marketSlug,
    email.value.trim().toLowerCase(),
    code.value.trim(),
    Boolean(rememberUntil.value) && remember.value,
  );
  submitting.value = false;
  if (store.codeState === 'retry') {
    code.value = '';
    await nextTick();
    codeInput.value?.focus();
  }
}

function goBack() {
  step.value = 'email';
  code.value = '';
  validationError.value = null;
  store.error = null;
  store.codeState = null;
}
</script>

<template>
  <section class="sign-in" data-testid="vendor-sign-in">
    <h2 class="sign-in-title">Sign in</h2>

    <div
      v-if="displayedError"
      class="sign-in-error"
      role="alert"
      data-testid="vendor-sign-in-error"
    >
      {{ displayedError }}
    </div>

    <!--
      A native form, not a key handler (E20/F01/S03). Enter then runs the same handler as the
      button and inherits its guard - including the cooldown, which a `@keyup.enter` bypassed.
    -->
    <form
      v-if="step === 'email'"
      class="sign-in-step"
      data-testid="vendor-sign-in-email-step"
      @submit.prevent="requestCode"
    >
      <p class="sign-in-instruction">
        Enter your email address. We'll send you a code to sign in with.
      </p>
      <div class="sign-in-field">
        <label class="field-label" for="vendor-sign-in-email">Email</label>
        <input
          id="vendor-sign-in-email"
          v-model="email"
          class="field"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          data-testid="vendor-sign-in-email-input"
        />
      </div>
      <button
        type="submit"
        class="btn btn--primary"
        :disabled="submitting || !email.trim() || cooldownApplies"
        data-testid="vendor-sign-in-request-btn"
      >
        <template v-if="cooldownApplies"
          >Code already sent - retry in {{ cooldownRemaining }}s</template
        >
        <template v-else>{{ submitting ? 'Sending…' : 'Send code' }}</template>
      </button>
    </form>

    <form
      v-else
      class="sign-in-step"
      data-testid="vendor-sign-in-code-step"
      @submit.prevent="verifyCode"
    >
      <!-- The same words for every address, and true for every address: each is sent a code. -->
      <p class="sign-in-instruction sign-in-instruction--centred">
        We've sent a code to {{ requestedEmail }}. Only the newest one works.
      </p>
      <template v-if="!spent">
        <div class="sign-in-field">
          <label class="field-label" for="vendor-sign-in-code">Sign-in code</label>
          <CodeInput
            id="vendor-sign-in-code"
            ref="codeInput"
            v-model="code"
            data-testid="vendor-sign-in-code-input"
          />
        </div>
        <div v-if="rememberUntil">
          <label class="remember-me">
            <input
              v-model="remember"
              type="checkbox"
              aria-describedby="vendor-sign-in-remember-me-help"
              data-testid="vendor-sign-in-remember-me"
            />
            <!-- "until <date>" wraps as one phrase on a narrow phone, never leaving the year alone. -->
            <span>
              Remember me on this device
              <span class="remember-me-until">until {{ rememberUntil }}</span>
            </span>
          </label>
          <p id="vendor-sign-in-remember-me-help" class="remember-me-help">
            Leave it unticked on a shared device.
          </p>
        </div>
        <button
          type="submit"
          class="btn btn--primary"
          :disabled="submitting || code.trim().length !== 6"
          data-testid="vendor-sign-in-verify-btn"
        >
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </template>
      <!-- `type="button"`: inside a form, a button with no type submits it. -->
      <button
        v-else
        type="button"
        class="btn btn--primary"
        :disabled="submitting || cooldownRemaining > 0"
        data-testid="vendor-sign-in-send-new-code-btn"
        @click="requestCode"
      >
        {{ cooldownRemaining > 0 ? `Send a new code in ${cooldownRemaining}s` : 'Send a new code' }}
      </button>
      <div class="sign-in-alt">
        <button
          type="button"
          class="sign-in-link-btn"
          data-testid="vendor-sign-in-back-btn"
          @click="goBack"
        >
          Use a different email
        </button>
        <template v-if="!spent">
          <span class="sign-in-sep" aria-hidden="true">|</span>
          <button
            type="button"
            class="sign-in-link-btn"
            :disabled="submitting || cooldownRemaining > 0"
            data-testid="vendor-sign-in-resend-btn"
            @click="requestCode"
          >
            {{ cooldownRemaining > 0 ? `Resend code in ${cooldownRemaining}s` : 'Resend code' }}
          </button>
        </template>
      </div>
    </form>
  </section>
</template>

<style scoped>
/* A fixed column, so it does not change width as its steps change words. */
.sign-in {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
}

.sign-in-title {
  font-family: 'Merge One';
  font-size: var(--text-lg);
  color: var(--mm-black);
  text-align: center;
  margin: 0 0 var(--space-4);
}

.sign-in-error {
  background: var(--mm-chip-destructive);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-text-red-on-tint);
}

.sign-in-step {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* A field and its label, held together rather than spaced like the step's other parts. */
.sign-in-field {
  display: flex;
  flex-direction: column;
}

.sign-in-instruction {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  margin: 0;
  line-height: 1.5;
}

/* The code step has one alignment: its line centred, as the title over it and the links under it
   are; the label stays left over its full-width field, as every label does (T191 F21). */
.sign-in-instruction--centred {
  text-align: center;
}

/* The choice and its label are one target, at least `--target-min` tall (44px on a phone), and
   only as wide as its words, so a tap beside it does not tick it; as at the organizer's sign-in. */
.remember-me {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.remember-me-until {
  white-space: nowrap;
}

/* What the choice is for, said under it in the hint's size. */
.remember-me-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.sign-in-alt {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
}

/* Each a target of its own (`--target-min`, 44px on a phone), sitting on its text. */
.sign-in-link-btn {
  min-height: var(--target-min);
  background: none;
  border: none;
  color: var(--mm-text-muted);
  cursor: pointer;
  font-size: var(--text-xs);
  text-decoration: underline;
  padding: 0;
}

/* Still read in full while it waits: it says when the code can be sent again, which a 50% fade
   left below AA. Not underlined, so it does not read as something to press yet. */
.sign-in-link-btn:disabled {
  text-decoration: none;
  cursor: not-allowed;
}

.sign-in-sep {
  color: var(--mm-text-muted);
}
</style>
