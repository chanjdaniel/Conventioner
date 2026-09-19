<script setup lang="ts">
import axios from 'axios';
import { ref, inject } from 'vue';
import { useRouter } from 'vue-router';
import { executeRecaptcha } from '@/utils/captcha';

const hostname = import.meta.env.VITE_FLASK_HOST;

const router = useRouter();

// Mode: 'login' | 'register' | 'otp'
const mode = ref<'login' | 'register' | 'otp'>('login');

// Login fields
const email = ref('');
const password = ref('');
const errorMessage = ref('');
const showPassword = ref(false);

// Registration fields
const registerEmail = ref('');
const registerPassword = ref('');
const registerPasswordConfirm = ref('');
const registerErrorMessage = ref('');
const registerSuccessMessage = ref('');
const showRegisterPassword = ref(false);

// OTP fields
const otpEmail = ref('');
const otpCode = ref('');
const otpErrorMessage = ref('');
const otpRequested = ref(false);
const otpSuccessMessage = ref('');

const setUser = inject<(user: unknown) => void>('setUser', () => {});

const submitLogin = async () => {
  errorMessage.value = ''; // Clear previous error

  try {
    const response = await axios.post(
      `${hostname}/login`,
      {
        email: email.value,
        password: password.value,
      },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      const user_email = response.data.user_data.email;
      localStorage.setItem('user', JSON.stringify(user_email));
      setUser(user_email);
      router.push('/dashboard');
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    // Handle axios errors (including 401 responses)
    if (error.response) {
      // Server responded with error status
      errorMessage.value =
        error.response.data?.message ||
        'That email and password do not match. Try again, or reset your password below.';
    } else if (error.request) {
      // Request was made but no response received
      errorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      // Something else happened
      errorMessage.value = 'An error occurred. Please try again.';
    }
  }
};

const submitRegister = async () => {
  registerErrorMessage.value = '';
  registerSuccessMessage.value = '';

  // Validation
  if (!registerEmail.value || !registerPassword.value) {
    registerErrorMessage.value = 'Email and password are required';
    return;
  }

  if (registerPassword.value !== registerPasswordConfirm.value) {
    registerErrorMessage.value = 'Passwords do not match';
    return;
  }

  if (registerPassword.value.length < 8) {
    registerErrorMessage.value = 'Password must be at least 8 characters long';
    return;
  }

  try {
    // Get CAPTCHA token
    const captchaToken = await executeRecaptcha('register');

    const response = await axios.post(
      `${hostname}/register`,
      {
        email: registerEmail.value,
        password: registerPassword.value,
        captcha_token: captchaToken,
      },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 201) {
      registerSuccessMessage.value =
        response.data.msg ||
        'Registration successful! Please check your email to verify your account.';
      // Clear form
      registerEmail.value = '';
      registerPassword.value = '';
      registerPasswordConfirm.value = '';
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    if (error.response) {
      registerErrorMessage.value = error.response.data?.msg || 'Registration failed';
    } else if (error.request) {
      registerErrorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      registerErrorMessage.value = 'An error occurred. Please try again.';
    }
  }
};

const requestOTP = async () => {
  otpErrorMessage.value = '';
  otpSuccessMessage.value = '';

  if (!otpEmail.value) {
    otpErrorMessage.value = 'Email is required';
    return;
  }

  try {
    const response = await axios.post(
      `${hostname}/request-otp`,
      {
        email: otpEmail.value,
      },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      otpRequested.value = true;
      otpSuccessMessage.value = response.data.msg || 'OTP sent to your email';
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    if (error.response) {
      otpErrorMessage.value = error.response.data?.msg || 'Failed to send OTP';
    } else if (error.request) {
      otpErrorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      otpErrorMessage.value = 'An error occurred. Please try again.';
    }
  }
};

const submitOTPLogin = async () => {
  otpErrorMessage.value = '';

  if (!otpEmail.value || !otpCode.value) {
    otpErrorMessage.value = 'Email and OTP code are required';
    return;
  }

  try {
    const response = await axios.post(
      `${hostname}/login-otp`,
      {
        email: otpEmail.value,
        otp: otpCode.value,
      },
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 200) {
      const user_email = response.data.user_data.email;
      localStorage.setItem('user', JSON.stringify(user_email));
      setUser(user_email);
      router.push('/dashboard');
    }
  } catch (_e: unknown) {
    const error = _e as {
      response?: { data?: { msg?: string; message?: string }; status?: number };
      request?: unknown;
      message?: string;
    };
    if (error.response) {
      otpErrorMessage.value = error.response.data?.msg || 'Invalid OTP';
    } else if (error.request) {
      otpErrorMessage.value = 'Unable to connect to server. Please try again.';
    } else {
      otpErrorMessage.value = 'An error occurred. Please try again.';
    }
  }
};
</script>

<template>
  <div class="container">
    <div class="login-window">
      <!-- Mode Tabs -->
      <div class="mode-tabs">
        <button
          class="mode-tab"
          :class="{ active: mode === 'login' }"
          @click="
            mode = 'login';
            errorMessage = '';
            registerErrorMessage = '';
            otpErrorMessage = '';
          "
          data-testid="login-tab-login"
        >
          Sign in
        </button>
        <button
          class="mode-tab"
          :class="{ active: mode === 'register' }"
          @click="
            mode = 'register';
            errorMessage = '';
            registerErrorMessage = '';
            otpErrorMessage = '';
          "
          data-testid="login-tab-register"
        >
          Register
        </button>
        <button
          class="mode-tab"
          :class="{ active: mode === 'otp' }"
          @click="
            mode = 'otp';
            errorMessage = '';
            registerErrorMessage = '';
            otpErrorMessage = '';
            otpRequested = false;
          "
          data-testid="login-tab-otp"
        >
          Sign-in code
        </button>
      </div>

      <!-- Login Form -->
      <div v-if="mode === 'login'" class="form-container">
        <h1>Sign in</h1>
        <form
          id="login-form"
          class="login-form"
          @submit.prevent="submitLogin"
          data-testid="login-form"
        >
          <label class="field-label" for="email">Email</label>
          <div class="login-input">
            <input
              id="email"
              type="email"
              v-model="email"
              placeholder="you@example.com"
              class="email-input"
              required
              data-testid="login-email-input"
            />
          </div>
          <label class="field-label" for="password">Password</label>
          <div class="login-input">
            <input
              id="password"
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder=""
              class="password-input"
              required
              data-testid="login-password-input"
            />
            <button
              type="button"
              id="toggle-password"
              class="show-button"
              @click="showPassword = !showPassword"
              data-testid="login-toggle-password"
            >
              {{ showPassword ? 'Hide' : 'Show' }}
            </button>
          </div>
          <p
            class="error-message"
            role="alert"
            v-show="errorMessage"
            data-testid="login-error-message"
          >
            {{ errorMessage }}
          </p>
          <button type="submit" class="submit-button" data-testid="login-submit-button">
            Sign in
          </button>
          <div class="form-links">
            <a
              href="#"
              @click.prevent="router.push('/reset-password-request')"
              class="link"
              data-testid="login-forgot-password-link"
              >Forgot password?</a
            >
          </div>
        </form>
      </div>

      <!-- Registration Form -->
      <div v-if="mode === 'register'" class="form-container">
        <h1>Create account</h1>
        <form
          id="register-form"
          class="login-form"
          @submit.prevent="submitRegister"
          data-testid="login-register-form"
        >
          <label class="field-label" for="register-email">Email</label>
          <div class="login-input">
            <input
              id="register-email"
              type="email"
              v-model="registerEmail"
              placeholder="you@example.com"
              class="email-input"
              required
              data-testid="login-register-email-input"
            />
          </div>
          <label class="field-label" for="register-password">Password</label>
          <div class="login-input">
            <input
              id="register-password"
              :type="showRegisterPassword ? 'text' : 'password'"
              v-model="registerPassword"
              placeholder=""
              class="password-input"
              required
              data-testid="login-register-password-input"
            />
            <button
              type="button"
              class="show-button"
              @click="showRegisterPassword = !showRegisterPassword"
              data-testid="login-register-toggle-password"
            >
              {{ showRegisterPassword ? 'Hide' : 'Show' }}
            </button>
          </div>
          <p class="field-help">At least 8 characters.</p>
          <label class="field-label" for="register-password-confirm">Confirm password</label>
          <div class="login-input">
            <input
              id="register-password-confirm"
              :type="showRegisterPassword ? 'text' : 'password'"
              v-model="registerPasswordConfirm"
              placeholder=""
              class="password-input"
              required
              data-testid="login-register-password-confirm-input"
            />
          </div>
          <p
            class="error-message"
            role="alert"
            v-show="registerErrorMessage"
            data-testid="login-register-error-message"
          >
            {{ registerErrorMessage }}
          </p>
          <p
            class="success-message"
            role="status"
            v-show="registerSuccessMessage"
            data-testid="login-register-success-message"
          >
            {{ registerSuccessMessage }}
          </p>
          <button type="submit" class="submit-button" data-testid="login-register-submit-button">
            Create account
          </button>
          <p class="field-help">
            We will email you a link to verify this address. You cannot sign in until you have
            followed it.
          </p>
        </form>
      </div>

      <!-- OTP Login Form -->
      <div v-if="mode === 'otp'" class="form-container">
        <h1>Sign in with a code</h1>
        <form
          id="otp-form"
          class="login-form"
          @submit.prevent="otpRequested ? submitOTPLogin() : requestOTP()"
          data-testid="login-otp-form"
        >
          <div class="login-input">
            <input
              id="otp-email"
              type="email"
              v-model="otpEmail"
              placeholder="Email"
              class="email-input"
              required
              :disabled="otpRequested"
              data-testid="login-otp-email-input"
            />
          </div>
          <div v-if="otpRequested" class="login-input">
            <input
              id="otp-code"
              type="text"
              v-model="otpCode"
              placeholder="Enter 6-digit code"
              class="email-input"
              required
              maxlength="6"
              pattern="[0-9]{6}"
              data-testid="login-otp-code-input"
            />
          </div>
          <h3 class="error-message" v-show="otpErrorMessage" data-testid="login-otp-error-message">
            {{ otpErrorMessage }}
          </h3>
          <h3
            class="success-message"
            v-show="otpSuccessMessage"
            data-testid="login-otp-success-message"
          >
            {{ otpSuccessMessage }}
          </h3>
          <button type="submit" class="submit-button" data-testid="login-otp-submit-button">
            {{ otpRequested ? 'Login' : 'Send Code' }}
          </button>
          <div v-if="otpRequested" class="form-links">
            <a
              href="#"
              @click.prevent="
                otpRequested = false;
                otpCode = '';
                otpSuccessMessage = '';
              "
              class="link"
              data-testid="login-otp-different-email-link"
              >Use different email</a
            >
          </div>
        </form>
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

.login-window {
  width: 600px;
  min-height: 600px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
  padding: 60px;
}

.mode-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 30px;
  border-bottom: 2px solid #e0e0e0;
}

.mode-tab {
  flex: 1;
  padding: 12px 20px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  font-size: 16px;
  cursor: pointer;
  color: #666;
  transition: all 0.3s;
}

.mode-tab:hover {
  color: #333;
}

.mode-tab.active {
  color: var(--mm-green);
  border-bottom-color: var(--mm-green);
  font-weight: bold;
}

.form-container {
  display: flex;
  flex-direction: column;
}

.login-form {
  display: flex;
  flex-direction: column;
  padding-top: 20px;
}

/* Persistent labels. Every field was placeholder-only, so its identity - and the password rule -
   vanished the moment the organizer started typing. */
.field-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  margin-top: 22px;
  margin-bottom: -22px;
}

.field-help {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-text-muted);
  margin: 8px 0 0;
}

