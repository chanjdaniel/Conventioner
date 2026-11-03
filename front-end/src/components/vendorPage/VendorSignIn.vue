<script setup lang="ts">
/**
 * The vendor page's sign-in (ADR 0021): an email address, then the six-digit code sent to it.
 *
 * Every address is sent a code, applied or not, so the words are the same for every address and
 * true for each. Signing in emits `signed-in`, and the page draws the vendor's own sections.
 */
import { computed, onUnmounted, ref } from 'vue';
import { useApplicationStore } from '@/stores/application';

const props = defineProps<{ marketSlug: string }>();
const emit = defineEmits<{ 'signed-in': [] }>();

const store = useApplicationStore();

const RESEND_COOLDOWN_SECONDS = 60;

const email = ref('');
const code = ref('');
const step = ref<'email' | 'code'>('email');
const submitting = ref(false);
const validationError = ref<string | null>(null);
const displayedError = computed(() => validationError.value || store.error);

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
    step.value = 'code';
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
  const ok = await store.verifyCode(
    props.marketSlug,
    email.value.trim().toLowerCase(),
    code.value.trim(),
  );
  submitting.value = false;
  if (ok) {
    emit('signed-in');
  }
}

function goBack() {
  step.value = 'email';
  code.value = '';
  validationError.value = null;
  store.error = null;
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
      <p class="sign-in-instruction">We've sent a code to {{ requestedEmail }}.</p>
      <div class="sign-in-field">
        <label class="field-label" for="vendor-sign-in-code">Sign-in code</label>
        <input
          id="vendor-sign-in-code"
          v-model="code"
          class="field sign-in-code-input"
          autocomplete="one-time-code"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="000000"
          data-testid="vendor-sign-in-code-input"
        />
      </div>
      <button
        type="submit"
        class="btn btn--primary"
        :disabled="submitting || code.trim().length !== 6"
        data-testid="vendor-sign-in-verify-btn"
      >
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <div class="sign-in-alt">
        <!-- `type="button"`: inside a form, a button with no type submits it. -->
        <button
          type="button"
          class="sign-in-link-btn"
          data-testid="vendor-sign-in-back-btn"
          @click="goBack"
        >
          Use a different email
        </button>
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

/* The field and button primitives carry the rest; the code is the one field read at a glance. */
.sign-in-code-input {
  height: 48px;
  letter-spacing: 12px;
  text-align: center;
  font-size: var(--text-xl);
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
