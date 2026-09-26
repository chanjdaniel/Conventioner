# 02: How is every market screen reached?

Type: prototype
Status: resolved
Blocked by: 01

## Question

A market has four tabs in its black header bar (Market Setup, Application Form, Applications, Assignment) and more screens that carry the phase rail but not the tabs, reached today by quick links from the result.
[01](01-what-is-on-each-page.md) split Assignment into two pages, **Assignment** (the rules and the run) and **Result** (the assignment, read and changed), and moved the Tables screen into Result.
That leaves Vendors and Attendance.
What does moving around one market look like?

The prototype must answer by showing, on the real routes at 1920x1080:

- **The two pages inside the Assignment tab.** Sub-tabs under the bar, a switch inside the surface, a stepper, or something else - and how it sits with the pinned frame (`MarketFrame`, whose bar and rail stick under the banner).
  The tab and its first page share a name, Assignment (organizers' word, decided in 01); the navigation has to make that read as "the tab, and its first page", not as a stutter.
- **The Result page's own layout.** A summary strip, the tables grid with per-seat editing, the unassigned vendors, the placement history and the CSV, and where [03](03-does-a-result-know-its-rules-changed.md)'s out-of-date notice sits. The grid is the Tables screen's today; show it inside Result.
- **Vendors and Attendance.** Do they join the header's tabs, become pages of a tab (Vendors under Result, say), or stay separate screens reached some other single way?
  The destination asks that every market screen be reached the same way; show at least two answers side by side.
- **Which page opens by default, in each phase.** The rail already marks the current stage and the tab bar marks the current surface (`isCurrentSurface`).
  Before an assignment exists, the Assignment page; after, Result? And in `market_days`, is Attendance the market's front page?
  (A run lands on Result - decided in 01.)
- **Import and Floorplan.** Both are market screens too, but each is a flow entered from a tab (Applications, Market Setup) rather than a place to go. Show whether they stay that way.
- **Too many tabs.** Six destinations do not fit the bar the way four do. What happens at 1280 wide?

Every page is a URL (settled while charting), so the prototype's answer includes the address of each page.

## Answer

Prototyped and decided 2026-09-26.
The prototype is primary source on the local branch `prototype/plan-row-rule` (commit `686961df`): three navigations rendered by `MarketFrame`, so every market screen carries them, switched by `?nav=A|B|C` with `none` for today; the Result page is the Tables screen under a summary strip, with `&stale=1` mocking [03](03-does-a-result-know-its-rules-changed.md)'s line.

| | Navigation | What it showed |
| --- | --- | --- |
| A | Flat: six tabs; Assignment has pages Assignment and Result | Vendors and Attendance sit in the bar showing nothing before there is an assignment; six tabs beside a long name only just fit at 1280. |
| B | Nested: four tabs; Assignment has pages Assignment, Result and Vendors; Attendance becomes a fifth tab once published | The bar only grows as the market does; Result and Vendors side by side as the assignment by table and by vendor. |
| C | The bar keeps the name; every screen listed down the frame's left side, by stage | Clear, but 200px of width on every market screen, and unlike anything else in the product. |

**B.**

- **The bar**: Market Setup, Application Form, Applications, Assignment, and **Attendance once the market is published** (`market_days`, `archived`).
- **The Assignment tab's pages**: **Assignment** (the rules and the run), **Result** (the assignment by table), **Vendors** (the assignment by vendor), in a row under the rail, pinned with the frame.
  The row is what makes the repeated name read as "the tab, and its first page".
- **A tab opens the page where the market is worked on in its phase** (the dot): in `assignment` with an assignment stored, Assignment opens Result; in `market_days`, the market opens on Attendance. Every other page is one click away in the row.
- **Every page has its own address**: `/markets/:id/{setup, form, applications, assignment, result, vendors, attendance}`. The `setup?tab=` addresses and `/tables` redirect to theirs, so a bookmark still lands.
- **Import and Floorplan stay flows** entered from their tab (Applications, Market Setup), carrying the same bar with that tab active.
- **One frame width for every market screen**, `--workspace-max`: Tables was `--list-max`, so moving between tabs made the frame jump and cut the name to "Journey E2E 17904063038…". The name ellipses only when the bar truly runs out of room.
- **The Back buttons go** from Tables, Vendors and Attendance: they existed because those screens had no tabs.

**The Result page**, top to bottom: the out-of-date line ([03](03-does-a-result-know-its-rules-changed.md)); a summary strip (vendors placed, tables used, unassigned, satisfaction, **Statistics**, **Download CSV**); the tables grid with its seat editing and filters; the placement history.

- **Statistics opens an inline panel under the strip**, closed by default, holding the per date / section / tier / table choice counts. Not a dialog: AGENTS.md's dialog is one small job, and this is reading.
- **The Unassigned Tables list goes**: the grid's "empty" filter already shows those tables on the grid itself.
- **"2 unassigned" leads to Vendors, filtered to the unassigned.**
- With no pins, "Run again"'s line reads "Places everyone again." rather than counting zero hand placements.

Buildable work: [E22/F04 The Assignment tab has pages](../../../backlog/E22-the-assignment-tab/F04-the-assignment-tab-has-pages/feature.md).
