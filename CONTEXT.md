# Conventioner

Conventioner helps a market organizer run a maker's market: collect vendor applications, review them, and assign the accepted vendors to physical tables across the market's days.

## Language

### Organizing

**Organization**:
The body that runs markets. Owns its markets and its members.
_Avoid_: Team, account, tenant
See [Organization and roles](docs/business/concepts/organization-and-roles.md).

**Organizer**:
A person acting on behalf of an organization. The authenticated user of the main application.
_Avoid_: Admin, owner (both name specific roles within an organization, not the general actor)
See [Organization and roles](docs/business/concepts/organization-and-roles.md).

**Market**:
One event, run by an organization over one or more days.
_Avoid_: Event, show, convention
See [Market](docs/business/concepts/market.md).

**Phase**:
Where a market is in its lifecycle: `draft`, `applications`, `assignment`, `offers`, `market_days`, `archived`. The single source of truth for a market's state. `applications` is the one stage where applications arrive and are reviewed at once, shown as Review on a Google Form market and Applications on one whose vendors apply on its page; whether it is taking applications is a fact about its form, not a phase.
_Avoid_: Status, stage, state (all used for other things; `isDraft` in particular is derived from phase, never set)
See [Phase](docs/business/concepts/phase.md).

**Publish**:
To put a market's check-in page on the air: the `assignment` -> `market_days` transition, taken once tables have been allocated. A published market is running, not finished.
_Avoid_: Archive (that is the opposite), go live, release

**Market days**:
The phase a market is in while it is running - published, and serving check-in. Not every market reaches it: one abandoned before it runs goes straight to `archived`.

**Archived**:
Finished. A market that has run and is over, or one abandoned before it ever ran. It means one thing, in one direction, whichever phase it came from; it used to double as "just published", which is what made `phase` ambiguous.
_Avoid_: Published, closed

**Intake mode**:
How a market receives its vendors - by importing a CSV, or through the public application form. Exactly one, chosen while the market is a draft and frozen thereafter. It decides whether the public applicant surface answers, but never gates check-in, and never gates authoring the form itself: a CSV market still has an application form, because the essential questions define the offering the CSV maps onto.
See [Intake mode](docs/business/concepts/intake-mode.md).

**CSV import**:
Turning each row of a CSV the organizer already collected into an application, by saying which question each column answers. It fills in applications and never writes the form: a column with nowhere to go needs the form changed first.

**Form started from a CSV**:
An application form the product proposes from a CSV's columns, for the organizer to edit before it is theirs. Saying what each column is happens once: the same answer shapes the form and maps that file's later CSV import.
_Avoid_: Draft form, drafted form (Draft is a phase)

**Proposal**:
What the product suggests each column of a CSV becomes - a plan fact, an essential question, a question of the organizer's own, or left out - before the organizer confirms it. Written nowhere until confirmed; confirming writes the plan facts, the form and that file's import mapping at once.
_Avoid_: Draft (a phase), suggestion, guess

### Applying

**Applicant**:
A vendor-to-be who has applied to a market. Keyed by email and called by the name they chose, and authenticated separately from organizers via an emailed login code. The email is the identifier the system matches on; the name is what people read.
_Avoid_: User (means an organizer), vendor (means an applicant who has been assigned)

**Application**:
One applicant's submission to one market. The canonical vendor-intake record: both CSV import and the public form produce these, and the solver reads them.
_Avoid_: Submission, entry, registration
See [Application](docs/business/concepts/application.md).

**Essential question**:
A question the product owns, that every application form asks. Purpose-built and non-removable. Most are read directly by the assignment solver, which is why they cannot be deleted - it would then have nothing to read. The vendor's name is the exception: it is essential because identity is, not because the solver needs it. Distinct from the custom fields an organizer adds freely.
_Avoid_: Required field (custom fields can be required too)
See [Essential question](docs/business/concepts/essential-question.md).

**Full name**:
The name on a vendor's identification, and what they are called unless they give a preferred name. One field, never split into first and last - the names organizers already collect arrive whole, and splitting them means guessing. Asked by every market, unconditionally: it does not depend on the market plan offering anything. A person's name, not a trading name.

**Offering**:
The set of choices an essential question presents, derived from the market's own plan - its dates, its sections, its table types. Frozen onto the form when the first applicant answers, so later plan edits cannot move the questions under them.

**Preferred name**:
The name a vendor chooses to be called. Asked of every vendor beside their full name and never required; where given, it is the name every screen leads with.

