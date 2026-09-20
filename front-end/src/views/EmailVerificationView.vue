<script setup lang="ts">
import axios from 'axios';
import type { AxiosError } from 'axios';
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

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
  <div class="container">
    <div class="verification-window">
      <h1>Email Verification</h1>

      <div v-if="isLoading" class="loading">
        <p>Verifying your email...</p>
      </div>

      <div v-else-if="message" class="success">
        <p class="success-message">{{ message }}</p>
        <p class="redirect-message">Redirecting to login page...</p>
      </div>

      <div v-else-if="errorMessage" class="error">
        <p class="error-message" data-testid="email-verification-error-message">
          {{ errorMessage }}
        </p>
        <button
          @click="resendVerification"
          class="btn btn--primary resend-button"
          data-testid="email-verification-resend-button"
        >
          Resend Verification Email
        </button>
        <button
          @click="router.push('/login')"
          class="btn btn--secondary link-button"
          data-testid="email-verification-login-button"
        >
          Go to Login
        </button>
      </div>
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

.verification-window {
  width: 600px;
  min-height: 400px;
  background-color: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.loading {
  font-size: var(--text-lg);
  color: var(--mm-text-muted);
}

.success-message {
  color: green;
  font-size: var(--text-lg);
  margin-bottom: 20px;
}

.redirect-message {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-message {
  color: red;
  font-size: var(--text-lg);
  margin-bottom: 20px;
}

.resend-button,
.link-button {
  margin: var(--space-2);
}

/* `.btn btn--primary` carries everything but the spacing (E16/F05). */
.resend-button {
  margin: var(--space-2);
}

.link-button {
  background-color: var(--mm-text-link);
  color: white;
}

.resend-button:hover,
.link-button:hover {
  opacity: 0.9;
}
</style>
