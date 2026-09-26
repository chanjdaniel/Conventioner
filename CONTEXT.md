# Conventioner

Conventioner helps a market organizer run a maker's market: collect vendor applications, review them, and assign the accepted vendors to physical tables across the market's days.

## Language

### Organizing

**Organization**:
The body that runs markets. Owns its markets and its members.
_Avoid_: Team, account, tenant

**Organizer**:
A person acting on behalf of an organization. The authenticated user of the main application.
_Avoid_: Admin, owner (both name specific roles within an organization, not the general actor)

**Market**:
One event, run by an organization over one or more days.
_Avoid_: Event, show, convention

**Phase**:
Where a market is in its lifecycle: `draft`, `applications_open`, `applications_closed`, `review`, `assignment`, `offers`, `market_days`, `archived`. The single source of truth for a market's state.
_Avoid_: Status, stage, state (all used for other things; `isDraft` in particular is derived from phase, never set)

**Publish**:
To put a market's check-in page on the air: the `assignment` -> `market_days` transition, taken once the assignment has been computed. A published market is running, not finished.
_Avoid_: Archive (that is the opposite), go live, release

**Market days**:
The phase a market is in while it is running - published, and serving check-in. Not every market reaches it: one abandoned before it runs goes straight to `archived`.

**Archived**:
Finished. A market that has run and is over, or one abandoned before it ever ran. It means one thing, in one direction, whichever phase it came from; it used to double as "just published", which is what made `phase` ambiguous.
_Avoid_: Published, closed

**Intake mode**:
How a market receives its vendors - by importing a CSV, or through the public application form. Exactly one, chosen while the market is a draft and frozen thereafter. It decides whether the public applicant surface answers, but never gates check-in, and never gates authoring the form itself: a CSV market still has an application form, because the essential questions define the offering the CSV maps onto.

### Applying

**Applicant**:
A vendor-to-be who has applied to a market. Keyed by email and named by their full name, and authenticated separately from organizers via an emailed login code. The email is the identifier the system matches on; the name is what people read.
_Avoid_: User (means an organizer), vendor (means an applicant who has been assigned)

**Application**:
One applicant's submission to one market. The canonical vendor-intake record: both CSV import and the public form produce these, and the solver reads them.
_Avoid_: Submission, entry, registration

**Essential question**:
A question the product owns, that every application form asks. Purpose-built and non-removable. Most are read directly by the assignment solver, which is why they cannot be deleted - it would then have nothing to read. The vendor's name is the exception: it is essential because identity is, not because the solver needs it. Distinct from the custom fields an organizer adds freely.
_Avoid_: Required field (custom fields can be required too)

**Full name**:
What a vendor is called. One field, never split into first and last - the names organizers already collect arrive whole, and splitting them means guessing. Asked by every market, unconditionally: unlike every other essential question, it does not depend on the market plan offering anything. A person's name, not a trading name.

**Offering**:
The set of choices an essential question presents, derived from the market's own plan - its dates, its sections, its table types. Frozen onto the form when the first applicant answers, so later plan edits cannot move the questions under them.

**Required answer**:
An answer the applicant cannot submit the form without. A property of the question, enforced at the applicant's keyboard. Says nothing about whether anyone reads it afterwards.
_Avoid_: Essential (that is the product's own set of questions, and a custom field can be required too)

**Review highlight**:
An answer a reviewer reads first. The organizer marks a handful on the market, and the review card leads with them and folds the rest away behind a disclosure. A flag, not a rank.

It lives on the market rather than on the form because the form freezes at the first application, and an organizer only learns which answers they needed once they are reading real ones. Off the form it can also name essential answers, which are not form fields at all.
_Avoid_: Important field, priority (means the solver's ordering rules)

**Solver-relevant answer**:
An answer whose change invalidates a completed review, because it changes what the solver would do with the application. Named by `SOLVER_RELEVANT_KEYS` in `back-end/essential_fields.py`.

**These three are independent, and the glossary keeps them apart deliberately.** A required answer may be noise on a triage card; a review highlight may be optional; a solver-relevant answer may be neither. Blurring them is how the form builder grows two controls an organizer cannot tell apart.

**Vendor**:
An applicant being placed, or already placed, at tables. The solver's word for the thing it assigns.

### Placing

**Market date**:
One day the market runs. A **calendar day**, never an instant: a stored `YYYY-MM-DD` renders as the same day for every viewer regardless of timezone.

**Section**:
A named block of tables within the venue, carrying a tier, a location, and a count. Tables are generated from sections. A vendor ranks sections as a preference, and may be placed outside their top choice.
_Avoid_: Area, zone, block

**Tier**:
A price band. **Determines what an applicant pays for a table on a given day**, which is why it is a hard filter: a vendor is never placed at a tier they did not accept, even if that leaves them unassigned.
_Avoid_: Level, class, grade

**Location**:
Where a section sits in the venue. Descriptive; the solver does not filter on it.

**Table**:
One physical table on one market date. Holds either one full-table vendor or two half-table vendors.

**Table code**:
A table's name: its section, a space, then its number within that section - "Front Row 1".
Built in exactly one place (`table_code_for` in `back-end/datatypes.py`), because it is both the label an organizer reads and the key a stored placement is matched against.
_Avoid_: Table number, table ID, "Front Row1"

**Table type**:
The physical kind of a table, such as its size. A property of an **individual table, not of its section** - any table in any section may be any type - so only a floorplan can describe it. Stubbed to a single type until the floorplan ships.
_Avoid_: Table choice (a different concept, below)

**Table choice**:
Whether a vendor wants a full table, a half table, or either. Not a preference about table *type*.
Stored as a code (`full`, `half`, `either`) and read back to a human as the sentence the applicant chose: "A whole table to myself", "Half a table, shared", "Either is fine".
Those sentences are the name of the thing - the CSV importer matches an imported column against them, and the review queue prints them - so the pairing lives in one place per side (`TABLE_CHOICE_LABELS` in `back-end/essential_fields.py`, `TABLE_CHOICES` in `front-end/src/utils/essentialFields.ts`) and the two must stay in step.
_Avoid_: Table size, table preference, showing the stored code to anyone

**Placed as**:
What a vendor actually got: "Full Table", "Half Table (Left)", "Half Table (Right)".
A different concept from **table choice**, which is what they asked for - an "Either is fine" applicant is placed as one or the other.
_Avoid_: Using the applicant's sentence for an outcome, or "table choice" for either one alone

**Table sharing**:
Two half-table vendors placed at the same table. A vendor may name a preferred partner by email; one who names nobody may be paired with a stranger.

**Assignment**:
The output of the solver: which vendor sits at which table on which date.
Changed afterwards only by hand placements, never by editing the rules - new rules take effect when the assignment is run again.
The organizers' word for the whole job of placing vendors, which is why the page where the **Assignment rules** are set and run is also labelled Assignment; its sibling page, where the assignment is read and changed, is the **Result**.
_Avoid_: Assignment results (the assignment is the result; there is no second thing)

**Assignment rules**:
The organizer's inputs to the solver: the **Priority**, the **Max assignments per vendor**, and how many of a section's tables may be split between half-table vendors. What the organizer sets before running an assignment, as distinct from the **Assignment** it produces.

**Priority**:
The organizer's ordered rules for who gets placed first when demand exceeds tables. Each rule names a target - one of their own form questions, or a built-in fact about the application such as when it was submitted - and an ordering over that target's values.

**Max assignments per vendor**:
The organizer's ceiling on how many days any one vendor may be assigned, bounded by the market's own date count. A hard limit set by the market, distinct from the vendor's own `max dates` answer; the effective cap is the lower of the two.
