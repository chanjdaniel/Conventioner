# 04: Who is in the Vendors list?

Type: grilling
Status: open
Blocked by: -

## Question

A rejected applicant appears in the Vendors list, badged **"Unassigned"**, counted in **"5 of 6 vendors assigned"**, with two date cards that read **"Not placed"** and nothing else.

That last part is `placementReasonText(undefined)` - the fallback.
E12's reasons are computed over the *solver's* vendors, which are the approved applications only, so a rejected applicant never appears in `unplacedDates` and there is no reason to show.
The card is visually identical to a genuinely unplaceable approved vendor.

It is the one case where "said nothing else" is exactly the finding E12 set out to fix:

> "the payoff screen listed unassigned vendors by email under a heading and said nothing else"

And the reason is the simplest one in the product: **their application was rejected.**

### What to decide

**Who belongs in the Vendors list, and what the product calls them.**

`CONTEXT.md` already has an answer, and the screen disagrees with it:

> **Vendor**: An applicant being placed, or already placed, at tables. The solver's word for the thing it assigns.
>
> **Applicant**: A vendor-to-be who has applied to a market.

By the glossary a rejected applicant is **not a vendor**, and the Vendors list is showing applicants.
So this is a modelling question before it is a UI one - either the screen is wrong, or the glossary is.

Candidate answers:

- **The list is vendors, so rejected applicants leave it.** Matches the glossary. Raises: where does an organizer go to see everyone who applied, including the rejected? The Applications tab holds the review queue, which empties as it is worked.
- **The list is applicants, and the glossary widens.** Then the "Unassigned" badge and the "5 of 6" denominator both need a third state - rejected is not unassigned, it is not in the running.
- **The list is vendors plus a rejected section**, which is the "one list, two populations" answer and usually the worst of both.

Whatever wins, two derived things move with it: the **denominator** in "N of M vendors assigned", which currently counts someone who was never going to be placed and makes the market look less successful than it is, and the **card state**, which today falls through to a fallback.

### Notes

If the answer widens the glossary, amend `CONTEXT.md` in the same session - it is the artifact this ticket turns on.

Note the adjacent case this must not break: an approved vendor who genuinely cannot be placed **does** belong in the list with a reason, and E12 built the card for exactly that.

Findings: F11 in `.lavish/qc-2026-09-20.html`.
