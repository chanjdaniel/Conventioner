/**
 * The design language's gate (`npm run lint:css`; `docs/design-system.md#what-keeps-this-true`).
 *
 * Every rule is an error in every file, and `lint:css` passes `--max-warnings 0` too: a warning on
 * old code lands on whichever later change touches the file. A legitimate value the patterns refuse
 * widens them; only the floorplan beta's own values and a value that is not spacing carry a
 * `stylelint-disable`, with its reason on that declaration, and a disable with no reason or nothing
 * to disable is refused too.
 *
 * A module rather than JSON (T82) so the spacing patterns are built once, from named parts, rather
 * than one 300-character regex written four times; `src/__tests__/spacingScale.test.ts` runs this
 * file over what it allows and refuses.
 */

/** The spacing scale's tokens, and the two lengths laid out beside it. */
const TOKEN = String.raw`var\(--(?:space-(?:1|2|3|4|6|8|12|hairline)|card-grid-gap|banner-h)\)`;
/** A phone's safe area: the room a notch or a home bar takes, with an optional fallback. */
const SAFE_AREA = String.raw`env\(safe-area-inset-(?:top|right|bottom|left)(?:,\s*(?:0|${TOKEN}))?\)`;
/** What a sum or a function may be made of: the scale and the safe area, never a bare number. */
const OPERAND = `(?:${TOKEN}|${SAFE_AREA})`;
/** A negated token, or a sum of tokens. `calc(var(--space-1) * 1.5)` is a raw 6px. */
const CALC = String.raw`calc\((?:-1 \* ${TOKEN}|${OPERAND}(?: \+ ${OPERAND})+)\)`;
/** The larger, the smaller or a clamp of the same: `max(var(--space-4), env(safe-area-inset-left))`. */
const COMPARE = String.raw`(?:max|min|clamp)\((?:0|${OPERAND}|${CALC})(?:,\s*(?:0|${OPERAND}|${CALC}))+\)`;
/** A CSS-wide keyword, which is the whole value or nothing. */
const KEYWORD = '(?:inherit|initial|unset|revert|revert-layer)';

/** A value of one or more terms, each set apart by whitespace (`0auto` is no value), or a keyword. */
const values = (...terms) => {
  const term = `(?:${terms.join('|')})`;
  return new RegExp(String.raw`^(?:${KEYWORD}|${term}(?:\s+${term})*)$`);
};

const SPACED = ['0', TOKEN, SAFE_AREA, CALC, COMPARE];
/** `auto` centres a margin; on a padding or a gap it is invalid. */
const MARGIN = values(...SPACED, 'auto');
/** A percentage padding keeps a box's proportions as it scales. */
const PADDING = values(...SPACED, String.raw`\d+(?:\.\d+)?%`);
const GAP = values(...SPACED);

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-html/vue'],
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  rules: {
    'color-no-hex': [
      true,
      {
        message:
          'Use a --mm-* token from base.css. 351 hardcoded colours, nine reds for one semantic role, and a red that could not carry white text is how the product got here (E16/F02).',
      },
    ],
    'declaration-property-value-disallowed-list': [
      {
        '/^font-size$/': ['/^[0-9.]+(px|rem|em)$/'],
        '/^border-radius$/': ['/^[0-9.]+(px|rem)/', '/^[0-9.]+%(?<!50%)/'],
        '/^box-shadow$/': ['/^(?!var\\(|none)/'],
      },
      {
        message:
          'Use a scale token from base.css - --text-*, --radius-*, --shadow-card. See docs/design-system.md.',
      },
    ],
    'declaration-property-value-allowed-list': [
      {
        '/^margin(-[a-z-]+)?$/': [MARGIN],
        '/^padding(-[a-z-]+)?$/': [PADDING],
        '/^(grid-)?(row-|column-)?gap$/': [GAP],
      },
      {
        message:
          'Use a --space-* token from base.css - or 0, --space-hairline, --card-grid-gap, --banner-h, a negated token or a sum of them in calc(), env(safe-area-inset-*), max()/min()/clamp() over them, auto on a margin, a percentage on a padding, or a CSS-wide keyword. See docs/design-system.md#spacing.',
      },
    ],
  },
  ignoreFiles: ['dist/**', 'node_modules/**', 'src/assets/base.css', 'src/assets/primitives.css'],
};
