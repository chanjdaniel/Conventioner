# Map: Conventioner v0.1.0

Charted 2026-09-12.

## Destination

Conventioner v0.1.0: an organizer can create a market, set up its tables, import their vendors from a Google Forms CSV, review them, and run assignment - on a deployed instance any organizer can use.
The way is clear when nothing remains to decide before that journey can be built, and the resulting Epic/Feature backlog in `.scratch/backlog/` is the by-product.

## Notes

**Domain.** Markets belong to organizations and move through a phase state machine (`back-end/guards.py`).
Vendors reach a market as `Application` records.
Assignment is a constraint solver (`back-end/assignment/assignment.py`) that today reads a CSV-shaped `source_data` blob addressed by positional column indices.

**Skills every session should consult.** `grilling` and `domain-modeling` by default; `prototype` for the mapping-UX ticket; `tdd` and `no-mistakes` once implementation starts.
`AGENTS.md` is dense and authoritative on this codebase's sharp edges - read it before touching markets, phases, or secrets.

**This map is planning.** Resolving a ticket produces a decision, not a deliverable.
Buildable work goes to `.scratch/backlog/`, linked from the ticket's `## Answer`.

### Settled while charting

These frame every ticket below and are not open for re-litigation without redrawing the destination.

- **MVP intake is a Google Forms CSV import**, mapped onto the essential-fields contract that `back-end/essential_fields.py` already owns.
  This is explicitly a temporary intake; the native application form is the official path later.
- **`Application` is the single canonical vendor-intake record.** CSV import and the native form converge on it. Imported rows carry real state.
- **The solver is rewritten to read Applications natively.** `source_data`, `col_names`, and every `*_col_name_idx` are deleted.
  This resolves what `AGENTS.md` has been calling "Phase 5" rather than deferring it again.
  Sizing fact behind that call: the solver's entire live contact with the CSV shape is one 15-line method, `_get_vendor_rows()` (`assignment.py:327`), called once.
- **Imported rows land at status `open`** and are approved or rejected in the existing `ApplicationMonitor`, with a bulk-approve action.
- **MVP markets traverse the existing phase machine unchanged** (`draft` through `assignment`); the CSV import happens during `applications_open`.
  No new edges.
- **`FormHasFieldsGuard` is fixed to count essential questions.** It currently requires a custom field, so a market whose form is exactly the five essential questions cannot leave `draft`. Pre-existing bug; MVP exposes it.
- **Free.** No billing concepts in the model.
- **The real organizer's market is decoupled** and will be served by hand if its date arrives first.
  No organizer's specifics steer the roadmap.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: Reconcile the essential-fields contract with the solver's inputs](issues/01-reconcile-essential-fields-with-solver.md): the contract becomes seven fields, every one read by the solver - availability and tier split apart, `table_choice` and optional `table_share_email` added, tier is a hard filter while section is a soft placement preference, and table type is stubbed to one hard-coded type until the floorplan ships.
- [02: The solver's native vendor input model](issues/02-solver-vendor-input-model.md): a typed `SolverVendor` built by a dedicated module under `assignment/`, fed only by `reviewer_approved` applications, rejecting incomplete ones up front - and the hard-coded four-day ceiling is replaced by `max_assignments_per_vendor`, an organizer setting that already exists in the UI and that the solver has never read.
- [03: What replaces the column-indexed priority system?](issues/03-priority-system-rewrite.md): a rule names a custom form field or a built-in application attribute (`submitted_at`, `application_type`), and its ordering is derived from that target's type - `data_type` and `enum_priority_order` are both deleted rather than ported, and the two predicate "data types" the UI advertised are dropped.
- [06: Intake mode on Market](issues/06-intake-mode-semantics.md): `csv` or `form`, exactly one, gating the five applicant-intake endpoints but never check-in and never the form builder; enforced by one new lookup helper beside `published_market_by_slug`; organizer-settable while `draft` then frozen; and absence means `csv`, so the public surface fails closed.
- [04: CSV column mapping - UX and persistence](issues/04-csv-mapping-ux.md): a dedicated upload/map/preview/confirm flow whose mapping is stored on the market and pre-filled on re-import; structure follows the column-ledger variant, borrowing explicit multi-column shape labels and inline unmatched-value fixes from the target-board one. Pre-fill turned out to decide the layout: a filled ledger is scannable, while both assignment-driven designs opened with nothing left to assign.
- [05: Re-import and applicant identity semantics](issues/05-reimport-and-identity.md): re-import upserts on `(market_id, applicant_email)` to match the unique index; a changed *solver-relevant* answer returns an approved application to review while other edits keep their status; absent rows are left alone; import is permitted only in `applications_open` and `applications_closed`, using the existing reopen edge as the escape hatch; and no `source` field, since intake mode already says it.

## Not yet specified

- **Review and bulk-approve details.** How bulk-approve interacts with the D9 application-form lock, and whether rejecting after import needs an audit trail.
- **Expand-contract sequencing for deleting `source_data`.** The order in which the collection, the `col_name` fields, and the `/source-data` endpoints come out while CI stays green.
- **What the organizer does with the assignment output.** MVP ends at "assignment computed" with no offers and no emails, so the organizer communicates results themselves. Whether that needs any export beyond the existing CSV download is unexamined.
- **`MarketHomeView.vue` disposition.** A 32-line stub on the public slug route. Ticket 06 settled that intake mode gates the route for CSV markets; what it should *render* for a form-intake market, and what a gated visitor sees, is still undecided.
- **Seed and demo data for a fresh deployment.** What a brand-new organizer sees before they have imported anything.

## Out of scope

Ruled beyond this destination. These never graduate; they return only if the destination is redrawn.

- **Deployment, hosting, and Vercel configuration.** Owned by the user directly, not by this map or its backlog.
- **Offers, and applicant accept/refuse.** Post-MVP. Tracked as work in `.scratch/backlog/E05-post-mvp-offers/`, including the verified `assignment -> offers` deadlock.
- **Outcome notification emails** (approval, rejection, offer). The mailer sends auth mail only.
- **The public applicant URL and application form.** Built and merged, but switched off in MVP by intake mode.
- **Floorplan GUI.** Explicitly cut from MVP.
  Consequence recorded by ticket 01: **table type is per-table, not per-section** - any table in any section may be any type, so only a floorplan can describe it.
  MVP therefore stubs table type to a single hard-coded type and does not ask the applicant to rank it.
  This is a deliberate stub, not an oversight: the field and the solver's handling of it exist, and only a real offering is missing.
- **Invite-gating and access control on signup.** Deferred; registration stays as it is.
- **Market-day check-in.** Works today, but sits past the MVP journey, which ends at assignment.
- **Billing and plan limits.**
