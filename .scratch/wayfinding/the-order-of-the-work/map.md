# Map: The order of the work

Charted 2026-09-21, from the findings in `.scratch/qc/2026-09-21-manual-qc.md`.

## Destination

An organizer builds a market in the order the work actually happens, on screens whose controls were decided once.
The way is clear when nothing remains to decide before that can be built; the resulting backlog in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.**
A manual quality-control walk on 2026-09-21, dictated screen by screen against `dev @ 26cf49fe` on the primary stack, covering sign-in, the markets list, the organizations screen, the market workspace (all four tabs), the form builder, the CSV import wizard and the phase rail.
The report is `.scratch/qc/2026-09-21-manual-qc.md`; every ticket here cites its findings by number (`F01`-`F19`), its one policy (`P1`) and its open questions (`Q1`-`Q8`).
Read the report before taking any ticket - each finding carries the source-level mechanism that was verified while recording it, and several of those mechanisms are the answer.

**What the walk actually found.**
Two classes of problem, and they want different treatment.

The first is that **the workspace presents the market-building journey as four peer tabs and six simultaneous cards, when the work has a real order** - and the back end already knows that order and says so.
`essential_fields.py` opens with "The offering is never an independent list: it is the market plan itself", so the application form cannot offer anything until the plan is decided; yet the tab bar puts Application Form first.
Assignment Priority and Assignment Options sit in the earliest stage and are usable only in the latest.
Table types are a question the form asks and no screen lets an organizer answer.
That is tickets 01 through 03, and it is the spine of this map.

The second is that **there is still no shared control layer**, which `E16` began and did not finish.
The add-row `+` has no owner: `.add-container` appears in four components and is styled in none of them, `.icon-add-round` is declared identically in five files, and one card's markup names a class that matches nothing.
The drag handle is two 0.8px hairlines at 25% opacity with a hardcoded hex.
A field in the create-market dialog is `all: unset` inside a container that declares a radius and no border.
None of those carry a decision; they are ticket-free and become an epic.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default.
`CLAUDE.md` is dense and authoritative on this codebase's sharp edges, and its sections on the essential-questions contract, phase transitions and the design language all bear directly on tickets here.
`docs/design-system.md` is the single statement of what this product looks like; `front-end/src/assets/primitives.css` owns the controls.

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **The vocabulary is fixed.**
  The walk agreed it explicitly, and it is recorded at the top of the report: **the market workspace** is the whole page, **the settings panel** the white container, **the tab bar** and **a tab** the four buttons, **the phase rail** and **a phase** the lifecycle band, **the plan** what the Market Setup tab edits, and **a plan card** each of the six.
  "Market Setup" now names the tab and never the page.
  The tabs are not states; market state lives in the phase rail alone.
- **Eleven findings carry no decision and should not wait behind any ticket.**
  `F01`, `F02`, `F04`, `F06`, `F07`, `F09`, `F10`, `F13`, `F14`, `F15` and `F17`, plus `P1`.
  Each has exactly one right answer and a verified mechanism.
  They are the `E09` / `E14` / `E15` pattern, fourth time round, and they become an epic charted with this map.
  Three more - `F03`, `F05` and `F12` - are fixes whose surfaces a ticket may delete; each is noted in the ticket that could moot it, and each should be fixed on its own if that ticket sits.
- **The add-row `+` and the drag handle are one problem, not eleven.**
  `F07`, `F10` and `F14` are the same absence - a control nobody owns, re-decided per file - and `.btn` in `primitives.css` is where the answer belongs.
  Fixing `F07` alone leaves the other four cards centred by coincidence, which the report measured.
- **`published_at` exists, is read in two places, and is never assigned.**
  This was verified across the whole back end.
  It is why ticket 03 exists as its own question rather than as a line in ticket 01: three separate items (`F11`, `F19`, `Q5` step 3) all need "finalized" to mean something, and today it means nothing.
- **Intake mode is the reason the public application URL cannot simply be shown.**
  `applicant_intake_market_by_slug()` gates every applicant endpoint on `intakeMode === 'form'`, absence means `csv`, and MVP ships no control for it deliberately.
  Ticket 09 is therefore a product decision wearing a button, which is why it is a ticket and not a fix.
