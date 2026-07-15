<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApplicationStore } from '@/stores/application';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';

const route = useRoute();
const router = useRouter();
const store = useApplicationStore();

const marketSlug = computed(() => (route.params.marketSlug as string) || '');
const redirect = computed(() => (route.query.redirect as string) || 'dashboard');
const marketName = ref('');

const RESEND_COOLDOWN_SECONDS = 60;

const email = ref('');
const code = ref('');
const step = ref<'email' | 'code'>('email');
const submitting = ref(false);
const validationError = ref<string | null>(null);
const displayedError = computed(() => validationError.value || store.error);

function goOnward() {
  router.push({
    name: redirect.value === 'apply' ? 'apply' : 'applicant-dashboard',
    params: { marketSlug: marketSlug.value },
  });
}

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

onMounted(async () => {
  store.error = null;
  if (store.isAuthenticatedFor(marketSlug.value)) {
    goOnward();
    return;
  }
  marketName.value = (await fetchPublicApplicationForm(marketSlug.value)).marketName;
});

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
  await store.requestCode(marketSlug.value, address);
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
    marketSlug.value,
    email.value.trim().toLowerCase(),
    code.value.trim(),
  );
  submitting.value = false;
  if (ok) {
    goOnward();
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
  <div class="login-page" data-testid="applicant-login-page">
    <header class="login-header">
      <h1>Sign In</h1>
      <p class="login-market" data-testid="applicant-login-market">
        {{ marketName || marketSlug }}
      </p>
    </header>

    <div v-if="displayedError" class="login-error" data-testid="applicant-login-error">
      {{ displayedError }}
    </div>

    <template v-if="step === 'email'">
      <div class="login-step" data-testid="applicant-login-email-step">
        <p class="login-instruction">
          Enter the email address you used to apply. We'll send you a verification code.
        </p>
        <input
          v-model="email"
          class="login-input"
          type="email"
          placeholder="you@example.com"
          data-testid="applicant-login-email-input"
          @keyup.enter="requestCode"
        />
        <button
          class="login-btn"
          :disabled="submitting || !email.trim() || cooldownApplies"
          @click="requestCode"
          data-testid="applicant-login-request-btn"
        >
          <template v-if="cooldownApplies"
            >Code already sent - retry in {{ cooldownRemaining }}s</template
          >
          <template v-else>{{ submitting ? 'Sending...' : 'Send Code' }}</template>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="login-step" data-testid="applicant-login-code-step">
        <p class="login-instruction">If an account exists for this email, we've sent a code.</p>
        <input
          v-model="code"
          class="login-input login-code-input"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="000000"
          data-testid="applicant-login-code-input"
          @keyup.enter="verifyCode"
        />
        <button
          class="login-btn"
          :disabled="submitting || code.trim().length !== 6"
          @click="verifyCode"
          data-testid="applicant-login-verify-btn"
        >
          {{ submitting ? 'Verifying...' : 'Verify & Sign In' }}
        </button>
        <div class="login-alt">
          <button class="login-link-btn" @click="goBack" data-testid="applicant-login-back-btn">
            Use a different email
          </button>
          <span class="login-sep">|</span>
          <button
            class="login-link-btn"
            :disabled="submitting || cooldownRemaining > 0"
            @click="requestCode"
            data-testid="applicant-login-resend-btn"
          >
            {{ cooldownRemaining > 0 ? `Resend code in ${cooldownRemaining}s` : 'Resend code' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.login-page {
  max-width: 420px;
  margin: 60px auto;
  padding: 0 16px;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
}

.login-header h1 {
  font-family: 'Merge One';
  font-size: 24px;
  color: var(--mm-black);
  margin: 0 0 4px;
}

.login-market {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #666);
  margin: 0;
}

.login-error {
  background: #f8d7da;
  border: 1px solid var(--mm-red, #cc0000);
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: #721c24;
}

.login-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login-instruction {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #666);
  margin: 0;
  line-height: 1.5;
}

.login-input {
  height: 44px;
  padding: 4px 12px;
  font-family: 'Outfit Regular';
  font-size: 16px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
}

.login-code-input {
  letter-spacing: 12px;
  text-align: center;
  font-size: 24px;
}

.login-btn {
  height: 44px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 16px;
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-alt {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.login-link-btn {
  background: none;
  border: none;
  color: var(--mm-grey, #666);
  cursor: pointer;
  font-family: 'Outfit Regular';
  font-size: 13px;
  text-decoration: underline;
  padding: 0;
}

.login-link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-sep {
  color: var(--mm-grey, #ccc);
}
</style>
