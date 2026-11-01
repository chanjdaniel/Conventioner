<script setup lang="ts">
import axios from 'axios';
import type { AxiosError } from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import { resentLink, type SignInNotice } from '@/utils/signInNotice';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();
const route = useRoute();

/** How long the page shows a verification before it goes to sign in. */
const REDIRECT_PAUSE_MS = 3000;
/** What the field says when "Send the link again" is pressed with nothing in it. */
const ADDRESS_MISSING = 'Type your email address.';

const isLoading = ref(true);
/** The server's line for a link that worked; the page then goes to sign in. */
const verified = ref('');
/**
 * The one line a failed link's page says: why the link failed, then what "Send the link again"
 * did (`resentLink`), the newer replacing the older.
 */
const notice = ref<SignInNotice | null>(null);
/** A new link is on its way, so the form has done its work. */
const resent = computed(() => notice.value?.tone === 'success');

const address = ref('');
const addressError = ref('');
const addressInput = ref<HTMLInputElement | null>(null);
/** "Back to sign in", where focus goes once the form that held it is gone. */
const backLink = ref<ComponentPublicInstance | null>(null);
/** A link on its way, so a double click sends one. */
const sending = ref(false);

let redirect: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(redirect));

onMounted(async () => {
  const token = route.query.token;

  if (typeof token !== 'string' || !token) {
    notice.value = { tone: 'error', text: 'No verification token provided' };
    isLoading.value = false;
    return;
  }

  try {
    const response = await axios.post(
      `${hostname}/verify-email`,
      { token },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      verified.value = response.data.msg || 'Email verified successfully!';
      redirect = setTimeout(() => {
        router.push('/login');
      }, REDIRECT_PAUSE_MS);
    }
  } catch (_e: unknown) {
    const error = _e as AxiosError<{ msg?: string }>;
    let text: string;
    if (error.response) {
      text = error.response.data?.msg || 'Verification failed';
    } else if (error.request) {
      text = 'Unable to connect to server. Please try again.';
    } else {
      text = 'An error occurred. Please try again.';
    }
    notice.value = { tone: 'error', text };
  } finally {
    isLoading.value = false;
  }
});

/** The field's message goes as soon as something is typed. */
function onAddressInput() {
  addressError.value = '';
}

/**
 * "Send the link again" (E38/F14/S02, T181): asks for a new link for the address typed on the
 * page, and says what the sign-in page says of its answer: a link on its way whatever the server
 * said of the address, else that it was not sent, with the form kept to try again.
 */
async function sendTheLinkAgain() {
  if (sending.value) return;
  const email = address.value.trim();
  if (!email) {
    addressError.value = ADDRESS_MISSING;
    await nextTick();
    addressInput.value?.focus();
    return;
  }
  sending.value = true;
  try {
    await axios.post(
      `${hostname}/resend-verification`,
      { email },
      { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
    );
    notice.value = resentLink(null);
  } catch (err: unknown) {
    notice.value = resentLink(err);
  } finally {
    sending.value = false;
  }
  // A link on its way takes the form, and the focus in it, away: focus goes to the one control
  // left, so a keyboard is never left on the page itself; the sentence is read as a status.
  if (resent.value) {
    await nextTick();
    (backLink.value?.$el as HTMLElement | undefined)?.focus();
  }
}
</script>

<template>
  <AuthCard>
    <h1>Verify your email</h1>

    <p v-if="isLoading" class="description">Verifying your email…</p>

    <template v-else-if="verified">
      <p class="success-message" role="status" data-testid="email-verification-success-message">
        {{ verified }}
      </p>
      <p class="description" data-testid="email-verification-redirecting">
        Redirecting to sign in…
      </p>
    </template>

    <template v-else>
      <!-- Both lines stay in the page, hidden when empty, so a screen reader announces each as it
           changes. -->
      <p
        class="error-message"
        role="alert"
        v-show="notice?.tone === 'error'"
        data-testid="email-verification-error-message"
      >
        <template v-if="notice?.tone === 'error'">{{ notice.text }}</template>
      </p>
      <p
        class="success-message"
        role="status"
        v-show="resent"
        data-testid="email-verification-resent-message"
      >
        <template v-if="resent">{{ notice?.text }}</template>
      </p>

      <!-- `novalidate`: an empty address is refused by the page, under the field, in its words. -->
      <form
        v-if="!resent"
        class="resend-form"
        novalidate
        @submit.prevent="sendTheLinkAgain"
        data-testid="email-verification-resend-form"
      >
        <p class="description">Type your email address and we'll send you a new link.</p>
        <label class="field-label" for="verification-email">Email</label>
        <input
          id="verification-email"
          ref="addressInput"
          v-model="address"
          type="email"
          placeholder="you@example.com"
          class="field"
          autocomplete="email"
          :aria-invalid="addressError ? 'true' : undefined"
          :aria-describedby="addressError ? 'verification-email-error' : undefined"
          @input="onAddressInput"
          data-testid="email-verification-email-input"
        />
        <p
          v-if="addressError"
          id="verification-email-error"
          class="field-error"
          data-testid="email-verification-email-error"
        >
          {{ addressError }}
        </p>
        <button
          type="submit"
          class="btn btn--primary submit-button"
          :disabled="sending"
          data-testid="email-verification-resend-button"
        >
          Send the link again
        </button>
      </form>

      <div class="form-links">
        <RouterLink
          ref="backLink"
          to="/login"
          class="link-alone"
          data-testid="email-verification-back-link"
          >Back to sign in</RouterLink
        >
      </div>
    </template>
  </AuthCard>
</template>

<style scoped>
/*
 * The reset pages' card, in their terms (T79's review): a left-aligned heading over a left-aligned
 * line, one full-width primary action and the way back as a link beneath it. It was a column
 * centred in a card held at 400px, about 100px of nothing above and below it on a phone.
 *
 * A failed link asks for the address as the reset request asks for it: a labelled `.field` in a
 * column, the action under it (T181; it was a browser prompt).
 */
h1 {
  margin: 0;
}

.description {
  margin: var(--space-2) 0 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-message,
.success-message {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
}

.error-message {
  color: var(--mm-red);
}

.resend-form {
  display: flex;
  flex-direction: column;
}

.field-label {
  margin-top: var(--space-4);
}

.field-error {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.success-message {
  color: var(--mm-text-green);
}

/* `.btn btn--primary` carries the height, radius, fill, weight, focus halo and disabled state. */
.submit-button {
  width: 100%;
  margin-top: var(--space-6);
}

.form-links {
  margin-top: var(--space-4);
  text-align: center;
}
</style>
