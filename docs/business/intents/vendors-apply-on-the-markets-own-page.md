---
layer: business
kind: intent
verified: 2026-10-29
sources:
  - E18/F04
  - E26/F07
  - E32/F03
---

# Vendors apply on the market's own page

An organizer may instead take applications on the market's own page: they choose it when creating the market, and share the page's link from the phase rail.
A vendor with no account signs in to that one market with a code sent to their address, applies, changes their answers while applications are open, and reads their application afterwards.
A market that does not take applications online has no applicant surface at all: its addresses answer exactly as a market that does not exist.

## Why

A wrongly hidden application page is visible and gets complained about; a wrongly exposed one is silent until a stranger applies to a market that will never read them.
So the page is on only where the organizer turned it on, and a page that is off confirms nothing to anyone guessing addresses.
A vendor applies once, to one market, so they need no account, only proof that the address is theirs; and a code that never arrives is a vendor who cannot apply, so it is sent before the page answers.
Every applicant answers the same form, which never changes under them once anyone has applied.

## Rules

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): a market takes applications online, or imports, exactly one, chosen at creation.
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md): a market that takes no applications online answers every applicant request as no market at all.
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md): every address that asks is sent a code, and the first valid save creates the application.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): the form is fixed once anyone has applied.
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md): applying is open while applications are, and reading one's application in every phase but draft.

## Flows

- [The online path](../flows/the-online-path.md): the whole path, from creation to the end.
- [Creating a market](../flows/creating-a-market.md): "On this market's own page" puts the market on this path from its first screen.
- [Building the application form](../flows/form-tab.md): the questions an applicant answers, and the preview of them.
- [Taking applications](../flows/taking-applications.md): opening applications, and stopping and taking them again.
- [Applying online](../flows/applying-online.md): the vendor's sign-in, application, edits and outcome.
- [The mixed path](../flows/the-mixed-path.md): applying online beside importing, and why it is not offered.
