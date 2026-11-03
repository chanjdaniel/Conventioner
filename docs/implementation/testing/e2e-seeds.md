---
layer: implementation
kind: testing
describes:
  - front-end/e2e/helpers/seeds.ts#loginViaApi
  - front-end/e2e/helpers/seeds.ts#ensureTestOrgAuthenticated
  - front-end/e2e/helpers/seeds.ts#ensureTestOrgs
  - front-end/e2e/helpers/seeds.ts#ensureTestOrg
  - front-end/e2e/helpers/seeds.ts#ensureOrganizationAdmin
  - front-end/e2e/helpers/seeds.ts#seedMarketWithVendors
  - front-end/e2e/helpers/seeds.ts#seedPublishedMarketWithAssignments
  - front-end/e2e/helpers/seedAssignedMarket.ts
  - front-end/e2e/helpers/seedPhaseMarket.ts
  - front-end/e2e/helpers/seedDraftMarket.ts
  - front-end/e2e/helpers/seedApplicantMarket.ts
  - front-end/e2e/helpers/seedApplication.ts#seedApprovedVendor
  - front-end/e2e/helpers/seedApplication.ts#approvedVendorApplication
  - front-end/e2e/helpers/seedApplication.ts#insertApplications
  - front-end/e2e/helpers/seedTheScreens.ts
  - front-end/e2e/helpers/seedFloorplanTemplate.ts
  - front-end/e2e/helpers/verifiedUser.ts
  - front-end/e2e/helpers/backendScript.ts
  - back-end/create_test_user.py
  - front-end/e2e/helpers/exampleCollegeMarket.ts
  - front-end/e2e/helpers/decideReviewSetup.ts
  - front-end/e2e/helpers/seedPeopleAtScale.ts
verified: 2026-11-03
sources:
  - E02
  - E11/F01/S01
  - E21/F03/S06
  - E31/F01/S01
  - E35/F02/S02
  - E36/F04/S02
  - T15
  - T45
  - T79
  - E41/F01/S01
  - E43/F01/S03
  - T142
  - T148
  - E38/F12/S01
  - T181
  - T206
  - T204
---

# E2E seeds

The helpers that put a market, its vendors and its users in the state a spec starts from, so the spec spends its time on its own subject.
They live in `front-end/e2e/helpers/`; how a spec is written around them is [E2E patterns](e2e-patterns.md).

## Users

