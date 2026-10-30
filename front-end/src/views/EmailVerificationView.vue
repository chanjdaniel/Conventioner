<script setup lang="ts">
import axios from 'axios';
import type { AxiosError } from 'axios';
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();
const route = useRoute();

const message = ref('');
const errorMessage = ref('');
const isLoading = ref(true);

onMounted(async () => {
  const token = route.query.token as string;

  if (!token) {
    errorMessage.value = 'No verification token provided';
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
      message.value = response.data.msg || 'Email verified successfully!';
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    }
  } catch (_e: unknown) {
    const error = _e as AxiosError<{ msg?: string }>;
    if (error.response) {
      errorMessage.value = error.response.data?.msg || 'Verification failed';
    } else if (error.request) {
      errorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      errorMessage.value = 'An error occurred. Please try again.';
    }
  } finally {
    isLoading.value = false;
  }
});

const resendVerification = async () => {
  errorMessage.value = '';
  const email = prompt('Please enter your email address:');

  if (!email) {
    return;
  }

  try {
    const response = await axios.post(
      `${hostname}/resend-verification`,
      { email },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      message.value = response.data.msg || 'Verification email sent!';
    }
  } catch (_e: unknown) {
    const error = _e as AxiosError<{ msg?: string }>;
    if (error.response) {
      errorMessage.value = error.response.data?.msg || 'Failed to resend verification email';
    } else {
      errorMessage.value = 'Unable to connect to server. Please try again.';
    }
  }
};
</script>

<template>
  <AuthCard>
    <h1>Verify your email</h1>

    <p v-if="isLoading" class="description">Verifying your email…</p>

    <template v-else-if="message">
      <p class="success-message" role="status" data-testid="email-verification-success-message">
        {{ message }}
      </p>
      <p class="description">Redirecting to login page...</p>
    </template>

    <template v-else-if="errorMessage">
      <p class="error-message" role="alert" data-testid="email-verification-error-message">
        {{ errorMessage }}
      </p>
      <button
        type="button"
        @click="resendVerification"
        class="btn btn--primary submit-button"
        data-testid="email-verification-resend-button"
      >
        Resend verification email
      </button>
      <div class="form-links">
        <a
          href="#"
          @click.prevent="router.push('/login')"
          class="link"
          data-testid="email-verification-back-link"
          >Back to sign in</a
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

/* A link on a line of its own is a target (WCAG 2.5.8, T79): a line box `--target-min` tall, with no
   padding, so it still sits on its text. */
.link {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  color: var(--mm-text-link);
  text-decoration: none;
  font-size: var(--text-sm);
}

.link:hover {
  text-decoration: underline;
}
</style>
