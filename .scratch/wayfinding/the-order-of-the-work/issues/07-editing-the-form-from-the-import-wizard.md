# 07: Can the form be edited from inside the import wizard?

Type: grilling
Status: resolved
Blocked by: 03

## Question

When the column mapping reveals the form is wrong - a question it never asked, a question it should stop asking - the wizard cannot fix it.
It prints instructions instead.
The rail says, verbatim:

> "Reopen the market for editing, turn it off in the form builder, then open applications and import again."

Four steps, two phase transitions, and the organizer loses their upload and their partial mapping on the way.

**The constraint is already written down at the point of pain.**
The comment above that block says: *"Turning a question off is a change to the FORM, and a form is editable only in draft (D9). This wizard only ever runs in applications_open, so it points at where to do it rather than offering a button that would be refused here."*
The instructions are an honest dead end given the rules, not laziness.

### What to decide

**Whether a modal here can edit the form and orchestrate the phase transitions invisibly, and what it must refuse.**

The round trip is *legal*, just manual.
`("applications_open", "draft")` is a real edge in `VALID_TRANSITIONS`, guarded only by `_NO_APPLICATIONS_YET` - and during mapping no application exists yet, because none have been imported.
So the seamless version is: drop to `draft`, `PUT /markets/<id>/application-form`, return to `applications_open`, all behind one modal.

Four things that will break it if unhandled:

1. **`FormHasFieldsGuard` gates the way back.**
   `("draft", "applications_open")` requires the form to ask something.
   If the edit empties it, the return transition is *refused* and the market is stranded in `draft`, mid-import, with the organizer given no hint that a phase moved.
   The modal must validate against that guard before it commits anything, not after.
2. **The wizard's state must survive.**
   The uploaded file, the resolved mapping and the cursor position all have to be intact when the modal closes, or this replaces a four-step round trip with a two-step one.
3. **Going to `draft` takes the public application page off the air.**
   Harmless for a CSV market, whose applicant endpoints are gated shut anyway - but decide now whether this control is offered at all on a form-intake market. See ticket 09.
4. **It only works before the import commits.**
   The instant one application exists, D9 freezes the form for good and `_NO_APPLICATIONS_YET` blocks the way back.
   The guard's own docstring says so: "Once one application exists the market cannot return, and the form is frozen for good."
   The modal must be unavailable after step 4, and must say why rather than failing.

### Notes

**The rail has a second dead end of the same shape** - the unmapped-column case in the ledger, which the comment itself calls "the same shape".
Whatever is built here should cover both, or the wizard keeps one dead end and loses the other.

**The advisory's writing is the model, not the target.**
`claims-and-room` ticket 03 already recorded that this importer's explanation "is the best writing in the product, and it is attached to the worst dead end in it".
This ticket removes the dead end; the tone should survive.

Blocked by ticket 03 because whether the form is still editable is exactly what "finalized" will mean.

Findings: `F19` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**The modal is offered from both import phases and orchestrates the whole chain, but it checks every guard on the chain *before* the market moves at all.**

### Two corrections to the ticket

**The wizard runs in two phases, not one.**
`IMPORT_PHASES` is `['applications_open', 'applications_closed']`.
The comment in `CsvImportView.vue` that says it "only ever runs in applications_open" is out of date and should be corrected while this is built.

**`applications_closed -> draft` does not exist**, and is not being added.
`guards.py` states the reason - "a market that has closed applications or begun review has moved past the point where its form is a draft of anything" - and that decision stands.
So from `applications_closed` the chain is four hops:

```
applications_closed -> applications_open -> draft -> [edit] -> applications_open -> applications_closed
                       ^_FORM_HAS_FIELDS   ^_NO_APPLICATIONS_YET   ^_FORM_HAS_FIELDS
```

From `applications_open` it is two.
The modal returns the market to **the phase it started in**, whichever that was.

### Pre-flight, not rollback

Nothing moves until the whole chain is known to succeed.

1. The organizer opens the modal and edits the form. **The phase does not change.**
2. On confirm, the edited form is validated against every guard on the return path - `_FORM_HAS_FIELDS` against the *edited* form, `_NO_APPLICATIONS_YET` against the live application count - server-side, as the authority, with the same rule mirrored client-side so the refusal is immediate.
3. Only when all of them pass does the market leave its phase.

This removes the failure mode the ticket was most worried about: a form edited empty, a refused return, and a market stranded in `draft` mid-import with no hint that a phase moved.
There is nothing to roll back because nothing moved.

**What pre-flight does not cover**, and the build must still answer for: transport failure or a concurrent change between hops.
The modal records the origin phase, and a chain that stops partway must say exactly where it stopped and offer to finish - never fail silently, and never leave the organizer to discover the phase from the rail.

### Consequences

- **An amend re-dates the form.**
  [Ticket 03](03-what-finalized-means.md) clears `publishedAt` on entering `draft` and stamps it on leaving, so the round trip restamps it.
  That is correct under that ticket's rule - the field answers "is this form finalized right now", and the form genuinely changed - but it means an amend is not invisible in the record, only in the organizer's workflow.
- **A form-intake market's public page is off the air for the duration.**
  [Ticket 09](09-who-can-reach-the-public-application-url.md) made that reachable, and import is not gated on intake mode.
  The exposure is bounded by `_NO_APPLICATIONS_YET`: the chain is only possible when nobody has applied, so the page that goes down is one no applicant has used.
  Say so in the modal rather than leaving it to be discovered.
- **Both dead ends, not one.**
  The rail has a second of the same shape - the unmapped-column case in the ledger, which the source comment itself calls "the same shape".
  The modal covers both or the wizard keeps one.
- **Keep the advisory's voice.**
  `claims-and-room` ticket 03 already recorded that this importer's explanation is "the best writing in the product, and it is attached to the worst dead end in it".
  The dead end goes; the tone is the model for what the modal says when it refuses.
