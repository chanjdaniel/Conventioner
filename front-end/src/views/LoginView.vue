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
      errorMessage.value = error.response.data?.message || 'Invalid credentials';
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
          Login
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
          Use OTP
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
          <div class="login-input">
            <input
              id="email"
              type="email"
              v-model="email"
              placeholder="Email"
              class="email-input"
              required
              data-testid="login-email-input"
            />
          </div>
          <div class="login-input">
            <input
              id="password"
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder="Password"
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
          <h3 class="error-message" v-show="errorMessage" data-testid="login-error-message">
            {{ errorMessage }}
          </h3>
          <button type="submit" class="submit-button" data-testid="login-submit-button">
            Login
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
          <div class="login-input">
            <input
              id="register-email"
              type="email"
              v-model="registerEmail"
              placeholder="Email"
              class="email-input"
              required
              data-testid="login-register-email-input"
            />
          </div>
          <div class="login-input">
            <input
              id="register-password"
              :type="showRegisterPassword ? 'text' : 'password'"
              v-model="registerPassword"
              placeholder="Password (min 8 characters)"
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
          <div class="login-input">
            <input
              id="register-password-confirm"
              :type="showRegisterPassword ? 'text' : 'password'"
              v-model="registerPasswordConfirm"
              placeholder="Confirm password"
              class="password-input"
              required
              data-testid="login-register-password-confirm-input"
            />
          </div>
          <h3
            class="error-message"
            v-show="registerErrorMessage"
            data-testid="login-register-error-message"
          >
            {{ registerErrorMessage }}
          </h3>
          <h3
            class="success-message"
            v-show="registerSuccessMessage"
            data-testid="login-register-success-message"
          >
            {{ registerSuccessMessage }}
          </h3>
          <button type="submit" class="submit-button" data-testid="login-register-submit-button">
            Register
          </button>
        </form>
      </div>

      <!-- OTP Login Form -->
      <div v-if="mode === 'otp'" class="form-container">
        <h1>Login with OTP</h1>
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
  color: var(--mm-green, #4caf50);
  border-bottom-color: var(--mm-green, #4caf50);
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
  color: grey;
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

.error-message {
  color: red;
  text-align: right;
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

.submit-button {
  height: 60px;
  border-radius: 30px;
  margin-top: 40px;
  background-color: var(--mm-green, #4caf50);
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
  color: #2196f3;
  text-decoration: none;
  font-size: 14px;
}

.link:hover {
  text-decoration: underline;
}
</style>
