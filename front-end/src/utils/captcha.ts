/**
 * reCAPTCHA v3 utility for frontend integration
 */

declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
const RECAPTCHA_SCRIPT_URL = 'https://www.google.com/recaptcha/api.js?render=' + RECAPTCHA_SITE_KEY;

/**
 * The token a build with no site key sends. Only a back end running with `DISABLE_CAPTCHA` accepts
 * it; the back end refuses to boot without a reCAPTCHA secret otherwise, and Google - which never
 * issued this - fails it, so every registration comes back 400.
 */
const PLACEHOLDER_TOKEN = 'e2e-test-captcha-token';

/**
 * A build that has declared itself a local development one. `vite build` refuses a missing site key
 * unless this is set (see vite.config.ts), so this is the only way a keyless bundle exists at all -
 * and the dev server, which e2e drives, is a local development process by definition.
 */
const INSECURE_LOCAL_DEV =
  import.meta.env.DEV || import.meta.env.VITE_ALLOW_INSECURE_LOCAL_DEV === 'true';

let scriptLoaded = false;
let scriptLoading = false;

/**
 * Load reCAPTCHA v3 script dynamically
 */
function loadRecaptchaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (scriptLoaded) {
      resolve();
      return;
    }

    if (scriptLoading) {
      // Wait for existing load
      const checkInterval = setInterval(() => {
        if (scriptLoaded) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      return;
    }

    scriptLoading = true;

    // Check if script already exists
    const existingScript = document.querySelector(`script[src="${RECAPTCHA_SCRIPT_URL}"]`);
    if (existingScript) {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = RECAPTCHA_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
    };

    script.onerror = () => {
      scriptLoading = false;
      reject(new Error('Failed to load reCAPTCHA script'));
    };

    document.head.appendChild(script);
  });
}

/**
 * Execute reCAPTCHA v3 and get token
 * @param action - Action name for reCAPTCHA (e.g., 'register', 'login')
 * @returns Promise resolving to reCAPTCHA token
 */
export async function executeRecaptcha(action: string): Promise<string> {
  if (!RECAPTCHA_SITE_KEY) {
    if (!INSECURE_LOCAL_DEV) {
      // Unreachable: `vite build` refuses to produce this bundle. Reached only by a build that
      // skipped that check, and a placeholder token is not a token - sending it would have the back
      // end verify it against Google and reject the registration with a 400 naming none of this.
      throw new Error(
        'VITE_RECAPTCHA_SITE_KEY is not configured, so there is no captcha to solve. Set it to the ' +
          "site key that pairs with the back end's RECAPTCHA_SECRET_KEY.",
      );
    }
    // A local development build: the site key is intentionally empty, and the back end it talks to
    // is running with DISABLE_CAPTCHA, which is the only thing that accepts this token.
    console.warn('VITE_RECAPTCHA_SITE_KEY is not configured; using placeholder token');
    return PLACEHOLDER_TOKEN;
  }

  try {
    await loadRecaptchaScript();

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(() => {
        window.grecaptcha
          .execute(RECAPTCHA_SITE_KEY, { action })
          .then((token: string) => {
            resolve(token);
          })
          .catch((error: Error) => {
            reject(error);
          });
      });
    });
  } catch (error) {
    throw new Error(`Failed to execute reCAPTCHA: ${error}`);
  }
}
