# 01: How does an organizer screen size itself?

Type: grilling
Status: open
Blocked by: -

## Question

Four screens make up the market workspace and none of them agrees with the others about how big it is.

- **Market Setup** is `.market-setup-body { width: 80%; height: 80% }` - 1536 x 864 at the design target, pinned to the viewport whatever it contains.
- **Tables**, **Vendors** and **Attendance Status** are each `max-width: 1100px`, growing to their content.

The 80% cap is the finding.
At 1920x1080 the plan editor gives its content **548px of the 1100px it has** and hides the other 552 behind an inner scroller, while ~190px above and ~190px below the card stay permanently empty and the outer page cannot scroll at all.
The assignment tab is the same: **537 of 1058**, hiding 521px, which puts Per Tier, Per Table Choice and the whole Placement history below the fold on arrival.
Both tabs nest a *second* scroller inside a panel, hiding a further 38px and 311px.

`git log -S "height: 80%"` dates it to 2025-02-18, *"began work on market setup page"* - the first commit of that view.
It is scaffolding nobody chose, and E10/F02/S01's stated outcome - *"dates, then tiers and sections, then the options, all in view at once"* - is false at the design target because of it.

Two more findings are the same question from other angles:

- **A panel reserves 320px for one row.** `.setting-container { min-height: 320px }` gives Market Dates ~300px of empty space under a single date, inside a card already capped. It is the largest consumer of the 548px the plan gets.
- **Section rows truncate the tier that sets their price.** `plan-row--triple` resolves to three equal 460px columns. Tier Setup needs ~250px and gets 460; Section Setup packs four columns and a delete control into the same 460, so it renders "Sil..." for *Silver* and "Garde..." for *Garden Room*. Measured: tier select 69px wide with ~38px for text, "Bronze" needs 44.4px; location select 94px with ~63px, "Garden Room" needs 87.9px.

### What to decide

**One sizing model for an organizer screen**, which answers all four at once and stops the fifth instance.
Roughly: a card of width *W* that grows to its content while the page scrolls, which is what three of the four screens already do.

The parts that are actually open:

- **What is W?** 1100 visibly shrinks Market Setup; 1536 visibly widens three screens; fluid-with-a-max is a third answer. The plan editor holds three side-by-side panels and the payoff screen holds a 3-up grid, so they may not want the same width as a single-column vendor list - in which case the model is a rule about *how* rather than a single number.
- **Does any panel keep a minimum height?** A one-row Market Dates panel at its natural height looks thin next to a three-row Section Setup. That may be fine, or it may be why the 320px exists.
- **Do the three plan columns stay equal?** Sizing them by need fixes the truncation; whether that is a per-row template or a general rule for the workspace is the decision.

### Notes

The previous map left this in its fog and it never graduated: *"The Tables view and Attendance Status share a shape... Whether anything else in the app shares it, and whether that warrants a structural answer rather than a third instance fix, only sharpens once the Tables fix lands and shows what else uses those class names."*
The Tables fix landed. What else uses the shape is now known: the whole workspace does, and Market Setup is the outlier.

Do not re-litigate the target width of 1920x1080 - settled on the previous map, ticket 06.
The check-in page is out of this ticket's scope: it is not an organizer screen and keeps its phone requirement.

Findings: F2, F3, F4 in `.lavish/qc-2026-09-20.html`.
