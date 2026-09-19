# 06: Where does an organizer get the check-in URL?

Type: prototype
Status: resolved
Blocked by: 01

## Question

Publishing a market puts a public check-in page on the air at `/<slug>/check-in`.
**Nothing in the product ever shows the organizer that URL.**

After the `-> market_days` transition the setup screen is unchanged except that the phase pill reads "Market Days" and the transition buttons have narrowed to Archive Market.
There is no link, no copy button, no QR code, and no mention that a public page now exists.
The organizer has to know the slug rule and type the URL.
That is the entire point of the action they just took.

Two adjacent facts shape this:

- **`/<slug>` without `/check-in` answers "Page not found"** for a live CSV-intake market.
  That is the intake-mode gate working exactly as designed and it is not a bug - a gated market answers as a nonexistent one does, deliberately, so slug-guessing reveals nothing.
  But a vendor who trims the path off the URL they were handed is told the market does not exist, and door staff will do that.
- **The check-in page does not name the market until after a lookup.**
  Before you type an email it says "Vendor Check-in"; after, "Check in for QC Winter Market 2026".
  The confirmation that you are in the right place arrives after the work, not before it.

This is a **prototype** ticket because the question is "what should the organizer see", and the cheapest way to answer it is to make the thing and react to it.
The output is a rough artifact plus a decision, not a built feature.

It was blocked on [01](01-one-lifecycle-model.md) because where the URL lives depends on what a published market's screen *is*.

## Widened by 01 (unblocked 2026-09-19)

01 settled that a **horizontal rail below the market header** carries the lifecycle spine plus the
forward action, and freezes at the last stage a market reached when it leaves the spine.
Two parts of that answer are prose that ought to be pictures, and this prototype should draw them
alongside the check-in URL rather than in a separate ticket:

- **Does the spine survive at 1280x720?**
  Seven phases on the spine (`offers` is out of scope), a prominent forward action and a secondary
  menu, on a page whose header already carries a market name and four tabs.
  If it does not fit, the fallback named in 01 is current-phase-plus-one-action, and this is where
  that gets decided.
- **Does a frozen rail read as "finished" rather than "broken"?**
  A draft abandoned straight to `archived` stops the spine partway along it.
  A reader who cannot tell a deliberately-stopped rail from a rendering failure makes the rail worse
  than the pills it replaced.

The check-in URL is then one element on a rail whose shape is known, rather than a decision taken in
isolation.

Report finding: **H4** (the "nothing tells the organizer the URL exists" half).

## Answer

**Variant A - the labelled spine - with the check-in URL as a chip on the same row. And the target
width is now 1920x1080.**

Three variants were built on the real `/market-setup` route behind `?variant=`, against the real
header and the real market, and driven at several widths.
The artifact is `.lavish/proto-06-phase-rail.html`.
The prototype itself is captured on the throwaway branch **`proto/06-phase-rail`** (`fb7d9400`) and
has been removed from the working tree; restore it with
`git checkout proto/06-phase-rail -- front-end/src/components/PrototypePhaseRail.vue front-end/src/views/MarketSetupView.vue`.

### The spine survives, at 1920

Measured with a deliberately long market name - `portland-holiday-makers-market-december-2026`, a
69-character URL, longer than anything in the repo's fixtures:

| Viewport | Rail | Smallest gap between labels | Result |
| --- | --- | --- | --- |
| 1920x1080 | 1536 | **+31px** | Clean. Spine at natural width, 24px clear of the actions. |
| 1600 | 1280 | - | Clean |
| 1440 | 1152 | - | Clean |
| 1366x768 | 1093 | **-59px** | Five labels overlap |
| 1280x720 | 1024 | **-67px** | Five labels overlap |

**The break is between 1366 and 1440.**
At and above 1440 the spine sits at its natural width and never competes with the URL chip; below
it, the spine is the flexible element on the row, absorbs the shortfall, and the labels paint over
each other into an unreadable smear.

### The target width is 1920x1080

Decided while resolving this, and it is the reason A ships rather than B or C.
**The organizer screens are designed for 1920x1080 and other widths are no longer a requirement.**

This narrows the previous map's "desktop only" and supersedes `E08/F01`'s "from 1280x720 upward" as
a *forward* commitment - that outcome stays as the record of what was done on 2026-09-14, but it is
no longer the bar new work is held to.

**One carve-out survives, deliberately: the public check-in page keeps its phone requirement.**
It is not an organizer screen, `E08/F03` shipped it at 390px on purpose, and the previous map carved
it out for a reason that has not changed - it is the one surface someone holds in their hand at a
door. Narrowing the organizer target says nothing about it.

### A still needs words on the terminal state

The one change A needs regardless of width.
Its frozen rail - a market abandoned in draft, then archived - renders the reached stage as current
and strikes through the rest.
That reads as **stopped**, not as **archived**: nothing on it says the market is over, or why.
Strikethrough is fine as reinforcement and useless as the only signal.
Both variants that stated it in words read correctly, and stating it is cheap.

### What A is

- A band **below the market header**, inside the card, on every market screen.
- The **lifecycle spine**: seven phases in order, current position marked, completed ones filled.
  `offers` is out of scope and is not on it.
- **One prominent forward action** at the right.
- Back and destructive edges in a **secondary menu**.
- When published, a **check-in URL chip** between the spine and the action, carrying the URL and a
  copy control - the thing the product has never told the organizer.
- A market that leaves the spine **freezes** it at the last stage reached, **and says in words what
  became of it**.

### Method note

Two of my own measurements were wrong before they were right, and the corrections matter to anyone
re-testing this:

- **Container overflow is not a collision detector here.**
  The `.step` boxes shrink below their labels rather than the flex container overflowing, so
  `scrollWidth > clientWidth` reports clean while the text visibly collides.
  The valid test is **label bounding-box overlap** between adjacent steps.
- An earlier "breaks below 1860" figure was arithmetic on that bad premise. The measured break is
  between 1366 and 1440.

Screenshots could not be captured in the second pass - the harness timeout will not complete a
capture at these sizes - so the 1920 evidence is live geometry rather than images. The 1280 images
in the artifact are from the first pass and show what breaking looks like.

Buildable work: `.scratch/backlog/E10-one-lifecycle-model/F01-the-phase-rail/`.
