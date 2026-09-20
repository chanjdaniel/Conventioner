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
      <h1>Reset Password</h1>
      <p class="description">
        Enter your email address and we'll send you a link to reset your password.
      </p>

      <form
        @submit.prevent="submitRequest"
        class="reset-form"
        data-testid="password-reset-request-form"
      >
        <div class="input-group">
          <input
            type="email"
            v-model="email"
            placeholder="Email"
            class="email-input"
            required
            :disabled="isLoading"
            data-testid="password-reset-request-email-input"
          />
        </div>

        <h3
          class="error-message"
          v-show="errorMessage"
          data-testid="password-reset-request-error-message"
        >
          {{ errorMessage }}
        </h3>
        <h3
          class="success-message"
          v-show="successMessage"
          data-testid="password-reset-request-success-message"
        >
          {{ successMessage }}
        </h3>

        <button
          type="submit"
          class="btn btn--primary submit-button"
          :disabled="isLoading"
          data-testid="password-reset-request-submit-button"
        >
          {{ isLoading ? 'Sending...' : 'Send Reset Link' }}
        </button>

        <div class="form-links">
          <a
            href="#"
            @click.prevent="router.push('/login')"
            class="link"
            data-testid="password-reset-request-back-link"
            >Back to Login</a
          >
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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
  min-height: 500px;
  background-color: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 60px;
}

.description {
  color: var(--mm-text-muted);
  font-size: var(--text-md);
  margin-bottom: 30px;
  text-align: center;
}

.reset-form {
  display: flex;
  flex-direction: column;
  padding-top: 20px;
}

.input-group {
  height: 36px;
  padding-left: 10px;
  margin-top: 30px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: row;
  background-color: transparent;
}

.input-group:focus-within {
  border-color: blue;
}

.input-group:has(input:disabled) {
  opacity: 0.6;
  background-color: var(--mm-beige);
}

.email-input {
  width: 100%;
  border: none;
  font-size: var(--text-sm);
  flex-grow: 1;
  outline: none;
}

.error-message {
  color: red;
  text-align: right;
  font-size: var(--text-sm);
  margin-top: 10px;
  margin-bottom: 0;
}

.success-message {
  color: green;
  text-align: center;
  font-size: var(--text-sm);
  margin-top: 10px;
  margin-bottom: 0;
}

/* `.btn btn--primary` carries the height, radius, fill, weight, focus ring and disabled state.
   It was a 60px, 30px-radius pill with 20px text - the auth screens' own dialect (E16/F05). */
.submit-button {
  width: 100%;
  margin-top: var(--space-6);
}

.submit-button:hover:not(:disabled) {
  opacity: 0.9;
}

.submit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-links {
  margin-top: 20px;
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
