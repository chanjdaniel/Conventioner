---
layer: implementation
kind: testing
describes:
  - front-end/e2e/pages/
  - front-end/e2e/fixtures.ts
  - front-end/e2e/helpers/browserSaid.ts
  - front-end/e2e/helpers/withUser.ts
  - front-end/e2e/helpers/mongo.ts
  - front-end/e2e/helpers/marketScreens.ts
  - front-end/e2e/helpers/upcoming.ts
  - front-end/e2e/helpers/settledPlanChanged.ts
  - front-end/e2e/helpers/seeds.ts#SEED_MARKET_DATE
  - front-end/e2e/helpers/seeds.ts#completePlan
  - front-end/e2e/date-display-timezone.spec.ts
  - front-end/e2e/global-setup.ts
  - front-end/e2e/helpers/networkSettles.ts
  - front-end/e2e/helpers/settle.ts
  - front-end/src/utils/utils.ts#getFormattedDate
  - front-end/e2e/helpers/phoneWindow.ts#inTheWindow
  - front-end/e2e/helpers/stackReady.ts
  - front-end/e2e/helpers/signInWindow.ts
verified: 2026-11-12
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
  - T121
  - T161
  - E38/F15/S03
  - T169
  - E42/F01/S05
  - T177
  - T181
  - T211
  - T205
  - T223
  - T251
  - T260
  - T263
  - T284
  - T257
  - T315
  - T318
---

# E2E patterns

