import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**'],
  },

  pluginVue.configs['flat/essential'],
  {
    // No template renders raw HTML, so an applicant's text always reaches the page escaped;
    // this keeps it that way. `flat/recommended` would only warn, and would bring other rules.
    name: 'app/no-raw-html',
    rules: { 'vue/no-v-html': 'error' },
  },
  {
    // The component library (`src/dev/`) is a development build's only, and the router's
    // development block is its one way in: anything else importing it would bundle it into
    // production, where `scripts/no-dev-pages.ts` would then fail the build.
    name: 'app/dev-pages-stay-out',
    files: ['**/*.{ts,mts,tsx,vue}'],
    ignores: ['src/dev/**', 'src/router/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/dev', '@/dev/*'],
              message:
                'src/dev/ is the development-only component library: only the router reaches it, inside `if (import.meta.env.DEV)`.',
            },
          ],
        },
      ],
    },
  },
  vueTsConfigs.recommended,
  skipFormatting,
);
