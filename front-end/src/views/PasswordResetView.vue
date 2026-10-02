<script setup lang="ts">
import axios from 'axios';
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();
const route = useRoute();

const token = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const showPassword = ref(false);
const isLoading = ref(false);

onMounted(() => {
  const tokenParam = route.query.token as string;
  if (!tokenParam) {
    errorMessage.value = 'No reset token provided';
    router.push('/reset-password-request');
    return;
  }
  token.value = tokenParam;
});

const submitReset = async () => {
  errorMessage.value = '';
  successMessage.value = '';

  if (!newPassword.value || !confirmPassword.value) {
    errorMessage.value = 'Password and confirmation are required';
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match';
    return;
  }

  if (newPassword.value.length < 8) {
    errorMessage.value = 'Password must be at least 8 characters long';
    return;
  }

  isLoading.value = true;

  try {
    const response = await axios.post(
      `${hostname}/reset-password`,
      {
        token: token.value,
        new_password: newPassword.value,
      },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      successMessage.value = response.data.msg || 'Password reset successfully!';
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    if (error.response) {
      errorMessage.value = error.response.data?.msg || 'Failed to reset password';
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
      <p class="description">Choose a new password for your account.</p>

      <form @submit.prevent="submitReset" class="reset-form" data-testid="password-reset-form">
        <label class="field-label" for="reset-new-password">New password</label>
        <div class="password-field">
          <input
            id="reset-new-password"
            :type="showPassword ? 'text' : 'password'"
            v-model="newPassword"
            class="password-input"
            autocomplete="new-password"
            required
            :disabled="isLoading"
            data-testid="password-reset-new-password-input"
          />
          <button
            type="button"
            class="show-button"
            @click="showPassword = !showPassword"
            data-testid="password-reset-toggle-password"
          >
            {{ showPassword ? 'Hide' : 'Show' }}
          </button>
        </div>
        <p class="field-help">At least 8 characters.</p>

        <label class="field-label" for="reset-confirm-password">Confirm password</label>
        <div class="password-field">
          <input
            id="reset-confirm-password"
            :type="showPassword ? 'text' : 'password'"
            v-model="confirmPassword"
            class="password-input"
            autocomplete="new-password"
            required
            :disabled="isLoading"
            data-testid="password-reset-confirm-password-input"
          />
        </div>

        <p
          class="error-message"
          role="alert"
          v-show="errorMessage"
          data-testid="password-reset-error-message"
        >
          {{ errorMessage }}
        </p>
        <p
          class="success-message"
          role="status"
          v-show="successMessage"
          data-testid="password-reset-success-message"
        >
          {{ successMessage }}
        </p>

        <button
          type="submit"
          class="btn btn--primary submit-button"
          :disabled="isLoading"
          data-testid="password-reset-submit-button"
        >
          {{ isLoading ? 'Resetting…' : 'Reset password' }}
        </button>

        <div class="form-links">
          <a
            href="#"
            @click.prevent="router.push('/login')"
            class="link"
            data-testid="password-reset-back-link"
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

/* A password and its Show toggle, wearing `.field`'s metrics, as Sign in's does. */
.password-field {
  height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  display: flex;
  align-items: center;
  background-color: white;
}

.password-field:focus-within {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.password-field:has(input:disabled) {
  background-color: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
}

.password-input {
  min-width: 0;
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-sm);
}

/* Its focus ring is the primitives' own: this set `outline: none`, so a keyboard user could not
   see they were on it. */
.show-button {
  border: none;
  background-color: transparent;
  padding: 0 0 0 var(--space-2);
  color: var(--mm-text-link);
  font-size: var(--text-xs);
  cursor: pointer;
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
