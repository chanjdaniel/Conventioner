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
      <h1>Reset Password</h1>
      <p class="description">Enter your new password below.</p>

      <form @submit.prevent="submitReset" class="reset-form" data-testid="password-reset-form">
        <div class="input-group">
          <input
            :type="showPassword ? 'text' : 'password'"
            v-model="newPassword"
            placeholder="New Password (min 8 characters)"
            class="password-input"
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

        <div class="input-group">
          <input
            :type="showPassword ? 'text' : 'password'"
            v-model="confirmPassword"
            placeholder="Confirm password"
            class="password-input"
            required
            :disabled="isLoading"
            data-testid="password-reset-confirm-password-input"
          />
        </div>

        <h3 class="error-message" v-show="errorMessage" data-testid="password-reset-error-message">
          {{ errorMessage }}
        </h3>
        <h3
          class="success-message"
          v-show="successMessage"
          data-testid="password-reset-success-message"
        >
          {{ successMessage }}
        </h3>

        <button
          type="submit"
          class="btn btn--primary submit-button"
          :disabled="isLoading"
          data-testid="password-reset-submit-button"
        >
          {{ isLoading ? 'Resetting...' : 'Reset Password' }}
        </button>

        <div class="form-links">
          <a
            href="#"
            @click.prevent="router.push('/login')"
            class="link"
            data-testid="password-reset-back-link"
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

.password-input {
  width: auto;
  border: none;
  font-size: var(--text-sm);
  flex-grow: 1;
  outline: none;
}

.show-button {
  border: none;
  background-color: transparent;
  width: fit-content;
  padding-right: 20px;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
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
