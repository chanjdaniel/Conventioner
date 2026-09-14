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
A vendor-to-be who has applied to a market. Identified by email, and authenticated separately from organizers via an emailed login code.
_Avoid_: User (means an organizer), vendor (means an applicant who has been assigned)

**Application**:
One applicant's submission to one market. The canonical vendor-intake record: both CSV import and the public form produce these, and the solver reads them.
_Avoid_: Submission, entry, registration

**Essential question**:
One of the questions the assignment solver reads directly. Purpose-built and non-removable - an organizer cannot delete one, because the solver would then have nothing to read. Distinct from the custom fields an organizer adds freely.
_Avoid_: Required field (custom fields can be required too)

**Offering**:
The set of choices an essential question presents, derived from the market's own plan - its dates, its sections, its table types. Frozen onto the form when the first applicant answers, so later plan edits cannot move the questions under them.

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

**Table type**:
The physical kind of a table, such as its size. A property of an **individual table, not of its section** - any table in any section may be any type - so only a floorplan can describe it. Stubbed to a single type until the floorplan ships.
_Avoid_: Table choice (a different concept, below)

**Table choice**:
Whether a vendor wants a full table, a half table, or either. Not a preference about table *type*.
_Avoid_: Table size, table preference

**Table sharing**:
Two half-table vendors placed at the same table. A vendor may name a preferred partner by email; one who names nobody may be paired with a stranger.

**Assignment**:
The output of the solver: which vendor sits at which table on which date.

**Priority**:
The organizer's ordered rules for who gets placed first when demand exceeds tables. Each rule names a target - one of their own form questions, or a built-in fact about the application such as when it was submitted - and an ordering over that target's values.

**Max assignments per vendor**:
The organizer's ceiling on how many days any one vendor may be assigned, bounded by the market's own date count. A hard limit set by the market, distinct from the vendor's own `max dates` answer; the effective cap is the lower of the two.