- **The CSV importer is more flexible than the applicant form, not less.**
  `_assembled_rows` already accepts a per-date tier grid *and* a flat tier list and normalises both.
  The applicant validator accepts one shape.
  Ticket 05 is about widening the form to match, with storage staying canonical - not about teaching the importer anything.
- **`CsvImportView.vue`'s full-width shape was prototyped and written down.**
  Its header records that the column-ledger "won a three-variant prototype" and that a dialog was rejected because mapping a dozen columns is too dense for one.
  Ticket 06 may still reverse it, but must argue against that finding rather than around it.

## The tickets, and the order to take them

Ten tickets.
`Blocked by` in each file is the authority; this is the same graph read forwards.

```
01 the order of the work ──┬──> 02 what the draft workspace looks like
                           └──> 03 what "finalized" means ──> 07 editing the form from the import wizard

04 what the form asks, and in how many shapes ──> 05 which answers matter for review

06 what shape is the import flow          (independent)
08 what a dialog is in this product       (independent)
09 who can reach the public application URL  (independent, informs 07)
10 when may an organization be deleted    (independent)
```

**Frontier: empty.** Ten tickets resolved 2026-09-22 in the order recommended above; ticket 11 graduated from the fog and resolved the same day.

The way is clear, and the buildable work is charted:

| Epic | Outcome | From |
| --- | --- | --- |
| [E17](../../backlog/E17-corrections-the-fourth-walk-found/epic.md) | Corrections the fourth walk found | the eleven findings that carried no decision |
| [E18](../../backlog/E18-the-workspace-follows-the-phase/epic.md) | The workspace follows the phase | tickets 01, 02, 03, 09, 11 |
| [E19](../../backlog/E19-the-form-asks-what-a-real-form-asks/epic.md) | The form asks what a real form asks | tickets 04, 05 |
| [E20](../../backlog/E20-dialogs-and-the-dead-ends-they-remove/epic.md) | Dialogs, and the dead ends they remove | tickets 08, 07, 06, 10 |

**E17 has no blockers and is the cheapest to ship first.**
E18, E19 and E20 are independent of one another at the epic level and can run in parallel; the one ordering that matters is **inside** E20, where `F01` (the dialog idiom) must land before `F03` and `F04`, which each build a dialog from it.
E19's form-builder work and E18's draft page both touch the form builder, so they should be sequenced against each other at story level rather than at epic level.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: What order does building a market actually happen in?](issues/01-the-order-of-the-work.md):
  **the phase spine is already right; the workspace will follow it.**
  Computed from `VALID_TRANSITIONS` rather than assumed, the spine is
  `draft -> applications_open -> applications_closed -> review -> assignment -> market_days -> archived` -
  so the `assignment` stage the walk thought was missing has existed all along, and
  `assign_phase_refusal` already enforces it. Nothing in the transition table or `guards.py` changes.
  What changes is the workspace: surfaces follow the phase instead of four peer tabs laid over seven
  phases, and Assignment Priority, Assignment Options and the Assign button leave Market Setup for
  the `assignment` surface. **`draft` carries two ordered stages** - the plan, then the form built
  from it - because that is the one dependency the phase machine cannot express and it is real;
  presenting it is ticket 02's. **Table types stay stubbed for MVP**, now as a documented decision
  rather than a hole: only a floorplan can describe a per-table property, and MVP does not ship one.

- [04: What does the application form ask, and in how many shapes?](issues/04-what-the-form-asks-and-in-how-many-shapes.md):
  **one input method - the one a real form already uses - and the storage contract does not move.**
  Reproduced against the committed export rather than assumed: that Google Form asks *one* grid
  question ("choose all tiers... Choose None if you are not available"), date in the header, tiers
  in the cell; Conventioner's applicant form asks *two*. The import path already handles the real
  shape and is tested against it, so the applicant form is the half that is wrong. It becomes one
  grid with an explicit **Not available** choice, replacing the two questions rather than joining
  them. `{date: [tiers]}` stays canonical with availability derived - backwards compatibility is a
  property of the stored contract, not of the control - and the widening moves out of
  `_assembled_rows` into `essential_fields.py`, which owns this contract. **Preferred name** joins
  as essential-but-not-required, and `VendorIdentity.vue` shows preferred falling back to full.
  `F12` is unaffected and moves to `E17`.

