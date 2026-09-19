# 01: What is the one model of a market's lifecycle the organizer sees?

Type: grilling
Status: resolved
Blocked by: -

## Question

The product shows the organizer two parallel, unconnected models of where a market is and what to do next, and they disagree.

**The wizard.**
`MarketSetupView` is a three-page flow with Back / Next, ending in **Assign**, which runs the solver and navigates to Assignment Results, which ends in **Done**.
Nothing in it mentions a phase.

**The phase strip.**
An unlabelled row of pills above the page card offering the transitions valid from the current phase: Open Applications, Close Applications, Begin Review, Begin Assignment, Publish Market, Reopen for Editing, Archive Market.
Nothing in it mentions the wizard.

They disagree in a way that breaks the happy path.
**Assign does not move the phase**, so after import -> triage -> Assign the market is still `applications_open`.
`Done` posts `toPhase: 'market_days'`, which is only valid from `assignment` or `offers`, so it 400s with `Transition from 'applications_open' to 'market_days' is not available in the current phase` - two internal enum values, neither of which appears anywhere in the UI, and advice that is circular.
The route that does work is four manual clicks in the strip the wizard never mentions.

The same split produces five names for publishing:

| Label | Where | What it does |
| --- | --- | --- |
| Done | Assignment Results, bottom right | `-> market_days`, unconfirmed |
| Publish Market | Phase strip, in `assignment` | `-> market_days`, confirmed |
| Begin Market Days | The confirm button inside that dialog | the same transition again |
| Publish Results | Applications tab, top right | a different endpoint entirely |
| Archive Market | Phase strip, red, every phase | `-> archived` |

**This is not "what does publish mean".**
`CONTEXT.md` settles that: Publish is `assignment -> market_days`, and [real-market-readiness ticket 06](../../real-market-readiness/issues/06-is-published-a-phase.md) settled it deliberately.
The domain model is right and the UI has not caught up.

**The question is what the organizer navigates.**
Does the wizard drive the phase, so that finishing a step advances it and the strip becomes a read-only indicator?
Does the strip drive, so the wizard loses its terminal actions and becomes pure editing?
Is there one control at a time - "what's next" - rather than a strip of everything valid?
And what survives: `Publish Results` is enabled on a market with zero applications and zero assignment and nothing on screen says what "results" means.

Confirmation is also inconsistent and should fall out of the same answer: `Publish Market` confirms, and its dialog talks about pending offers and refusals, a concept the MVP organizer has never met; `Done`, `Close Applications`, `Begin Review`, `Begin Assignment` and `Archive Market` do not confirm at all.

Report findings: **B2**, **H4**.

## Answer

**The phase is the model. The wizard is a plan editor and loses every lifecycle control it has.**

The phase machine is already the source of truth: guarded per edge, validated at import by
`_validate_registry()`, mirrored deliberately in the front end, and `CONTEXT.md` is written in its
vocabulary.
Nothing about it needed replacing.
What the wizard was doing was modelling the lifecycle a second time, badly, and B2 is what that
disagreement produces.

The wizard's pages were never lifecycle steps.
They are three views of one editable object - the plan - and the ordering they imply does not exist
in the data.
The dependency worth respecting (tiers and locations before sections can reference them) lives
**entirely inside page 1**; the only cross-page dependency is dates bounding the max-assignments
clamp, which is weak.

### What the organizer sees

**A horizontal rail below the market header**, on every market screen.
Not in the header: that bar already carries the market name and three tabs and is not roomy at
1280px, and the tabs stay where they are.

The rail shows **the lifecycle spine** - the phases in order, with the market's position marked -
plus the forward action as the one prominent button.
Back and destructive edges (`Reopen for Editing`, `Reopen Applications`,
`Return to Applications Closed`, `Archive Market`) go into a secondary menu.
That fixes `transitionVariant()`'s fall-through by construction rather than by patch: `draft` is the
one unambiguously backwards edge and it currently falls through to `advance`.

The spine answers "where is this market" at a glance, which matters because the organizer has just
lost the wizard's sense of progress and this is what replaces it.
**A market that leaves the spine freezes it at the last stage it reached.**
A draft abandoned straight to `archived` does not need the spine to represent abandonment; it needs
the spine to stop advancing, which is what a frozen rail says.
`offers` is out of scope for MVP and is not on the spine.

### The plan editor is one page

