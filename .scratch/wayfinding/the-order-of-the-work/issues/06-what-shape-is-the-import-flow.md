# 06: What shape is the CSV import flow?

Type: grilling
Status: resolved
Blocked by: -

## Question

The import wizard carries a lot of white space, and the cause differs by step.

- `.import-view` declares padding and **no `max-width` at all**.
  Every other screen picks one of the two widths CLAUDE.md names - `--workspace-max` (1440) or `--list-max` (1100) - and `MarketsView`, `OrganizationsView`, `TablesView`, `VendorsView` and `AttendanceStatusView` all do.
  This view opted out of the sizing model rather than choosing within it.
- **Three of the four steps are narrow.** Upload, Preview and Confirm render `.import-panel`, which is `max-width: 720px` - a 720px panel stranded on an uncapped page.
- **One step is wide.** Map columns renders `.import-map`, a grid of `minmax(0, 1fr)` plus a 280px rail, which genuinely wants the room.

So a single width for the whole wizard cannot be right: the step that needs width and the steps that do not share one shell.

### What to decide

**What shape the import flow takes, given that its steps disagree about how much room they want.**

Candidate answers, none free:

- **Cap the view at `--workspace-max` and centre it.**
  Smallest change, keeps the recorded full-width decision, leaves the three narrow steps still adrift inside 1440.
- **Let each step choose its own width, centred.**
  Honest to the content; means the shell resizes between steps, which can read as jumpy.
- **Modal for the narrow steps, full page for mapping.**
  Splits one flow across two presentations.
- **Modal throughout.**
  Directly contradicts the prototype finding below.

### Notes

**Read the file's own header before deciding.**
`CsvImportView.vue` opens with: *"A full-width flow rather than a dialog: mapping a dozen columns against a target list is too dense for one, and Market Setup already carries dates, sections, tiers, priorities and the form builder."*
It goes on to record that the column-ledger shape *"won a three-variant prototype"*.
"Make it a modal" is a reversal of a decision that was prototyped and written down.
That does not make it wrong, but it has to be argued against what that prototype found, not around it.

Whatever is decided should put this view back inside CLAUDE.md's sizing model - "a screen is one of two widths and never caps its own height" - rather than beside it.

Findings: `Q7` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**It stays a full-width page. `.import-view` gets `max-width: var(--workspace-max)` and centres, and the narrow steps centre their panel within it.**

Not a modal, in whole or in part.

### Why this is not a reversal of anything

The walk offered "perhaps by making the import CSV a modal, or centering it", and the second of those is the answer.
Making it a modal would reverse a decision that was prototyped and written into the file's header - the column ledger "won a three-variant prototype", and a dialog was rejected because "mapping a dozen columns against a target list is too dense for one".
Nothing this walk found is evidence against that finding.
What it found is that **the view never joined the sizing model in the first place**: `.import-view` declares padding and no `max-width` at all, while every other screen picks `--workspace-max` or `--list-max`.
That is a gap, not a disagreement.

### The shape

- **The view is capped at `--workspace-max` and centred.** One constant shell for all four steps.
- **The narrow steps centre their panel inside it.** Upload, Preview and Confirm keep `.import-panel`'s `max-width: 720px` and stop being left-aligned in an uncapped page, which is the white space that was reported.
- **Map columns keeps the room it needs.** `.import-map` is `minmax(0, 1fr)` plus a 280px rail and genuinely wants the width.

The shell does not resize between steps.
Letting each step size its own shell was the honest-to-content option and was rejected: a flow whose page width changes under the organizer as they press Next reads as instability, and the wizard already has a step indicator doing the job of saying where they are.

### Consequences

- **It matches the draft surface.** [Ticket 02](02-what-the-draft-workspace-looks-like.md) made draft one full-width page capped at the same token. The import wizard is an `applications_open` / `applications_closed` surface in the same workspace, and both now obey "a screen is one of two widths and never caps its own height".
- **It leaves room for [ticket 07](07-editing-the-form-from-the-import-wizard.md)'s modal.** A dialog opened *from* this page is a different thing from the page being a dialog, and that distinction only holds while the page is a page.
- **`.import-panel h2` and `.import-ledger h2` are already correct** at `--text-lg`, which the scale reserves for section headings and card titles. Nothing to change there.

### Decided without a round trip

This one was settled on the evidence rather than put to the walker: the modal option was already closed by a recorded prototype, and the remaining choice - where the narrow panels sit inside a capped page - has one answer that does not make the shell jump.
Reopen it if the prototype's finding is thought to be stale.