- [03: What does "finalized" mean, and what writes it?](issues/03-what-finalized-means.md):
  **leaving `draft` is finalizing; the transition stamps `publishedAt`, and returning to `draft`
  clears it.** No new act for an organizer to discover, and no new guard: `FormHasFieldsGuard`
  counts *plan-derived* asked keys, so it already refuses a market whose plan offers nothing and
  whose form therefore asks nothing. Only the stamp was missing. The field is **not** a restatement
  of `phase != draft`, because `draft -> archived` exists and does not stamp it - a market published
  straight from draft never opened its form to anybody; if that edge ever goes, the field becomes
  derivable and should be deleted. **`F11` does not survive**: it asked for the opposite order to
  the one ticket 01 settled, and what replaces it is phase-driven routing, not a patched
  `tabFromRoute()`.

- [09: Who can reach a market's public application URL?](issues/09-who-can-reach-the-public-application-url.md):
  **the intake-mode control ships, settable in `draft` only; the application chip follows it.**
  CLAUDE.md's reason for withholding the toggle - that it "would advertise a surface MVP withholds" -
  no longer holds: the applicant surface is built and switched off, not withheld, and
  `ApplicationPage.vue` already answers correctly in every phase. Absence still means `csv`, so the
  default keeps failing closed and no migration is needed. The chip copies and opens, follows the
  rail's `checkin-chip` pattern, and is shown in *every* phase of a form-intake market - the
  opposite of the check-in chip's rule, deliberately. A CSV market shows no chip and its `/apply`
  URL keeps answering exactly as a market that does not exist. **CLAUDE.md's Intake Mode section
  needs amending** on that one point.

- [02: What does the draft workspace look like?](issues/02-what-the-draft-workspace-looks-like.md):
  **one scrolling page, sections in dependency order, full width, with the form gated until the plan
  offers something.** Not a step wizard - the ticket's own constraints (resumable, and never forcing
  a walk-through to change one value) rule one out, and an ordered page communicates order by
  position instead of enforcing it by navigation. It also survives into later phases unchanged, so
  there is one layout for this data rather than two. The gate must read `FormHasFieldsGuard`'s
  plan-derived asked keys, never a count of custom fields, and must say *what* is missing.
  **Market dates become a calendar with the market's days marked** - which uses the width, reads the
  same at two dates and twelve, and **dissolves `F05`** since there is no native date input left to
  position. It must be built against `date-display-timezone.spec.ts`: month arithmetic is the most
  likely place to reintroduce the calendar-day-versus-instant bug. The `.plan-row--triple` sizing
  truce ends rather than being rebalanced.

- [05: Which answers matter for review?](issues/05-which-answers-matter-for-review.md):
  **review highlights are a list of answer keys on the market, never on the form; marked answers
  lead the card and the rest collapse behind a disclosure.** The freeze decides where it lives - an
  organizer learns what they needed *while reviewing*, which is after the form locks, so a flag on
  `FormField` would freeze exactly when it becomes knowable. Off the form it also marks essential
  answers, which are not `FormField`s and could otherwise never be highlighted. Authored in the form
  builder, adjustable from the review queue: one store, two writers. A flag, not a rank. The
  disclosure must persist across cards, name its count, and disappear entirely when a market has
  marked nothing. `reviewAnswers()`'s custom-first heuristic goes, having been standing in for this
  all along. **Three notions of "matters" now exist** - `required`, `SOLVER_RELEVANT_KEYS`, review
  highlights - and `CONTEXT.md` must keep them apart.

- [07: Can the form be edited from inside the import wizard?](issues/07-editing-the-form-from-the-import-wizard.md):
  **yes - offered from both import phases, orchestrating the whole chain, with every guard checked
  before the market moves at all.** Two corrections to the ticket: the wizard runs in
  `applications_open` *and* `applications_closed` (its own comment is out of date), and
  `applications_closed -> draft` does not exist and is not being added - `guards.py`'s reason stands -
  so from a closed market the chain is four hops back to the phase it started in. Pre-flight rather
  than rollback: the form is validated against `_FORM_HAS_FIELDS` and `_NO_APPLICATIONS_YET` before
  anything transitions, so the stranded-in-draft failure cannot happen. An amend re-dates
  `publishedAt`, which is correct under ticket 03 but not invisible. Covers both of the rail's dead
  ends, not just the one.