.login-input {
  height: 60px;
  padding-left: 10px;
  margin-top: 30px;
  border-radius: 8px;
  border: 3px solid rgba(0, 0, 0, 0.4);
  font-size: 20px;
  display: flex;
  flex-direction: row;
  background-color: transparent;
}

.login-input:focus-within {
  border-color: blue;
}

.login-input:has(input:disabled) {
  opacity: 0.6;
  background-color: #f5f5f5;
}

.show-button {
  border: none;
  background-color: transparent;
  width: fit-content;
  padding-right: 20px;
  color: var(--mm-text-muted);
  font-size: 14px;
  cursor: pointer;
  outline: none;
}

.email-input {
  width: auto;
  border: none;
  font-size: 20px;
  flex-grow: 1;
  outline: none;
}

.password-input {
  width: auto;
  border: none;
  font-size: 20px;
  flex-grow: 1;
  outline: none;
}

/* Left-aligned with the form it belongs to. It was right-aligned against a left-aligned form,
   so the eye had to hunt for it. `red` is also not a token; #c0392b reaches AA on white. */
.error-message {
  color: #c0392b;
  text-align: left;
  font-size: 14px;
  margin-top: 10px;
  margin-bottom: 0;
}

.success-message {
  color: green;
  text-align: center;
  font-size: 14px;
  margin-top: 10px;
  margin-bottom: 0;
}

/* 8px, not a 30px pill: every other button in the product is a rounded rectangle, and the fields
   directly above this one are 8px. */
.submit-button {
  height: 60px;
  border-radius: 8px;
  margin-top: 40px;
  background-color: var(--mm-green);
  font-family: 'Outfit Regular';
  color: white;
  font-size: 20px;
  border: none;
  cursor: pointer;
}

.submit-button:hover {
  opacity: 0.9;
}

.form-links {
  margin-top: 20px;
  text-align: center;
}

.link {
  color: var(--mm-text-link);
  text-decoration: none;
  font-size: 14px;
}

.link:hover {
  text-decoration: underline;
}
</style>
