# 07: Why is a published market's rail four times taller than a draft's?

Type: grilling
Status: resolved
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

## Answer

Decided 2026-10-03, building [E26/F10/S01](../../../backlog/E26-the-user-flows-hold/F10-polish-copy-and-accessibility/S01-layout-polish.md) (bug 11, which found the application-page chip in Applications Open to be a second case of the same cause).

**The address gives way, and the rail's end travels as one piece.**

- **The chip is the one flexible part of the row.** Its address shortens with an ellipsis and drops the scheme every address shares, so the part that names the market is what shows. The whole address is still the link, its hover text and what Copy copies, so nothing is lost by shortening it. At 1440 the rail is one row, 61px, the same with an address as without.
- **The addresses and the actions are one item of the row.** Where the row cannot hold them beside the spine at a useful width, they take a second row together: addresses at its start, actions at its end. That is the designed two-row rail the question asked for, rather than today's overflow, which left "Close Applications" alone on a row beside an empty band.
- **The third option was already taken.** E22/F04/S01 gave every market screen the workspace width, so Tables, Vendors and Attendance no longer sit below the break at 1100. Nothing here amends `--list-max`.

Two things found on the way, both fixed in the same story: the chip was a pixel taller than the buttons, so the rail grew by one whenever an address appeared, and every market screen placed the frame itself, so the rail sat at a different x on four of them.
