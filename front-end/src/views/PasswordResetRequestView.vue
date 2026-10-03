<script setup lang="ts">
import axios from 'axios';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

const email = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const isLoading = ref(false);

const submitRequest = async () => {
  errorMessage.value = '';
  successMessage.value = '';

  if (!email.value) {
    errorMessage.value = 'Email is required';
    return;
  }

  isLoading.value = true;

  try {
    const response = await axios.post(
      `${hostname}/request-password-reset`,
      { email: email.value },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      successMessage.value =
        response.data.msg || 'If an account exists, a password reset email has been sent.';
      email.value = '';
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    if (error.response) {
      if (error.response.status === 429) {
        errorMessage.value =
          error.response.data?.msg || 'Please wait before requesting another password reset';
      } else {
        errorMessage.value = error.response.data?.msg || 'Failed to send password reset email';
      }
    } else if (error.request) {
      errorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      errorMessage.value = 'An error occurred. Please try again.';
    }
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="container">
    <div class="reset-window">
      <h1>Reset your password</h1>
      <p class="description">
        Enter your email address and we'll send you a link to reset your password.
      </p>

      <form
        @submit.prevent="submitRequest"
        class="reset-form"
        data-testid="password-reset-request-form"
      >
        <label class="field-label" for="reset-email">Email</label>
        <input
          id="reset-email"
          type="email"
          v-model="email"
          placeholder="you@example.com"
          class="field"
          autocomplete="email"
          required
          :disabled="isLoading"
          data-testid="password-reset-request-email-input"
        />

        <p
          class="error-message"
          role="alert"
          v-show="errorMessage"
          data-testid="password-reset-request-error-message"
        >
          {{ errorMessage }}
        </p>
        <p
          class="success-message"
          role="status"
          v-show="successMessage"
          data-testid="password-reset-request-success-message"
        >
          {{ successMessage }}
        </p>

        <button
          type="submit"
          class="btn btn--primary submit-button"
          :disabled="isLoading"
          data-testid="password-reset-request-submit-button"
        >
          {{ isLoading ? 'Sending…' : 'Send reset link' }}
        </button>

        <div class="form-links">
          <a
            href="#"
            @click.prevent="router.push('/login')"
            class="link"
            data-testid="password-reset-request-back-link"
            >Back to sign in</a
          >
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/*
 * Sign in's card, in Sign in's terms (bug 43): sentence case, a left-aligned heading over a
 * left-aligned line, persistent labels, and the field primitive's metrics. This page had its own
 * dialect - Title Case, a left-aligned title over a centred subtitle, a fixed 500px card with a
 * band of nothing in it, and an input 10px wider than its box, which painted over the box's right
 * border.
 */
.container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.reset-window {
  width: 600px;
  background-color: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: var(--space-8);
}

h1 {
  margin: 0;
}

.description {
  margin: var(--space-2) 0 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.reset-form {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-2);
}

.field-label {
  margin-top: var(--space-4);
}

.field-help {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* Messages, not headings: they were `h3`s, in the outline beside the page's title. */
.error-message,
.success-message {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
}

.error-message {
  color: var(--mm-red);
}

.success-message {
  color: var(--mm-text-green);
}

/* `.btn btn--primary` carries the height, radius, fill, weight, focus ring and disabled state. */
.submit-button {
  width: 100%;
  margin-top: var(--space-6);
}

.form-links {
  margin-top: var(--space-4);
  text-align: center;
}

.link {
  color: var(--mm-text-link);
  text-decoration: none;
  font-size: var(--text-sm);
}

.link:hover {
  text-decoration: underline;
}
</style>
