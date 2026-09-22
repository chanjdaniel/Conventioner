# 03: What does "finalized" mean for a market, and what writes it?

Type: grilling
Status: resolved
Blocked by: 01

## Question

Three separate items in this walk need a market or its form to be *finished*, and nothing in the product records that it is.

`ApplicationFormObject.published_at` is the field that would mean it.
It is declared in `back-end/datatypes.py:567` as "locks form when applications exist (D9)", threaded through `api/markets.py` at lines 181, 264 and 1362, and read by `PhaseRail.vue:92` and `FormBuilder.vue:40`.
**Nothing in the back end ever assigns it a value.**
It is only carried from the stored form into the response, so it is `None` on every market in the product.

The three items that need it:

- **`F11`** - opening a market should land on the Application Form tab while the form is unfinished and on Market Setup once it is finished. `tabFromRoute()` falls back to `'setup'` unconditionally and never looks at the market.
- **`F19`** - editing the form from inside the CSV import wizard turns on when the form is still editable.
- **Ticket 01, step 3** - "finalize both, which is what opens applications" is a step that has no representation.

### What to decide

**Whether finalizing is a real act that stamps `published_at`, or whether "finished" is derived from something the product already stores.**

Candidate answers:

- **Make finalizing a real act.**
  Probably the honest answer - the field was designed for it and two front-end components already read it - but it means deciding what finalizing *is*, what UI performs it, and whether it is one act over both the plan and the form or two separate ones.
- **Derive it from the phase.**
  A market past `draft` has opened applications, so its form is effectively sent out.
  Needs no new state, but conflates "the organizer finished the form" with "the market left draft", and an organizer can finish a form and not open applications for a week.

### Notes

**It must agree with the lock, not become a second answer to a similar question.**
`application_form_lock_reason()` (`back-end/api/markets.py`) already computes when a form becomes uneditable: `draft` phase and no applications yet.
That is a *lock*, not a finalization, but whatever decides "finalized" has to be consistent with it.

**The landing rule is downstream of ticket 01.**
`F11`'s rule is really "land on the earliest unfinished stage", and ticket 01 decides what the stages are.
Two things hold regardless of either answer: an explicit `?tab=` in the URL must still win so shared links keep working, and something has to start writing the signal or "finished" has to come from somewhere else.

Findings: `F11`, and the `published_at` trace inside it, in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**Leaving `draft` is finalizing. The `draft -> applications_open` transition stamps `applicationForm.publishedAt`; returning to `draft` clears it.**

There is no new act for an organizer to discover: the forward step they already take *is* the finalize.
The gate already exists and already checks both halves - `FormHasFieldsGuard` counts **plan-derived** asked keys, so its own docstring says "a market with no dates, no tiers and fewer than two sections genuinely asks nothing, and is genuinely blocked."
A plan that offers nothing cannot produce a form that asks anything, so one guard covers the plan and the form together.
Only the stamp was missing.

Returning to `draft` - legal only while no application exists - clears the stamp.
`publishedAt` therefore answers exactly one question: **is this form finalized right now?**

### Why the field is not redundant with the phase, and when it would become so

Stamped on leaving `draft` and cleared on returning, `publishedAt` looks like a restatement of `phase != draft`.
It is not, because **`draft -> archived` also exists** - CLAUDE.md records it as the publish path fired by the Done button - and that edge does **not** stamp it.
A market published straight from draft to archived never opened its form to anybody.

So the two fields say different things:

- `phase` - where the market is now.
- `publishedAt` - whether this form was ever opened to applicants.

**If the `draft -> archived` edge is ever removed, `publishedAt` becomes derivable and should be deleted rather than maintained.**
Recorded here so that it is a decision next time and not an archaeology problem.

### What this does to `F11`

`F11` as recorded asked for the *opposite* order - land on the application form until it is finalized, then on market setup.
[Ticket 01](01-the-order-of-the-work.md) settled that the plan comes first and the form is built from it, so that rule is backwards and does not survive.

What replaces it follows from ticket 01 rather than from this ticket: **the workspace opens the surface for the market's current phase**, and within `draft` the surface opens at the earliest incomplete stage - the plan, then the form.
`tabFromRoute()` and its unconditional `'setup'` fallback are replaced by that routing, not patched.

**`F11` is therefore absorbed and should not be built as a standalone fix.**
One requirement survives it: an explicit stage in the URL must still win, so a shared or bookmarked link keeps working.

### Consequences

- **The transition endpoint is the only writer**, consistent with `phase` and `assignment_object` already being server-owned. A market `PUT` body can never set `publishedAt`; `update_market()` re-applies the stored value.
- **Both writes are in the same atomic update as the phase change**, or a failure between them leaves a market whose stamp and phase disagree - the class of bug `migrate_is_draft_consistency.py` exists to repair.
- **Existing markets need no backfill.** A market past `draft` today has a null stamp and would read as never-finalized. Since nothing consumes the field yet, the honest fix is a one-off migration that stamps every market whose phase is past `draft` and is not archived-from-draft - or an explicit decision to leave history blank. Decide when the story is written; do not let it default.
- `PhaseRail.vue:92` and `FormBuilder.vue:40` already read the field and start receiving real values.
