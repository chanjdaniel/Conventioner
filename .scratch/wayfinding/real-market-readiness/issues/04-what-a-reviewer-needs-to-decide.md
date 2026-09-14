# 04: What must a reviewer see to decide on an application?

Type: prototype
Status: open
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