How a Playwright spec under `front-end/e2e/` is written.
How to run the suite is [TESTING.md](../../TESTING.md#end-to-end-e2e-tests); the helpers that put a market in a given state are [the E2E seeds](e2e-seeds.md); which spec to extend is [the market journey spec](the-market-journey-spec.md).

## Selectors and page objects

**Every selector is a `data-testid`, named `viewname-element`** (`login-email-input`, `markets-create-button`), so a spec never depends on a CSS class or on the words on screen.
Adding a `data-testid` changes no behaviour; a view gains them as specs need them.
**The one exception is a location's layout** (T257): its map's tables are found by their accessible names ("Gold row 5, Standard 6 ft"), and its toolbar's tools, its menus' items, its location links and its sections' swatches by role and name ([`LayoutPage.ts`](../../../front-end/e2e/pages/LayoutPage.ts)), since what its specs prove is what a screen reader hears: a table's code and type are read back from its name, as the spec of the layout asks.
Everything else on the page is found by its `data-testid`.

**A page object wraps one screen** ([`front-end/e2e/pages/`](../../../front-end/e2e/pages/)): it holds `getByTestId()` locators and exposes action methods, and a spec calls those methods rather than reaching for locators of its own.
`LoginPage.login` opens a bare `/login` first; `signIn` signs in on the page as it stands, so a spec about where signing in returns to keeps the address's `next`.
`waitForMarkets` waits for where signing in lands by the path, since `/login?next=/markets` ends in `/markets` too and a glob would be met before the sign-in had happened; a spec asserts a landing the same way.
A new page follows the existing ones (`LoginPage`, `MarketsPage`, `NewMarketPage`, `MarketSetupPage`, `ResultPage`, `OrganizationsPage`, `ManageMarketPage`); TESTING.md lists them all.
`MarketSetupPage` holds more than the plan: the market's tabs and the phase rail are there too, because every market page stands in the same frame, and `publishResults`, which a walk into market days takes on either path.
`VendorPage` is the one object for a market's vendor page, signed out and in, the application form on it included.
Its `decideOnReviewSetup` follows the rail's "Decide what reviewers read first" to Review setup and chooses "Nothing leads the card" and "No automatic rejections", so a walk that opens Review through the screens decides as an organizer does ([review waits on the review setup](../../business/rules/review-waits-on-the-review-setup.md)).
On a form of essential questions alone the rail offers the form first (T260), so `decideOnReviewSetupAskingNothingOfTheirOwn` waits for that offer by its name, opens Review setup as the form tab's last step and decides the same way.
A dialog that more than one screen opens has an object of its own (`FollowUpDialog`, opened from One by one's card and from the All view's drawer), so a test id renamed in it is one line to change for every spec that drives the dialog through the object.

**The Application Form tab is a sequence of steps** (E33/F01): the builder, the preview and the highlights are never all on screen.
A spec opens the step it asserts on, with `ApplicationFormPage.openStep(step)`, whose header is `form-step-<step>` and whose body is `form-step-body-<step>`.
Each step can show before the form's own read has answered, the copy the market holds under "Loading the application form...", so a spec that sweeps a step waits for `ApplicationFormPage.loading` to be hidden first, as the walked states do with `formAt` (T315).

## Fixtures

[`front-end/e2e/fixtures.ts`](../../../front-end/e2e/fixtures.ts) is what a spec imports `test` and `expect` from.
It provides `TEST_USER` (`e2e@example.com`) and `NO_ORG_USER` (`e2e-noorg@example.com`, in no organization), the `authenticatedPage` fixture (signed in through the login page before the test), `BACKEND_URL` (the `BACKEND_URL` variable, else `stack().backendURL`) for direct API calls from a request context of their own, `APP_API` (`/api`, the address the app's pages call the API at) for calls made with a page's cookies (`page.request`), and re-exports of the page objects.
A spec that needs several people at once drives each in a browser context of its own with `withUser()` ([`front-end/e2e/helpers/withUser.ts`](../../../front-end/e2e/helpers/withUser.ts)), so no two share a session cookie.
Every `page`, and the page `withUser()` opens, is watched by [`helpers/browserSaid.ts`](../../../front-end/e2e/helpers/browserSaid.ts) so that a failing test carries what the browser said (console errors, page errors, crashes, failed requests other than a navigation's aborts), since the suite has failed on pages that never painted with nothing in the stack's logs to say why.
The fixture's page attaches it when the test fails, and a `withUser()` page when its sign-in or body throws, headed with whose page it was; [`a-stalled-helper-says-why.spec.ts`](../../../front-end/e2e/a-stalled-helper-says-why.spec.ts) shows both that and the people-at-scale wait for quiet naming each API request still open and its age.
That wait ([`helpers/peopleAtScale.ts`](../../../front-end/e2e/helpers/peopleAtScale.ts), `requestsWhile`) lets go of the requests the old page still had out when a reload or a `goto` inside it brings a new page, since Playwright reports neither their end nor their failure, and still waits for the new page's own.
`expectAccessible(state)` runs axe over the page as it stands and fails on any WCAG A or AA violation, one line per element as `rule (impact) target`; its configuration and why `color-contrast` is off are [the design language's](../../design-system.md#what-keeps-this-true).
`settle(page)` ([`helpers/settle.ts`](../../../front-end/e2e/helpers/settle.ts)) waits, bounded, for CSS transitions to end, since a control mid-transition reports its passing paint rather than its own; every sweep calls it before it looks.
A sweep's tests are registered by `walkTheScreens()`, so Playwright reports each under [`helpers/screens.ts`](../../../front-end/e2e/helpers/screens.ts), the line of its `test()` call, never the sweep's spec file; the describe title names the sweep, and `npx playwright test e2e/<sweep>.spec.ts` still runs that sweep alone.
So does `expectInside`, the window check of the phone journeys ([`helpers/phoneWindow.ts`](../../../front-end/e2e/helpers/phoneWindow.ts)), since a box read in a slide's last frames stands a fraction of a thousandth of a pixel past where it rests, enough to fail an exact comparison with the window's edge.
The same fixture hides the Vue DevTools floating panel (`#__vue-devtools-container__`) that the dev server injects, in every tab of its context: it overlays the app and intercepts clicks aimed at it, so a test failed on a click that hit that button instead of its own target.
A context a test opens itself with `browser.newContext()` is outside the fixture, so it calls [`hideDevToolsPanel`](../../../front-end/e2e/helpers/hideDevToolsPanel.ts), as `withUser()` does: a click there may otherwise wait on the panel until the test times out, as the vendor's Send code did on the Google Form market's page.

## Opening a market, and shelling into Mongo

**A spec opens a market by URL**, the way a bookmark would: `marketSetupPath(id, page)` and `marketScreenPath(id, screen)` in [`helpers/marketScreens.ts`](../../../front-end/e2e/helpers/marketScreens.ts) build the addresses of [every market page](../conventions/every-market-page-has-an-address.md).
The Applications page opens on the review's All view, so a spec that walks the one-by-one queue opens it by `oneByOnePath(id)` (`?view=one`), or `ApplicationMonitorPage`'s `goto` or `switchTo` after a move lands there.
Specs no longer plant a market in `localStorage`; nothing about a market is stored in the browser.

**A spec shells into Mongo through `mongoEval`** ([`helpers/mongo.ts`](../../../front-end/e2e/helpers/mongo.ts)), never its own `docker exec`: the container, the address and the flags were once copied into fifteen files.
It is for what no endpoint does: a document shaped as an older build wrote it, a token only an email carries, a state a rule now forbids reaching.
The container name comes from `helpers/containerNames.ts` (`E2E_MONGO_CONTAINER` overrides it), resolved from [the stack's identity](ci-and-the-gate.md#stack-identity).

**Discord stands outside the stack**, so a spec that needs it runs the back end's own check against a fake Discord server it writes with [`helpers/fakeDiscord.ts`](../../../front-end/e2e/helpers/fakeDiscord.ts) ([a fake Discord](../../TESTING.md#a-fake-discord), [the Discord connection](../modules/discord.md#who-is-in-the-server)).

## Market dates and plans

**A market that opens applications needs a complete plan with dates still to come** (E31/F01/S01), since [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md) and leaving draft needs it.
[`helpers/seeds.ts`](../../../front-end/e2e/helpers/seeds.ts) exports `completePlan()` (a date, a location, a Gold tier with five tables in one section) and `SEED_MARKET_DATE`, a date in 2099 every seeded vendor can attend; a plan whose date differs from the vendors' silently assigns nobody.
The door takes no check-in on a day that has not begun, so a spec that checks a vendor in at the door seeds on `calendarToday()` ([checking a vendor in](e2e-seeds.md#checking-a-vendor-in)).
A spec that picks dates on the calendar uses `upcomingSaturday()` ([`helpers/upcoming.ts`](../../../front-end/e2e/helpers/upcoming.ts)), dates a couple of months ahead of whenever it runs, since the calendar steps a month at a time.

**A plan cannot change after draft, so a spec seeds the room it wants**: `seedAssignedMarket({ tables })` for a smaller one.
Only a spec about a market older than that rule rewrites a settled plan, straight into Mongo with `changeASettledPlan()` ([`helpers/settledPlanChanged.ts`](../../../front-end/e2e/helpers/settledPlanChanged.ts)): an orphaned pin (`placement-pins`, `orphaned-pin-in-assignment`), and the frozen offering that protects such a market's applicants (`essential-fields`).

**A market a spec imports into is `intakeMode: 'csv'`**; a market whose vendors apply on its page says `'form'` ([intake mode fails closed](../../adr/0006-intake-mode-fails-closed.md)).
A `csv` market enters `applications` only holding an application, so a spec that moves one there inserts its applications first, or imports from draft ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).

**Market dates are calendar days, not instants**: a stored `YYYY-MM-DD` renders as the same day for every viewer, wherever they are.
[`getFormattedDate`](../../../front-end/src/utils/utils.ts) formats with pure UTC arithmetic; never parse a market date through `new Date()` with an offset.
[`date-display-timezone.spec.ts`](../../../front-end/e2e/date-display-timezone.spec.ts) pins it in Honolulu, Los Angeles and Tokyo through Playwright's `timezoneId`.

## Sharp edges

**Identity comes from the session cookie alone**: the helpers authenticate by logging in, and no spec or seed sends an identity header.
That, the self-signed certificate and the other suite-wide traps are TESTING.md's [testing gotchas](../../TESTING.md#testing-gotchas).

**Applicant sign-in is rate limited** ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)): an address is sent at most five codes per 15 minutes and may try ten, and a caller 300 of each, which the whole serial run shares.
[`global-setup.ts`](../../../front-end/e2e/global-setup.ts) clears the counters at the start of every run; a spec that signs the same address in more than that within one run trips the limit, so a spec that spends a code's five tries uses an address of its own.
**The organizer's password and code sign-ins are rate limited too** ([the sign-in is bounded](../data/users-and-email.md#the-sign-in-is-bounded)): ten tries per address per 15 minutes on each, and fifty per caller on the password, sixty on the code.
A try that signs in takes its count back, so the suite's hundreds of fixture sign-ins cost nothing; wrong passwords and codes share the caller's fifty and sixty across the serial run, so a spec that goes past a limit, or tries many wrong ones, clears the counters in its `finally` (`db.sign_in_attempts.deleteMany({})`), as `the-sign-in-says-what-to-do-next.spec.ts` does.
Asking for an organizer's code, a reset link or a verification link, and signing up, take nothing back: five of each per address and thirty per caller per 15 minutes, so a spec that goes past one clears the counters in its `finally` too.
**The counts are kept in fixed quarter hours on the clock** (`back-end/sign_in_limits.py`), so tries that straddle a quarter hour's end are counted in two windows: a spec that fills a limit and then meets it calls `waitForRoomInWindow` ([`helpers/signInWindow.ts`](../../../front-end/e2e/helpers/signInWindow.ts)) first, which waits out a window with less than a minute left, or the try past the limit can land in a fresh window and be allowed.
Every signed-out vendor page, and every vendor request that finds its tab's sign-in ended, also asks to resume a remembered sign-in, 300 per caller per 15 minutes; a refused resume draws the sign-in as no cookie does, so only a spec that needs a resume to pass clears the counters first, as `remember-me-on-the-vendor-page.spec.ts` does.

**A run starts once the stack is ready.**
A stack's interfaces keep changing for a while after `up` returns: each takes an IPv6 address within a second, and changes link state again about 15 seconds later, and Chromium fails whatever it has in flight with `net::ERR_NETWORK_CHANGED` at each change, so the first spec after a stack started lost a module and failed.
`global-setup.ts` waits until the host's newest container interface (`veth`, `br-` or `docker`, aged by its `/sys/class/net` entry) is 20 seconds old ([`networkSettles.ts`](../../../front-end/e2e/helpers/networkSettles.ts)), and prints how long; a settled host, or one with no such interface, waits for nothing.
Then it waits for the stack itself ([`stackReady.ts`](../../../front-end/e2e/helpers/stackReady.ts)), since `up` returns once the back end's and the dev server's containers run, neither having a health check: for `/api/healthz` to answer 200 through the dev server's proxy, for at most 60 seconds, and then for the sign-in page to draw its email field in a browser of its own, for at most 120 seconds.
It prints `e2e: the stack was ready in <n>s` when that took over 2 seconds, and a stack that never gets ready fails the run with the part that did not, the back end with its last answer or the sign-in page, rather than its first spec.
Another stack starting or stopping during a run can still abort a request: [CI and the gate](ci-and-the-gate.md#the-no-mistakes-gate) has the lock that keeps two gate runs apart.
A test that fails after its browser, the fixture's page or a `withUser` page, saw `net::ERR_NETWORK_CHANGED` gains the annotation "network changed", which says so, beside what the browser said ([`browserSaid.ts`](../../../front-end/e2e/helpers/browserSaid.ts)); such a failure is the machine's, so run the test again rather than chase it.
E2E stays on the dev server rather than a built front end, though a build makes fewer requests per page: an API request fails on a network change all the same, a build goes stale at every source edit, so a spec run after a change would test the old code, and the dev-only component library's specs need the dev server.

**A spec finds a market or an organization by name through the page's search, never by scanning the cards.**
Markets and Organizations show 50 cards at a time, in date order and in the order the organizations were made, and the shared test user gathers hundreds of markets over runs on one stack, so a card made in the spec can be past the first page.
`MarketsPage.narrowTo(name)` and `OrganizationsPage.findCard(name)` fill the search when the page draws it and use nothing when it does not, since the page then holds 12 or fewer and shows them all.
Markets' search is drawn only past 12 markets or while the address holds words, so a spec that types into it gives its user 13 markets of its own, as [`finding-a-market.spec.ts`](../../../front-end/e2e/finding-a-market.spec.ts) does, or brings its words in the address (T223).

**A spec ends an organizer's session on the server**: `mongoEval` unsets the user's `login_id`, so the cookie names a login no account holds and the next request answers 401, as after a password reset; the next sign-in gives the account a new one.
`context.clearCookies()` ends it only in the browser: the stack keeps its sessions on disk, where it stays until it lapses.

**A call made with a page's cookies goes to `APP_API`, as the page's own calls do** (E38/F14/S01).
`APP_API` is the address the app's pages call the API at, through the dev server's proxy, so such a call reaches the back end the way the page's do.
Until T318 a `page.request` at `BACKEND_URL` was refused as signed out, since the back end held a session to the client's address as well as its browser; it holds it to the browser string alone now ([the cookies](../conventions/security-invariants.md#the-cookies)), so one there is taken too, but no spec relies on that.
A page of another browser context (`withUser()`'s) is a page too; a request context of its own (the `request` fixture, `playwright.request.newContext()`) is a client of its own, and may call either.
A request with no cookie at all answers 401; [`a-failure-says-what-to-do.spec.ts`](../../../front-end/e2e/a-failure-says-what-to-do.spec.ts) holds that, from a page of the app's origin that runs none of its code.

**A request a page sends from `pagehide` goes with the browser's own User-Agent**, not the Desktop Chrome device's, which Playwright sets through DevTools for the page alone, so the same session protection refuses it with a 401 (T271).
Playwright's `page.on('request')` does not report it either; read what it did from the server.
A spec of a write on the way out of the page uses the browser's User-Agent for its context, as [`the-plan-saves-one-at-a-time.spec.ts`](../../../front-end/e2e/the-plan-saves-one-at-a-time.spec.ts)'s "The plan on the way out of the page" does, with `userAgent` read from `Browser.getVersion` over a browser CDP session.

**Focus an amount field before you `fill` it once it holds an amount** ([an amount field](../../business/rules/an-amount-reads-to-the-cent.md#an-amount-field)).
Such a field rewrites its text on focus, "$50.00" to "50.00", and `fill` selects the text before it focuses the field, so the rewrite drops the selection and what is filled lands after the number ("50.003x").
`await field.focus()` first, as a person focuses it, and `fill` then selects the plain number and replaces it ([`the-pricing-card.spec.ts`](../../../front-end/e2e/the-pricing-card.spec.ts)).
Likewise `selectOption` leaves the focus where it was, so focus a select first where a field must have been left.

**`waitForURL` returns when the route changes, not when the new page has loaded.**
An element assertion made straight after it spends its budget on the page's own fetch, which under a full suite's contention sometimes takes longer: the applicant form's spec failed one full run in two this way, on "Loading application form...", while passing alone every time.
Wait for the page to have finished loading, either way, then assert what it shows ([`essential-fields.spec.ts`](../../../front-end/e2e/essential-fields.spec.ts) waits for the signed-in vendor page or its load-failed state, `vendor-page-signed-in-as` or `vendor-page-load-failed`, and takes the retry the page offers).

**An app request reaches the network a little after the code that made it**, since axios (1.21 on) awaits the XSRF cookie from the browser's Cookie Store before it sends each same-origin XHR, where the browser has one (Chromium does), and a stack's API is same-origin, through the front end's `/api` proxy.
So a `page.route` set just before a `goto`, or a `waitForResponse` set just after a click, can catch a request the page before, or the action before, had made and not yet sent.
A route that must fail the screen's own read fails every matching request until the test unroutes it, as [`a-failure-says-what-to-do.spec.ts`](../../../front-end/e2e/a-failure-says-what-to-do.spec.ts)'s `failUntilCleared` does, and a response wait matches what the request carries, as [`automatic-rejections.spec.ts`](../../../front-end/e2e/automatic-rejections.spec.ts)'s `addRule` matches the PUT that ticks the answer.

**A spec that waits on a file chooser listens for it from before the page loads.**
`page.waitForEvent('filechooser')` turns on Playwright's catching of choosers as it is called, without waiting for the browser to agree, so a chooser opened by the very next key press can slip past it and the wait times out with focus still on the input: [`the-upload-steps-are-one.spec.ts`](../../../front-end/e2e/the-upload-steps-are-one.spec.ts) missed its first Enter in 4 runs of 20 this way.
It adds `page.on('filechooser', () => {})` before it opens the page, then waits for each chooser as before.

## Chasing a flake

A flake is chased the same way every time, so its report says what was tried; [when a test fails](../../TESTING.md#when-a-test-fails) is where each attempt's trace lands.

**The load.** `stress-ng --cpu <n> --timeout <minutes>m`, always with `--timeout` so it ends by itself, with `<n>` chosen so `uptime` reads a load average of one to one and a half times the machine's cores once it runs, counting what already runs there.
Start it only while `uptime` reads below that band, never push it past the band's top, run one at a time, and stop it by its own timeout or the process id it started with.
Where the load cannot be raised (a session not allowed to start `stress-ng`), run at the load the machine has.
Note `uptime` before and during each run in the report, and report a run that ran below the band as below it.

**A cold stack**, for a flake seen on a stack's first spec: stop the worktree's stack and start it again (a team worker with `team-stack stop` and `team-stack up`), then run the spec as the first thing after it is up.

**The run.** From `front-end/`, `npx playwright test <files> --retries=0 --repeat-each=<k> --output=<a new directory>`, with `<k>` 20 for a single test or file; a fresh `--output` per run keeps each run's traces apart, since a rerun empties the last one's.
Before a fix the run must fail at least once; one that does not fail in 20 repeats under load, and 3 cold starts where a cold stack applies, is reported with what was tried, not fixed and not called fixed.
After the fix the same run passes 30 of 30 under the same load.

**A held route makes a race certain.** A `page.route` handler that awaits a promise the test releases holds one read while the page goes on, which turns a suspected race into a yes or no, as the second test of [`undoing-a-verdict.spec.ts`](../../../front-end/e2e/undoing-a-verdict.spec.ts) does.
Never unroute it with a request still held: unrouting lets the held request go on, and the test's later release then throws "Route is already handled".
