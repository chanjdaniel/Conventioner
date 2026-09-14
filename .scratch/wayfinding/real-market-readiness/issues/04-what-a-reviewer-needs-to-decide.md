# 04: What must a reviewer see to decide on an application?

Type: prototype
Status: claimed
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