**Every seed needs a verified user, and only `back-end/create_test_user.py` makes one.**
`/register-user` does not set `email_verified`, so a user it makes cannot log in; do not switch to it, and do not hand-roll the user document.
[`scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh) runs the script for two users: `TEST_EMAIL` (`e2e@example.com`, owner of `Seed Test Org`) and `NO_ORG_EMAIL` (`e2e-noorg@example.com`), deliberately in no organization so `new-market-org.spec.ts` can exercise the zero-organization fallback.
A spec needing more users calls `ensureVerifiedUser(email, password)` ([`helpers/verifiedUser.ts`](../../../front-end/e2e/helpers/verifiedUser.ts)) in `beforeAll`: it runs [`create_test_user.py`](../../../back-end/create_test_user.py) inside the back-end container ([`helpers/backendScript.ts`](../../../front-end/e2e/helpers/backendScript.ts); `E2E_BACKEND_CONTAINER` overrides the name) and is idempotent.
The script exits 0 whether it created the user, found one, or failed to insert (it refuses outright, exiting non-zero, when neither `MONGODB_HOST` nor `MONGODB_URI` names a database or they name the primary checkout's MongoDB from the host, but every stack's back-end container sets `MONGODB_HOST=mongodb`), so the helper reads its output for one of the two outcomes that leave a usable user and throws otherwise: a seeding failure surfaces at the `beforeAll` that caused it, not later as a login timeout.
A seed of many people makes them with one run of its bulk form, `create_test_user.py --bulk <password> <email>...`: each address made as the one-address form makes it, in one process with the password hashed once, an address already made left as it is.
It prints one line per address, `created <email> <id>` or `exists <email> <id>`, and never the password, so the seed reads every account's id from it.
An operator never uses that script for a real account: it prints the password ([OPERATIONS.md](../../OPERATIONS.md#making-an-account)).

## Markets require an organization

`POST /markets` answers 400 to a payload with no `organizationId`, an unknown organization, or one the caller is not a member of ([the organization document](../data/organization-document.md)).
So anything that creates a market attaches one: [`helpers/seeds.ts`](../../../front-end/e2e/helpers/seeds.ts) exports `ensureTestOrgAuthenticated()` (for a request context already logged in by `loginViaApi()`) and `ensureTestOrg()` (which logs in first), both reusing the user's first organization or creating `E2E Test Org`; the seed helpers return it as `orgId`.
A spec that creates a market through the UI calls `ensureTestOrg()` in `beforeAll`, or the create dialog's organization list is empty and its submit stays disabled.
`ensureTestOrgs(count)` is for a spec whose subject is a choice of organization, which a split run (CI shards) no longer guaranteed by accident.
`ensureOrganizationAdmin(orgId, email)` makes a verified user an admin of that organization, through the owner's session the request carries, and so Admin on every market it holds; it is idempotent across runs.
Every spec using it adds its own account to the shared `E2E Test Org`, so that account is Admin on every market seeded there and no other spec signs in as it.

## The seed helpers

Every helper works over the API through Playwright's `APIRequestContext`, whose cookies carry the session, except where it says it writes to Mongo.
Each helper is one block, what it leaves and its notes, one note a line; a new helper is a block beside the helper it builds on, and a new item in its lists is one line beside the item it is most like, not at the list's end ([two features never share a line](../conventions/two-features-never-share-a-line.md)):

**`seedDraftMarket()`** ([file](../../../front-end/e2e/helpers/seedDraftMarket.ts))
- Leaves: a draft with no plan and no form
- Notes:
  - what an organizer has the moment the new-market dialog closes
  - its review setup undecided, as a new market's is

**`seedPhaseMarket()`, `seedFormlessPhaseMarket()`** ([file](../../../front-end/e2e/helpers/seedPhaseMarket.ts))
- Leaves: a draft that may open applications: a complete plan, and a two-field form or none
- Notes:
  - does not move the phase
  - its review setup decided, unless `reviewSetupUndecided: true`
  - `orgId` puts it in that organization, which the signed-in user runs, rather than their first
  - `transitionMarket()` and `seedApplicationWithStatus()` beside them

**`decideReviewSetup()`** ([file](../../../front-end/e2e/helpers/decideReviewSetup.ts))
- Leaves: a market's review setup decided through its own writes: nothing leads the card, and no automatic rejections (T206)
- Notes:
  - every seed here that leaves a draft ready for Review calls it, `seedDraftMarket()` alone excepted
  - a spec that takes a draft of its own making into Review by its own request calls it first
  - a spec about the decisions asks its seed for `reviewSetupUndecided: true` instead

**`seedPeopleAtScale()`** ([file](../../../front-end/e2e/helpers/seedPeopleAtScale.ts))
- Leaves: a `form` market in `applications` whose organization has 150 people, the case every people list and chooser must hold (T204):
  - 153 accounts, `person-001@people-at-scale.test` to `person-153@people-at-scale.test`, made by one `create_test_user.py --bulk`
  - an organization of its own, "Example People Org" and a unique number, owned by the seed owner, persons 001 to 003 its admins and 004 to 153 its members, added one at a time through its endpoints as Manage organization adds them
  - 5 open applications
  - Editor on the market for the first 20 members, through `grantMarketRole()`
  - the first 12 of those its chosen reviewers, through the endpoint Choose reviewers saves to, which deals the applications among them
- Notes:
  - built on `seedPhaseMarket()` with `orgId`
  - answers every person's id and address, each group, and the counts (154 with access, 3 admins, 150 members, 12 reviewers), which a spec asserts against rather than typing a number twice
  - makes a new organization and market on every call, some 180 requests, so a spec seeds it only in a test that needs it

**`seedMarketWithVendors()`**
- Leaves: a draft with a complete plan, a one-field form and two approved vendors
- Notes:
  - the vendors are written into Mongo
  - its review setup decided
  - `dates` gives it more than the one date
  - a CSV market unless `intakeMode` says `form`

**`seedAssignedMarket()`** ([file](../../../front-end/e2e/helpers/seedAssignedMarket.ts))
- Leaves: the above, walked to `assignment` and assigned
- Notes:
  - `run: false` stops before the run
  - `tables` sizes the room
  - `dates` gives it more than one date, a table on each
  - `intakeMode: 'form'` makes its vendors apply on its page, so it has results to publish

**`seedPublishedMarketWithAssignments()`**
- Leaves: the above, in `market_days`, with its slug
- Notes:
  - a `form` market publishes its results first
  - its review setup decided
  - `vendors` seeds others than alice and bob, a table each
  - `namePrefix` starts its name, and so its addresses, with a long one

**`seedApplicantMarket()`** ([file](../../../front-end/e2e/helpers/seedApplicantMarket.ts))
- Leaves, one of:
  - a `form` market in `applications`
  - a `csv` one left a draft for its first import
  - a `form` one left a draft with `draft: true`, to be opened from the rail
- Notes:
  - `fields` gives its form its own questions
  - its review setup decided before it opens, the drafts' too, unless `reviewSetupUndecided: true`
  - it creates no application
  - `seedApplicationDoc()` and `createApplicantLoginChallenge()` write one and a known sign-in code into Mongo

**`seedExampleMarket()`** ([file](../../../front-end/e2e/helpers/exampleCollegeMarket.ts))
- Leaves: a draft on the vendors' own page, with two dates, Gold and Silver, and the Example College form's two choice questions
- Notes:
  - the Example College fixture both `price-groups.spec.ts` and `the-price-answers.spec.ts` share
  - its review setup decided
  - `EXAMPLE_PRICING` and `EXAMPLE_GROUPS` give its three groups and "Everyone else", and it writes no prices itself

**`seedApplication()`, `seedApprovedVendor()`** ([file](../../../front-end/e2e/helpers/seedApplication.ts))
- Leaves: one application, written into Mongo
- Notes: see below

**`seedTheScreens()`** ([file](../../../front-end/e2e/helpers/seedTheScreens.ts))
- Leaves: the stress markets the sweeps walk:
  - one in every phase
  - every market's review setup decided as it is made
  - names of about 70 characters
  - 40 applications in every review state
  - a review divided between the organizer and a Viewer (the organizer's share all decided)
  - every reviewer, verdict giver and follow-up owner it writes on an application carries their user's id, as the server writes them: the organizer's id from `loginViaApi`, the Viewer's read from their stored account
  - 36 vendors over four dates and three sections
  - `SCREENS_EDITOR` an Editor on that market, so a `SCREENS` state signed in as `'editor'` reads Update info with the answers the assignment reads locked
  - settled rules, on a priced market, so Payments draws the market's money and its tables by tier and by date (T180)
  - an archive
  - the CSV markets the import screens serve: one taking applications, a draft with no plan, and a draft with a plan and the Viewer on it, whose first import's preview offers the reviewers
  - an organization of the organizer's own:
    - its name 72 characters and its admin's and member's addresses 32 and 43, found by name on a later run, so Manage organization draws its people
    - holding a draft of its own, made anew on each run and dated after every other seeded market, its admin also Editor on it, so Manage market draws an organization's people and a market role that adds nothing (E38/F12/S01)
    - the organizer always has a second organization, and "the new-market dialog" always draws the organization select rather than naming one (T148)
  - the review market's cards lead with two answers and fold the rest behind "N more answers"
- Notes:
  - for the [sweeps](../../design-system.md#what-keeps-this-true)
  - its applications go in with one `insertApplications()` per market

**`seedFloorplanTemplate()`** ([file](../../../front-end/e2e/helpers/seedFloorplanTemplate.ts))
- Leaves: a floorplan template of the given table types, saved by the signed-in user
- Notes: a seeded template is the user's and outlives every market, so a spec finds its own by the unique name returned

**A vendor is seeded as an approved application**, which is what the solver reads ([ADR 0003](../../adr/0003-applications-are-the-solvers-only-input.md)).
`seedApprovedVendor()` writes the essential answers in the shapes `essential_fields.py` validates into (dates and tiers as the plan's own names, the count an integer, the table choice lower-cased).
The seeds once uploaded a fabricated CSV because the solver read a `source_data` collection; E02 deleted it.
A spec using `seedMarketWithVendors()` or anything built on it therefore exercises no review: the applications arrive approved.

`approvedVendorApplication()` builds the application `seedApprovedVendor()` writes without writing it, and `insertApplications()` writes many in one `insertMany`: every `mongoEval` is a round trip into the container, so a seed of dozens writes them together.

**`seedApplication()` writes one application straight into Mongo**, snake_case and keyed by `market_id` as [the application document](../data/application-document.md) is, with status `open`.
It is how a spec puts an application on a market without signing in as an applicant, in any phase, and so how it reaches [the form lock](../../business/rules/the-form-locks-at-the-first-application.md).

## Reaching a stored assignment

**An assignment is stored by `POST /markets/{id}/assignment`, and by nothing else** ([placements](../modules/placements.md)): that one call runs the solver and keeps what it produced.
It used to be `GET /markets/{id}/assignment`, which only computes, followed by a whole-market PUT carrying the result; `assignmentObject` is what check-in reads, so a stale client copy overwriting it moved vendors on market day (E11/F01/S01), and that PUT is gone (E21/F03/S06).

**A seed walks the market to `assignment` before it assigns** ([assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md)): `applications`, then `assignment`, each through `POST /markets/{id}/transition`, its applications seeded first, since a `csv` market enters `applications` only holding some, the only thing that moves a phase; no request body sets `phase` or `isDraft`.

**Publishing is `assignment -> market_days`**, and that move's entry invariant is that an assignment exists, so `seedPublishedMarketWithAssignments()` assigns before it publishes.
A `form` market must publish its results first ([publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md)), so with `intakeMode: 'form'` the helper calls `POST /markets/{id}/publish-results` in between; absent, the market is a CSV market and needs neither.
It returns the `marketSlug` of the public check-in page, which serves a running market.

## Sharp edges

**The vendor writes into Mongo assume the stack's container is up**, through `mongoEval` ([E2E patterns](e2e-patterns.md#opening-a-market-and-shelling-into-mongo)).
