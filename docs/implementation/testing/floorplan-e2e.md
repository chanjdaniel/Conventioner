---
layer: implementation
kind: testing
describes:
  - front-end/e2e/floorplan.spec.ts
  - front-end/e2e/the-floorplan-beta-places-tables.spec.ts
  - front-end/e2e/pages/FloorplanWorkflowPage.ts
  - front-end/e2e/fixtures/test-floorplan.png
verified: 2026-10-31
sources:
  - bug/38
  - E26/F09/S01
  - E21/F02/S03
  - T45
  - E38/F01/S01
---

# Floorplan E2E

**Deterministic, with no AI to mock.**
The floorplan wizard calls no model: Auto-Place is a geometry solver and the walls are drawn by hand ([floorplan placement](../modules/floorplan-placement.md)), so both specs run the real flow in CI with no API keys and no stubbing.
The fixture is [`front-end/e2e/fixtures/test-floorplan.png`](../../../front-end/e2e/fixtures/test-floorplan.png), an 800x600 floor plan, calibrated as 30 m across so it is a hall that holds the tables with their aisles.

## The specs

- [`floorplan.spec.ts`](../../../front-end/e2e/floorplan.spec.ts) walks the whole wizard from a draft's Market Setup (upload, calibrate, a table type and Auto-Place, sections, save), lands back on the market's setup page, and checks that the saved plan has the floorplan's sections and locations, that the store still holds the placed tables, and that the next plan edit does not erase the floorplan (a parser that dropped `floorplans` once did, E21/F02/S03).
- [`the-floorplan-beta-places-tables.spec.ts`](../../../front-end/e2e/the-floorplan-beta-places-tables.spec.ts) pins bug 38's fixes: the path choice promises nothing the wizard does not do, a calibration line drawn from beside the image still draws, the scale reads the right way round, a new table type seats two, and Auto-Place asked for twenty places twenty and says so.

[`FloorplanWorkflowPage`](../../../front-end/e2e/pages/FloorplanWorkflowPage.ts) is their page object, and `completeFloorplanWorkflow()` walks every step.
`reachTableTypes()` stops at the table types (upload and calibrate), which is where [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) drives the Edit Table Type dialog and [`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the add form and that dialog (T45).
`reachSaveStep()` goes on to the save step, with a table type placed and grouped, where the same two specs drive and walk the Save Template and Load Template dialogs; `completeFloorplanWorkflow()` is it plus the save.
A template the suite seeds belongs to the user, not the market, and the suite shares one user, so Load Template's list grows with every run: a spec seeds its own with `seedFloorplanTemplate()` ([E2E seeds](e2e-seeds.md)) and finds it by the unique name that returns.
The table-type fields are native inputs, found by their test ids.
The sweeps walk the wizard through `floorplanAt()` in [`e2e/helpers/screens.ts`](../../../front-end/e2e/helpers/screens.ts), with the same page object: calibrating, adding a table type, the sections listed, ready to save and the save dialog, on the screens seed's draft, saving nothing ([the design language](../../design-system.md#what-keeps-this-true)).
Those steps are marked `deskOnly`, since at a phone's width the calibration field is off the screen, so the focus sweep's phone walk passes them by.

## Which canvas steps are real gestures

The wizard draws on a Konva stage, and its steps are not equally drivable:

- **Calibration is a real gesture**: `drawCalibrationLine()` drags with `page.mouse` across the stage.
- **Section grouping is not**: the Konva lasso is not reliably drivable through simulated mouse events, so `groupAllTablesIntoSection()` sets the floorplan store's sections directly through `page.evaluate`.
- **The editor canvas is not exercised at all**: no spec drags, rotates or deletes a table.
- `snapshotPlacedTables()` reads the store's `placedTables` through `page.evaluate`, to assert that tables survive across steps.

**The coverage gap**: section grouping and the editor canvas are validated at the state level, not as gestures a person makes.
Anyone extending floorplan coverage accounts for it, and a bug in the lasso or in dragging a table would pass both specs.
