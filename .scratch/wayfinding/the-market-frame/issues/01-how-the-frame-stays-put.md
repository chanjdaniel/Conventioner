# 01: How does the frame stay put?

Type: prototype
Status: resolved
Blocked by: -

## Question

The app banner, the market's black header bar and the phase rail must stay visible at any scroll position while the page itself scrolls.
What does that look like, and how does it behave?

The constraint is AGENTS.md's, and it is load-bearing: **the page scrolls, and no screen caps its own height.**
The banner is already `position: sticky` for exactly that reason, and its comment warns that a sticky element inside an `overflow` ancestor silently stops sticking.
So the obvious move is two more sticky layers stacked beneath it, which has to be shown working rather than assumed.

Things the prototype must answer by showing, not arguing:

- **Stacking.** Each sticky layer needs to know the height of the layers above it. The banner is sized in `vh`. Is the stack one sticky block, or three that each know an offset?
- **The rail's parts that grow.** The rail is not always one line: a refused transition opens the blocker panel, an error prints under it, and the More menu drops down. When pinned, does a tall blocker panel push the content down, overlay it, or scroll with the page while the one-line rail stays?
- **"Fills the available height."** With the page scrolling, a surface cannot be `100vh`. Does the card reach at least the bottom of the viewport so a short surface does not leave a card that ends mid-screen, and does that hold on all four tabs?
- **A screen with no tabs.** Tables, Attendance and Vendors carry the rail but not the tab bar. Show the frame on one of them beside Market Setup at 1920x1080.
- **Where the scroll lands.** Switching tab, or following a link to a surface, should not leave content hidden under the pinned frame.

## Answer

Prototyped and decided 2026-09-26.
The prototype is primary source on the local branch `prototype/market-frame` (commit `f757ce8e`): three variants on the real Market Setup and Tables routes, switched by `?variant=A|B|C` with `none` for today, plus the throwaway specs that seeded the demo markets and took the screenshots.

**Variant A, the whole frame sticks: the market's bar and its full phase rail pin directly under the app banner as one block, and whatever the rail grows is pinned with it.**

### What the three variants showed

- **A, whole frame sticks.** The blocker panel after a refused transition pins with the rail (about 215px of frame at 1920x1080 while it is open), and sits directly under the button that caused it. The archived note costs about 40px, on archived markets only.
- **B, condenses on scroll.** Saves height, but condensing hides every stage except the current one, which removes "where the market is", the rail's whole reason to exist (settled in `readable-journey` 01 and 06), and the frame visibly jumps as it changes size.
- **C, one line pinned, growth floats.** The floating blocker panel covers the part of the plan it is telling the organizer to fix: "add market dates" lands on top of the Dates card.

### Decisions

1. **Variant A.** The bar and the full rail are one sticky block under the banner; the rail's growth (blocker panel, transition error, archived note) is inside it.
2. **Every surface starts at the top and fills the height.** The card reaches at least the bottom of the viewport, and the page still scrolls. Switching tab starts the new surface at its own top, directly under the frame.
3. **The page is the only scroller.** Tables, Attendance and Vendors each cap their card at the viewport and scroll inside it (`max-height: 100%`, `overflow: hidden`, a scrolling body), which is the nested scroller AGENTS.md forbids and the reason a sticky header cannot work there. The cap goes on all three.
4. **The banner has a fixed height, as a token.** Its height is currently whatever its content makes it (min 30px, max 100px); the prototype had to measure it with a `ResizeObserver` to know where the frame sticks. A `--banner-h` token lets the frame stick at `top: var(--banner-h)` with no script.
5. **One frame component for every market screen.** It owns pinning, the offset, filling the height and hosting the rail; Market Setup puts its title and tabs in it, and Tables, Attendance and Vendors put their own titles in it.
   Whether those three screens should also carry the market's tabs is navigation, and goes to Topic 3's map.

### Buildable work

[E21/F04 The frame stays put](../../../backlog/E21-the-market-frame/F04-the-frame-stays-put/feature.md).

