# 07: Why is a published market's rail four times taller than a draft's?

Type: grilling
Status: open
Blocked by: -

## Question

Graduated from this map's fog on 2026-09-20, when [ticket 01](01-how-an-organizer-screen-sizes-itself.md) picked the widths it hung on.

The phase rail is on every market screen. Measured on the shipped rail at 1920x1080, stepping the card width:

| Card width | Rail height, published market | Rail height, no check-in chip |
| --- | --- | --- |
| 1100 (`--list-max`) | **111px** | 27px |
| 1280 | 111px | 27px |
| 1360 | 120px | 27px |
| 1440 (`--workspace-max`) | 62px | 27px |
| 1536 | 62px | 27px |

**The check-in chip is the entire cause.** Without it the rail is 27px at every width from 1100 to 1440. With it, the rail wraps to a second row below 1440 and is 62px even above it.

So on the three `--list-max` screens - Tables, Vendors, Attendance - **publishing a market makes the rail grow from 27px to 111px, permanently**, and takes 84px off the top of the three screens where an organizer does the work of market day. Ticket 01 chose 1440 for the workspace partly to avoid this, but `--list-max` is 1100 because list content is ~1035, and raising it to 1440 would put a 1,035px list in a 1,440px page.

This is not a regression. [readable-journey ticket 06](../../readable-journey/issues/06-where-the-check-in-url-lives.md) put the URL on the rail deliberately, and measured then that the rail's break is *"between 1366 and 1440"*. It picked 1536 for Market Setup, which was above the break. What it did not settle is what happens on the screens that are below it - and at the time, Tables was the only one.

### What to decide

**Where the check-in URL lives on a screen narrower than the rail's break.** The parts that are actually open:

- **Is a two-row rail acceptable on the list screens?** It is 84px, on screens that carry a filter bar and a long scroller beneath it. If yes, it should be *designed* as two rows rather than being a wrap that happens - today the second row is the first row's overflow.
- **Or does the chip stop being a chip below the break?** It could collapse into the `More...` menu, or become an icon button that copies, or move out of the rail entirely into the screen's own header.
- **Or do the list screens get the workspace width after all**, and the emptiness of a 1,035px list in a 1,440px page is the lesser cost? This one is cheap to try and would close the ticket without touching the rail.

### Notes

Do not re-litigate whether the check-in URL belongs on the rail - readable-journey ticket 06 settled that, and this ticket is a consequence of it, not a challenge to it.

Do not re-litigate the two widths; ticket 01 settled those. If the answer here is the third option above, that is an amendment to `--list-max`, and it should say so explicitly.

The public check-in page is out of scope, as everywhere on this map.

Evidence: ticket 01's answer, and `.lavish/aesthetics-2026-09-20.html` (the rail is visible at 111px in the Tables and Vendors captures).