Not three wizard pages, not three tabs.
The pages have no ordering worth enforcing, so paging imposes a sequence the data does not have -
the same mistake as the wizard pretending to be the lifecycle, one level down.
Tabs are out because there are already three tabs in the header and nesting a second strip inside
one is worse than either.

One page fixes three things at once: the dead space on the dates page and the options page
disappears; **`setupPageIdx` stops existing**, so the "a new market skips Market Dates" bug is
deleted rather than patched; and an organizer changing a date can see the assignment options that
clamp to it without navigating.

### Assign is an operation, not a transition

It runs inside the `assignment` phase and may be repeated there.

The machine already says everything it needs to.
`assignment` carries the entry invariant `_ALL_REVIEWED`, so *entering* is the gate - that is what
"you may not assign before reviewing" means, expressed once, server-side.
`market_days` carries `_ASSIGNMENT_COMPUTED`, so "you must have run it before you can publish" is
also already expressed.
Between those two the solver in the middle is just a button, which is what an organizer tuning
max-assignments actually needs.
Making it a side-effect of `review -> assignment` would force the transition to be either once-only
or re-firable, and both are worse.

**Assign is frozen past `assignment`.**
Today it is gated only on `assignmentOptionsComplete` and never on phase, so it is enabled on a
published market whose check-in page is serving table numbers.
The escape valve is manual editing, which admins may do without restriction - see
[08](08-where-a-manual-placement-lives.md).
**This freeze should not ship before manual edits do**, or an organizer whose vendors drop out on
the morning of the market has no move but to archive a running market.

### "Done" disappears

There is nothing left for it to mean: publishing is a transition on the rail, and "I have finished
looking at this" is what leaving a page already is.
**Assignment Results becomes the assignment phase's screen** - a fourth tab beside Application Form,
Market Setup and Applications, rather than a route the organizer is pushed to.
Its button row keeps Download CSV and Send to Discord, which are the two things there that are
actually actions.

### "Publish Results" is correctly named and has no audience

It flips `resultsPublished`, which is what makes a reviewer's verdict visible to the applicant
instead of `under_review`.
That is a real action and the label is right.
But every endpoint that reads it goes through `applicant_intake_market_by_slug`, which serves
**form-intake markets only** - and intake mode defaults to `csv` with no UI to change it.
On every market this product can currently create, the flag has no reader.

**It is conditioned on intake mode**: present on form markets, absent on CSV.
It therefore disappears from MVP in practice, which is the honest outcome, while the code keeps the
concept rather than losing it and having to re-derive it.
The condition belongs beside the existing gate, not as a fourth check somewhere new: `AGENTS.md` is
explicit that the single-lookup shape exists because "five checks are five chances to forget the
sixth".
On a form market with nothing reviewed it is disabled with its reason, not silently absent.

### Confirmation follows the machine

**The hard-to-reverse edges confirm; nothing else does.**
That is already the set the product confirms - `market_days` and `archived` - so the policy was
right and only the copy is wrong.
It should be **derived from `VALID_TRANSITIONS`** (an edge whose target has no route back) rather
than hard-coded, so it stays right as the table changes.
`archived` has no outbound edges at all and `market_days` reaches only `archived`; everything else
has a documented reverse edge.

The publish dialog's copy is replaced.
It currently reads "No offers are pending - no vendors will be marked refused", fetched from
`/pending-offers-count`, which is about a feature MVP does not have and will always return 0.
It should say that a **public check-in page goes live**, which is what actually happens and the
thing the organizer cannot take back.

### Consequences for other work

- **[06](06-where-the-check-in-url-lives.md) is unblocked and widens.**
  Its prototype should draw the whole rail, not only where the check-in URL sits.
  Two things in this answer are prose that ought to be pictures: whether the spine survives eight
  phases at 1280px, and whether a frozen rail reads as "finished" rather than "broken".
  If the spine cannot carry abandonment legibly, fall back to current-phase-plus-one-action.
- **[07](07-what-a-market-row-says.md) is unblocked.**
  The market row can now carry a phase, because the organizer has somewhere to have learned what a
  phase is.
- **`E09/F05/S02`**: the `setupPageIdx` half is superseded if the one-page editor lands first.
  The no-market guard half is independent and stays.
- **`E09/F01/S02`**: making the invisible "Current Phase:" label visible still stands - the rail
  needs a label too - but "the strip reads as label plus state plus actions" is this answer's
  business, not that story's.

Buildable work: `.scratch/backlog/E10-one-lifecycle-model/`.
