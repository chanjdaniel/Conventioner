---
layer: implementation
kind: testing
describes:
  - front-end/e2e/fixtures/test-floorplan.png
  - front-end/e2e/the-layout-takes-the-same-zone.spec.ts
  - front-end/e2e/the-layout-draws-as-a-map.spec.ts
  - front-end/e2e/pages/LayoutPage.ts
  - front-end/e2e/a-table-moves-by-pointer.spec.ts
  - front-end/e2e/a-layout-saves-once.spec.ts
verified: 2026-11-11
sources:
  - bug/38
  - E26/F09/S01
  - E21/F02/S03
  - T45
  - E38/F01/S01
  - T205
  - T217
  - T221
  - T263
  - T272
  - T257
  - T271
---

# Floorplan E2E

**Deterministic, with no AI to mock.**
A location's layout calls no model ([floorplan placement](../modules/floorplan-placement.md)), so the specs run the real flow in CI with no API keys and no stubbing.
The fixture is [`front-end/e2e/fixtures/test-floorplan.png`](../../../front-end/e2e/fixtures/test-floorplan.png), an 800x600 floor plan, calibrated as 30 m across so it is a hall that holds the tables with their aisles.
A spec gets its market from `seedLayout()` ([E2E seeds](e2e-seeds.md)): a draft with Upper Hall and Lower Hall and their sections, and a location with no name; asked, it uploads the fixture for Upper Hall and starts its layout, calibrated or not, with tables and no-table zones placed on a calibrated one.

## The specs

- [`the-layout-takes-the-same-zone.spec.ts`](../../../front-end/e2e/the-layout-takes-the-same-zone.spec.ts), the beta's upload spec renamed and moved onto the layout page (T257), drives each step as a person does: "Lay out Upper Hall" on Section Setup opening the location's layout on its drop zone, and the nameless location offering nothing; the beta's old address landing there; a PNG uploaded, the zone busy while a held upload is in flight, and shown again after a reload; a plan dropped on the zone; a two-page PDF's second page chosen with "Use page 2", each location then showing its own image; a line dragged across the plan's 800 px and 30 m typed reading "30.0 m across", a reload keeping it and Recalibrate drawing it again; the same by keyboard; the upload's refusals, each read as an alert (a text file, a 5 MB PDF refused in the browser with nothing sent, a 21-page PDF and a damaged one refused by the server); a PNG of about 5.8 MB, random so it cannot pack, made smaller in the browser and taken; and the revision's two 409s, a second start of a location's layout and a tab that read an older layout saying so with Reload.
- [`the-layout-draws-as-a-map.spec.ts`](../../../front-end/e2e/the-layout-draws-as-a-map.spec.ts) opens the seeded Upper Hall, 30 m by 22.5 m with 20 tables, and reads the drawing from the screen: the map's name and count; a turned table's and an unturned one's box where the layout's millimetres put them, at their size; each section's fill and edge as the browser computes them, and a table in no section grey with no number; each section's name covering no table, 22 px tall, and the panel's list of sections with their counts and colours; the image the hall wide at half strength and grey, with no "Show the floorplan" tick yet; the stage hatched where it stands; Tab reaching the toolbar and then the map, once each, and leaving the map at the next press, the arrow keys moving between tables, and the stop following the focus; and the whole hall fitting a phone with nothing scrolling sideways.
- No spec drives the floorplan beta's wizard any more: its address lands on the layout page, so the specs that walked it (`the-floorplan-beta-places-tables`, `-shades-its-scrollers`, `-draws-as-its-tokens-say`, `the-floorplan-asks-before-it-drops-a-drawing`) went, with their page object, `FloorplanWorkflowPage`, and `seedFloorplanTemplate()`; [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) dropped its Edit Table Type and template dialog cases, [`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the layout's upload and calibration instead, and [`every-select-draws-one-chevron.spec.ts`](../../../front-end/e2e/every-select-draws-one-chevron.spec.ts) measures the calibration's Unit beside its Length.
  The layout's own dialogs, its drawing and its editor gain their cases as T257's later tickets build them.

