---
layer: implementation
kind: module
describes:
  - back-end/services/placement_service.py
  - back-end/api/floorplans_placement.py
  - back-end/requirements-floorplan-solver.in
  - back-end/requirements-floorplan-solver.txt
  - back-end/api/floorplans_save.py
  - back-end/api/floorplans_calibrate.py
  - back-end/api/floorplans_export.py
  - back-end/api/floorplans.py
  - back-end/api/floorplans_access.py
  - back-end/api/floorplans_templates.py
  - back-end/services/gridfs_service.py
  - back-end/utils/pdf_converter.py
  - front-end/src/components/floorplan/FloorplanWorkflow.vue
  - front-end/src/utils/canvasColor.ts
  - front-end/src/components/floorplan/AutoPlaceButton.vue
  - front-end/src/components/floorplan/FloorplanEditor.vue#loadBackgroundImage
  - back-end/floorplan_limits.py
  - back-end/api/markets.py#_floorplans_refusal
  - front-end/src/views/FloorplanEditorView.vue
  - front-end/src/stores/floorplan.ts
  - back-end/api/markets.py#_with_the_layouts
  - back-end/api/markets.py#release_removed_floorplans
  - back-end/layout.py
  - back-end/migrations/migrate_layouts.py
  - front-end/src/components/layout/FloorplanUploader.vue
  - front-end/src/components/layout/LayoutView.vue
  - front-end/src/components/layout/LayoutCalibration.vue
  - front-end/src/components/layout/LayoutMap.vue
  - front-end/src/components/layout/LayoutMapTable.vue
  - front-end/src/components/layout/LayoutPanelSections.vue
  - front-end/src/components/layout/layoutGeometry.ts
  - front-end/src/components/layout/layoutDrawing.ts
  - front-end/src/components/layout/calibration.ts
  - front-end/src/components/layout/layoutSave.ts
  - front-end/src/components/layout/shrinkImage.ts
  - front-end/src/components/layout/useFloorplanImage.ts
  - front-end/src/components/layout/LayoutEditor.vue
  - front-end/src/components/layout/LayoutPanelSelection.vue
  - front-end/src/components/layout/useLayoutEditor.ts
  - front-end/src/components/layout/layoutSelection.ts
  - front-end/src/components/layout/layoutAnnouncements.ts
  - front-end/src/components/layout/LayoutPanelKeyboard.vue
  - front-end/src/components/layout/layoutRow.ts
  - front-end/src/components/layout/LayoutRowPreview.vue
  - front-end/src/components/layout/layoutFill.ts
  - front-end/src/components/layout/LayoutFillDialog.vue
  - front-end/src/components/layout/LayoutFillPreview.vue
  - front-end/src/components/layout/LayoutCrosshair.vue
  - front-end/src/components/elements/ElementLocationSetup.vue
  - back-end/api/layouts.py
  - front-end/src/components/layout/layoutTypes.ts
  - front-end/src/components/layout/LayoutPanelTypes.vue
  - front-end/src/components/layout/LayoutTypeDialog.vue
  - front-end/src/components/layout/LayoutSavedTypesDialog.vue
  - front-end/src/components/layout/LayoutSaveTypesDialog.vue
  - front-end/src/components/layout/LayoutPanelZones.vue
verified: 2026-11-11
sources:
  - bug/38
  - E26/F09/S01
  - E31/F01/S02
  - T205
  - T221
  - T217
  - T263
  - T271
  - T272
  - T257
---

# Floorplan placement

