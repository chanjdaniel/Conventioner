# 11: Do the three application phases get three surfaces, or one surface in three states?

Type: grilling
Status: resolved
Blocked by: -

## Question

[Ticket 01](01-the-order-of-the-work.md) settled that the workspace shows the surface for the market's current phase.
It did not settle how finely.
`applications_open`, `applications_closed` and `review` are three consecutive phases about the same subject, and the answer decides whether that is three places or one place that changes.

### What actually differs between them, measured rather than assumed

| | `applications_open` | `applications_closed` | `review` |
| --- | --- | --- | --- |
| New applications can arrive | yes, form intake only | no | no |
| CSV import allowed | yes | yes | **no** |
| Review verdicts allowed | **yes** | **yes** | yes |
| Forward transition | -> closed | -> review | -> assignment |
| Guard on leaving | none | none | `_ALL_REVIEWED` |

Three things this table says that the phase names do not:

- **`review_application` has no phase gate.**
  An organizer can approve and reject from the moment the first application lands.
  "Review" is not the phase in which reviewing happens; it is the phase after which reviewing must be finished.
- **For a CSV market, `applications_open` and `applications_closed` are indistinguishable.**
  Nothing arrives in either - the vendors come from a file - so the only difference between them is a door that nobody was going to walk through.
  Both import. Both review.
- **`review` is distinguished by a refusal, not a capability.**
  The one thing that changes on entering it is that importing stops being allowed.

### What to decide

**Whether the workspace gives these three phases three surfaces or one surface in three states - and if one, what it emphasises in each.**

Candidate answers:

- **One surface, three states.**
  An Applications surface carrying the same two capabilities throughout - bring applications in, decide on them - whose emphasis shifts: receiving, then closed-and-importing, then finishing the last verdicts with `_ALL_REVIEWED` in view.
  Matches what the table says. Risk: the phase rail shows three steps while the workspace shows one place, which could read as the rail being decorative.
- **Three surfaces.**
  Honest to the rail, and lets each phase lead with its own thing.
  Risk: two of the three would be near-identical for a CSV market, and a surface whose only distinction is that a button is missing teaches an organizer that phases are arbitrary.
- **Collapse the phases instead.**
  If `applications_open` and `applications_closed` are indistinguishable for a CSV market, the question may be whether the lifecycle has one phase too many rather than how to draw it.
  This reaches `VALID_TRANSITIONS`, which [ticket 01](01-the-order-of-the-work.md) deliberately left untouched, so it is the largest of the three and needs the strongest reason.

### Notes

Graduated from ticket 01 on 2026-09-22 and charted on the same day, because it is the patch a build hits on day one: `E18` cannot lay out the workspace without it.

Tickets [05](05-which-answers-matter-for-review.md) and [06](06-what-shape-is-the-import-flow.md) each decided what one of these surfaces *contains* - the review card's shape, the import page's width - without settling how many surfaces there are.
Neither answer is disturbed by this one.

Findings: graduated from the map's Not yet specified, not from a QC finding.

## Answer

**One Applications surface, in three states. The transition table is untouched.**

The surface carries the same two capabilities throughout - bring applications in, decide on them - and what changes with the phase is the emphasis and whether Import is offered:

- **`applications_open`** - leads with what has arrived, offers Import.
- **`applications_closed`** - states that the market is no longer receiving, still offers Import.
- **`review`** - drops Import, leads with what is still undecided and with `_ALL_REVIEWED` in view: every application must be decided before the market can assign.

The review queue itself is the same below all three.

### Why one surface is the honest answer

The three phases barely differ, and the differences they do have are not the ones their names suggest:

- **`review_application` has no phase gate.** Verdicts can be recorded from the moment the first application lands. `review` is not the phase in which reviewing happens; it is the phase after which reviewing must be finished.
- **Import spans two of the three**, stopping only at `review`.
- **`applications_closed` changes nothing for a CSV market**, where nothing was arriving in the first place.

Three screens for that would mean two near-identical screens on every market this product currently serves, and a screen whose only distinction is a missing button teaches an organizer that the phases are arbitrary.

### Why the phases are not collapsed

`applications_closed` is only meaningless for **CSV** markets.
[Ticket 09](09-who-can-reach-the-public-application-url.md) made form intake reachable, and for a form-intake market "applications have closed" is a real and important state: the public form stops accepting.
Collapsing it would optimise for the markets the product serves today at the cost of the ones just unlocked.

It also reverses [ticket 01](01-the-order-of-the-work.md)'s decision to leave `VALID_TRANSITIONS` alone, and would need `guards.py`, `_validate_registry`, the rail and a migration for markets already sitting in that phase.
Not worth it for a phase that earns its place the moment a form-intake market exists.

### The risk this accepts

**The rail shows three steps while the workspace shows one place**, which can read as the rail being decorative.
The mitigation is that the surface must *say* which state it is in, in words, at the top - not merely hide a button.
An organizer who cannot tell `applications_open` from `applications_closed` by looking at the screen is being shown a rail that means nothing, and CLAUDE.md already records that a terminal state stated only by strikethrough was read as "stopped" rather than "archived".
The same standard applies here: state it.

### What this unblocks

`E18` can lay out the workspace.
Tickets [05](05-which-answers-matter-for-review.md) and [06](06-what-shape-is-the-import-flow.md) are undisturbed - they decided what this surface *contains* (the review card's shape, the import page's width), and it is now settled that there is one of it.