**Required answer**:
An answer the applicant cannot submit the form without. A property of the question, enforced at the applicant's keyboard. Says nothing about whether anyone reads it afterwards.
_Avoid_: Essential (that is the product's own set of questions, and a custom field can be required too)

**Review highlight**:
An answer a reviewer reads first. The organizer marks a handful on the market, and the review card leads with them and folds the rest away behind a disclosure. A flag, not a rank.

It lives on the market rather than on the form because the form freezes at the first application, and an organizer only learns which answers they needed once they are reading real ones. Off the form it can also name essential answers, which are not form fields at all.
_Avoid_: Important field, priority (means the solver's ordering rules)
See [Review highlight](docs/business/concepts/review-highlight.md).

**Reviewer**:
Someone chosen to review a market's applications, by an Admin or the owner. Chosen from the people with a role on the market or through its organization (only the market's own, to a chooser from outside the organization), and kept only for this review: being chosen is not a role. With none chosen, everyone reviews first come, first served.
_Avoid_: Assignee (an assignment is a table), the reviewer for whoever happens to have a card open (that is who holds it)
See [The review is dealt among chosen reviewers](docs/business/rules/the-review-is-dealt-among-chosen-reviewers.md).

**Share**:
The applications dealt to one reviewer. An application stays in the share it was dealt to after it is decided, as the record of whose it was.

**Deal**:
Handing the open applications out among the reviewers, round robin in the order they arrived. Any change of reviewers deals the open applications again; a decided application stays where it is, and so does a follow-up, unless its owner is a reviewer the change removed.
_Avoid_: Assign (means giving a vendor a table)

**Solver-relevant answer**:
An answer whose change invalidates a completed review, because it changes what the solver would do with the application. Named by `SOLVER_RELEVANT_KEYS` in `back-end/essential_fields.py`.

**These three are independent, and the glossary keeps them apart deliberately.** A required answer may be noise on a triage card; a review highlight may be optional; a solver-relevant answer may be neither. Blurring them is how the form builder grows two controls an organizer cannot tell apart.

**Vendor**:
An assigned applicant: one with an **assignment**, a table on at least one date.
_Avoid_: Vendor for an applicant who has no assignment

**Approved applicants**:
Everyone the review approved, assigned or not. There is no single word for them: say "approved applicants".
_Avoid_: Vendors (that is the assigned ones)

### Assigning

**Market date**:
One day the market runs. A **calendar day**, never an instant: a stored `YYYY-MM-DD` renders as the same day for every viewer regardless of timezone.

**Section**:
A named block of tables within the venue, carrying a tier, a location, and a count. Tables are generated from sections. A vendor ranks sections as a preference, and may be assigned outside their top choice.
_Avoid_: Area, zone, block

**Tier**:
A price band. **Determines what an applicant pays for a table on a given day**, which is why it is a hard filter: a vendor is never assigned at a tier they did not accept, even if that leaves them unassigned.
_Avoid_: Level, class, grade

**Location**:
Where a section sits in the venue. Descriptive; the solver does not filter on it.

**Table**:
One physical table on one market date. Holds either one full-table vendor or two half-table vendors.
See [Placement and pin](docs/business/concepts/placement-and-pin.md).

**Table code**:
A table's name: its section, a space, then its number within that section - "Front Row 1".
Built in exactly one place (`table_code_for` in `back-end/datatypes.py`), because it is both the label an organizer reads and the key a stored assignment is matched against.
_Avoid_: Table number, table ID, "Front Row1"

**Table type**:
The physical kind of a table, such as its size. A property of an **individual table, not of its section** - any table in any section may be any type - so only a floorplan can describe it. Stubbed to a single type until the floorplan ships.
_Avoid_: Table choice (a different concept, below)

**Table choice**:
Whether a vendor wants a full table, a half table, or either. Not a preference about table *type*.
Stored as a code (`full`, `half`, `either`) and read back to a human as the sentence the applicant chose: "A whole table to myself", "Half a table, shared", "Either is fine".
Those sentences are the name of the thing - the CSV importer matches an imported column against them, and the review queue prints them - so the pairing lives in one place per side (`TABLE_CHOICE_LABELS` in `back-end/essential_fields.py`, `TABLE_CHOICES` in `front-end/src/utils/essentialFields.ts`) and the two must stay in step.
_Avoid_: Table size, table preference, showing the stored code to anyone

**Assigned as**:
What a vendor actually got: "Full Table", "Half Table (Left)", "Half Table (Right)".
A different concept from **table choice**, which is what they asked for - an "Either is fine" applicant is assigned as one or the other.
_Avoid_: Using the applicant's sentence for an outcome, or "table choice" for either one alone
See [Placement and pin](docs/business/concepts/placement-and-pin.md).

**Table sharing**:
Two half-table vendors assigned to the same table. A vendor may name a preferred partner by email; one who names nobody may be paired with a stranger.
See [Table sharing](docs/business/concepts/table-sharing.md).

**Assignment**:
One applicant's table on one date: what they were given, by the solver or by hand.
Assigning by hand is assigning: an organizer who puts someone at a table, or moves or frees them, changes their assignments.
The Assignment phase, tab and page keep the name for the whole job, which is why the page where the **Assignment rules** are set and tables are allocated is labelled Assignment; its sibling page, where the assignments are read and changed, is the **Result**.
_Avoid_: Assignment for the solver's whole output (that is the **table allocation**); placement, placed and placing (all now **assignment**, **assigned** and **assigning**)
See [Assignment](docs/business/concepts/assignment.md).

**Assigned / unassigned**:
An applicant is assigned when they have an assignment on at least one date, and unassigned when they have none.
Being assigned implies being approved; until approving on assigning lands, an applicant assigned by hand without approval is marked "Not approved".
_Avoid_: Placed, unplaced, seated

**Table allocation**:
What the solver produces for the whole market: every assignment it makes in one run. "Allocate tables" runs it; assignments made by hand are kept, and new **assignment rules** take effect only when tables are allocated again.
_Avoid_: Assignment, assignment results, "run the assignment"

**Assignment rules**:
The organizer's inputs to the solver: the **Priority**, the **Max assignments per vendor**, and how many of a section's tables may be split between half-table vendors. What the organizer sets before allocating tables, as distinct from the **table allocation** it produces.

**Priority**:
The organizer's ordered rules for who gets assigned first when demand exceeds tables. Each rule names a target - one of their own form questions, or a built-in fact about the application such as when it was submitted - and an ordering over that target's values.

**Max assignments per vendor**:
The organizer's ceiling on how many days any one vendor may be assigned, bounded by the market's own date count. A hard limit set by the market, distinct from the vendor's own `max dates` answer; the effective cap is the lower of the two.
