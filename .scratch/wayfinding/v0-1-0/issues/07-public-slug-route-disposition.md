# 07: What does the public slug route render?

Type: grilling
Status: resolved
Blocked by: 06

## Question

Ticket 06 settled that intake mode gates `/:marketSlug` along with `/apply`, `/applicant-login` and `/applicant/dashboard`, and that check-in at `/:marketSlug/check-in` stays open to everyone.
It did not say what a visitor to a gated route actually sees, and `MarketHomeView.vue` is a 22-line stub that prints the slug back.

Decide what the public slug route answers, for a CSV market and for a form market.

## Answer

### A gated market answers exactly as a nonexistent one does

**404.** A visitor who guesses the slug of a CSV market gets the same response as a visitor who invents a slug: not found.

The alternative considered was a neutral notice page saying the market is not accepting online applications.
It is friendlier, but it confirms the market exists to any stranger who guesses, which is the same class of leak the fail-closed default in ticket 06 exists to prevent.
Between a stranger learning nothing and a stranger learning that an organizer they have never met is running a market, MVP takes the first.
Redirecting to check-in was rejected outright: it turns a stranger's typo into a vendor-facing page.

This makes the rule uniform across all five gated surfaces.
A gated market is invisible on the applicant side and fully visible on the check-in side, and neither side has to reason about the other.

### A form market keeps the stub, untouched

`MarketHomeView.vue` stays exactly as it is.
Form intake is off the MVP path, so the market's public landing page has no MVP content to render and no MVP visitor to render it to.

### Consequence: designing a public market landing page is out of scope

This was the live reason the `MarketHomeView` disposition sat in the map's fog.
It is now a scoping decision rather than an open question: MVP never serves that page, so there is nothing to design.
It returns with form intake, not before.
