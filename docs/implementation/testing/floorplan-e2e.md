---
layer: implementation
kind: testing
describes:
  - front-end/e2e/floorplan.spec.ts
  - front-end/e2e/the-floorplan-beta-places-tables.spec.ts
  - front-end/e2e/the-floorplan-takes-the-same-zone.spec.ts
  - front-end/e2e/pages/FloorplanWorkflowPage.ts
  - front-end/e2e/fixtures/test-floorplan.png
  - front-end/e2e/the-floorplan-shades-its-scrollers.spec.ts
  - front-end/e2e/the-floorplan-draws-as-its-tokens-say.spec.ts
  - front-end/e2e/the-floorplan-asks-before-it-drops-a-drawing.spec.ts
  - front-end/e2e/a-floorplan-save-keeps-the-market-readable.spec.ts
verified: 2026-11-10
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
  - T271
  - T272
---

# Floorplan E2E

**Deterministic, with no AI to mock.**
The floorplan wizard calls no model: Auto-Place is a geometry solver and the walls are drawn by hand ([floorplan placement](../modules/floorplan-placement.md)), so the specs run the real flow in CI with no API keys and no stubbing.
The fixture is [`front-end/e2e/fixtures/test-floorplan.png`](../../../front-end/e2e/fixtures/test-floorplan.png), an 800x600 floor plan, calibrated as 30 m across so it is a hall that holds the tables with their aisles.

## The specs

- [`floorplan.spec.ts`](../../../front-end/e2e/floorplan.spec.ts) walks the whole wizard from a draft's Market Setup (upload, calibrate, a table type and Auto-Place, sections, save), lands back on the market's setup page, and checks that the saved plan has the floorplan's sections and locations, that the store still holds the placed tables, and that the next plan edit does not erase the floorplan (a parser that dropped `floorplans` once did, E21/F02/S03).
- [`a-floorplan-save-keeps-the-market-readable.spec.ts`](../../../front-end/e2e/a-floorplan-save-keeps-the-market-readable.spec.ts) pins T272's fix: a market fresh from `seedDraftMarket()`, whose plan was never saved, walks the whole wizard to "Save & Continue" and still opens, on Market Setup and to `GET /markets/<id>`, with the empty plan and the floorplan's section, location and floorplan.
  Its second test runs the wizard twice with a `page.reload()` between and reads one floorplan, of the first save's id, after both saves.
- [`the-floorplan-beta-places-tables.spec.ts`](../../../front-end/e2e/the-floorplan-beta-places-tables.spec.ts) pins bug 38's fixes: the path choice promises nothing the wizard does not do, a calibration line drawn from beside the image still draws, the scale reads the right way round, a new table type seats two, and Auto-Place asked for twenty places twenty and says so.
- [`the-floorplan-takes-the-same-zone.spec.ts`](../../../front-end/e2e/the-floorplan-takes-the-same-zone.spec.ts) pins the upload step on the app's one drop zone (T205): its words, the input named by them, a text file refused with the type message, the zone busy while a held upload is in flight, and a plan dropped on the zone uploading.
- [`the-floorplan-shades-its-scrollers.spec.ts`](../../../front-end/e2e/the-floorplan-shades-its-scrollers.spec.ts) pins the rule on scrolling (T217): each canvas's height at 1440x900, a short window scrolling the page with nothing in the wizard scrolling, at the calibrating and placed steps, and the shades coming and going on the Sections panel, the section dialog and the save dialog, the panel keeping its translucent ground and a press beside it reaching the canvas; and focus going into the calibration's panels, on a redraw too, the section dialog and the save dialog, and back to Save as that one closes; and Enter on the length panel doing what has focus, so its field calibrates, or says a length is missing, and its Redraw redraws with nothing sent.
- [`the-floorplan-draws-as-its-tokens-say.spec.ts`](../../../front-end/e2e/the-floorplan-draws-as-its-tokens-say.spec.ts) pins what the beta's move onto tokens leans on (T221): a section's row and its delete button read AA on the fill they hover, a wall toolbar separator stays 1px wide and a step label stays on one line at each size, so `--radius-pill` draws their corners as the raw radii did.
- [`the-floorplan-asks-before-it-drops-a-drawing.spec.ts`](../../../front-end/e2e/the-floorplan-asks-before-it-drops-a-drawing.spec.ts) pins the question before a floorplan not yet saved is dropped (T271): none before an upload, the leave question on a market tab, Back and the app bar after one, Stay keeping the upload or the step, the browser's own question on a reload, and the save going back to Market Setup unasked.
  A spec that leaves the wizard after an upload, other than by its save, meets that question and answers it.

[`FloorplanWorkflowPage`](../../../front-end/e2e/pages/FloorplanWorkflowPage.ts) is their page object, and `completeFloorplanWorkflow()` walks every step.
`uploadFloorplanImage()` sets the file on the drop zone's input (`floorplan-upload-file-input`) with `setInputFiles`, opening no file chooser.
`reachTableTypes()` stops at the table types (upload and calibrate), which is where [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) drives the Edit Table Type dialog and [`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the add form and that dialog (T45).
`reachSaveStep()` goes on to the save step, with a table type placed and grouped, where the same two specs drive and walk the Save Template and Load Template dialogs; `completeFloorplanWorkflow()` is it plus the save.
A template the suite seeds belongs to the user, not the market, and the suite shares one user, so Load Template's list grows with every run: a spec seeds its own with `seedFloorplanTemplate()` ([E2E seeds](e2e-seeds.md)) and finds it by the unique name that returns.
The table-type fields are native inputs, found by their test ids.
The sweeps walk the upload step at rest, at a desk and a phone's width, and the wizard through `floorplanAt()` in [`e2e/helpers/screens.ts`](../../../front-end/e2e/helpers/screens.ts), with the same page object: calibrating, adding a table type, the sections listed, ready to save and the save dialog, on the screens seed's draft, saving nothing ([the design language](../../design-system.md#what-keeps-this-true)).
Those steps are marked `deskOnly`, since at a phone's width the calibration field is off the screen, so the focus sweep's phone walk passes them by.

## Which canvas steps are real gestures

The wizard draws on a Konva stage, and its steps are not equally drivable:

- **Calibration is a real gesture**: `drawCalibrationLine()` drags with `page.mouse` across the stage.
- **Section grouping mostly is not**: the Konva lasso is not reliably drivable through simulated mouse events, so `groupAllTablesIntoSection()` and `listManySections()` set the floorplan store's sections directly through `page.evaluate`.
  `the-floorplan-shades-its-scrollers.spec.ts` alone drags a lasso, on the part of the canvas in view, and only to open the section dialog, which it cancels.
- **The editor canvas is not exercised at all**: no spec drags, rotates or deletes a table.
- `snapshotPlacedTables()` reads the store's `placedTables` through `page.evaluate`, to assert that tables survive across steps.

**The coverage gap**: section grouping and the editor canvas are validated at the state level, not as gestures a person makes.
Anyone extending floorplan coverage accounts for it, and a bug in the lasso or in dragging a table would pass every one of these specs.
