# 02: How does a market express a tier preference that differs per day?

Type: grilling
Status: claimed
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

## Settled so far

Given in grilling on 2026-09-14. **Not a resolution** - this ticket stays open until the whole
round is closed.

- **Tier preference becomes per-date**, like availability. The union was rejected because tier is a
  hard filter *and it sets the price*: a vendor who offered Gold on Monday and Bronze on Friday
  would be placed at Gold on Friday and charged for it, or at Bronze on their good day. The real
  form promises "the highest tier available among the selections made" **per day**, so a union
  breaks a promise the organizer already made in writing.
- **Availability stays its own answer.** Collapsing it into tier would match the real form exactly
  but leaves availability undefined for a market that offers no tiers at all - which
  `asked_essential_keys()` already treats as legitimate. Both are stored, and **validation refuses a
  ticked date with no tiers**, so they cannot disagree.
- **Same key, new shape** (`essential_tier_preference` becomes date -> list), with the migration.
  Accepting either shape at read was rejected for the reason `AGENTS.md` gives about market
  documents: a read-time fallback leaves stale values alive forever.
- **Consequence:** `essential_tier_preference` stops being usable as a **priority-rule target** - a
  map has no ordering. The rule builder must stop offering it rather than score every vendor
  identically, which is the C1 failure mode in a new costume.
