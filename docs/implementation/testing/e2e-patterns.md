---
layer: implementation
kind: testing
describes:
  - front-end/e2e/pages/
  - front-end/e2e/fixtures.ts
  - front-end/e2e/helpers/mongo.ts
  - front-end/e2e/helpers/marketScreens.ts
  - front-end/e2e/helpers/upcoming.ts
  - front-end/e2e/helpers/settledPlanChanged.ts
  - front-end/e2e/helpers/seeds.ts#SEED_MARKET_DATE
  - front-end/e2e/helpers/seeds.ts#completePlan
  - front-end/e2e/date-display-timezone.spec.ts
  - front-end/e2e/global-setup.ts
  - front-end/e2e/helpers/settle.ts
  - front-end/src/utils/utils.ts#getFormattedDate
verified: 2026-10-30
sources:
  - E21/F02/S02
  - E22/F04/S02
  - E31/F01/S01
  - E33/F01
  - E33/F01/S02
  - E34/F01/S01
  - E06/F01/S01
  - E33/F01/S01
  - T45
  - T75
  - E38/F05/S01
---

# E2E patterns

How a Playwright spec under `front-end/e2e/` is written.
How to run the suite is [TESTING.md](../../TESTING.md#end-to-end-e2e-tests); the helpers that put a market in a given state are [the E2E seeds](e2e-seeds.md); which spec to extend is [the market journey spec](the-market-journey-spec.md).

## Selectors and page objects

**Every selector is a `data-testid`, named `viewname-element`** (`login-email-input`, `markets-create-button`), so a spec never depends on a CSS class or on the words on screen.
Adding a `data-testid` changes no behaviour; a view gains them as specs need them.

**A page object wraps one screen** ([`front-end/e2e/pages/`](../../../front-end/e2e/pages/)): it holds `getByTestId()` locators and exposes action methods, and a spec calls those methods rather than reaching for locators of its own.
A new page follows the existing ones (`LoginPage`, `MarketsPage`, `NewMarketPage`, `MarketSetupPage`, `ResultPage`, `OrganizationsPage`, `ManageMarketPage`); TESTING.md lists them all.
`MarketSetupPage` holds more than the plan: the market's tabs and the phase rail are there too, because every market page stands in the same frame.

**The Application Form tab is a sequence of steps** (E33/F01): the builder, the preview and the highlights are never all on screen.
A spec opens the step it asserts on, with `ApplicationFormPage.openStep(step)`, whose header is `form-step-<step>` and whose body is `form-step-body-<step>`.

## Fixtures

[`front-end/e2e/fixtures.ts`](../../../front-end/e2e/fixtures.ts) is what a spec imports `test` and `expect` from.
It provides `TEST_USER` (`e2e@example.com`) and `NO_ORG_USER` (`e2e-noorg@example.com`, in no organization), the `authenticatedPage` fixture (signed in through the login page before the test), `BACKEND_URL` (the `BACKEND_URL` variable, else `stack().backendURL`) for direct API calls, and re-exports of the page objects.
A spec that needs several people at once drives each in a browser context of its own with `withUser()` ([`front-end/e2e/helpers/withUser.ts`](../../../front-end/e2e/helpers/withUser.ts)), so no two share a session cookie.
Every `page` is wrapped so that a failing test carries what the browser said (console errors, page errors, crashes, failed requests other than a navigation's aborts), since the suite has failed on pages that never painted with nothing in the stack's logs to say why.
`expectAccessible(state)` runs axe over the page as it stands and fails on any WCAG A or AA violation, one line per element as `rule (impact) target`; its configuration and why `color-contrast` is off are [the design language's](../../design-system.md#what-keeps-this-true).
`settle(page)` ([`helpers/settle.ts`](../../../front-end/e2e/helpers/settle.ts)) waits, bounded, for CSS transitions to end, since a control mid-transition reports its passing paint rather than its own; every sweep calls it before it looks.
The same fixture hides the Vue DevTools floating panel (`#__vue-devtools-container__`) that the dev server injects: it overlays the app and intercepts clicks aimed at it, so a test failed on a click that hit that button instead of its own target.

## Opening a market, and shelling into Mongo

**A spec opens a market by URL**, the way a bookmark would: `marketSetupPath(id, page)` and `marketScreenPath(id, screen)` in [`helpers/marketScreens.ts`](../../../front-end/e2e/helpers/marketScreens.ts) build the addresses of [every market page](../conventions/every-market-page-has-an-address.md).
The Applications page opens on the review's All view, so a spec that walks the one-by-one queue opens it by `oneByOnePath(id)` (`?view=one`), or `ApplicationMonitorPage`'s `goto` or `switchTo` after a move lands there.
Specs no longer plant a market in `localStorage`; nothing about a market is stored in the browser.

**A spec shells into Mongo through `mongoEval`** ([`helpers/mongo.ts`](../../../front-end/e2e/helpers/mongo.ts)), never its own `docker exec`: the container, the address and the flags were once copied into fifteen files.
It is for what no endpoint does: a document shaped as an older build wrote it, a token only an email carries, a state a rule now forbids reaching.
The container name comes from `helpers/containerNames.ts` (`E2E_MONGO_CONTAINER` overrides it), resolved from [the stack's identity](ci-and-the-gate.md#stack-identity).

## Market dates and plans

**A market that opens applications needs a complete plan with dates still to come** (E31/F01/S01), since [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md) and leaving draft needs it.
[`helpers/seeds.ts`](../../../front-end/e2e/helpers/seeds.ts) exports `completePlan()` (a date, a location, a Gold tier with five tables in one section) and `SEED_MARKET_DATE`, a date in 2099 every seeded vendor can attend; a plan whose date differs from the vendors' silently assigns nobody.
A spec that picks dates on the calendar uses `upcomingSaturday()` ([`helpers/upcoming.ts`](../../../front-end/e2e/helpers/upcoming.ts)), dates a couple of months ahead of whenever it runs, since the calendar steps a month at a time.

**A plan cannot change after draft, so a spec seeds the room it wants**: `seedAssignedMarket({ tables })` for a smaller one.
Only a spec about a market older than that rule rewrites a settled plan, straight into Mongo with `changeASettledPlan()` ([`helpers/settledPlanChanged.ts`](../../../front-end/e2e/helpers/settledPlanChanged.ts)): an orphaned pin (`placement-pins`, `orphaned-pin-in-assignment`), and the frozen offering that protects such a market's applicants (`essential-fields`).

**A market a spec imports into is `intakeMode: 'csv'`**; a market whose vendors apply on its page says `'form'` ([intake mode fails closed](../../adr/0006-intake-mode-fails-closed.md)).

**Market dates are calendar days, not instants**: a stored `YYYY-MM-DD` renders as the same day for every viewer, wherever they are.
[`getFormattedDate`](../../../front-end/src/utils/utils.ts) formats with pure UTC arithmetic; never parse a market date through `new Date()` with an offset.
[`date-display-timezone.spec.ts`](../../../front-end/e2e/date-display-timezone.spec.ts) pins it in Honolulu, Los Angeles and Tokyo through Playwright's `timezoneId`.

## Sharp edges

**Several specs and seeds still send an `X-Owner-Email` header, and it is inert**: identity comes from the session cookie alone, and the helpers authenticate by logging in.
That, the self-signed certificate and the other suite-wide traps are TESTING.md's [testing gotchas](../../TESTING.md#testing-gotchas).

**Applicant sign-in is rate limited** ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)): an address is sent at most five codes per 15 minutes, and a caller thirty, which the whole serial run shares.
[`global-setup.ts`](../../../front-end/e2e/global-setup.ts) clears the counters at the start of every run; a spec that signs the same address in more than that within one run trips the limit.

**`waitForURL` returns when the route changes, not when the new page has loaded.**
An element assertion made straight after it spends its budget on the page's own fetch, which under a full suite's contention sometimes takes longer: the applicant form's spec failed one full run in two this way, on "Loading application form...", while passing alone every time.
Wait for the page to have finished loading, its loading state hidden and no load-failed state shown, then assert what it shows ([`essential-fields.spec.ts`](../../../front-end/e2e/essential-fields.spec.ts) waits on `apply-loading` and `apply-load-failed`).
