---
layer: implementation
kind: module
describes:
  - front-end/src/components/AppBar.vue
  - front-end/src/components/PageNotFound.vue
  - front-end/src/App.vue#user
  - front-end/index.html
  - front-end/src/utils/currentPlace.ts
  - front-end/src/utils/signedIn.ts
  - front-end/src/utils/sessionEnded.ts#signOut
  - front-end/src/utils/sessionEnded.ts#forgetTheSession
  - front-end/src/utils/sessionEnded.ts#endTheSessionOnTheServer
  - front-end/src/views/PasswordResetRequestView.vue
  - front-end/src/views/PasswordResetView.vue
  - front-end/e2e/the-app-bar.spec.ts
  - front-end/src/__tests__/theBarsCurrentPlace.test.ts
verified: 2026-11-05
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
On a phone a market screen pins 44 + 94 = 138px, inside the layout sweep's 150px limit.

**The whole logo, 26px tall, leads to Markets.**
Signed in, it is a link named "Conventioner, Markets"; signed out, it is an image with no link.
On Markets the link says nothing of being current, `aria-current-value="false"`, so a screen reader hears the current page once, on the place's own link.

**Markets and Organizations are links in a `nav` named "Main".**
Each is the band's full height; the current one is `--mm-green`, semibold, with a 2px underline over the band's line, and carries `aria-current="page"`.
Every link holds its heavier words' width open, so moving between the places never nudges the link beside it.

**Which place is current is one pure function of the route**, [`currentPlace`](../../../front-end/src/utils/currentPlace.ts): a route with a `marketId` param or named `markets` is Markets, `organizations` is Organizations, and any other route has none.
A new market screen needs nothing there; [`theBarsCurrentPlace.test.ts`](../../../front-end/src/__tests__/theBarsCurrentPlace.test.ts) reads it off the router's own routes.

