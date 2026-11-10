<script setup lang="ts">
/**
 * The one line a sign-in form says (E38/F14/S02), with what to do next beside it: "Forgot
 * password?" for a refused password, "Send the link again" for an address that needs verifying.
 *
 * One line at a time: the form holds one notice, and a newer one replaces it, so a red line never
 * sits under a green one. Both lines stay in the page, hidden when empty, so that a screen reader
 * announces each as it changes. Each takes `tabindex="-1"`, so the focus can move to it once a
 * send takes the button away, and Tab never stops on it.
 */
import { nextTick, ref, watch } from 'vue';
import type { SignInNotice } from '@/utils/signInNotice';

const props = defineProps<{
  notice: SignInNotice | null;
  /** The form's test ids start with it: `login`, `login-otp`. */
  testidPrefix: string;
  /** A link is on its way, so the button waits for it. */
  sending?: boolean;
}>();

const emit = defineEmits<{ resend: [] }>();

const errorLine = ref<HTMLElement | null>(null);
const successLine = ref<HTMLElement | null>(null);

/**
 * This form asked for the link: the two forms share one `sending`, so only the one asked moves the
 * focus when it ends.
 */
let asked = false;

function resend() {
  asked = true;
  emit('resend');
}

/*
 * Once the send ends, the newer line has replaced the one the button answered. When the button went
 * with it (a link on its way, or the wait past the limit), the focus on it would fall to
 * the page, so it moves to the line that says what happened; offered again, it keeps the focus.
 */
watch(
  () => props.sending,
  async (sending, wasSending) => {
    if (sending || !wasSending || !asked) return;
    asked = false;
    await nextTick();
    if (props.notice?.next === 'resend') return;
    (props.notice?.tone === 'success' ? successLine : errorLine).value?.focus();
  },
);
</script>

<template>
  <p
    ref="errorLine"
    class="sign-in-notice sign-in-notice--error"
    role="alert"
    tabindex="-1"
    v-show="notice?.tone === 'error'"
    :data-testid="`${testidPrefix}-error-message`"
  >
    <template v-if="notice?.tone === 'error'">{{ notice.text }}</template>
    <template v-if="notice?.next === 'reset'">
      {{ ' '
      }}<RouterLink
        to="/reset-password-request"
        class="sign-in-notice__link"
        :data-testid="`${testidPrefix}-error-forgot-password-link`"
        >Forgot password?</RouterLink
      >
    </template>
  </p>
  <button
    v-if="notice?.next === 'resend'"
    type="button"
    class="btn btn--secondary btn--compact sign-in-notice__resend"
    :disabled="sending"
    :data-testid="`${testidPrefix}-resend-verification-button`"
    @click="resend"
  >
    Send the link again
  </button>
  <p
    ref="successLine"
    class="sign-in-notice sign-in-notice--success"
    role="status"
    tabindex="-1"
    v-show="notice?.tone === 'success'"
    :data-testid="`${testidPrefix}-success-message`"
  >
    <template v-if="notice?.tone === 'success'">{{ notice.text }}</template>
  </p>
</template>

<style scoped>
/* Left-aligned with the form it belongs to, in the tokens' red and green, which reach AA on
   white. */
.sign-in-notice {
  text-align: left;
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  margin-bottom: 0;
}

.sign-in-notice--error {
  color: var(--mm-red);
}

.sign-in-notice--success {
  color: var(--mm-green);
}

/* A link in the sentence, so it reads as part of it; the link colour tells it from the red. On a
   phone it moves to the next line whole, rather than breaking between its two words. */
.sign-in-notice__link {
  color: var(--mm-text-link);
  text-decoration: underline;
  white-space: nowrap;
}

/* As wide as its words, under the line it answers. */
.sign-in-notice__resend {
  align-self: flex-start;
  margin-top: var(--space-2);
}
</style>
