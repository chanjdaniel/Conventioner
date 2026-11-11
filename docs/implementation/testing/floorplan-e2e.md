---
layer: implementation
kind: testing
describes:
  - front-end/e2e/the-layout-takes-the-same-zone.spec.ts
  - front-end/e2e/pages/LayoutPage.ts
  - front-end/e2e/fixtures/test-floorplan.png
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
---

# Floorplan E2E

**Deterministic, with no AI to mock.**
A location's layout calls no model ([floorplan placement](../modules/floorplan-placement.md)), so the specs run the real flow in CI with no API keys and no stubbing.
The fixture is [`front-end/e2e/fixtures/test-floorplan.png`](../../../front-end/e2e/fixtures/test-floorplan.png), an 800x600 floor plan, calibrated as 30 m across so it is a hall that holds the tables with their aisles.
A spec gets its market from `seedLayout()` ([E2E seeds](e2e-seeds.md)): a draft with Upper Hall and Lower Hall and their sections, and a location with no name; asked, it uploads the fixture for Upper Hall and starts its layout, calibrated or not.

## The specs

- [`the-layout-takes-the-same-zone.spec.ts`](../../../front-end/e2e/the-layout-takes-the-same-zone.spec.ts), the beta's upload spec renamed and moved onto the layout page (T257), drives each step as a person does: "Lay out Upper Hall" on Section Setup opening the location's layout on its drop zone, and the nameless location offering nothing; the beta's old address landing there; a PNG uploaded, the zone busy while a held upload is in flight, and shown again after a reload; a plan dropped on the zone; a two-page PDF's second page chosen with "Use page 2", each location then showing its own image; a line dragged across the plan's 800 px and 30 m typed reading "30.0 m across", a reload keeping it and Recalibrate drawing it again; the same by keyboard; the upload's refusals, each read as an alert (a text file, a 5 MB PDF refused in the browser with nothing sent, a 21-page PDF and a damaged one refused by the server); a PNG of about 5.8 MB, random so it cannot pack, made smaller in the browser and taken; and the revision's two 409s, a second start of a location's layout and a tab that read an older layout saying so with Reload.
- No spec drives the floorplan beta's wizard any more: its address lands on the layout page, so the specs that walked it (`the-floorplan-beta-places-tables`, `-shades-its-scrollers`, `-draws-as-its-tokens-say`) went, with their page object, `FloorplanWorkflowPage`, and `seedFloorplanTemplate()`; [`dialog-idiom.spec.ts`](../../../front-end/e2e/dialog-idiom.spec.ts) dropped its Edit Table Type and template dialog cases, [`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the layout's upload and calibration instead, and [`every-select-draws-one-chevron.spec.ts`](../../../front-end/e2e/every-select-draws-one-chevron.spec.ts) measures the calibration's Unit beside its Length.
  The layout's own dialogs, its drawing and its editor gain their cases as T257's later tickets build them.

[`LayoutPage`](../../../front-end/e2e/pages/LayoutPage.ts) is their page object.
Its `drawLine()` drags with `page.mouse` between two points given in the image's pixels, placed on the SVG's box as the SVG draws its image (whole and centred), so the calibration is a real gesture; the line, the scale and the image are read back from the page and the stored layout, never from a store.
The sweeps walk a location's layout through `layoutAt()` in [`e2e/helpers/screens.ts`](../../../front-end/e2e/helpers/screens.ts) at all three sizes, since the page fits a phone: the screens seed's draft at its upload step and the screens seed's `layout` calibrating, saving nothing, and the market-days market's layout past draft ([the design language](../../design-system.md#what-keeps-this-true)).
