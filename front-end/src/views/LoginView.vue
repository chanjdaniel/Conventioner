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
          <button
            type="submit"
            class="btn btn--primary submit-button"
            data-testid="login-submit-button"
          >
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
          <button
            type="submit"
            class="btn btn--primary submit-button"
            data-testid="login-register-submit-button"
          >
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
          <button
            type="submit"
            class="btn btn--primary submit-button"
            data-testid="login-otp-submit-button"
          >
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

/* The card idiom, extracted: --radius-card and the three-layer shadow. The halo it replaces -
   `0 0 4px 5px` - has no offset, so no light source, and a spread larger than its blur is a ring
   rather than a shadow (E16/F05). */
.login-window {
  width: 600px;
  background-color: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: var(--space-8);
}

.mode-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.mode-tab {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--text-sm);
  cursor: pointer;
  color: var(--mm-text-muted);
  transition: color 0.15s ease-in-out;
}

.mode-tab:hover {
  color: var(--mm-black);
}

.mode-tab.active {
  color: var(--mm-green);
  border-bottom-color: var(--mm-green);
  font-weight: 600;
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
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin-top: var(--space-4);
  margin-bottom: var(--space-1);
}

.field-help {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin: var(--space-2) 0 0;
}

/* A composite field: it holds the input and, for passwords, the Show toggle - so it wears
   `.field`'s metrics rather than the class itself. It used to be 60px tall with a 3px border and
   20px text, which is why the auth screens read as a different product (E16/F05). */
/*
 * Two stacked fields need room for their focus rings (E17/F02/S02).
 *
 * `.login-form` is a flex column with no gap, so the sign-in-code form's email and code inputs sat
 * flush against each other - and the ring is `2px` of outline at `2px` of offset, so focusing the
 * code field painted 4px up into the field above it.
 *
 * Adjacent-sibling rather than a gap on the form: a gap would also push each field away from its
 * own label, which belongs against it.
 */
.login-input + .login-input {
  margin-top: var(--space-3);
}

.login-input {
  height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: white;
}

/* `blue` was not a token, and a focus state has to be visible against the page as well as the
   field. Matches the primitives' ring. */
.login-input:focus-within {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.login-input:has(input:disabled) {
  background-color: var(--mm-beige);
  color: var(--mm-text-muted);
}

.show-button {
  border: none;
  background-color: transparent;
  width: fit-content;
  padding: 0 0 0 var(--space-2);
  color: var(--mm-text-link);
  font-size: var(--text-xs);
  cursor: pointer;
}

.email-input {
  width: auto;
  border: none;
  font-size: var(--text-sm);
  flex-grow: 1;
  outline: none;
  background: transparent;
}

.password-input {
  width: auto;
  border: none;
  font-size: var(--text-sm);
  flex-grow: 1;
  outline: none;
  background: transparent;
}

/* Left-aligned with the form it belongs to. It was right-aligned against a left-aligned form,
   so the eye had to hunt for it. `red` is also not a token; var(--mm-red) reaches AA on white. */
.error-message {
  color: var(--mm-red);
  text-align: left;
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  margin-bottom: 0;
}

/* `green` was not a token either, and the keyword renders #008000 - unrelated to anything else
   the product paints. */
.success-message {
  color: var(--mm-green);
  text-align: left;
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  margin-bottom: 0;
}

/* `.btn btn--primary` carries the height, radius, fill, weight, focus ring and disabled state.
   All this adds is the one thing that is local: it spans the form, which gives the page's primary
   action presence without inventing a fourth button height (E16/F05). */
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