**The account menu is `RowMenu` with its `trigger` slot.**
The button shows the address and a chevron, 32px tall and at most 260px wide; the address gives way first when the window is short of room, cut with an ellipsis, with its whole value as a `title` on the words.
The words name the button, as [every control is named](../conventions/every-control-is-named.md#the-rules) asks, so `RowMenu`'s `label` then names the open menu alone.
It holds Change password and Sign out.

## Who sees what

**One rule: a known signed-in organizer gets the full bar, on every route, and nobody else gets more than the logo.**
There is no list by role or by screen, since a role belongs to a market or an organization and not to the account.
So a Viewer's bar is an Owner's, an organizer with no organization has Organizations to make one in, sign-in and a vendor's page show a vendor the logo alone, and an organizer who opens their own market's public page or "Page not found" keeps the full bar, with no place marked current.

**The bar's reading of who is signed in is one, the shell's.**
[`App.vue`](../../../front-end/src/App.vue)'s `user` starts from the stored user ([`signedInEmail`](../../../front-end/src/utils/signedIn.ts)) and is read again after every navigation, so each way a session starts or ends (signing in, Sign out, `endSession`, a 401) only changes what is stored and moves, without telling the shell.
It is read again on a `storage` event too, for what makes no navigation here: another tab signing out or in as someone else, and `forgetTheSession`, which raises that event in its own tab, since a tab hears only another's change.
So a finished reset drops the bar at once, 2 seconds before the page moves on, and a tab left open never goes on naming an account that has gone, an open sheet closing with it; what that tab already shows stays until its next read, which answers as whoever the shared cookie now is.
The session probe corrects the stored address when it answers, and `user` is provided to the bar and to "Page not found".
So the bar stands before the probe answers, with the account menu in it from the first paint.
A person can then sign out under the probe, so its answer counts only if the stored user is still the one it asked about: a late answer brings back neither the bar nor a note that the session ended.

**The shell makes no probe on a public page**, so a stale stored user there shows a full bar.
That says nothing about any market, and its links lead to sign-in, since the first read of the page they open answers 401 ([a session that ends mid-work](../conventions/an-exception-never-reaches-a-client.md)).

**["Page not found"](../../../front-end/src/components/PageNotFound.vue) offers Markets to a signed-in organizer and Sign in to anyone else.**
It decides on the person alone, never on the address, so a gated market and a missing one read identically to each ([a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md)).
On a phone its words stand at the phone's 16px gutter, on the logo's left edge.

## The sheet, on a phone

**At 640px and below the links and the account menu stand aside for a menu button**, a 44px square at the band's right named "Open menu" or "Close menu", with `aria-expanded` and `aria-controls`; its icon is the menu's, or the close icon while open.

**The button opens a sheet hanging from the bar**, the window's width, white with `--shadow-card`, over a `rgba(0, 0, 0, 0.5)` scrim that fills the window below the bar.
It holds the same things as the desk's bar, in 44px rows: Markets and Organizations in a `nav` named "Main", a line, the address in `--mm-text-muted`, then Change password and Sign out.
The current row is `--mm-green`, semibold, with a 3px bar at its left edge, and carries `aria-current="page"`; a row's words stand on the logo's left edge, at 16px.
A long address wraps whole, since a `title` is no use to a thumb, and the row grows with it.
Taller than the window, the sheet scrolls within itself.

**It behaves as a modal, without being a dialog.**
It is a list of places and not a form in a window, so it is not an `AppDialog`, but it keeps a modal's contract ([dialogs](../conventions/dialogs.md)): `useInertBehind` holds the page out, the logo with it, with the sheet, the scrim and the menu button as its parts, since the button is how it closes; focus moves to its first row on opening; Escape, a press on the scrim and the button close it and return focus to the button (`useEscapeToClose`, `useFocusGoesBack`).
Choosing a row closes it, as does any route change, and a window that widens past the break, since the button is gone there and nothing would be left to close it with.
[`modalsHoldThePageInert.test.ts`](../../../front-end/src/__tests__/modalsHoldThePageInert.test.ts) reads a full-window cover by its CSS and this scrim starts under the bar, so [`modal-inert.spec.ts`](../../../front-end/e2e/modal-inert.spec.ts) holds its wiring.

## Change password

**Change password leads to the emailed reset page, `/reset-password-request`, with no page and no server change of its own.**
[The page](../../../front-end/src/views/PasswordResetRequestView.vue) fills its email field from the shell's `user`, so the address is in no URL, and the field stays editable; signed out, it is empty.
The rest is [the reset everyone uses](../../business/flows/accounts.md#a4-reset-a-forgotten-password).

**The two password pages say only what is true of the person reading them.**
To someone signed in, the request page does not ask for an address it already holds, and its link and the reset page's read "Back to Markets" and go there, since `/login` would only forward them.

**Setting the new password ends the session it is set in.**
`reset_password` gives the account a new login id, which ends every session of it, so [the reset page](../../../front-end/src/views/PasswordResetView.vue) calls `forgetTheSession`, and its link goes back to reading "Back to sign in".
Without that the stored user would turn the page's move to `/login` into a move to a page that answers 401, and sign-in would say "Your session has ended", when ending it is what they just did.
The answer does not say whose link it was, so a link for another account forgets this browser's stored user too, and the page also posts `/logout` through `endTheSessionOnTheServer`, `signOut`'s own call, so the session this browser held is over and not only forgotten.
Another tab here drops to the logo at once, as above, and its next write answers 401 and lands on sign-in saying the session ended.
For the person's own link the post answers 401 and changes nothing, and the page moves on only once the post has been answered.
A failed reset forgets nothing.

## Sign out

**[`signOut`](../../../front-end/src/utils/sessionEnded.ts) is the one sign-out**, the account menu's and the sheet's, beside `endSession`.
It posts `/logout` (`endTheSessionOnTheServer`, which a finished reset uses too), then forgets `localStorage` and the market store (`forgetTheSession`) and goes to `/login`, whether or not the post succeeded, so a sign-out that failed on the wire still leaves this browser signed out.
It uses `fetch`, not the app's `axios`, so a 401 from `/logout` is not told as a session that ended under the organizer.

## Sharp edges

**The break is the market frame's, `width <= 640px`, in CSS**, so the two layouts never disagree with the frame's.

**The bar is the window's width on a screen keeping the desktop floor.**
`.app-container` keeps a 1000px floor there, so the band itself is as wide as the page, its line running on under a page scrolled sideways, and what it holds is a fixed row of the window's width, less a scroll bar, which stays put as the page scrolls.
A sticky row needs a width of its own, and `100vw` counts the scroll bar's gutter, so at a desk's 800px it ran 15px past the window.

**`minimum-scale=1.0` in [`index.html`](../../../front-end/index.html) is what lets that row hold on a phone.**
Without it a phone's browser answers a page wider than the window by widening the layout viewport to the page, 1001px at a 390px window, and a thumb then pans the window over a page that does not scroll: `scrollX` stays 0, so nothing sticky or fixed stays in view, and a fixed box runs the page's whole width.
With it the layout viewport stays the window's and the page scrolls sideways, as [the market frame](market-frame.md#sharp-edges) says it does, and a fixed box, a dialog's scrim among them, is the window's width.
The cost is that a person can no longer pinch such a screen out to see all of it; zooming in is untouched.
This is measured in Chromium's phone emulation only; Safari on an iPhone has not been tried.

**The bar does not print**: `App.vue` hides its `header` under `@media print`.

**Tests drive it as a person does**: [`the-app-bar.spec.ts`](../../../front-end/e2e/the-app-bar.spec.ts) at 1280 and under a phone's own emulation, dragging a floored screen sideways with a synthesized gesture, since `window.scrollTo` moves the layout viewport and says nothing of a thumb; `helpers/screens.ts` walks the account menu and the sheet through the layout, contrast, focus and accessibility sweeps.

## Why

The organizer's two places were hidden behind a hamburger, and nothing on screen said which one they were in; [finding a market](../../business/flows/finding-a-market.md) is what the bar is for.
`RowMenu` carries the account menu rather than a new component since the app owns its components ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)) and `RowMenu` already holds the keyboard contract.
The token, and how the market frame pins under it, are in [the design language](../../design-system.md).