- [`a-table-moves-by-pointer.spec.ts`](../../../front-end/e2e/a-table-moves-by-pointer.spec.ts) drives the editor with the pointer's own gestures (`page.mouse`) and reads what each did from the table's name on the map, the selection's card and the layout the server stored, never from the page's state: Add table placing "Gold row 1" and "Gold row 2" where they were clicked at their true size, Silver aisle numbered on its own, "No section" staying chosen for two tables of none, and a reload keeping them; a table dropped five pixels short of another's edge snapped to it, to the tenth of a millimetre, with one guide shown while the button is down, the same five pixels kept with Alt and no guide, and a reload showing it where it was dropped; a table dragged past the east and north walls stopping with its centre on the corner; the handle dragged 40° turning the table 45° about its centre, then R and "Turn 90°" a quarter each; "Gold row 2" of 4 removed, the two after it renumbered, the focus on the map after it, and Section Setup reading 3 "from the layout" beside Lower Hall's typed count; and Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and the buttons undoing and redoing an add, a move and a turn, each one saved.
- [`a-layout-saves-once.spec.ts`](../../../front-end/e2e/a-layout-saves-once.spec.ts) holds the saves: a second tab that read the layout before the first tab's move adds a table and is told the layout changed elsewhere, with Reload and no Retry, keeps its table on screen with nothing of it stored, takes the first tab's layout on Reload and saves from there; Market Setup, open in another tab since before the editor placed two tables, saves an edit of its own and the layout's three tables stand, with the plan's edit stored and the counts derived; a table added with the save's request aborted says the app's offline sentence with Retry and stays on screen, a move to Lower Hall asks "Leave without saving?" and Stay keeps it, and Retry stores it once the request goes through, after which the move asks nothing; and a table placed and the page reloaded inside the 600 ms wait is asked by the browser, sent as the page goes and there after the reload.
  That last test runs with the browser's own User-Agent, as `the-plan-saves-one-at-a-time.spec.ts` does: Playwright's emulated one does not reach a request sent from `pagehide`, and the session protection refuses a request from another browser.
  It does not hold a plan write crossing a layout save in flight; see [what is not held](#what-is-not-held).

[`LayoutPage`](../../../front-end/e2e/pages/LayoutPage.ts) is their page object: `onScreen()` gives where a point of the hall, in millimetres, is on the screen at any pan and zoom, `clickAt()` and `drag()` press and drag between such points, and `saved()` wraps a change and waits for the write it starts, since a change waits 600 ms before it is sent and "Saved" still stands from the save before.
Its `drawLine()` drags with `page.mouse` between two points given in the image's pixels, placed on the SVG's box as the SVG draws its image (whole and centred), so the calibration is a real gesture; the line, the scale and the image are read back from the page and the stored layout, never from a store.
The sweeps walk a location's layout through `layoutAt()` in [`e2e/helpers/screens.ts`](../../../front-end/e2e/helpers/screens.ts) at all three sizes, since the page fits a phone: the screens seed's draft at its upload step, the screens seed's `layout` calibrating and its `laidOut` drawn as its map (the editor at a desk, the map read on a phone), then at a desk alone with a table selected and with Add table's options strip open, saving nothing, and the market-days market's layout past draft ([the design language](../../design-system.md#what-keeps-this-true)).

## What is not held

A plan write (`PUT /markets/<id>/plan`) whose read came before a layout save and whose write lands after it puts the older layout back: the plan write keeps the floorplans it read and writes the whole plan unconditionally.
No spec or back-end test holds it yet, since nothing closes it on this branch: T274's revision of the plan (`planRevision`, held by the plan write and counted by the layout save) does, and the test of the crossing is written when that lands and the layout save and the editor's queue are fitted to it.