T257 makes a floorplan a location's layout, stored in the plan as [the market document](../data/market-document.md#a-locations-layout) says, and worked on its own page, [the layout page](#the-layout-page), reached from Section Setup.
The floorplan beta came before it: an organizer uploaded a floor plan, calibrated its scale, defined table types, Auto-Placed them, grouped them into sections, and saved the result into the market's plan.
Its code stays until T257's last phase removes it, but nothing reaches it: its address, `/markets/:marketId/floorplan`, now lands on the layout page, and Section Setup no longer offers it; its save would be refused (below).
The wizard is five steps (Upload, Calibrate, Place Tables, Edit Layout, Save) and the Konva canvas draws every one of them.
Each component that draws imports the vue-konva components it renders (`Stage as VStage`, `Layer as VLayer` and so on) rather than the app installing vue-konva for every page, so Konva rides only in the floorplan route's lazily loaded chunk, and [the bundle budget](../testing/ci-and-the-gate.md#the-bundle-budget) fails a pull request that brings it back to every page.
No step scrolls by itself: the market's frame gives the wizard no height to outgrow, so a step grows with what it holds and the page scrolls, in any window; what scrolls inside the wizard is the Sections panel, the save dialog's body and the section dialog, each in a [`ScrollBox`](../../design-system.md#the-primitive-layer).

**The floorplan beta makes no LLM or vision call.**
Auto-Place (`POST /floorplans/place-tables`, [`back-end/api/floorplans_placement.py`](../../../back-end/api/floorplans_placement.py)) is a pure geometry solver in [`back-end/services/placement_service.py`](../../../back-end/services/placement_service.py): Shapely for the room and the zone, `pyckingsolver` for the packing.
Walls are drawn by hand, and no route sends a floorplan image to a hosted model.
So the flow can be exercised end to end in CI with no API keys and no stubbing ([floorplan E2E](../testing/floorplan-e2e.md)).

## The layout page

[`LayoutView.vue`](../../../front-end/src/components/layout/LayoutView.vue) is `/markets/:marketId/layout/:locationId`, under the Market Setup tab, in the market's frame ([every market page has an address](../conventions/every-market-page-has-an-address.md)); with no location it opens the market's first named one.
Its head row holds "Layout", the switch between the market's named locations (each a link to its own address, the one open marked `aria-current`), the save state ("Saved", "Saving…", or the failure with Retry, or the revision's refusal with Reload), the scale ("36.0 m across", or "Not calibrated") and "Back to Market Setup"; below it the map column and a 320px side panel, which goes under the map with less than 1100px of room (a container query on the page).
Before an image the map column is the upload's drop zone and the panel says "Upload the venue's floorplan for Upper Hall to start."; the first save, made as the image is chosen, starts the layout.
Before a scale it is [`LayoutCalibration.vue`](../../../front-end/src/components/layout/LayoutCalibration.vue): the image in an SVG whose units are its pixels, a line drawn by drag (its ends draggable after) or by keyboard (a crosshair from the centre, the arrows, Enter for each end, a polite live region saying each step), a length in m, cm, mm, ft or in, and "Set the scale", whose arithmetic is [`calibration.ts`](../../../front-end/src/components/layout/calibration.ts): `scalePxPerUnit` is the line's pixels over its millimetres, from a line of at least 10 px.
Recalibrate draws the line again from the stored one; a table keeps its millimetres, so the image is what moves under it.
A scale that would leave tables outside the floorplan is refused in the calibration's error line, with how many, and nothing is written; that sentence goes with the location, so another location's calibration starts without it.
The panel's Floorplan card says how wide the floorplan reads, holds "Show the floorplan" (ticked; unticked, the map draws the floor alone, for this visit), and for someone who may change the layout "Replace the image" and "Recalibrate".
Replace the image is the upload again in the map's place, with "Keep the current image", and then the scale over the new image, its line started from the stored one carried onto the new image's pixels, so the same drawing at another size keeps its hall's size with "Set the scale" alone; only then is the layout written with the new image and its scale, every table keeping its millimetres, and the save deletes the old image by id.
A write of the new image that is refused or fails leaves the layout on its old image with nothing unsaved (`write`'s `rollBack`) and says why above the scale; a new image that cannot be shown offers "Choose another image" and "Keep the current image".
A replacement given up after its upload, or left with the page, deletes the image it uploaded (`DELETE /floorplans/<id>`, which records `floorplan_image_deleted`).
With a scale the map column is [the editor](#the-editor) for a person who may change the layout, at a desk, and for anyone else, and at a phone's width (640px and below), [the drawing](#the-drawing) in its read mode; either is drawn over the floor alone while the image is on its way or could not be fetched (which the page says above it), the read map the whole hall in a box of the floorplan's shape, as wide as the column and as tall as that makes it, and the panel gains "Sections in Upper Hall" ([`LayoutPanelSections.vue`](../../../front-end/src/components/layout/LayoutPanelSections.vue)): each of the location's sections with the colour the map draws it in, its tier and its count of tables on the layout.
A person the Market Setup row refuses, and anyone past draft (the save's blanket 409 until T257's ticket 11 narrows it), reads the page with nothing to upload or calibrate.
The page holds the layout's working copy ([`useLayoutEditor.ts`](../../../front-end/src/components/layout/useLayoutEditor.ts), [below](#the-editor)); each save names the revision of the layout it read ([`layoutSave.ts`](../../../front-end/src/components/layout/layoutSave.ts)), and after each answer the page re-reads the market through [the one store](../conventions/one-market-from-the-server.md).
The image is fetched with the session as a blob ([`useFloorplanImage.ts`](../../../front-end/src/components/layout/useFloorplanImage.ts)), as the image read requires.

## The drawing

[`LayoutMap.vue`](../../../front-end/src/components/layout/LayoutMap.vue) is the one drawing of a layout, in SVG, for the page, and for the editor, the PNG export and any later map as T257's later tickets build them.
Its props are the layout, its location's name, the plan's sections, the market's table types, the image as the page fetched it, `mode` (`read`, `edit` or `print`), `showImage` (unless told, the image is drawn in `read` and `edit` and left out of `print`), `view`, `selection`, `guides` and `carried`; it emits `activate` with a table's id, and draws its default slot last, over the tables, in its millimetres, handing it the millimetres to a pixel.
It holds no editing state: its only state is which table has the focus.

- **Its units are millimetres** from the floorplan's top-left corner, so a table is its true size at any zoom: `view` is the part of the hall shown (the whole hall when not given, drawn whole inside the map's box), the image is drawn the hall wide, and a table is a rectangle about its centre, moved and turned by its group's `transform`.
- **What is read in pixels holds its size at every zoom**: edges and outlines by `vector-effect: non-scaling-stroke`, and names, numbers, gaps and the zones' hatch by the scale the map measures its own box at (a `ResizeObserver`).
  100% is 1 px to 25 mm (`PX_PER_MM_AT_100`).
- **It draws** the floor, the image (at half strength and grey in `read` and `edit`), each no-table zone hatched with its label, each table in its section's colour of [the section palette](../../design-system.md#the-section-palette) with its number, a table whose section is gone or is another location's, or that has no number, in grey with none, and each section's name in a pill.
  A table's number is 14 px where the table has the room, smaller to fit, and left out of a table too small to carry it at 6 px (`numberSizePx`); it turns with its table and never reads upside down.
- **A section's name** goes where its style's `labelAt` says, else where `sectionLabelAt` puts it: just outside the section's own tables on the longer side of their box, the side toward the hall's centre, at that side's middle; where that would cover a table or another name, or leave the hall, it slides along the side, then tries the other sides.
  It stands against the section's tables there, not against the box, so the name of an L-shaped section is beside one of its arms.
  On a layout too full for any free place it stays at its first choice, over tables.
- **`read` and `edit` make the map a group** named "Upper Hall layout, 49 tables" and each table a button named "Gold row 5, Standard 6 ft" (in no section: "Table in no section, Standard 6 ft"), in the order of the sections and their numbers; a zone is an image named "No-table zone: Stage".
  One table is the map's Tab stop, the one focused last, else the first selected, else the first, and the arrow keys move the focus to the nearest table within 45° of the arrow (`nearestInDirection`), unless the editor round the map took the key first, on the table or in the capture phase.
  A table says when it takes the focus itself: a focus listener on the `<svg>` makes Chromium count the map as a Tab stop of its own.
  In `edit` a map with no table is the Tab stop itself, so the keys have somewhere to place the first table from.
- **In `read` a table pressed**, by pointer, Enter or Space, emits `activate`; `edit` draws the selection's outline and the guides it is given, says each table pressed or not (`aria-pressed`) as it is selected or not, draws the tables it is told were picked up by keyboard (`carried`) lifted, and leaves a press to the editor; `print` is a picture named as the map is, with no button and no stop.
- **A table's paint is written on its shapes** (`fill="var(--layout-section-1-fill)"`), not in a class, and its sizes are attributes, so the markup carries the drawing wherever it goes; the tokens still resolve from the page's stylesheet.
- **A focused table draws the app's button border itself**, a shape over its own edge ([the design language](../../design-system.md#the-primitive-layer)), since a CSS outline on an SVG shape is measured in the drawing's units.
- Each table is a component of its own ([`LayoutMapTable.vue`](../../../front-end/src/components/layout/LayoutMapTable.vue)) whose props are plain values, so a table whose values did not change is not drawn again when another does, and a pan, a change of `view` at the same zoom, changes the `viewBox` and no table.

The geometry is pure, in [`layoutGeometry.ts`](../../../front-end/src/components/layout/layoutGeometry.ts) (a turned table's corners and box, the palette's order, a name's place, the arrow keys' focus, a number's size, and [the editor's](#the-editor)), and what the drawing says, in [`layoutDrawing.ts`](../../../front-end/src/components/layout/layoutDrawing.ts) (`layoutSections`, a location's sections with their colours and tables, which the map and the panel's list both read; a table's code and name; a place in metres to one decimal; a width of words in the app's type).

## The editor

[`LayoutEditor.vue`](../../../front-end/src/components/layout/LayoutEditor.vue) is the map column of a calibrated layout for a person who may change it: a toolbar, the map on a stage that pans and zooms, and a hint line.
It draws the working copy through [the drawing](#the-drawing) in `edit` mode and turns the pointer and the keys into the model's commands; it holds no table of its own.

- **The model is [`useLayoutEditor.ts`](../../../front-end/src/components/layout/useLayoutEditor.ts)**, held by the page: the layout's working copy, never changed in place, the selection, and the commands `addTables`, `moveTables`, `turnTables`, `removeTables`, and for many at once `setSection`, `setType`, `duplicate`, `align`, `distribute`, `renumber` and `setSectionStyle`.
  A new table takes its section's next number, a move stops where a centre meets the floorplan's edge, a turn of several goes about the middle of the box they stand in ([`layoutSelection.ts`](../../../front-end/src/components/layout/layoutSelection.ts)), those carried past a wall coming back inside together (`shiftInside`), and of one about its own centre, and a removal in a draft closes the gap in its section's numbers, so a section is always numbered 1 to N, as the save requires.
  Positions are kept to 0.01 mm and turns to 0.001° (`roundMm`, `roundTurn`): tables that touch along a curve are each at their own angle, and kept any coarser a row's neighbours overlapped by more than 0.05 mm.
- **Many tables at once**: tables put in another section are numbered after its own, in the order of the numbers they had, and the sections they left close their gaps; put in no section they lose their numbers.
  A duplicate stands one table depth and 300 mm down from its original, or, where that would cover a table or a no-table zone or leave the floorplan, at the next free place to the right of the selection, then to its left, then up the page (`duplicateOffset`, which judges turned tables as they stand, `shapesOverlap`), and is numbered on in its section.
  `align` brings the boxes the tables stand in to one edge or one centre and `distribute` makes the gaps between them equal, the outer two staying (`alignMoves`, `spreadMoves`).
  `renumber` numbers a section in reading order: rows from the top, each from the left, a row being the tables whose centres stand within half a table's depth of the row's first, its type's depth however it is turned (`readingOrder`).
  `setSectionStyle` keeps a section's colour of the palette or the place of its name in the layout's `sectionStyles`; a section with no style yet keeps the colour it was drawn in.
- **A table whose section is gone** (removed on Section Setup, or moved to another location) is drawn and listed as in no section, and the editor's next change stores it so, without its section and its number (`inNoSection`): the page tells the model the location's sections.
  Until then the stored table still names the section that is gone.
- **Undo and redo** hold the tables and the sections' styles as they stood, whole, for the last 200 changes; they cross saves, not page loads, and each is a change that saves in turn.
  A drag of tables or of a section's name, or a turn by the handle, is one change: between `begin` and `end` each frame replaces the last, and `cancel` (Escape) puts the layout back.
  A save whose wait runs out under a gesture sends the layout as the gesture found it, so one put back leaves the server holding what the page shows.
  Tables picked up by keyboard are one change too, from `pickUp` to `drop`, held the same way (no save, no undo while they are in hand), but each move or turn goes on from where the last left them; `putBack` leaves them where they were picked up, and a drop that leaves every one where it was is no change, with no step and no save.
  The layout's own fields (its start, its image, its scale) are written at once by `write`, outside undo, since an undone image would name one the save deleted.
- **It saves through the app's one queue**, `useAutosave` ([the plan's autosave](plan-autosave.md#the-queue)), told to keep the working copy on a refusal (`keepOnRefusal`): 600 ms after the last change, one write at a time, a change made while a write is out sent when its answer is in, with the revision that answer gave.
  The answer's revision and the fields the server owns are taken; the tables and the sections' styles stay the working copy's.
  A save that fails or is refused keeps the working copy and says the sentence with Retry, and the next change sends it again; one refused as stale ("This layout changed elsewhere. Reload to see the latest.") sends nothing more until Reload takes the server's layout, dropping the working copy and its undo.
  A write of the layout's own fields refused as stale puts the layout back as it was read.
  A re-read of the market that brings a newer layout is taken only while nothing is unsaved and no drag is in hand.
- **A change still waiting is saved before the page is left**: the route's leave and update guards and a phase move wait for the flush, and when that save did not land a move in the app asks "Leave without saving?" before it drops the change ([unsaved work asks before it is dropped](../conventions/unsaved-work-asks-before-it-is-dropped.md)); a reload or a closed tab is asked by the browser first and the layout sent as the page goes, a keepalive request (`saveLayoutOnUnload`).
  With a write out as the page goes, that last write names the revision the write out will leave, since it was sent first.
  That last write is a best effort: its answer is never read, and a body over the browser's 64 KiB keepalive limit, a layout of some hundreds of tables, is not sent at all.
- **The toolbar** is a `role="toolbar"` with one Tab stop and the arrow keys, Home and End between its buttons: Select, Add table, Row of tables, Fill an area and No-table zone (toggles, `aria-pressed`), Undo, Redo, Zoom out, Zoom in, Fit and the zoom's percentage; when a press empties Undo or Redo the focus goes to the other.
  With Add table, Row of tables or Fill an area on, an options strip under it holds Section (the location's sections, and "No section") and Table type, and for a row also Gap (cm, 0 at first), Tables ("Beside the line" or "Centred on the line"), "Flip side", which is off while they are centred, Rows (1 at first, 10 at most), Aisle (cm, 120 at first) and "Spread evenly to the ends", unticked at first and off while the path is closed; for Fill an area it holds the button "Fill what is in view".
  A row's strip takes two lines, and the stage gives up their height so the hint stays on the screen.
  A Gap or an Aisle that is no number of centimetres from 0 to 1,000, read as Fill reads its Aisle (`lengthMmOf` in [`layoutRow.ts`](../../../front-end/src/components/layout/layoutRow.ts)), is marked invalid and said on a line of its own under the strip, both fields' sentences side by side, which the stage gives up too ("Type the gap's width in centimetres, 0 to 1,000."); while it stands no row is shown or placed, a placing says the same sentence, and the path waits for the field to be mended.
- **Select**: a press on a table selects it, Shift or Ctrl adding it or taking it out, and a press on the floor selects nothing; with the pointer over the map, Space is the panning hand, unless the focus came to the map by keyboard.
  A drag on the floor draws a box that selects every table whose centre is in it (`tablesInBox`), as it is drawn, beside those already selected when Shift or Ctrl is held; Escape puts the selection back as the box found it.
  Ctrl+A selects every table and Escape none, while the map has the focus, or nothing has and the pointer is over the map.
  A section's name is dragged to where it should stand, which the layout keeps as its style's `labelAt`; a press on a name is therefore no press on the floor under it.
  A drag moves the selection, snapping each moving table's edges and centre to those of the tables that stand still within 8 screen px, the nearest pair winning each axis (`snapMove`), with a guide drawn along the line they share; only a still table within 5 m along that line is read, so a table lines up with its neighbours and across an aisle, not with one across the hall; Alt places freely.
  The handle at the middle of the selection's box's top edge, a 14 px knob the editor draws in the map's slot, turns it in 15° steps (Alt: freely); where it would cover another table or a section's name (the map exposes where it drew each, `labelBounds`) it stands at the bottom edge instead, then the right, then the left, the first side that covers none; R, and "Turn 90°" on the selection's card, turn it a quarter.
- **Add table**: a click places a table of the strip's section and type at the point, and the tool stays on.
  With the focus on the map, Enter or Space places one at the middle of the view, or, where a table or a no-table zone stands there, at the nearest clear place a duplicate would find (`clearPlace`), and the focus goes to it.
- **Row of tables** places a row along a path the organizer draws; its model is [`layoutRow.ts`](../../../front-end/src/components/layout/layoutRow.ts) and what it draws over the map is [`LayoutRowPreview.vue`](../../../front-end/src/components/layout/LayoutRowPreview.vue).
  A press and a drag of 4 px or more, with no path begun, draw the row's line by hand: a stroke, shown while the button is down as the row along it with its count at the pointer.
  A stroke that is nearly straight, or any stroke while Shift is held, is the straight row from the press to the pointer, placed when it is let go; Shift pressed or let go under the button changes what is shown with no move of the pointer.
  Any other stroke, let go, becomes a pending path of a few points on a smooth curve (`fitStroke`), closed into a loop where it was let go within 24 px of its press having been 48 px from it, and said ("Curve drawn through 6 points. 10 tables. Enter places it.", or "Loop drawn…"); while the button is down such a stroke is shown closed, its press ringed.
  That path is `drawn`: it is its points alone wherever the pointer goes, takes no further point, and a press on the floor, a click or a drag, does nothing to it; its points are dragged, Backspace takes its last, Enter places it, with the crosshair on the map too, and taken back to one point it is a clicked path again.
  The stroke's samples are the press, snapped as a point is, each move 2 px or more from the last kept, and the pointer's place, snapped, last; at 2,000 kept every second is dropped and they are kept twice as far apart; its numbers are screen pixels in one place (`STROKE_PX` in `layoutRow.ts`), turned into millimetres by the view (`strokeOptions`).
  A stroke cut short (a second finger, a cancelled pointer, a release the stage never heard, Escape with the button down, another tool chosen while the pointer is down) is dropped and places nothing.
  A stroke that is no line, or whose fitted points make no path, leaves nothing pending.
  A click instead lays a point, each further click another, and the row follows the smooth path through them, shown as it would be placed (its tables dashed, in their section's colours) through the points and the pointer, with its count at the pointer ("14 tables").
  A click on the last point places the row, so a double-click does, its first click laying the point; so does Enter, for a pointer, which places the path as it is shown, through the pointer's place while it is over the map.
  A point within 12 px of a press is pressed, and a drag moves it; Backspace, or Ctrl+Z while a path is pending, takes the last point back and leaves the layout's own undo alone; Escape, another tool and another location drop the path.
  While the tool is on, Backspace is the path's key alone: with no point to take it does nothing, and never removes the selection, which a row just placed is; Delete still does.
  A release the stage never heard (the button let go over a menu) places and lays nothing.
  The hint line under the map says one of four sentences by what the tool holds: nothing, a stroke in hand, a clicked path, a drawn path.
  Nothing of a pending path is in the layout: it is not saved and is no step of undo.
  A point snaps to the nearest corner of a table within 8 px, else to the nearest line a table's edge lies on, on the edge or up to 5 m past its end (`snapPoint`), and goes freely with Alt.
  The tables stand beside the line, on the right of the way it was drawn as seen on the screen; F or "Flip side" swaps the side, "Centred on the line" puts the path through their middles, and the strip's choices are kept while the app is open (`rowChoices`).
  A path of three points or more, each a place of its own, closes into a shape: the pointer over its first point rings the point and shows the path closed, a click there closes it, and so does C; the editor says "Closed. 10 tables.", or "A shape takes three points or more." of fewer.
  A closed shape is still a pending path: its points can be dragged, a press on the floor adds no point, Backspace or Ctrl+Z opens it again ("Opened again. 9 tables."), and it is placed by Enter, Ctrl+Enter, or a click on its first or its last point, so a double-click on the first point closes and places.
  A closed shape's tables are always spread evenly round it; an open path's are where "Spread evenly to the ends" is ticked.
  Rows over 1 places that many rows in the one gesture, each offset toward the tables' side (the right of the way drawn, for rows centred on the line), the Aisle between them; they are numbered the first row whole, then the next, each the way it was drawn.
  Placed, the tables are ordinary tables of the strip's section and type, numbered on in their section in the order drawn, selected, and one step of undo; where no table fits, nothing is added and the editor says so.
- **Fill an area** packs an area the organizer draws with rows of tables; its model is [`layoutFill.ts`](../../../front-end/src/components/layout/layoutFill.ts), what it draws over the map is [`LayoutFillPreview.vue`](../../../front-end/src/components/layout/LayoutFillPreview.vue), and what it asks is [`LayoutFillDialog.vue`](../../../front-end/src/components/layout/LayoutFillDialog.vue).
  A press and a drag of 4 px or more, with no corner laid, draw a box, shaded as it is drawn, and the release opens the dialog; a drag along one line encloses no floor and says "No table fits in that area.".
  A click instead lays a corner of a shape with straight sides, each further click another, drawn through the corners and the pointer; a click on the first corner of three or more, ringed while the pointer rests on it, closes the shape, and so do a click on the last corner (so a double-click) and, for a pointer, Enter.
  A shape whose sides cross or touch is drawn in `--mm-text-red-on-tint`, wears no ring and does not close (`polygonIsSimple` in `layoutGeometry.ts`): the status line says "This shape's sides cross. Move a corner, or take one back, so that they do not.", a close asked of fewer than three corners "An area takes three corners or more.", and of more than 50, the server's bound, "An area takes 50 corners at most. Take some back.".
  A corner within 12 px of a press is pressed, and a drag moves it; Backspace, or Ctrl+Z while a shape is pending, takes the last corner back and leaves the layout's own undo alone; Escape, another tool and another location drop the shape, which is never in the layout, its saves or its undo.
  A corner is laid on the floorplan, never past its edge, and does not snap to the tables.
  The dialog is an [`AppDialog`](../conventions/dialogs.md), narrow: the area in words ("A box 12.0 m by 8.0 m", "A shape of 6 corners", "What is in view"), Section and Table type, which are the strip's own, "How many" ("This many" with a count, 30 at first, or "As many as fit"), Direction ("Rows across" or "Rows down"), Aisle (cm, 120 at first) and the tick "Fill what is in view", which fills the part of the hall the map shows in place of the area drawn; the choices but the section and the type are kept for the next area while the app is open.
  The strip's "Fill what is in view" opens the dialog with nothing drawn, that tick on and held, which is the tool's way in for someone who draws nothing.
  A count that is no whole number from 1 to 500, the most one fill places, is said under its field and disables Fill.
  So is an aisle that is no number of centimetres from 0 to 1,000, the placement's own bound ("Type the aisle's width in centimetres, 0 to 1,000."), never read as no aisle.
  Fill asks the placement (`POST /floorplans/place-tables`, [below](#interface)) for the area with the hall as the room, the no-table zones, every table that stands by its four corners as it is turned, one table type and its count, never more than 500 or than the layout's 1,000 less what it holds; while it runs the button reads "Placing…" and nothing closes the dialog, and a refusal is written into the dialog, which stays open.
  The answer is added as one change, so one Undo takes it whole: ordinary tables of the section and type chosen, numbered on from the section's own in reading order (`readingOrder`), selected.
  What it did is said on the panel's status line, a card heading the panel, and in the live region: "Placed 30.", "Placed 24 of 30; the rest did not fit.", with `timed_out` "Placed 24 of 30 - Fill an area ran out of time before the rest.", or "No table fits in that area."; where every table asked of the placement stands and a cap stopped it, "Placed 10 of 30. A layout holds at most 1,000 tables." or, of as many as fit, "Placed 500, the most one fill places. Fill again for more."; the line stands until a table is next added or removed, or a corner is next laid.
  Given up in the dialog, a drawn shape is its corners again, to be moved, and a box is gone.
- **A row's geometry** is `layoutGeometry.ts`'s, pure.
  `smoothRuns` makes the path of the points: each span blends the circle through the point before it with the circle through the point after, so points along a circular wall give the circle back exactly; a point where either span beside it would sweep more than 70° on the circle through it and its neighbours, or where the path turns straight back, is a corner; a point in a line with its neighbours carries that line on, so a span from a straight wall into a curve leaves the wall along it; and the path is flattened to within 2 mm into runs, one polyline between corners.
  `readStroke` reads a line drawn by hand, on every move: fewer than two samples a millimetre apart are nothing; it is closed when its last sample is within the closing reach of its first and some sample stood twice that from the first; else straight when it does not double back along its own line and every sample is within 4% of the chord of the line between its ends, never less than 10 px nor more than 24 px; else it is resampled every 4 px (1,000 points at most) and smoothed by a Gaussian of 16 px, an open line's ends staying its first and last samples; `strokeRuns` is what the drag shows the row along, the smoothed line itself, which holds still under the pointer.
  `fitStroke` chooses the path's points on that smoothed line when it is let go: the two ends of an open line, or eight evenly round a closed one; a point the corner rule's own measure reads over 60° is mended by a point each side where the line's direction has turned 30°; else the span whose smoothed points stand furthest off the path, past 12 px, takes a point there; no two points nearer than 8 px along the line and 48 at most; then every point the path holds without is taken back.
  So a drawn path has no corner and stands within 12 px of the smoothed stroke, except where the hand turned tighter than the points can stand apart or drew more than 48 points' worth, and it is nothing but points for `smoothRuns`.
  `poseOnPath` stands one table on a run: its back edge is a chord of the path as long as the table is wide (`chordEnd`), the table stands off it to its side and never across the path, and its turn is the chord's, held between -90° and 90° so a number never reads upside down.
  `placeAlongRuns` marches each run in order: a table goes at the first place where it stands the gap clear of every table before it, by `separation`, the distance between two turned rectangles, found by halving to 0.05 mm, so no two overlap at any bend and a straight run holds `floor((length + gap) / (width + gap))`.
  A place that would overlap a table or a no-table zone that stands already is passed over for the next clear one, a table whose centre would stand outside the floorplan is left out, and a row never takes the layout past 1,000 tables (`MAX_LAYOUT_TABLES`, the server's `MAX_PLACED_TABLES`).
  The first clear place between one too near and one clear is found by where a straight line between the two would cross, with halving where that is no guide; where the room left is narrower than the search's step, at a run's end outside a bend or at a loop's seam, the place the gap from the last table alone is tried.
  `smoothRuns` with `closed` joins the last point to the first and judges every point, the first among them, by the same corner rule: with no corner the path is one run that ends on the point it began on (a loop), and with corners its runs go round from the corner before the first point.
  Four points turn 360° between them, so four clicks are always four straight sides; a smooth loop takes six or more.
  Round a loop a table may stand across the seam, the last one begun before it, until the next would be nearer the first than the gap.
  `spreadEvenly` is the same march with each run's gap grown, never under the gap asked, until the last table's edge ends at its run's end, or round a loop until the gap between the last table and the first is the gap between every other two: each run keeps the tables the march gives it, by a few tries that each aim at no room left, so a path with corners may hold one fewer spread than not, where a run spread to its corner stands in the way of the next run's first table; a run whose last table is held by something that stands in the way stays as it is.
  `offsetRuns` moves a path sideways, each run on its own and a loop to a loop, and drops whatever of it would stand nearer any run of the path than the distance, cut where it comes that near (found through a grid of the path's segments, so its cost does not grow with the square of the path's length): inside a bend tighter than the distance nothing of the bend is left, and inside a corner each wall's offset stops short of the other wall.
  `placeRows` places the first row on the path and each next one on the path offset a table's depth and the aisle further, then widens that offset, six times at most, by what the two rows' tables turn out short of the aisle where they stand nearest, to within 0.5 mm, since on a bend a table's back stands off its line; where no widening gives the aisle, as round a sharp corner, the tables that would stand in it are left out; a row with no room is empty, and the cap of 1,000 holds across the rows.
- **By keyboard**: the editor hears the map's keys before the map does (a capture listener on the stage).
  Enter or Space on the focused table picks it up, with the selection when it is one of it, else alone and selected; Shift+Enter adds it to the selection or takes it out instead.
  Nothing is picked up under a press, a drag or a turn in hand, whose frames reckon from where it began.
  Picked up, the arrow keys move the tables 10 cm, or 1 m with Shift, R turns them a quarter and Shift+R 15°, Enter or Space drops them and Escape puts them back; a move that a wall stops says so.
  A key held down moves them at each repeat and says where they are once, when it is let go.
  They are dropped too when the focus leaves the map for another control, or arrives on one after the window lost the keys (the window losing them drops nothing by itself), and when a pointer is pressed anywhere; no other shortcut fires while they are in hand, and Ctrl+A, Ctrl+D, Ctrl+Z and Ctrl+Y are kept from the browser meanwhile.
  Left in hand as the page goes, they are put back: the write sent on the way out carries the layout as it was picked up, as a save's does.
  With the focus on the map, or on nothing with the pointer over it, Delete or Backspace removes the selection, Ctrl+D duplicates it, selecting the copies, + and - step the zoom and 0 fits the floorplan; with nothing selected, R, Delete and Ctrl+D act on the focused table.
  The view follows the keys: a table that takes the focus by keyboard, tables carried or added by a key, and the focused table after a zoom by key are brought into view with 24 px round them, the view moving no further than that, and of tables too long for the stage one way the top or left end is shown (`cameraShowing`).
  While the focus is in the map and came by keyboard the stage wears the halo and the hint line says the keys: those that move between tables, those of what is picked up, Add table's Enter, or the crosshair's.
  With Row of tables on the arrow keys move a crosshair instead of the focus, 10 cm or 1 m with Shift, from the middle of the view and never past the floorplan's edge; Enter lays a point at it, Backspace takes the last back, F swaps the side, Ctrl+Enter places the row and Escape drops it, and no table is picked up.
  The row the keys place is the path through the points laid, wherever the crosshair stands or the pointer passes, and once placed the focus goes to its first table.
  Enter again where a point was just laid lays no second one, and a press on the map gives the path back to the pointer and hides the crosshair.
  With Fill an area on the same crosshair ([`LayoutCrosshair.vue`](../../../front-end/src/components/layout/LayoutCrosshair.vue)) lays an area's corners: Enter lays one, said with its place ("Corner 3 at 12.4 m, 6.1 m."), Backspace takes the last back, Ctrl+Enter closes the shape and opens the dialog, and Escape drops it.
  The map is described to a screen reader by one hidden sentence of its keys.
- **What a change did is said**: the editor emits `announce` with a sentence for each move, turn, placement and removal, by pointer or by key, and for a pick-up, a drop, a put back, Ctrl+A, Escape and an undo or redo by key; the page says the selection card's Turn, Duplicate and Remove the same way, and holds the one polite live region they are put in while the layout is edited.
  A drag that ended where it began says nothing, and an undo that the model refused under a drag neither.
  The sentences are [`layoutAnnouncements.ts`](../../../front-end/src/components/layout/layoutAnnouncements.ts)'s: "Gold row 5 moved to 12.4 m, 6.1 m", "Gold row 5 turned to 90°", "Added Gold row 10", "Removed 3 tables", of a row "Added Gold row 10 to 23.", of a point laid by the crosshair "Point 3 at 12.4 m, 6.1 m. 14 tables.", of a curve drawn by hand "Curve drawn through 6 points. 10 tables. Enter places it.", and of several "3 tables moved, Gold row 5 to 12.4 m, 6.1 m", naming the table the keys are on; the same words twice running are told apart by a space that is not read, so they are read again.
- **The keys are listed** in the panel's last card, "Keyboard" ([`LayoutPanelKeyboard.vue`](../../../front-end/src/components/layout/LayoutPanelKeyboard.vue)), a disclosure closed until asked for; the card only lists them.
- **The view** is a camera, a point of the hall at the stage's middle and a scale, 10% to 800% (`fitCamera`, `zoomedAbout`, `steppedZoom`): the wheel or two fingers pan, Ctrl and the wheel or a pinch zoom about the pointer (a mouse's notch a quarter at most), Space and a drag or the middle button pan, the wheel does nothing under a drag in hand, the buttons step through round percentages, and Fit shows the whole floorplan.
  The stage is the floorplan's shape, never taller than leaves the toolbar and the hint on the screen, and round the hall it is a pasteboard a step darker than the floor.
- **Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y** undo and redo, and R turns a quarter and Shift+R 15°, from anywhere on the page but a field or under an open dialog (`[role="dialog"][aria-modal="true"]`, the app's).
- **The focus is never left on a control that went**: when Undo or Redo empties under the focus it goes to the other of the two, else to Select, and when the selection empties under a control of its card, by "Remove" or by an undo that takes the selected tables away, to the map's stop, else to the toolbar; and when a table that had the focus goes, removed by a key or taken back by an undo, to the nearest table left (`nearestTo`), else to the map itself.
- **The selection's card** ([`LayoutPanelSelection.vue`](../../../front-end/src/components/layout/LayoutPanelSelection.vue)) heads the panel: "Select tables to change them.", or one table's code, section, type and its centre in metres from the floorplan's top-left corner, or "3 tables selected" and their codes, the first ten of many.
  Its Section and Table type fields change the selection's, each reading "Mixed" while the selected tables differ; "Turn 90°", "Duplicate", which selects the copies, and "Remove", which asks nothing, since Undo takes it back; and for several an Align menu ([`RowMenu.vue`](../../../front-end/src/components/RowMenu.vue)): left, centre, right, top, middle, bottom, and space evenly across and down.
  For one table, "Row of N…" opens a count, 1 to 100, and "Add row": that many more tables of the table's section and type going on along its line, the Row tool's gap apart (a gap that is no length lays nothing and says so), past what stands in the way and no further than the floorplan (`rowOnFrom`), from the end it is turned to, or from its other end where that one is taken and the other is free, as at the last table of a row; the table stays selected, so "Add row" again goes on from the row's end.
- **The Sections card** ([`LayoutPanelSections.vue`](../../../front-end/src/components/layout/LayoutPanelSections.vue)), for someone editing: a section's swatch is a button that opens the palette's eight colours under its row, the one it wears pressed, and its row's menu has "Renumber by position (rows across the page)".
  Under the list it counts the tables in no section ("3 tables are in no section") with "Select them", and says what Section Setup had for each section that has fewer tables than when the layout began ("Section Setup had Gold row at 13: 9 placed.").
  A reader sees the count of tables in no section and none of the controls.

- **No-table zone**, the toolbar's fifth tool: a drag draws a box, held to the floorplan, and its release marks a zone of it (`addZone`, one step of undo; a box under 10 cm a side, or a 101st zone, marks none and says why on the status line), says its size ("Added a no-table zone 4.0 m by 3.0 m. Name it in the panel.") and gives the focus to its name in the zones card.
  A zone is drawn only with the pointer, as a box is.
  **A table put down on a zone is pushed off it**, to the nearest clear place with every centre inside the floorplan, as a snap takes it (`offZones`: from where the tables stand, each zone a table meets offers four ways off it, past each of its edges, tried nearest first, and a way that lands on another zone offers that zone's in turn, looking at no more than 60,000 table and zone pairs, so a thousand tables dragged over a hall of pillars gives up within a frame); it applies to a drag, frame by frame, to a table added or turned there, and to tables carried by keyboard only as they are dropped, so the keys can carry them across a zone.
  A zone drawn over tables that stand leaves them where they are.
- **The Table types card** ([`LayoutPanelTypes.vue`](../../../front-end/src/components/layout/LayoutPanelTypes.vue)): each of the market's types with its size ("183 x 76 cm", [`layoutTypes.ts`](../../../front-end/src/components/layout/layoutTypes.ts)) and how many of the market's tables are of it, the layout being edited counted as it stands; each row's menu has Edit and Remove.
  "Add a type" and Edit open [`LayoutTypeDialog.vue`](../../../front-end/src/components/layout/LayoutTypeDialog.vue): Name, Width, Depth and a Unit (cm first, then m, mm, ft and in, the sides carried into a unit chosen), each field saying beneath it what it is refused for (a name each, none shared, sides 100 mm to 20,000 mm).
  Remove takes a type no table uses, and of one that tables use says how many and keeps it: "12 tables are Square 4 ft. Change them first.".
  "Save these types" ([`LayoutSaveTypesDialog.vue`](../../../front-end/src/components/layout/LayoutSaveTypesDialog.vue)) names a template of the types, filed under the market's organization when the person is in it, else theirs alone; "Use saved types" ([`LayoutSavedTypesDialog.vue`](../../../front-end/src/components/layout/LayoutSavedTypesDialog.vue), wide, its list scrolling in its body) lists the person's own templates and, when they are in the market's organization (`inOrganization`), its templates, each once, the own kept when the organization's cannot be listed, and adds the chosen one's types the market has none of by name, each a new id (`withSavedTypes`); a beta template's height is read as the depth.
  Both ask [the template routes](#who-may-use-the-floorplan-routes), which know the caller from the session; nothing reads the stored user.
  Every change is one write of the whole list, `PUT /markets/:id/table-types` ([below](#who-may-use-the-floorplan-routes)), sent once the layout's own pending change has landed, so the server judges the tables as the page shows them; then the market is read again, and the map draws each table at its type's new size.
  The dialogs hold through the write and write its refusal into themselves.
- **The No-table zones card** ([`LayoutPanelZones.vue`](../../../front-end/src/components/layout/LayoutPanelZones.vue)): each zone's name in a field ("Name of zone 1"), saved as one step when the field is left or Enter pressed, its size under it, and Remove, the focus going to the next zone's field.
  With none it says how one is drawn.
- **The panel's cards while editing**, in order: the status line when it has words, the selection, the sections, the table types, the no-table zones, the floorplan and the keys.

**Leaving Draft waits on tables in no section**: `LayoutTablesHaveSectionsGuard` ([the guards](guards.md)) refuses `draft -> applications` while a layout has any (`layout.tables_in_no_section`: of no section, of one that is gone, or of another location's), naming the location and how many, with "Open the layout" leading to that location's layout.

**Removing a location that has a layout asks first** ([`ElementLocationSetup.vue`](../../../front-end/src/components/elements/ElementLocationSetup.vue), on [`AppDialog`](../conventions/dialogs.md)): "Remove Upper Hall?", "Its layout of 49 tables goes with it.", "Remove location and layout" and Cancel, on which it opens; the plan's next save then drops the layout with its location.
A location with no layout is removed at once.

Section Setup reads a laid-out location's counts from its layout: the Count cell of such a section is the number of the layout's tables in it with "from the layout" under it, and no field, since `derive_counts` sets it on every write ([`ElementSectionSetup.vue`](../../../front-end/src/components/elements/ElementSectionSetup.vue)).

## Interface

`auto_place_tables(walls, obstacles, table_types, counts, scale_px_per_mm, aisle_config, room_mm, area_mm, area_polygon_mm, existing_mm, direction)` returns a `PlacementResult`: `placed`, the placed tables in millimetres (`x_mm`, `y_mm`, `rotation`, `width_mm`, `height_mm`, `table_type_id`), and `timed_out`, true only when the grid placement, or an area's rows, stopped at the deadline; the route answers them as `{"placed_tables": [...], "timed_out": ...}`.
The organizer asks for a count per table type ([`AutoPlaceButton.vue`](../../../front-end/src/components/floorplan/AutoPlaceButton.vue)), and the wizard reports how many it placed, and when it placed fewer than asked, why: "Placed {n} of {asked} tables - there was no room for the rest.", or with `timed_out` "Placed {n} of {asked} tables - Auto-Place ran out of time before the rest.".
While it cannot place, with no table type, scale, count asked or room yet, or a placement running, the button is disabled, and like the wizard's Next it takes the design language's [one disabled state](../../design-system.md#the-primitive-layer), never opacity.
`POST /floorplans/place-tables` takes the `market_id` the wizard is open on beside the geometry, read with `string_field()`, and places only for an editor of that market on a market that is not archived; `AutoPlaceButton.vue` sends the `marketId` [`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue) gives it.
The zone is the room less a wall buffer (1500 mm unless configured) and the obstacles; tables keep a spacing between them (1200 mm unless configured).

**With an area the same route fills a part of a layout** (T257's Fill an area).
The request adds `area_mm` (a box: x, y, width, depth) or `area_polygon_mm` (a drawn shape's corners), one or the other, `existing_mm` (the tables that stand, each its four corners as it is turned) and `direction` (`across`, the default, or `down`).
The room is then `room_mm`, the floorplan's extent, which the request must carry, whatever walls it sends; the wall buffer is not read; and the zone is the part of the area on the floorplan less the obstacles and less every table of `existing_mm` grown by the table spacing, every piece of it kept; an obstacle of fewer than three points takes no floor, and one whose sides cross is mended (`make_valid`) so the floor it covers stays clear.
The tables stand in rows (`_rows_place`): a row's tables end to end, touching, from the left of every stretch of the row that is clear for the row's whole depth, and the rows the table spacing apart from the zone's top; `down` is the same seen sideways, the rows running down the page from the zone's left with their tables turned 90°.
A type's tables are placed whole before the next type's, which keep the spacing from them.
The answer's `x_mm` and `y_mm` are centres, in the order placed, and `timed_out` is true when the rows stopped at the grid's deadline, `GRID_TIME_LIMIT_S`, which runs from before the zone is built.
**An area is never handed to `pyckingsolver`**: the solver packs as many as fit with one spacing all round and makes no rows, so an area is packed the same way on every machine, production included.
`placement_refusal()` holds the area too: both an `area_mm` and an `area_polygon_mm` answer "An area is a box or a drawn shape, not both."; a shape of fewer than 3 or more than 50 corners, one whose sides cross (Shapely's `is_valid`) and one that encloses no floor answer "An area is drawn with 3 to 50 corners that do not cross."; a box or a shape over 500 m on a side answers "An area must be at most 500 m on each side."; more than 1,000 tables in `existing_mm` answer "A floorplan holds at most 1,000 tables."; and their numbers are walked for the finite and 10,000,000 bound with the rest of the geometry.
An area with no `room_mm` answers the sentence that asks for a calibration.
The largest request the bounds let through, 500 tables asked among 1,000 standing, is placed in about 0.1 s.

**Auto-Place's request is parsed and bounded before it places** (T272).
After the access check the route parses the body as `PlaceTablesRequest`, defined in the route file of `WallSegment`, `ObstacleZone` and `BetaTableType` (the beta's table type, with a height and a capacity, never the market's `TableTypeObject`), `counts` of whole numbers from 0, a finite `scale_px_per_mm`, an optional `room_mm` of positive finite sides and an optional `aisle_config` with the wizard's camel-cased keys; a field that does not parse answers 400 "Invalid placement request: ..." naming it.
Then `placement_refusal()` in [`back-end/floorplan_limits.py`](../../../back-end/floorplan_limits.py), the one statement of a floorplan's bounds, answers 400 with one sentence for a number in the geometry that is not finite or past 10,000,000, more than 100 walls, 100 obstacle zones or 100 points in a zone, more than 500 tables asked, a table type's side outside 100 mm to 20,000 mm, a `room_mm` side over 500 m, or a wall buffer or table spacing outside 0 to 10,000 mm.
The tables asked are counted as the service places them, so a type the `counts` do not name counts as one table and a count for a type not listed counts as none.
The service refuses a room its walls make over 500 m on a side, since it is what builds that room.
The route has no blanket `except`, so the service's refusals reach the organizer as their sentences, "The walls drawn do not enclose a room." among them, which used to answer 500 "Internal server error", as a wall missing its thickness did.
The service is handed the parsed models' snake-cased dumps, so the aisle values the wizard sends are the ones it keeps: it used to read their camel-cased keys as unknown and keep its own defaults, the same 1500 mm and 1200 mm the wizard sends.

## Who may use the floorplan routes

Every floorplan action asks its row of the table ([the market's actions](market-actions.md)) on the floorplan's market, the way saving a floorplan to a market always did.
The roles are [what each role may do](../../business/rules/what-each-role-may-do.md) says, and a route that changes the floorplan keeps [an archived market is read-only](../../business/rules/an-archived-market-is-read-only.md).
[`back-end/api/floorplans_access.py`](../../../back-end/api/floorplans_access.py) is the one place a floorplan route decides it: `market_refusal(market_id, action, edits=...)` asks on a market the request names, `image_refusal(gridfs_id, action, edits=...)` asks on the market an image was uploaded for, and each answers None or the refusal the route returns.
They answer in save's order: no market named 400, unknown market 404, unreadable market data 400, a person the row refuses 403 with its sentence, and, for a route that changes the floorplan (`edits`), an archived market 403.
A route checks access right after it has read the id it is checked by, before the rest of its body or its image read.

| Route                                                                                                     | Needs                                                                | Archived market |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------- |
| `POST /floorplans/upload`                                                                                 | Change Market Setup (EDITOR) on the `market_id` sent                 | refused         |
| `POST /floorplans/place-tables`                                                                           | Change Market Setup (EDITOR) on the `market_id` sent                 | refused         |
| `DELETE /floorplans/<id>`                                                                                 | Change Market Setup (EDITOR) on the image's market                   | refused         |
| `POST /floorplans/calibrate` ([`floorplans_calibrate.py`](../../../back-end/api/floorplans_calibrate.py)) | Change Market Setup (EDITOR) on the image's market                   | refused         |
| `POST /floorplans/export` ([`floorplans_export.py`](../../../back-end/api/floorplans_export.py))          | the Read row (any role) on the image's market, signed in             | allowed         |
| `GET /floorplans/<id>`                                                                                    | the Read row (any role) on the image's market, signed in             | allowed         |
| `POST /floorplans/save-to-market`                                                                         | Change Market Setup (EDITOR), and a setup that has not settled (409) | refused         |

The wizard's steps are an editor's work on a market that can still change, which is when the front end offers the wizard at all.
**The export's audience is the people on the market**: it is a read of the plan, a rendering of the hall with its table codes, so it needs a sign-in and any role, and an archived market still exports.
**The image read's audience is the people on the market too**: `GET /floorplans/<id>` asks the Read row on the image's market, as the export does, and an archived market's image still reads.
It answers every refusal 404 "Image not found", a signed-in account with no role on the market included, so the answer never tells a stranger that an id names an image.
Its readers, the layout page's [`useFloorplanImage.ts`](../../../front-end/src/components/layout/useFloorplanImage.ts) and [`FloorplanUploader.vue`](../../../front-end/src/components/layout/FloorplanUploader.vue), and the beta's [`FloorplanEditor.vue`](../../../front-end/src/components/floorplan/FloorplanEditor.vue) and [`ScaleCalibration.vue`](../../../front-end/src/components/floorplan/ScaleCalibration.vue), fetch it through the API client with the session's cookie, as a blob.
The settled-setup refusal stays on save alone, since only save writes a layout, whose tables are its sections' counts.
**Every floorplan route needs a sign-in**, and `TestEveryFloorplanRouteNeedsASignIn` in [`back-end/tests/test_floorplan_access.py`](../../../back-end/tests/test_floorplan_access.py) keeps it so: it asks each route the floorplan blueprints register without a session and expects a 401, so a new route, or one whose `@login_required` is missing or above its `@route`, fails it.

**An image belongs to the market it was uploaded for.**
`POST /floorplans/upload` ([`back-end/api/floorplans.py`](../../../back-end/api/floorplans.py)) takes a `market_id` form field beside the file, needs an editor of that market on a market that is not archived, and checks it before it reads the file.
**An upload is held to production's limits** (T257): Vercel's functions refuse a request body over 4.5 MB, multipart overhead included, before Flask sees it ([Vercel's function limits](https://vercel.com/docs/functions/limitations)), so a request whose `Content-Length` passes `MAX_UPLOAD_BYTES` (4,000,000) and the form's 64,000-byte allowance is refused 413 "This file is larger than 4 MB." before its body is read, ahead of the market check, and a file over `MAX_UPLOAD_BYTES` by its own length once read.
A PDF of more than `MAX_PDF_PAGES` (20) pages is refused 400 "This PDF has more than 20 pages. Send the page with the plan on it." before any page is drawn, and one PDFium cannot open, or of which no page draws or encodes (a page PDFium fails to draw is skipped, as one that will not encode is), 400 "<file name> could not be read as a PDF.": the converter raises (`UnreadablePdf`, `TooManyPages`) where it used to answer an empty list, which the route read as a 500.
[`upload_image()`](../../../back-end/services/gridfs_service.py) keeps the market's id in the GridFS file's metadata (`metadata.marketId`), on every page of a PDF too, and `get_image_market_id()` reads it back: None for an unknown image, an id that is not an ObjectId, or an image stored without a market, so `image_refusal()` answers all three "Image not found", and no route treats an unowned image as anyone's.
[`FloorplanUploader.vue`](../../../front-end/src/components/layout/FloorplanUploader.vue), moved from the beta's folder to the layout's, sends the market it is in.
It takes the file on the app's one drop zone, [`FileDropZone.vue`](../../../front-end/src/components/FileDropZone.vue) ([the design language](../../design-system.md#the-primitive-layer)), offering PNG, JPG, WebP and PDF, and checks the type itself, refusing any other with "This file is not a PNG, JPG, WebP or PDF." before it sends anything (T205).
It refuses a PDF over 4 MB with "This PDF is larger than 4 MB. Export the page with the plan on it as a PNG or a smaller PDF.", since the browser draws no PDF, and shrinks a PNG, JPG or WebP over it before sending ([`shrinkImage.ts`](../../../front-end/src/components/layout/shrinkImage.ts)): decoded once, its longest side brought to at most 8,000 px, encoded as WebP at quality 0.9, then 0.8, then at sides 0.8 as long each time, until under 4 MB, and refused with its own sentence below 500 px; a browser that cannot write WebP writes PNG, and the file is named for what was written.
Its error line is `role="alert"`, so a screen reader says a refusal, the server's included, as it appears.
The zone stays, busy, while the file is shrunk ("Making the image smaller…") and uploads ("Uploading…"), and while the page saves what was chosen; an upload that fails leaves the zone and the error, so another file can be chosen.
An image, and a PDF of one page, is chosen as it is uploaded; a PDF of several pages previews as the page the server drew from it, fetched from `GET /floorplans/<id>` and following the page chosen, since a browser draws no PDF in an image, with "Use page N" to choose it.
When that first page cannot be fetched, the zone comes back with "The floorplan was uploaded, but its page could not be shown. Choose the file again.".
Every page of a PDF is stored; the pages not chosen are named by no floorplan, and only the migration's sweep of unnamed images removes them.
The server draws each page at 200 dpi, or smaller where that would make its longer side more than `MAX_PDF_PAGE_SIDE_PX` (8,000 px, the browser's own bound for an image), so a page of any size asks PDFium for a bounded bitmap, with pypdfium2 ([`pdf_converter.py`](../../../back-end/utils/pdf_converter.py)), whose `manylinux_2_17` wheel carries PDFium, so it needs no system package on Vercel, Docker or CI (T205).
Images uploaded before images named a market have no `marketId`, so no route reads them, `GET /floorplans/<id>` included; no migration gives them one, and [`migrations/migrate_layouts.py`](../../../back-end/migrations/migrate_layouts.py) deletes them with every other image no floorplan names.
Deleting a market deletes every image whose `metadata.marketId` names it, with its other records ([market deletion](market-deletion.md)); an image with no `marketId` names no market, so no deletion takes it.

**The market's table types have their own write**: `PUT /markets/:id/table-types`, [`back-end/api/layouts.py`](../../../back-end/api/layouts.py), registered in `app.py` beside the plan write, body `{tableTypes}` and nothing else (another key is refused by name), answered `{tableTypes}` as stored.
It asks save's questions in save's order: the body (a list of objects), the market (404), its data (400 "Invalid market data"), Change Market Setup (403 with its sentence), the archived rule (403), the settled setup (409 with its sentence: the types settle with the seats), then each type's parse (400 naming the field), the bounds (`table_types_refusal`), a name each and no two alike by case ("Two table types are named Standard 6 ft. Give each its own name."), an id each, and no type taken away that a table of a located layout uses (400 "12 tables are Square 4 ft. Change them first.").
`prepared_plan(table_types=...)` judges the plan it would make, and only `setupObject.tableTypes` is written (the whole plan for a market that never saved one), conditional on each stored layout's id and revision as read, no layout after them, and the types as read, so a layout saved or started in between, or another write of the types, answers 409 "A layout changed while the table types were saved. Reload and try again." rather than being put back or left naming a type that is gone.
It records `table_types` ([the market's history](../data/history.md)) when the types changed, each its id, name and size in words before and after, read as "changed the table types: added Square 4 ft (122 x 122 cm)", "renamed …", "resized … to 120 x 120 cm", "removed …".
`TestEveryFloorplanRouteNeedsASignIn` asks it without a session too.

**A template is its creator's, and one filed under an organization is filed by someone in it.**
[`back-end/api/floorplans_templates.py`](../../../back-end/api/floorplans_templates.py) reads a create's or an update's `organizationId` with `string_field()`: null or absent files it under none, another type answers 400, an organization nobody has 404, and one the caller is not in (as owner, admin or member) 403, the test listing an organization's templates applies.
The other fields a template takes are typed too, and any other key is ignored ([a write takes only its fields](../conventions/a-request-value-is-a-string.md#a-write-takes-only-its-fields)).
A stored `organizationId` that is not a non-empty string reads as none, so only the template's creator reaches it; [`back-end/tests/test_floorplan_template_access.py`](../../../back-end/tests/test_floorplan_template_access.py) keeps both.
**A template filed under an organization is in its history**: adding, changing and removing one records into [the organization's history](../data/history.md#what-an-organization-records), and a change that files it under another organization, or none, records leaving in the one it left and arriving in the other, neither naming the other; a template of no organization records nothing.
Its table types and aisles read in words in that history, each type its name and size, never as JSON.

## Sharp edges

**The room is the floor plan** (bug 38).
With no walls drawn, the room is the uploaded image's extent at the calibrated scale, `room_mm` from its top-left corner, which is where the editor draws a table at `(x_mm, y_mm)`.
It was a fixed 10 m square centred on the origin whatever was uploaded, so a 55 m hall had a 49 m² zone and every table landed off the image.
The endpoint answers 400 with neither walls nor `room_mm`: there is no default room.
Walls that enclose nothing fall back to the image's extent when it is known, and otherwise answer 400 "The walls drawn do not enclose a room.".

**The solver is bounded by its own `time_limit`** (`SOLVER_TIME_LIMIT_S`, 10 seconds): it is an anytime solver, returning the best packing found by then.
A thread timeout wrapped around the call bounded nothing: it raised in the caller while the solver ran on to its own 60-second default, and the request waited for it.
When the solver fails or finds no packing, a grid-based greedy placement runs instead.
**The grid has its own deadline too** (`GRID_TIME_LIMIT_S`, 10 seconds, T272): it reads the clock before each table and each column of positions, and at the limit stops and answers what it has placed, with `timed_out`.
The two limits sum to 20 seconds, under the browser's 30, for when the solver runs out its time and then fails; in production the solver's import fails at once and the grid has the whole 10.
The solver's answer is never `timed_out`, since it does not say whether it stopped for time and its answer is its best packing.
The grid tries positions in one order, largest table first, columns left to right, rows top to bottom in a column, unrotated before rotated, and takes the first that fits.
A position fits when it is more than the spacing from every placed table, measured at once against the placed tables' rectangles beside its column, and then inside the zone, tested on a prepared geometry; it used to buffer every candidate and test it against every placed table's buffer, the same rule much more slowly.
Six-foot tables (1800 by 750 mm) on one machine: 59 in a 40 m by 30 m hall in 0.44 s (3.05 s before), 100 in 55 m by 41 m in 1.39 s (9.62 s), 200 in 55 m by 41 m in 6.06 s (48.76 s), and the review's run took 84.6 s for 200, past the browser's 30.

**Production has no `pyckingsolver`.**
It ships only `manylinux_2_35` wheels and Vercel builds on Amazon Linux 2023 (glibc 2.34), so it lives in [`back-end/requirements-floorplan-solver.in`](../../../back-end/requirements-floorplan-solver.in) and its lock [`requirements-floorplan-solver.txt`](../../../back-end/requirements-floorplan-solver.txt), which Docker, CI and local development install; the service imports it lazily, and production's Auto-Place runs the grid.
So [`back-end/tests/test_auto_place_tables.py`](../../../back-end/tests/test_auto_place_tables.py) runs each placement case twice, on the solver and on the grid with `pyckingsolver`'s import blocked, which is production's state, and the solver's case fails rather than falling back to the grid.
On the grid alone it also places a real hall's 59 tables in time, keeps the spacing between every two tables, and stops at a deadline set to half a second with `timed_out`.
An area's cases run with the solver installed and with its import blocked, and answer the same: thirty asked of a box as two rows of eleven and one of eight, a box filled, rows down, a no-table zone, one whose sides cross and a standing table turned 30° left clear, a zone of fewer than three points taking no floor, an L and a triangle holding only whole tables inside them, a deadline of nothing answering `timed_out`, and 500 among 1,000 standing inside 5 s.
**Any dependency added to `requirements.in` must install on glibc 2.34**: this one failed every production build from June to October 2026.

**Konva cannot read a CSS variable.**
Handed `var(--mm-red)`, a canvas keeps painting with whatever colour it last had, silently.
Pass a canvas colour through `canvasColor()` ([`front-end/src/utils/canvasColor.ts`](../../../front-end/src/utils/canvasColor.ts)), which resolves a `var(--name)` to the stylesheet's value at the moment of drawing and passes anything else, or a token the stylesheet lacks, through unchanged.

**Nothing of the wizard reaches the market until the save, so leaving before it asks** (T271).
The upload, the scale, the table types, the tables and the sections live in the page and the floorplan store until "Save & Continue", so a link, a market tab, Back or a reload dropped all of it with no word.
[`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue)'s `holdsAFloorplan` is true from an upload in this visit of the wizard until the floorplan is saved to the market, and is handed to `useUnsavedWork` ([unsaved work asks before it is dropped](../conventions/unsaved-work-asks-before-it-is-dropped.md)), so a move off the wizard asks "Leave without saving?" and a reload is asked by the browser.
The wizard sets `savedToMarket` before it emits `saved`, so the move back to Market Setup that follows never asks.
The rule is the wizard's, not the store's: the store keeps its data across a visit, but a new visit opens on Upload with nothing uploaded, so it asks nothing until a new upload.

**A floorplan is a location's layout, and a save writes only it** (T257).
`POST /floorplans/save-to-market` ([`back-end/api/floorplans_save.py`](../../../back-end/api/floorplans_save.py)) takes `{market_id, floorplan, revision}`, refuses a body that is not a JSON object (400), a `floorplan` that is not one ("floorplan is required") and a `revision` that is not a whole number from 0 ("revision is required"), needs EDITOR, refuses an archived market (403) and a setup that has settled (409, [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md)), then parses the floorplan as `FloorplanObject`: a field that does not parse answers 400 "Invalid floorplan: ..." naming it, a floorplan with no id of its own answers "A floorplan needs its id.", and an unknown key is dropped, the beta's `walls`, `placedTables` and `sections` among them.
**It writes through the plan's own writer, so it can never store a market that does not read.**
It puts the floorplan in the stored plan's `floorplans` in the place of the one of its id, or after them, so saving again replaces it, and hands that list to `prepared_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), which judges it as it judges a plan write and derives the sections' counts from it; sections and locations are Market Setup's, and the save never writes them.
Before the plan's writer judges it, a table naming a section that is not one of its location's (removed on Section Setup, or another location's) is stored in no section and of no number (`in_its_sections`), as the editor sends it.
Then [`layout.py`](../../../back-end/layout.py)'s `layout_refusal` answers 400 with one sentence for a layout whose location is not one of the plan's, two tables of one id ("Every table must have an id of its own."), a section's tables not numbered 1 to N (or a number on a table of no section), a table of a type the market does not have, a table with no scale to stand by, or a table whose centre is outside the floorplan; the beta's wizard sends a floorplan of no location, so its save is refused with "This layout's location is not one of the market's locations.".
The save used to write the plan's sections and locations by hand, which on a market whose plan was never saved left a plan of those alone, and with one wrong field a floorplan that did not parse: either way the market then answered as missing to every reader and refused every write, its Delete included (T272, [`test_a_floorplan_save_keeps_the_market_readable.py`](../../../back-end/tests/test_a_floorplan_save_keeps_the_market_readable.py)).
The route has no blanket `except`, so a refusal `prepared_plan` raises answers its own status and sentence.
**A save names the revision it read, so one tab never writes over another's.**
`revision` is the stored layout's, 0 for a new one; the server moves it by one on every write, ignoring the body's.
It answers 409 "This layout changed elsewhere. Reload to see the latest." when the layout of that id holds another revision, when a new id names a revision but 0, and when a new layout's location already has one, so two tabs that each start a hall's layout cannot both land; the write itself holds what was read (the layout at its place and revision, or no layout of its id or location), so a save landing between this one's read and its write makes this one 409 too.
A layout keeps its location and its starting counts whatever the body sends; a new one records `startingCounts`, Section Setup's count for each section of its location as the save found them, and gives a market with no table type "Standard 6 ft" (1830 by 760 mm), through `prepared_plan`'s `table_types`.
An image the layout no longer names is deleted by id once the write has landed.
The answer is `{floorplan, sections}`, the layout and the plan's sections as stored, so the editor adopts the revision and the derived counts at once.
**A later visit's wizard saves over the market's floorplan too**: when the wizard opens, [`FloorplanEditorView.vue`](../../../front-end/src/views/FloorplanEditorView.vue) hands [`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue) the id of the floorplan the market stores, the last saved when it holds several, and `openOnMarket()` in the wizard's store, [`front-end/src/stores/floorplan.ts`](../../../front-end/src/stores/floorplan.ts), gives the wizard's floorplan that id, so a run after a reload or on another day replaces it.

**The plan write never writes a layout** (T257).
`PUT /markets/:id/plan` keeps the stored `floorplans` and `tableTypes` and ignores the body's (`_with_the_layouts`), so Market Setup's autosave, which carries the whole working copy it read, can never overwrite a layout saved in between; only the layout's own write passes `prepared_plan` the floorplans it changes.
Every write of the plan runs `layout.derive_counts`, so a section of a laid-out location stores the number of its layout's tables whatever count was sent, and a section of a location with no layout keeps its typed count.
A floorplan whose location is no longer one of the plan's goes with it: the write drops it, and `release_removed_floorplans` deletes its image by id once the write has landed and records `floorplan_removed`; the CSV start does the same after its write.
A floorplan of no location, which only the beta saved, is kept and ignored by every reader until [`migrations/migrate_layouts.py`](../../../back-end/migrations/migrate_layouts.py) removes it.
What of a layout settles on leaving draft is its seats and the market's table types (`layout.settled_part`), never where a table stands.
Every write of the whole plan holds the table types as it read them (`PreparedPlan.held`, `table_types_as_read`: each type at its place by id, name and sides, and none after them, by value, never by a stored document's key order), so types written by their own write in between are never put back: a layout's save then answers 409 `STALE_LAYOUT`, and the plan write, which ignores the body's types, reads the market again and writes once more, three times at most, then answers 409 "The market changed while the plan was saved. Try again in a moment.".

**A floorplan is held to its bounds wherever it is written.**
[`back-end/floorplan_limits.py`](../../../back-end/floorplan_limits.py) is the one statement of them, and `prepared_plan` asks it of the floorplans a layout's write passes, before a floorplan of a location gone is dropped, so the bounds answer first: with 400 and one sentence for more than 20 floorplans on a market, more than 1,000 tables, 100 no-table zones, 200 section styles or 200 starting counts, a string over 200 characters, or a number that is not finite or past 10,000,000 by absolute value ("A floorplan's measurements must be finite numbers no larger than 10,000,000.").
`table_types_refusal()` holds the market's table types the same way when a write passes them: at most 50, each side 100 mm to 20,000 mm, and the same walk; `MAX_UPLOAD_BYTES` (4,000,000), `MAX_PDF_PAGES` (20) and `MAX_PDF_PAGE_SIDE_PX` (8,000) are stated there, the first two with their sentences, for the upload.
`floorplan_refusal()` finds the strings and numbers by walking the floorplan's model dump, so a field added to `FloorplanObject` later is bounded with no new line; the list bounds are named one by one.
`NaN` and `Infinity` pass Flask's JSON reader and a float field alike, and a market holding one is echoed back by the market read as bare tokens that are not JSON, so the browser could not read the market at all (Market Setup said "This market could not be loaded.").
**The bounds are the request's, never the stored model's**: `datatypes.py` gains no constraint, since one there would make a market already holding a larger floorplan fail to read.
So a floorplan restated unchanged (equal, as a model, to one the market holds) is not judged again, the same "restating is not a change" rule as [the setup lock](../../business/rules/the-setup-settles-on-leaving-draft.md), and the count refuses only a list longer than both 20 and the stored one, since the save once added a copy on every save; a stored floorplan holding `NaN` never equals itself, so it is always judged.
**A floorplan names only an image uploaded for its market**: each changed floorplan's `image_gridfs_id` must be one `get_image_market_id()` answers this market for, else 400 "The floorplan's image was not uploaded for this market.", which covers another market's image, an image stored without a market and an id naming no image.

**The editor keeps the tables it is handed.**
[`FloorplanEditor.vue`](../../../front-end/src/components/floorplan/FloorplanEditor.vue)'s `loadBackgroundImage()` calls `store.initFloorplan()` only when no floorplan exists yet, spreading the store's `placedTables`, `tableTypes`, `sections`, `walls`, `obstacles` and scale into it, so moving forward through the wizard keeps the auto-placed tables; when a floorplan exists it only refreshes the background image's fields.
This replaced a snapshot-and-restore workaround in the E2E page object.

**Saving a layout, deleting an image and a layout taken with its location record into [the market's history](../data/history.md)** (`floorplan`, `floorplan_image_deleted`, `floorplan_removed`, under `change-setup`), a layout's save as one `floorplan` entry and never also a `plan` one.
Its subject is the layout's id and its location's name (`floorplan_id`, `location`), and its detail is `layout.describe_change`: what the save changed in the layout's own terms (`started`, tables `added` and `removed` per section, `moved`, `turned`, `renumbered`, `zones`, `image`, `scale` in metres across before and after, `colours`, `labels`), never a table itself; a save that changes nothing records nothing.
Its zones read "marked 2 no-table zones in Upper Hall", "changed 1 no-table zone in Upper Hall" and "removed 1 no-table zone in Upper Hall".
Manage market reads it in words, "started Upper Hall's layout", "calibrated Upper Hall's layout to 30.0 m across", "recalibrated ...", "replaced Upper Hall's floorplan image", "added 12 tables to Silver aisle in Upper Hall", "removed 1 table from Gold row in Upper Hall", "moved 3 tables in Upper Hall", "turned 2 tables in Upper Hall", a save of anything else reading "changed Upper Hall's layout" ([`historyReaders/setup.ts`](../../../front-end/src/utils/historyReaders/setup.ts)), and an entry the beta's save recorded, its detail the plan's and the floorplan's two sides, reads as it did.
An upload stores an image the market uses only once a layout is saved, so it records nothing.

## Why

Auto-Place exists so an organizer with a hall plan gets section table counts from the room rather than typing them; a layout's tables are its location's sections' counts, which the [assignment solver](assignment-solver.md) seats vendors at, by section name as ever.
The organizer's side of it is [a location's layout](../../business/flows/planning.md#e6-a-locations-layout).

The glossary concept it serves: [Placement and pin](../../business/concepts/placement-and-pin.md).
