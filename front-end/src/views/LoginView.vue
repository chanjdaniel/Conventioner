<script setup lang="ts">
import axios from 'axios';
import { computed, ref, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import SignInMessage from '@/components/SignInMessage.vue';
import { SESSION_ENDED_MESSAGE } from '@/utils/api';
import { executeRecaptcha } from '@/utils/captcha';
import { refusedSignIn, resentLink, type SignInNotice } from '@/utils/signInNotice';
import { safeNext } from '@/utils/signInNext';

const hostname = import.meta.env.VITE_FLASK_HOST;

const router = useRouter();
const route = useRoute();

/**
 * Where a sign-in continues to (E38/F11/S01): the page a signed-out link or an ended session was
 * on, when it is one of this app's, else the dashboard.
 */
const afterSignIn = computed(() => safeNext(route.query.next) ?? '/dashboard');
/** Brought here by a session that ended mid-work, which is said rather than left to guess. */
const sessionEnded = computed(() => route.query.ended === '1');

// Mode: 'login' | 'register' | 'otp'
type Mode = 'login' | 'register' | 'otp';
const mode = ref<Mode>('login');

/** The ways in, in tab order; `testid` keeps the ids the specs already address them by. */
const MODE_TABS: ReadonlyArray<{ mode: Mode; label: string; testid: string }> = [
  { mode: 'login', label: 'Sign in', testid: 'login' },
  { mode: 'register', label: 'Register', testid: 'register' },
  { mode: 'otp', label: 'Sign-in code', testid: 'otp' },
];

/** Open a way in, with nothing carried over from the last one. */
function selectMode(next: Mode) {
  mode.value = next;
  loginNotice.value = null;
  registerErrorMessage.value = '';
  otpNotice.value = null;
  if (next === 'otp') otpRequested.value = false;
}

/** The tab pattern's keys: arrows move to the next or previous tab and open it, Home and End to
 * the ends; focus follows, since only the open tab is in the tab order. */
function onTabKey(event: KeyboardEvent) {
  const at = MODE_TABS.findIndex((tab) => tab.mode === mode.value);
  const last = MODE_TABS.length - 1;
  const to =
    event.key === 'ArrowRight'
      ? (at + 1) % MODE_TABS.length
      : event.key === 'ArrowLeft'
        ? (at + last) % MODE_TABS.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;
  if (to === null) return;
  event.preventDefault();
  selectMode(MODE_TABS[to].mode);
  void nextTick(() => document.getElementById(`login-tab-${MODE_TABS[to].mode}`)?.focus());
}

// Login fields
const email = ref('');
const password = ref('');
/** The password form's one line (E38/F14/S02): a newer one replaces it. */
const loginNotice = ref<SignInNotice | null>(null);
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
const otpRequested = ref(false);
/** The code form's one line: "code sent", then a wrong code's in its place, never both. */
const otpNotice = ref<SignInNotice | null>(null);

/** Start the code form again with another address, saying nothing of the last one. */
function useADifferentEmail() {
  otpRequested.value = false;
  otpCode.value = '';
  otpNotice.value = null;
}

/** The address a sign-in was refused for as unverified, which "Send the link again" sends to. */
const unverifiedAddress = ref('');
/** A link on its way, so a double click sends one. */
const resending = ref(false);

/** Remember the address of a refusal that offers the link again, for the button to send to. */
function noticeOf(refusal: SignInNotice, address: string): SignInNotice {
  if (refusal.next === 'resend') unverifiedAddress.value = address;
  return refusal;
}

/**
 * "Send the link again" (E38/F14/S02): asks for the verification link for the address that was
 * refused, and then says one link is on its way, whatever the server said of the address.
 */
async function resendVerification(form: 'login' | 'otp') {
  if (resending.value) return;
  const notice = form === 'login' ? loginNotice : otpNotice;
  resending.value = true;
  try {
    await axios.post(
      `${hostname}/resend-verification`,
      { email: unverifiedAddress.value },
      { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
    );
    notice.value = resentLink(null);
  } catch (err: unknown) {
    notice.value = resentLink(err);
  } finally {
    resending.value = false;
  }
}

/**
 * "Remember me" (E38/F14/S01): one choice for both sign-ins, so it holds when switching between the
 * password and the code, and unticked until ticked. The server decides what it means: without it
 * the sign-in ends with the browser or 12 hours after it, with it 30 days after it.
 */
const remember = ref(false);
/** What the choice does, said under it: the door's laptop is often a shared one. */
const REMEMBER_ME_HELP =
  'Keeps you signed in on this device for 30 days. Leave it unticked on a shared one.';

const submitLogin = async () => {
  loginNotice.value = null;
  const address = email.value;

  try {
    const response = await axios.post(
      `${hostname}/login`,
      {
        email: email.value,
        password: password.value,
        remember: remember.value,
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
      router.push(afterSignIn.value);
    }
  } catch (err: unknown) {
    loginNotice.value = noticeOf(
      refusedSignIn(err, 'That email and password do not match.', { mismatchOffersReset: true }),
      address,
    );
  }
};

/**
 * A signup in flight (E32/F03/S04). A double click sent two, and before the server held one
 * account per address that made two accounts and two verification emails. The form's submit is
 * the one way in (Enter and the button alike), so guarding it here guards both.
 */
const registering = ref(false);

const submitRegister = async () => {
  if (registering.value) return;
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

  registering.value = true;
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
  } finally {
    registering.value = false;
  }
};

const requestOTP = async () => {
  otpNotice.value = null;
  const address = otpEmail.value;

  if (!address) {
    otpNotice.value = { tone: 'error', text: 'Enter your email address.' };
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
      otpNotice.value = {
        tone: 'success',
        text: response.data.msg || 'A sign-in code has been sent to your email.',
      };
    }
  } catch (err: unknown) {
    otpNotice.value = noticeOf(
      refusedSignIn(err, 'The sign-in code could not be sent. Please try again.'),
      address,
    );
  }
};

const submitOTPLogin = async () => {
  const address = otpEmail.value;

  if (!address || !otpCode.value) {
    otpNotice.value = { tone: 'error', text: 'Enter your email address and the code.' };
    return;
  }

  try {
    const response = await axios.post(
      `${hostname}/login-otp`,
      {
        email: otpEmail.value,
        otp: otpCode.value,
        remember: remember.value,
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
      router.push(afterSignIn.value);
    }
  } catch (err: unknown) {
    otpNotice.value = noticeOf(refusedSignIn(err, 'That code is not right.'), address);
  }
};
</script>

<template>
  <AuthCard>
    <p v-if="sessionEnded" class="session-ended" role="status" data-testid="login-session-ended">
      {{ SESSION_ENDED_MESSAGE }}
    </p>
    <!--
        A tab list, not a row of buttons (bug 44): the three ways in are announced as tabs of one
        set, the open one as selected, and the arrow keys move between them as on any tab list.
      -->
    <div class="mode-tabs" role="tablist" aria-label="How to sign in">
      <button
        v-for="tab in MODE_TABS"
        :id="`login-tab-${tab.mode}`"
        :key="tab.mode"
        type="button"
        role="tab"
        class="mode-tab"
        :class="{ active: mode === tab.mode }"
        :aria-selected="mode === tab.mode"
        :aria-controls="`login-panel-${tab.mode}`"
        :tabindex="mode === tab.mode ? 0 : -1"
        :data-testid="`login-tab-${tab.testid}`"
        @click="selectMode(tab.mode)"
        @keydown="onTabKey"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Login Form -->
    <div
      v-if="mode === 'login'"
      id="login-panel-login"
      class="form-container"
      role="tabpanel"
      aria-labelledby="login-tab-login"
    >
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
            autocomplete="username"
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
            autocomplete="current-password"
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
        <SignInMessage
          :notice="loginNotice"
          testid-prefix="login"
          :sending="resending"
          @resend="resendVerification('login')"
        />
        <label class="remember-me">
          <input
            v-model="remember"
            type="checkbox"
            aria-describedby="remember-me-help"
            data-testid="login-remember-me"
          />
          Remember me
        </label>
        <p id="remember-me-help" class="field-help remember-me-help">{{ REMEMBER_ME_HELP }}</p>
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
            class="link-alone"
            data-testid="login-forgot-password-link"
            >Forgot password?</a
          >
        </div>
      </form>
    </div>

    <!-- Registration Form -->
    <div
      v-if="mode === 'register'"
      id="login-panel-register"
      class="form-container"
      role="tabpanel"
      aria-labelledby="login-tab-register"
    >
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
            autocomplete="username"
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
            autocomplete="new-password"
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
            autocomplete="new-password"
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
          :disabled="registering"
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
    <div
      v-if="mode === 'otp'"
      id="login-panel-otp"
      class="form-container"
      role="tabpanel"
      aria-labelledby="login-tab-otp"
    >
      <h1>Sign in with a code</h1>
      <form
        id="otp-form"
        class="login-form"
        @submit.prevent="otpRequested ? submitOTPLogin() : requestOTP()"
        data-testid="login-otp-form"
      >
        <label class="field-label" for="otp-email">Email</label>
        <div class="login-input">
          <input
            id="otp-email"
            type="email"
            v-model="otpEmail"
            placeholder="you@example.com"
            class="email-input"
            autocomplete="username"
            required
            :disabled="otpRequested"
            data-testid="login-otp-email-input"
          />
        </div>
        <!-- Named, not only hinted: the placeholder went the moment typing started (bug 44). -->
        <label v-if="otpRequested" class="field-label" for="otp-code">Sign-in code</label>
        <div v-if="otpRequested" class="login-input">
          <input
            id="otp-code"
            type="text"
            v-model="otpCode"
            placeholder="6 digits"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="email-input"
            required
            maxlength="6"
            pattern="[0-9]{6}"
            data-testid="login-otp-code-input"
          />
        </div>
        <SignInMessage
          :notice="otpNotice"
          testid-prefix="login-otp"
          :sending="resending"
          @resend="resendVerification('otp')"
        />
        <template v-if="otpRequested">
          <label class="remember-me">
            <input
              v-model="remember"
              type="checkbox"
              aria-describedby="otp-remember-me-help"
              data-testid="login-otp-remember-me"
            />
            Remember me
          </label>
          <p id="otp-remember-me-help" class="field-help remember-me-help">
            {{ REMEMBER_ME_HELP }}
          </p>
        </template>
        <button
          type="submit"
          class="btn btn--primary submit-button"
          data-testid="login-otp-submit-button"
        >
          {{ otpRequested ? 'Sign in' : 'Send code' }}
        </button>
        <div v-if="otpRequested" class="form-links">
          <a
            href="#"
            @click.prevent="useADifferentEmail"
            class="link-alone"
            data-testid="login-otp-different-email-link"
            >Use a different email</a
          >
        </div>
      </form>
    </div>
  </AuthCard>
</template>

<style scoped>
.mode-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

/* Equal thirds wherever they fit; on a phone a third is narrower than "Sign-in code", which
   wrapped to two lines, so no tab wraps and the longest takes the room it needs. The tabs' text is
   centred in them, so their side padding only matters there, and 8px lets all three fit (T73). */
.mode-tab {
  flex: 1;
  padding: var(--space-3) var(--space-2);
  white-space: nowrap;
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
  padding-top: var(--space-4);
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
 * Two stacked fields keep room between them (E17/F02/S02).
 *
 * `.login-form` is a flex column with no gap, so the sign-in-code form's email and code inputs sat
 * flush against each other, two borders reading as one box.
 *
 * Adjacent-sibling rather than a gap on the form: a gap would also push each field away from its
 * own label, which belongs against it.
 */
.login-input + .login-input {
  margin-top: var(--space-3);
}

.login-input {
  /* The input inside is the target, and it is this box less its border: a desk's box is a control's
     height, and on a phone the input itself reaches `--target-min`, so the box is 2px taller (T82). */
  box-sizing: content-box;
  height: max(calc(var(--control-height) - 2px), var(--target-min));
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: row;
  /* Stretched, so the input and its Show button fill the box drawn around them: centred, they were
     20px and 15px tall, under the 24px a phone's tap needs (WCAG 2.5.8, T79). */
  align-items: stretch;
  background-color: white;
}

.login-input:has(input:disabled) {
  background-color: var(--mm-beige);
  color: var(--mm-text-muted);
}

.show-button {
  border: none;
  background-color: transparent;
  width: fit-content;
  min-width: var(--target-min);
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

/* The choice and its label are one target, at least `--target-min` tall (44px on a phone), and
   only as wide as its words, so a tap beside it does not tick it. */
.remember-me {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.remember-me-help {
  margin-top: 0;
}

/* Why they are here, before anything is asked of them: a fact, in the attention chip's tint. */
.session-ended {
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  color: var(--mm-black);
  font-size: var(--text-sm);
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

/* `.btn btn--primary` carries the height, radius, fill, weight, focus halo and disabled state.
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
</style>
