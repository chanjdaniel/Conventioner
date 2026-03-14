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
    throw new Error('RECAPTCHA_SITE_KEY is not configured');
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
