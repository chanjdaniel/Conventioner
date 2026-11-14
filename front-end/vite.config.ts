import { readFileSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig, loadEnv, normalizePath, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import vueDevTools from 'vite-plugin-vue-devtools';

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
    return;
  }
  if (env.VITE_ALLOW_INSECURE_LOCAL_DEV === 'true') {
    console.warn(
      '[captcha] VITE_ALLOW_INSECURE_LOCAL_DEV is set: building a bundle with no reCAPTCHA site ' +
        'key. It sends a placeholder token, which only a back end running with DISABLE_CAPTCHA ' +
        'accepts. Never deploy this bundle.',
    );
    return;
  }
  throw new Error(
    'VITE_RECAPTCHA_SITE_KEY is not set, so this bundle would carry no reCAPTCHA site key and ' +
      'send a placeholder token instead. The back end verifies that token against Google, which ' +
      'never issued it, and rejects every registration with a 400 that names none of this - a ' +
      'deployment nobody can sign up for. Set VITE_RECAPTCHA_SITE_KEY to the site key that pairs ' +
      "with the back end's RECAPTCHA_SECRET_KEY (https://www.google.com/recaptcha/admin), or set " +
      'VITE_ALLOW_INSECURE_LOCAL_DEV=true if this build is only ever going to talk to a local ' +
      'back end running with DISABLE_CAPTCHA.',
  );
}

/**
 * Refuse to build a bundle with no API address (T273).
 *
 * `VITE_FLASK_HOST` is baked into the bundle at build time as the base of every API request. With
 * none, each request goes to the front end's own origin, whose rewrite answers every path with
 * `index.html` and 200, so the deployment looks healthy and nothing works. The hatch is the site
 * key's: a bundle built under `VITE_ALLOW_INSECURE_LOCAL_DEV` warns and builds, as CI's and the
 * gate's builds do.
 */
function assertApiHost(env: Record<string, string>) {
  if (env.VITE_FLASK_HOST?.trim()) {
    return;
  }
  if (env.VITE_ALLOW_INSECURE_LOCAL_DEV === 'true') {
    console.warn(
      '[api] VITE_ALLOW_INSECURE_LOCAL_DEV is set: building a bundle with no VITE_FLASK_HOST. It ' +
        'calls its own origin. Never deploy this bundle.',
    );
    return;
  }
  throw new Error(
    'VITE_FLASK_HOST is not set, so this bundle would send every API request to its own origin, ' +
      "where every path answers index.html with 200 and nothing works. Set it to the back end's " +
      'address (https://api.conventioner.io in production), or set ' +
      'VITE_ALLOW_INSECURE_LOCAL_DEV=true if this build only ever talks to a local back end.',
  );
}

/**
 * Refuse the hatch on a Vercel build outright (T273): it lets a bundle build with no site key and
 * no API address, and a build Vercel makes is one that may be served. Vercel's build sets
 * `VERCEL=1` while the project's "Enable access to System Environment Variables" setting is ticked,
 * and not otherwise, so the refusal is armed only with that box ticked. It is not a `VITE_`
 * variable, so it is read from the build's process environment, as `BUILD_COMMIT` is, and no `.env`
 * file can set it.
 */
function assertNoLocalHatchOnVercel(env: Record<string, string>) {
  if (!process.env.VERCEL?.trim() || env.VITE_ALLOW_INSECURE_LOCAL_DEV !== 'true') {
    return;
  }
  throw new Error(
    'VITE_ALLOW_INSECURE_LOCAL_DEV is set on a Vercel build. It lets a bundle build with no ' +
      'reCAPTCHA site key or API address, which a deployed front end must never ship. Remove it ' +
      "from the front-end project's environment on Vercel.",
  );
}

/**
 * The headers `vercel.json` sends on every path, so `vite preview` serves a production build under
 * the same security headers and Content-Security-Policy as production does. `vercel.json` is the one
 * place they are declared; walk a page with `npm run build-only && npm run preview` to see what the
 * policy refuses there.
 */
function deployedHeaders(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const everyPath = vercel.headers.find((rule) => rule.source === '/(.*)');
  return Object.fromEntries((everyPath?.headers ?? []).map(({ key, value }) => [key, value]));
}

/**
 * vuedraggable's own ES source, which it publishes beside its builds. Its builds are webpack UMD
 * bundles carrying core-js, whose global lookup runs `Function('return this')()`: a string
 * evaluated as script, which the Content-Security-Policy refuses (and reported on every page with a
 * drag list). The source is the same component without that, importing SortableJS's ES build.
 */
export const VUEDRAGGABLE_SOURCE = {
  find: /^vuedraggable$/,
  replacement: 'vuedraggable/src/vuedraggable.js',
};

/** A module of Vue (its `@vue/` packages included), the router or Pinia, by its id. */
const VUE_RUNTIME = /[\\/]node_modules[\\/](@vue|vue|vue-router|pinia)[\\/]/;

/** The id `@vitejs/plugin-vue` gives the helper it imports into every single-file component. */
const VUE_SFC_HELPER = '\0plugin-vue:export-helper';

