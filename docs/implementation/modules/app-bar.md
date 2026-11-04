---
layer: implementation
kind: module
describes:
  - front-end/src/components/AppBar.vue
  - front-end/src/utils/currentPlace.ts
  - front-end/src/utils/sessionEnded.ts#signOut
  - front-end/e2e/the-app-bar.spec.ts
  - front-end/src/__tests__/theBarsCurrentPlace.test.ts
verified: 2026-11-04
sources:
  - T209
---

# The app bar

[`AppBar`](../../../front-end/src/components/AppBar.vue) is the way between the organizer's places, always in sight and always the same.
`App.vue` renders it once, in its sticky `header`; the [market bar](market-frame.md), the black band beneath it on a market screen, is the market's own navigation and stays separate.

## What it holds

**A fixed 44px white band with a thin line under it and no shadow.**
`--banner-h` is `44px` at every window size, and everything sticky reads the token, so nothing measures the bar.
Its `--space-4` of side padding lines the logo up with the market frame's card edge and the phone's gutter.

**The whole logo, 26px tall, leads to Markets.**
On an organizer's page it is a link named "Conventioner, Markets"; on a public page it is an image with no link.

**Markets and Organizations are links in a `nav` named "Main".**
Each is the band's full height; the current one is `--mm-green`, semibold, with a 2px underline over the band's line, and carries `aria-current="page"`.
Every link holds its heavier words' width open, so moving between the places never nudges the link beside it.

**Which place is current is one pure function of the route**, [`currentPlace`](../../../front-end/src/utils/currentPlace.ts): a route with a `marketId` param or named `markets` is Markets, `organizations` is Organizations, and any other route has none.
A new market screen needs nothing there; [`theBarsCurrentPlace.test.ts`](../../../front-end/src/__tests__/theBarsCurrentPlace.test.ts) reads it off the router's own routes.

**The account menu is `RowMenu` with its `trigger` slot.**
The button shows the address and a chevron, 32px tall and at most 260px wide; the address gives way first when the window is short of room, cut with an ellipsis, with its whole value as a `title` on the words.
The words name the button, as [every control is named](../conventions/every-control-is-named.md#the-rules) asks, so `RowMenu`'s `label` then names the open menu alone.
It holds Sign out.

## Sign out

**[`signOut`](../../../front-end/src/utils/sessionEnded.ts) is the one sign-out of the bar and the drawer**, beside `endSession`.
It posts `/logout`, then forgets `localStorage` and the market store and goes to `/login`, whether or not the post succeeded, so a sign-out that failed on the wire still leaves this browser signed out.
It uses `fetch`, not the app's `axios`, so a 401 from `/logout` is not told as a session that ended under the organizer.

## Sharp edges

**The break is the market frame's, `width <= 640px`, in CSS**, so the two layouts never disagree with the frame's.
At 640px and below the links and the account menu are hidden, and the menu button opens the old navigation drawer in `App.vue`.

**A public page shows the logo alone**, signed in or not, read off the route's `meta.public`.

**`App.vue` starts `user` empty and fills it from the session probe**, so the account menu draws once the probe has answered.

**The bar does not print**: `App.vue` hides its `header` under `@media print`.

**Tests drive it as a person does**: [`the-app-bar.spec.ts`](../../../front-end/e2e/the-app-bar.spec.ts) at 1280 and at a phone's width, and `helpers/screens.ts` walks the account menu through the layout, contrast, focus and accessibility sweeps.

## Why

The organizer's two places were hidden behind a hamburger, and nothing on screen said which one they were in; [finding a market](../../business/flows/finding-a-market.md) is what the bar is for.
`RowMenu` carries the account menu rather than a new component since the app owns its components ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)) and `RowMenu` already holds the keyboard contract.
The token, and how the market frame pins under it, are in [the design language](../../design-system.md).
