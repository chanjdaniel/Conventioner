# 09: Who can reach a market's public application URL, and how does an organizer see it?

Type: grilling
Status: resolved
Blocked by: -

## Question

Nothing in the organizer's view exposes the market's public application URL (`/<market-slug>/apply`).
An organizer cannot copy it to send to vendors, and cannot see what an applicant sees.

The asked-for control is compact: one button, to the right of Close Applications, that both **copies the URL** and **opens the application page**, visible in **every phase** - before applications open, while open, and after they close - so the organizer can always check what a visitor gets.

**There is already a pattern to follow, three lines up.**
The rail has a `checkin-chip` (`phase-rail-checkin`): a label, the URL as a link, and a Copy button that flips to "Copied" for two seconds.
Note its visibility rule is the opposite of what is wanted - it appears only in `market_days`, with the comment *"Only a published market has one. Before that it would be a link to a 404."*

**And the blocker: the URL is a 404 for every MVP market.**
`applicant_intake_market_by_slug()` (`back-end/market_documents.py:361`) gates every applicant endpoint on `intakeMode === 'form'`, and **absence means `csv`** - deliberately, so the applicant surface fails closed.
CLAUDE.md records that MVP ships no UI control for intake mode, because every MVP market is CSV and "a toggle would advertise a surface MVP withholds."
So today this button would offer every organizer a link to a page that answers exactly as a market that does not exist.

### What to decide

**Whether MVP markets can take applications by form, and therefore whether this control has anything to point at.**

Three options, and one must be chosen before the control is built:

- **Show the chip only for `intakeMode: 'form'` markets.**
  Correct, and invisible in MVP - which means building a control nobody sees.
- **Ship the intake-mode control too**, so an organizer can choose.
  CLAUDE.md says withholding it is deliberate, so this is a product decision, not a UI one.
- **Decide MVP markets should take applications by form**, which is a much larger change and reaches ticket 01's order.

A second thing the answer has to cover: **what the applicant page shows in each phase.**
The ask is that an organizer sees what a visitor sees in all three states, so the control's value depends entirely on `ApplicationPage.vue` having a real answer for "not open yet" and "closed".
If it 404s or shows an empty form in those phases, the button ships a link to a broken page.

### Notes

**One remedy is forbidden.**
Do not add a "this market does not accept online applications" message on the public page.
CLAUDE.md is explicit that a gated market must answer exactly as a market that does not exist: a distinct message tells any stranger guessing slugs that the market is real.
`front-end/e2e/intake-mode.spec.ts` asserts the gated and absent renders are identical.

This ticket also bears on ticket 07, whose modal drops a market to `draft` mid-import - harmless for a CSV market, but it would silently close a form-intake market to applicants for the duration.

Findings: `F16` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**The intake-mode control ships, settable in `draft` only. The application chip then has something to point at, and is shown only for a market whose intake is `form`.**

CLAUDE.md's reason for withholding it - "every MVP market is CSV, and a toggle would advertise a surface MVP withholds" - no longer holds.
The applicant surface is not withheld; it is **built and switched off**: the apply page, the applicant login, the applicant dashboard and their e2e seeds all exist, and `ApplicationPage.vue` already renders a phase badge and an `apply-closed` block naming the phase for markets that are not open.
Nothing is being advertised that does not exist.

### Decisions

**1. Intake mode becomes an organizer choice in the `draft` phase, frozen afterwards.**
That is the behaviour the back end already implements - `update_market()` freezes it from the stored phase - so this is a control over an existing rule, not a new rule.
It belongs to the plan stage of draft ([ticket 01](01-the-order-of-the-work.md)), because it decides what the form is *for*.

**2. Absence still means `csv`.**
The default does not move.
Wrongly hiding an application surface is visible and gets complained about; wrongly exposing one is silent until a stranger applies.
No migration, no backfill.

**3. The application chip is shown only when `intakeMode === 'form'`**, in every phase of such a market - before applications open, while open, and after they close.

> **Corrected while building (`E18/F04/S02`, 2026-09-23): not in `draft`.**
> This answer reasoned that the apply page "already answers correctly in every phase". That is true
> of a *published* market. A draft one is not published, so `published_market_by_slug` excludes it
> and the URL redirects to an applicant login showing the SLUG rather than the market - revealing
> nothing, correctly, because a draft must not be discoverable. A chip there would hand the
> organizer a link to a page that deliberately tells them nothing. The chip therefore starts at the
> first non-draft phase, which is the check-in chip's own reasoning at a different threshold.
It copies the URL and opens the page, following the `checkin-chip` pattern already in the rail (label, link, Copy that flips to "Copied").
Its visibility rule is the *opposite* of the check-in chip's deliberately: the check-in chip is restricted to `market_days` because before that it would be a link to a 404, whereas this page has a real answer in every phase.

**4. A CSV market shows no chip at all**, and its `/apply` URL keeps answering exactly as a market that does not exist.
Do not add a "this market does not accept online applications" message.
CLAUDE.md is explicit, and `front-end/e2e/intake-mode.spec.ts` asserts the gated and absent renders are identical - a distinct message would tell any stranger guessing slugs that the market is real.

### Consequences

- **The two applicant-login endpoints keep their uniform response.** They must not gain a 404 of their own; that would be an oracle saying "this slug is a CSV market" where every other answer says nothing.
- **[Ticket 07](07-editing-the-form-from-the-import-wizard.md) now has a live hazard.** Its modal drops a market to `draft` mid-import, which takes the public application page off the air. For a CSV market that is harmless, but the import wizard is reachable by a form-intake market too, so that ticket must decide whether the control is offered there or refused.
- **[Ticket 04](04-what-the-form-asks-and-in-how-many-shapes.md)'s work is now reachable by applicants.** The combined dates-and-tiers grid stops being a form-builder preview and becomes what a stranger fills in.
- **CLAUDE.md's Intake Mode section needs amending** where it says MVP ships no UI control for it deliberately. Everything else in that section stands.