/**
 * `src/dev/` spelled as Vite spells a module id, so they compare: its real path, since Vite resolves
 * every id through symbolic links, and with `/` for a separator, as Vite writes ids on Windows too.
 */
const DEV_DIR = `${normalizePath(realpathSync(fileURLToPath(new URL('./src/dev/', import.meta.url))))}/`;

/**
 * No development page ships (T200): a production build fails when any module of the component
 * library, `src/dev/`, is in any chunk it emits, and names each chunk and module.
 *
 * The library is reached only through the router's `if (import.meta.env.DEV)` block, which a
 * production build drops with its lazy imports. Anything else that reaches `src/dev/` (a shipped
 * file importing the fixture's synthetic applicants or a part, by any path, or that block kept
 * alive) puts it in a chunk, and this is where it is caught, on every production build: CI's, the
 * gate's and the deploy's. ESLint's `app/dev-pages-stay-out` refuses the import before it is built.
 */
export function noDevModules(): Plugin {
  let production = false;
  let root = '';
  return {
    name: 'conventioner:no-dev-modules',
    apply: 'build',
    configResolved(config) {
      production = config.isProduction;
      root = config.root;
    },
    generateBundle(_options, bundle) {
      if (!production) return;
      const found = Object.values(bundle).flatMap((output) => {
        if (output.type !== 'chunk') return [];
        const modules = new Set(
          output.moduleIds
            .filter((id) => id.startsWith(DEV_DIR))
            .map((id) => relative(root, id.split('?')[0]!)),
        );
        return [...modules].map((module) => `  ${output.fileName}: ${module}`);
      });
      if (found.length === 0) return;
      this.error(
        [
          'The component library, a development build only, is in this production build:',
          ...found,
          'Only the router may reach src/dev/, inside `if (import.meta.env.DEV)`, by a lazy ' +
            'import(); find what reaches it another way and remove it.',
        ].join('\n'),
      );
    },
  };
}

/**
 * Every build says which commit it was built from (T254): it emits `version.json` at the root of
 * its output, `{"commit":"<sha>"}`, or `{"commit":null}` for a build made without one (CI's, the
 * gate's, a local one), so it is never mistaken for a released commit.
 *
 * The Deploy workflow reads it, on the staged deployment and then on `conventioner.io`, to prove
 * the domain serves the commit it released; a person reads it with
 * `curl https://conventioner.io/version.json` to learn which build is live. The workflow sets
 * `BUILD_COMMIT` with `vercel deploy --build-env`, and this reads it from the build's process
 * environment. It is not a `VITE_` variable, and not read through `loadEnv`, so it is never inlined
 * into the bundle, a new commit leaves every chunk's hash as it was, and no `.env` file can set it.
 */
export function buildCommit(): Plugin {
  return {
    name: 'conventioner:build-commit',
    apply: 'build',
    generateBundle() {
      const commit = process.env.BUILD_COMMIT;
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit: commit?.trim() ? commit : null }),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');

  if (command === 'build') {
    assertNoLocalHatchOnVercel(env);
    assertCaptchaSiteKey(env);
    assertApiHost(env);
  }

  return {
    plugins: [vue(), vueJsx(), vueDevTools(), noDevModules(), buildCommit()],
    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        VUEDRAGGABLE_SOURCE,
      ],
    },
    build: {
      rolldownOptions: {
        output: {
          // Licence notices survive minifying, which drops every comment by default: the copied
          // Lucide icons carry ISC's notice as a `/*! @license */` comment, and that licence (like
          // the MIT notices of the libraries bundled here) asks for it in all copies.
          comments: { legal: true, annotation: false, jsdoc: false },
          // Vue, its router and Pinia, which every page runs, as a chunk named for them. Left to
          // itself the build named that shared chunk `_plugin-vue_export-helper`, after the helper
          // the Vue plugin adds to every single-file component, which read as one helper rather
          // than the runtime; the helper goes in with them, so it is no chunk of its own either.
          codeSplitting: {
            groups: [{ name: 'vue', test: (id) => VUE_RUNTIME.test(id) || id === VUE_SFC_HELPER }],
          },
        },
      },
    },
    server: {
      // Where every local URL points (T48). Left to `localhost`, Vite listens on ::1 alone, which
      // nothing dialling 127.0.0.1 reaches. The container's `--host 0.0.0.0` overrides it.
      host: '127.0.0.1',
      hmr: true,
      watch: {
        usePolling: true,
        // A test run's own output is not the app. Watched, the report Playwright writes at the end
        // of a run reloaded every page open on this server, a developer's included.
        ignored: ['**/test-results/**', '**/playwright-report/**', '**/blob-report/**'],
      },
      proxy: {
        '/api': {
          target: process.env.VITE_BACKEND_URL || 'https://127.0.0.1:5001',
          changeOrigin: true,
          secure: false, // Ignore SSL certificate errors (needed for adhoc cert)
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      headers: deployedHeaders(),
    },
  };
});
