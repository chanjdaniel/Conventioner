# Rules

Part of the [knowledge graph](../../README.md), business layer.
Every file here but this one is a node of kind `rule`, named in kebab-case.

A rule node states one product rule in one or two sentences: what the product does or refuses, and why.
Then `## Why`; `## Who may` when roles matter; `## Where it is kept`, linking the module, data or convention nodes and the code; `## Superseded` when it replaced an earlier decision; and `## Evidence` when measurements back it.
`describes` is optional; `verified` is required.

## Nodes

One line per node, sorted by file name.

- [A gated market answers as absent](a-gated-market-answers-as-absent.md) - a CSV market or a draft answers applicants exactly as no market at all; never a "not accepting" message
- [A price follows the table](a-price-follows-the-table.md) - an assignment costs its table's tier price for the day, a half table a share of it rounded half up; set on Market Setup, optional, settled with the setup
- [A seat only for an applicant](a-seat-only-for-an-applicant.md) - a seat goes only to someone with an application; anyone may be pinned, warned, and is held
- [A vendor is called by their chosen name](a-vendor-is-called-by-their-chosen-name.md) - the name they chose, else their full name, with their address beside it; the address alone when there is none
- [A vendor signs in before they have applied](a-vendor-signs-in-before-applying.md) - every address is sent a code, the token names market and address, the first valid save creates the application
- [Adding a vendor who never applied](adding-a-vendor-who-never-applied.md) - from Assignment on, added by name and address, approved, assigned by hand, never in the table allocation
- [An applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md) - "Submitted" until results are published, then a table or none, read off the stored seats
- [An archived market is read-only](an-archived-market-is-read-only.md) - nobody changes a finished market's record; roles and deletion are not changes
- [An archived market that ran stays a record](an-archived-market-that-ran-stays-a-record.md) - its check-in page stays up, marked ended, and takes no check-in
- [An assignment knows when it is out of date](an-assignment-knows-when-it-is-out-of-date.md) - the result says which of the rules, the plan and the approved applications changed since it ran
- [An imported email is asserted](an-imported-email-is-asserted.md) - an imported applicant's address is the organizer's word, an online one's proven by a code; settled before any other mail
- [An incomplete application refuses the run](an-incomplete-application-refuses-the-run.md) - an approved application missing an asked answer stops the assignment, naming the applicants
- [An update is kept beside the vendor's answer](an-update-is-kept-beside-the-vendors-answer.md) - an organizer's update reads in the answer's place, says who, when and what they wrote, and outlasts a re-import
- [Assign runs only in assignment](assign-runs-only-in-assignment.md) - the run is refused in every other phase, and once results are published
- [Automatic rejections](automatic-rejections.md) - answers the organizer names reject an undecided application, with the reason; a person's verdict is never touched
- [Dates fill one at a time, in the plan's order](dates-fill-in-calendar-order.md) - the solver fills each date before the next, in the plan's order; kept on purpose
- [The half-table share](half-table-share.md) - the organizer's share of a section on half tables, 30% when blank, bounding only Either choosers
- [Intake mode decides how vendors arrive](intake-mode-decides-how-vendors-arrive.md) - imported or applying online, exactly one, fixed after draft; never gates the form builder or check-in
- [The ceiling on dates per vendor](max-assignments-ceiling.md) - `max_assignments_per_vendor` is the only ceiling, with no hidden default
- [Needs follow-up](needs-follow-up.md) - a stored status with an owner, out of the queue, blocking assignment like an undecided application
- [No question is inferred required](no-question-is-inferred-required.md) - a market started from a CSV proposes every question optional; only the organizer marks one required
- [Priority and tie-breaks](priority-and-tie-breaks.md) - the order of turns: fewest dates, the organizer's rules, most constrained, earliest, address
- [Publish Results waits for the allocation](publish-results-waits-for-the-allocation.md) - a form market publishes in assignment once a current run is stored, which settles it
- [Review highlights](review-highlights.md) - the market marks the answers a reviewer reads first; on the market, never the form, so they change after it locks
- [Review needs an import](review-needs-an-import.md) - on the Google Form path the first import is the way into Review, and a late export is a Redo import
- [Table-share pairing](table-share-pairing.md) - one-way is enough, a person's own request outranks one about them, the first applicant named
- [The assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md) - the priority and the options lock once the market can no longer reach assignment
- [The form locks at the first application](the-form-locks-at-the-first-application.md) - the form is editable only in draft and only until anyone has applied (D9)
- [The setup settles on leaving draft](the-setup-settles-on-leaving-draft.md) - Market Setup is fixed after draft, so leaving draft asks for dates, a location and tables at every tier
- [Tier filters, section prefers](tier-filters-section-prefers.md) - never a tier a vendor refused, because it sets the price; section is only a preference
- [Vendor notes](vendor-notes.md) - the vendor's request and the organizer's note, two kinds kept apart; the vendor never sees the organizer's
- [Verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md) - verdicts are open while the market can reach review; after, a seat is changed by hand
- [What a correct assignment is](what-a-correct-assignment-is.md) - every row imports, no answer broken, every unplaced vendor says why, pairs together, the order respected
- [What an import may leave unasked](what-an-import-may-leave-unasked.md) - an imported row may leave the number of dates unanswered: no personal limit
- [What each role may do](what-each-role-may-do.md) - Viewer reads, Editor works on the market, Admin moves and publishes; served, never decided on the front end
- [When an organization may be deleted](when-an-organization-may-be-deleted.md) - its drafts and archived markets go with it, refused while one is mid-lifecycle, recorded first
- [Why a vendor was not placed](why-a-vendor-was-not-placed.md) - every date with no table says why, worked out on read; a tier with no tables never reaches the run