- [06: What shape is the CSV import flow?](issues/06-what-shape-is-the-import-flow.md):
  **it stays a full-width page; `.import-view` caps at `--workspace-max` and centres, and the narrow
  steps centre their 720px panel inside it.** Not a modal: that would reverse a decision the file's
  own header records as the winner of a three-variant prototype, and nothing this walk found is
  evidence against it. The white space was never a disagreement with that decision - the view simply
  never joined the sizing model, declaring padding and no `max-width` while every other screen picks
  one of the two named widths. The shell stays constant across steps rather than resizing under the
  organizer. **Settled on the evidence without a round trip**; reopen if the prototype's finding is
  thought stale.

- [08: What is a dialog in this product?](issues/08-what-a-dialog-is-in-this-product.md):
  **a native `<form>` in a modal, doing one small thing, which stays open until the organizer closes
  it.** The create-market dialog stays a modal and shrinks to name plus organization, handing off to
  ticket 02's draft page - a modal rather than a first section because a market must not exist until
  the organizer commits, or every abandoned attempt leaves an empty draft. Four rules for every
  dialog: the form element answers `P1`, since six views already get Enter free that way and it makes
  "same guard as the button" and "disabled means inert" automatic rather than remembered; closing
  never means saved and saving never closes (`F08`); a field looks like a field via `.field`, which
  answers `F03` and releases it from `E17`; errors sit in flow, not absolutely positioned. Enter in a
  textarea and in a row editor stays open - neither is a dialog.

- [10: When may an organization be deleted?](issues/10-when-may-an-organization-be-deleted.md):
  **refused while it holds a mid-lifecycle market; drafts and archived go with it; orphaning stops
  existing.** Owner-only stays as the authority rule and gains the safety rule it never had.
  **Recorded risk, raised and reaffirmed:** `published_market_by_slug` defines published as
  `phase != draft`, so an archived market is still publicly served and holds the placement record of
  a market that ran - deleting it takes a live check-in URL down and destroys that record. The
  confirmation must therefore name what it destroys per market, and the deletion must leave a trail.
  The `organizationId = None` update is **deleted, not kept as a fallback**: keeping it would
  preserve the exact state this answer exists to prevent. The check lives with
  `delete_organization`, not in `guards.py`, which is for phase transitions only.

- [11: Do the three application phases get three surfaces, or one?](issues/11-the-three-application-phases.md):
  **one Applications surface in three states; the transition table stays untouched.** Measured
  rather than assumed: `review_application` has **no phase gate**, so verdicts can be recorded from
  the first application - `review` is the phase after which reviewing must be *finished*, not the
  one in which it happens. Import spans `applications_open` and `applications_closed` and stops only
  at `review`, and `applications_closed` changes nothing at all for a CSV market. Three screens would
  mean two near-identical ones on every market the product serves today. The phases are **not**
  collapsed: `applications_closed` is meaningless only for CSV, and ticket 09 just made form intake
  real, where "applications have closed" is a genuine state. **Accepted risk:** the rail shows three
  steps over one place, so the surface must *say* which state it is in rather than merely hiding a
  button.

## Not yet specified

- **What Enter does outside a dialog.**
  Ticket 08 settled the dialog contract and deliberately left two cases: a multi-line textarea, where Enter types a newline and must not submit, and a row-based editor, where it might reasonably add a row.
  Small, but `P1` is a product-wide policy and these are the two places it does not yet reach.

- **Whether `draft -> archived` survives.**
  Ticket 03 noted that `publishedAt` is only non-redundant *because* that edge exists and does not stamp it; ticket 10 noted that the edge is why an archived market is publicly served and holds a placement record.
  Two answers now lean on one legacy publish path.
  If it is retired, both want revisiting - recorded so that is a decision and not an archaeology problem.

## Out of scope

Ruled beyond this destination.

- **Billing, plan limits, invoicing, and price per tier.** Inherited.
- **Offers, and applicant accept/refuse.** Inherited; `.scratch/backlog/E05-post-mvp-offers/`.
- **Outcome notification emails.** Inherited; the mailer sends auth mail only.
- **Full responsive support below laptop widths**, except the check-in page. Inherited.
- **Deployment, hosting, and Vercel configuration.** Inherited; owned by the user directly.
