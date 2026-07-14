import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * Refuse to build a bundle that cannot pass the captcha the back end now enforces.
 *
 * The site key is baked into the bundle at build time, and with none, `executeRecaptcha()` has no
 * widget to ask for a token. That used to be harmless: a back end with no reCAPTCHA secret took its
 * dev-bypass path and waved the placeholder token through. The secret is a boot requirement now, so
 * the back end verifies that placeholder against Google, Google says no, and `POST /register`
 * answers 400 - every organizer signup, on a deployment that looks healthy, with nothing anywhere
 * naming the variable. The back-end secret and this site key are a matched pair from one reCAPTCHA
 * property, and a deploy that sets only the first ships a product nobody can sign up for.
 *
 * So the failure lands here, at build time, where it names itself - the same shape as the back end's
 * boot refusal, and for the same reason. The escape hatch is the same one too, opt-in and by the
 * same name: a bundle built without a key only works against a back end that has also been told it
 * is a local development one (`ALLOW_INSECURE_LOCAL_DEV` + `DISABLE_CAPTCHA`).
 */
function assertCaptchaSiteKey(env: Record<string, string>) {
  if (env.VITE_RECAPTCHA_SITE_KEY?.trim()) {
    return
  }
  if (env.VITE_ALLOW_INSECURE_LOCAL_DEV === 'true') {
    console.warn(
      '[captcha] VITE_ALLOW_INSECURE_LOCAL_DEV is set: building a bundle with no reCAPTCHA site ' +
        'key. It sends a placeholder token, which only a back end running with DISABLE_CAPTCHA ' +
        'accepts. Never deploy this bundle.',
    )
    return
  }
  throw new Error(
    'VITE_RECAPTCHA_SITE_KEY is not set, so this bundle would carry no reCAPTCHA site key and ' +
      'send a placeholder token instead. The back end verifies that token against Google, which ' +
      'never issued it, and rejects every registration with a 400 that names none of this - a ' +
      'deployment nobody can sign up for. Set VITE_RECAPTCHA_SITE_KEY to the site key that pairs ' +
      'with the back end\'s RECAPTCHA_SECRET_KEY (https://www.google.com/recaptcha/admin), or set ' +
      'VITE_ALLOW_INSECURE_LOCAL_DEV=true if this build is only ever going to talk to a local ' +
      'back end running with DISABLE_CAPTCHA.',
  )
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')

  if (command === 'build') {
    assertCaptchaSiteKey(env)
  }

  return {
    plugins: [
      vue(),
      vueJsx(),
      vueDevTools(),
    ],
    define: {
      "process.env": process.env,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    server: {
      hmr: true,
      watch: {
        usePolling: true
      },
      proxy: {
        '/api': {
          target: process.env.VITE_BACKEND_URL || 'https://127.0.0.1:5000',
          changeOrigin: true,
          secure: false, // Ignore SSL certificate errors (needed for adhoc cert)
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    }
  }
});
