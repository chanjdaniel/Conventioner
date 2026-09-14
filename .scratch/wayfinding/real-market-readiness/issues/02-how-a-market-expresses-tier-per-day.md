# 02: How does a market express a tier preference that differs per day?

Type: grilling
Status: open
Blocked by:

## Question

Report finding B2.

The real form asks one question per market day whose answer is a set of tiers: `Gold, Silver, Bronze`,
or `None` meaning unavailable. One cell carries two facts - whether the vendor can attend that day,
and which tiers they would accept **on that day**.

The essential contract splits those apart, a decision recorded in the v0.1.0 map's ticket 01:
`essential_available_dates` is a list of dates, and `essential_tier_preference` is a single set of
accepted tiers for the whole application. There is nowhere to put "Gold on Monday, Bronze on Friday".

The import ledger enforces one column per target, so mapping the Monday column to Available dates
greys that target out everywhere else and tier has no column left. This is a blocker, not a
degradation: "Preview import" never enables.

Decide which of these the product means:

- **A grid may feed two targets**, deriving availability from "cell is non-empty and not `None`" and
  tier from the cell contents. Cheapest, covers this form exactly, and leaves the stored contract
  untouched. But it silently unions the tiers across days, so a vendor who offered Bronze on Friday
  and Gold on Monday is recorded as accepting both on both.
- **Tier preference becomes per-date**, like availability. Expresses the organizer's actual stated
  policy - "you will be given the highest tier available among the selections made" is written
  per-day on their form - at the cost of changing the essential contract, the solver's hard filter,
  the applicant form, and the freeze.
- **The union is accepted as the product's position**, and the form is the thing that should change.

That last option is a real answer, not a cop-out, but it has to be said out loud rather than arrived
at by default: it means telling organizers their existing form asks a question Conventioner does not
model. Consider what the union actually promises a vendor. Tier is a **hard filter** and it sets the
price, so a union can place someone at a tier they declined for that day - which is the one direction
the contract was careful about.

Interacts with ticket 03: if a required question can be declared "not asked", that mechanism may or
may not be the right way to express this one too.
