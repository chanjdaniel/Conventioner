# 04: What must a reviewer see to decide on an application?

Type: prototype
Status: resolved
Blocked by:

## Question

Report finding W2. Supersedes the v0.1.0 map's ticket 08, which asked a narrower question.

The review queue renders every application as `email, status pill, date, Approve, Reject`. With the
real file that is 232 identical cards in one list: no count, no search, no filter, no sort, no
paging, no bulk action, and a full re-fetch of all 232 on every click. Approving is not visibly
terminal - both buttons remain, unchanged.

The narrower framing was "what shape does bulk-approve take". The evidence says the queue has a
worse problem than click count: **there is nothing on a card to decide on.** An organizer reviewing
this market wants to know what the vendor sells, whether their portfolio is real work, and whether
they are actually UBC-affiliated. The card shows an email address.

Build a throwaway prototype to react to, and decide what the organizer sees and does:

- **What is on a row.** Which answers earn a place, and what happens when a market's form asks
  nothing that distinguishes one applicant from another. Note that an essential-only form genuinely
  has nothing to show, which is the state ticket 05 is about.
- **Selection and bulk action.** Select-all, per-row checkboxes, or apply-to-current-filter with no
  selection model. Approve only, or reject too - rejection is the destructive direction and an
  applicant never learns of it in MVP.
- **Confirmation.** Approved applications are the solver's only input, so an accidental approve-all
  silently changes who gets a table. Whether that earns a confirm step, an undo, or neither.
- **Scale.** 232 rows is the real number. Whether that means paging, virtualisation, or filtering,
  and what the action reports when rows cannot legally leave their status.

The answer must say what the organizer sees and does, not how it is implemented.

## Prototype

Built 2026-09-14, awaiting a reaction. Captured on branch `prototype/04-review-queue`
(commit message explains the three variants); it is deliberately **not** on `dev` or on the
feature branch.

Mounted on the real `/market-setup` Applications tab behind `?variant=A|B|C`, against 232 real
applications, so the variants are judged at real density rather than in a vacuum. Verdicts are
local state only - nothing is written, so flipping between variants cannot damage data.

- **A - Ledger.** Dense table, checkbox selection, bulk action on the selection. Primary
  affordance: picking rows.
- **B - Triage.** One application at a time with every answer, keyboard-driven (A/R/S), progress
  counted. Primary affordance: deciding the case in front of you.
- **C - Sweep.** No selection model at all. Narrow with search/tier/status filters, then act on the
  whole filtered set. Primary affordance: narrowing a population.

**What building it already surfaced, before anyone reacts:** with a market whose form asks only the
essential questions, every row renders the *same* answers - identical section rankings, and dates
and tiers that mostly repeat. So the ledger makes ticket 05's problem visible rather than solving
it: no layout can distinguish 232 applicants when the form never asked anything that distinguishes
them. Whichever variant wins, it is worth deciding 05 knowing that.

To run it: `?variant=A` on the Applications tab of any market with applications.

## Answer

**Variant B - triage. One application at a time, every answer shown, keyboard-driven. No bulk
action of any kind.**

Resolved 2026-09-14 by reacting to the prototype on `prototype/04-review-queue`.

### What the organizer sees and does

One card at a time, carrying **every** answer the application holds - the essential ones and any
custom fields the organizer asked - not an email and a status pill. Progress is counted ("12 of 232
to review"). Three verdicts: Approve, Reject, Skip, each with a keyboard shortcut, so a reviewer's
hands need never leave the keyboard.

### What was rejected, and why

- **A - a dense table with checkbox selection.** Readable, and it did show the answers, but its
  primary affordance is picking rows: a filing action rather than a judging one.
- **C - filter, then act on the whole filtered set.** Much the fastest way through 232 rows, and
  that is exactly why it loses: it decides about a *population*. The organizer is accepting or
  refusing individual people who applied to their market.
- **A bulk escape hatch on top of B** ("approve the remaining 219") was offered and declined.

This also settles what the superseded [v0.1.0 ticket
08](../../v0-1-0/issues/08-bulk-approve-shape.md) asked. Selection model: none. Which actions are
bulk: none. Confirmation: not needed, because there is no action large enough to need one. Scale is
answered by the reviewer's time, not by a control.

### The consequence, stated plainly because it is the cost of this answer

There is no way to approve an application without having looked at it. 232 applications is 232
decisions - on the order of 12 to 30 minutes of continuous triage. That is the point: each
acceptance is deliberate rather than a count.

It also makes **[ticket 05](05-how-custom-fields-reach-a-frozen-form.md) load-bearing rather than a
nicety**, which building the prototype had already hinted at. With a form that asks only the
essential questions - today's default, because the form freezes the moment a market leaves `draft`
- every card shows the same answers, and triage degenerates into 232 indistinguishable cards where
the only rational act is pressing Approve. Triage is humane only if the cards differ.

**Do not build this before 05 is resolved**, or the result is a slower version of the queue it
replaces.

Buildable work: `.scratch/backlog/E08-interface-correctness/F04-review-by-triage/`.
