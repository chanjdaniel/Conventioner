---
layer: implementation
kind: adr
describes:
  - front-end/src/main.ts
  - front-end/package.json
  - front-end/src/components/AppDialog.vue
  - front-end/src/components/icons/
  - front-end/src/__tests__/theAppOwnsItsComponents.test.ts
  - front-end/src/__tests__/theLucideNoticeReachesTheBundle.test.ts
  - front-end/src/components/SearchPicker.vue
verified: 2026-10-30
sources:
  - T45
  - E38/F08/S03
status: accepted
---

# The app owns its components

## Context

The front end depended on PrimeVue 4 and PrimeIcons 7, both MIT.
Their next majors are not: PrimeVue 5.0.0 (2026-07-15) and PrimeIcons 8 ship under the proprietary PrimeUI License, whose free Community tier ends at under $1M revenue, fewer than 5 developers and fewer than 10 employees, renewed every 12 months.
PrimeVue's repository says it "receives security fixes only" for 4.x, with no end date and no promise to follow Vue, Vite or TypeScript majors, and the PrimeIcons repository is archived.
So staying meant a frozen library, a Dependabot ignore for each major forever, and the licence question back on the table the first time a new piece was wanted.

What the app used of them was small, and broken.
Two files of the floorplan beta held all of it: three modal dialogs, text and number fields and a two-way choice, plus five icon glyphs in three files.
PrimeVue was installed with no theme, so in production its dialogs drew with no window and no scrim, the two-way choice showed no selected value, and its number field kept Save disabled until the field lost focus.
And the app already owned every one of those pieces: `AppDialog` is the product's one dialog ([dialogs](../implementation/conventions/dialogs.md)), `.field` is its input ([the design language](../design-system.md#the-primitive-layer)), the calibration step already used native radios for a choice like Max Capacity, and the app held its other 26 icons as local SVG components.

## Decision

The app owns its components and its icons, and depends on no component library or icon font.

- A dialog is [`AppDialog`](../../front-end/src/components/AppDialog.vue); a text field is `.field`; a number is a native `<input type="number">`; a choice of a few is native radios in a `<fieldset>` with a `<legend>`.
- An icon is a local SVG component in [`src/components/icons/`](../../front-end/src/components/icons/), drawing in `currentColor`; one copied from an icon set keeps that set's licence beside it and in the bundle the app ships.
  The five Lucide icons (ISC; `trash` also Feather's MIT) keep the full texts in `LICENSE-lucide.txt`, and each carries a `/*! @license` banner, as Lucide's own packages do, which the build keeps because [`vite.config.ts`](../../front-end/vite.config.ts) keeps legal comments when it minifies; [`theLucideNoticeReachesTheBundle.test.ts`](../../front-end/src/__tests__/theLucideNoticeReachesTheBundle.test.ts) builds them with that configuration and reads the notice in the output.
- PrimeVue, PrimeIcons and every `@primevue/*` and `@primeuix/*` package are gone: [`main.ts`](../../front-end/src/main.ts) installs no UI plugin, [`package.json`](../../front-end/package.json) names no UI kit, and [`theAppOwnsItsComponents.test.ts`](../../front-end/src/__tests__/theAppOwnsItsComponents.test.ts) fails if `package.json` or the lockfile brings one back.
- If a screen ever needs a widget that is hard to get right, a combobox, a date picker or a popover menu, the first stop is a headless library such as Reka UI (MIT), styled with the app's own tokens; a data table would be TanStack Table.
  That is a decision for the day a screen needs one, and a styled kit, which brings its own design language, is not.
- The first combobox, the placement dialog's searchable vendor pickers (E38/F08/S03), stays the app's own: [`SearchPicker.vue`](../../front-end/src/components/SearchPicker.vue).
  It was built on Reka UI's Combobox as well, and that version was set aside for three reasons.
  It is a dependency, Reka UI with a second VueUse of its own, for one control of about 150 lines whose roles and keys its unit tests pin.
  It put the entry JavaScript at 99,310 B against the bundle budget's 89,000 B, since the Vue runtime it uses lands in the chunk every first paint loads; the owned picker keeps it at 86,808 B.
  And the behaviour the dialog needs is not what it gives unasked: a search narrows each group and never hides one, where its filter drops a group with no match, and the list opens in the dialog's flow, so the dialog's scroller cannot clip it.
  A date picker or a popover menu, which must place itself over the page, is still a headless library's first.

## Consequences

- No licence or vendor exposure in the UI layer, and 43 kB less gzipped JavaScript and the 633 kB of icon-font files gone from the build.
- Every dialog in the product follows the one dialog rule: Enter submits, Escape and the backdrop close, the page behind is inert, focus lands in the dialog and goes back to what opened it when it closes.
- Keeping legal comments puts the bundled libraries' own `@license` banners (Vue's and others', MIT) back in the bundle too, about 2 kB more gzipped JavaScript in all; their licences ask for that as well.
- The app keeps up nothing but its own code; the cost is that a new kind of control is the app's to build, held to its primitives and the [contrast contract](../design-system.md#the-contrast-contract).
- The dimension fields lost thousands grouping ("1,800" is "1800"), which only PrimeVue's number field gave.
- `everyTokenResolves.test.ts` exempts no library prefix any more: every `var(--x)` is the app's and must resolve.

## Considered and rejected

- **Staying on PrimeVue 4.5.5 and PrimeIcons 7.0.0**: the dialogs stay broken unless a theme is added, the last MIT one being `@primeuix/themes` 4.5.4, and a theme restyles every piece away from the product's look; fixes stop at security ones with no end date.
- **Reka UI and `@lucide/vue` now**: two dependencies and wrappers for four pieces the app already has, and a second dialog beside `AppDialog`, against the product's dialog convention.
- **The OpenVue fork**: a package rename that keeps today's unthemed defects, with two maintainers and three months of history.
- **A styled kit** (Vuetify, Element Plus, Quasar, Naive UI, Nuxt UI, shadcn-vue): each brings its own design language or Tailwind, while the app has [one of its own](../design-system.md).
