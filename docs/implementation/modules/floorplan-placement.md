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
  - front-end/src/components/floorplan/FloorplanUploader.vue
  - front-end/src/components/floorplan/FloorplanWorkflow.vue
  - front-end/src/utils/canvasColor.ts
  - front-end/src/components/floorplan/AutoPlaceButton.vue
  - front-end/src/components/floorplan/FloorplanEditor.vue#loadBackgroundImage
  - back-end/floorplan_limits.py
  - back-end/api/markets.py#_floorplans_refusal
  - front-end/src/views/FloorplanEditorView.vue
  - front-end/src/stores/floorplan.ts
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
  - T274
---

# Floorplan placement

The floorplan beta: an organizer uploads a floor plan, calibrates its scale, defines table types, Auto-Places them, groups them into sections, and saves the result into the market's plan.
The wizard is five steps (Upload, Calibrate, Place Tables, Edit Layout, Save) and the Konva canvas draws every one of them.
Each component that draws imports the vue-konva components it renders (`Stage as VStage`, `Layer as VLayer` and so on) rather than the app installing vue-konva for every page, so Konva rides only in the floorplan route's lazily loaded chunk, and [the bundle budget](../testing/ci-and-the-gate.md#the-bundle-budget) fails a pull request that brings it back to every page.
No step scrolls by itself: the market's frame gives the wizard no height to outgrow, so a step grows with what it holds and the page scrolls, in any window; what scrolls inside the wizard is the Sections panel, the save dialog's body and the section dialog, each in a [`ScrollBox`](../../design-system.md#the-primitive-layer).

**The floorplan beta makes no LLM or vision call.**
Auto-Place (`POST /floorplans/place-tables`, [`back-end/api/floorplans_placement.py`](../../../back-end/api/floorplans_placement.py)) is a pure geometry solver in [`back-end/services/placement_service.py`](../../../back-end/services/placement_service.py): Shapely for the room and the zone, `pyckingsolver` for the packing.
Walls are drawn by hand, and no route sends a floorplan image to a hosted model.
So the flow can be exercised end to end in CI with no API keys and no stubbing ([floorplan E2E](../testing/floorplan-e2e.md)).

## Interface

`auto_place_tables(walls, obstacles, table_types, counts, scale_px_per_mm, aisle_config, room_mm)` returns a `PlacementResult`: `placed`, the placed tables in millimetres (`x_mm`, `y_mm`, `rotation`, `width_mm`, `height_mm`, `table_type_id`), and `timed_out`, true only when the grid placement stopped at its deadline; the route answers them as `{"placed_tables": [...], "timed_out": ...}`.
The organizer asks for a count per table type ([`AutoPlaceButton.vue`](../../../front-end/src/components/floorplan/AutoPlaceButton.vue)), and the wizard reports how many it placed, and when it placed fewer than asked, why: "Placed {n} of {asked} tables - there was no room for the rest.", or with `timed_out` "Placed {n} of {asked} tables - Auto-Place ran out of time before the rest.".
While it cannot place, with no table type, scale, count asked or room yet, or a placement running, the button is disabled, and like the wizard's Next it takes the design language's [one disabled state](../../design-system.md#the-primitive-layer), never opacity.
`POST /floorplans/place-tables` takes the `market_id` the wizard is open on beside the geometry, read with `string_field()`, and places only for an editor of that market on a market that is not archived; `AutoPlaceButton.vue` sends the `marketId` [`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue) gives it.
The zone is the room less a wall buffer (1500 mm unless configured) and the obstacles; tables keep a spacing between them (1200 mm unless configured).

**Auto-Place's request is parsed and bounded before it places** (T272).
After the access check the route parses the body as `PlaceTablesRequest`, defined in the route file of the stored `WallSegment`, `ObstacleZone` and `TableTypeObject`, `counts` of whole numbers from 0, a finite `scale_px_per_mm`, an optional `room_mm` of positive finite sides and an optional `aisle_config` with the wizard's camel-cased keys; a field that does not parse answers 400 "Invalid placement request: ..." naming it.
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
The wizard's three readers, [`FloorplanUploader.vue`](../../../front-end/src/components/floorplan/FloorplanUploader.vue), [`FloorplanEditor.vue`](../../../front-end/src/components/floorplan/FloorplanEditor.vue) and [`ScaleCalibration.vue`](../../../front-end/src/components/floorplan/ScaleCalibration.vue), fetch it through the API client with the session's cookie, as a blob.
The settled-setup refusal stays on save alone, since only save writes the sections.
**Every floorplan route needs a sign-in**, and `TestEveryFloorplanRouteNeedsASignIn` in [`back-end/tests/test_floorplan_access.py`](../../../back-end/tests/test_floorplan_access.py) keeps it so: it asks each route the floorplan blueprints register without a session and expects a 401, so a new route, or one whose `@login_required` is missing or above its `@route`, fails it.

**An image belongs to the market it was uploaded for.**
`POST /floorplans/upload` ([`back-end/api/floorplans.py`](../../../back-end/api/floorplans.py)) takes a `market_id` form field beside the file, needs an editor of that market on a market that is not archived, and checks it before it reads the file.
[`upload_image()`](../../../back-end/services/gridfs_service.py) keeps the market's id in the GridFS file's metadata (`metadata.marketId`), on every page of a PDF too, and `get_image_market_id()` reads it back: None for an unknown image, an id that is not an ObjectId, or an image stored without a market, so `image_refusal()` answers all three "Image not found", and no route treats an unowned image as anyone's.
The wizard's [`FloorplanUploader.vue`](../../../front-end/src/components/floorplan/FloorplanUploader.vue) sends the market it is in.
It takes the file on the app's one drop zone, [`FileDropZone.vue`](../../../front-end/src/components/FileDropZone.vue) ([the design language](../../design-system.md#the-primitive-layer)), offering PNG, JPG, WebP and PDF, and checks the type itself, refusing any other with "Unsupported file type. Please use PNG, JPG, WebP, or PDF." before it sends anything (T205).
The zone stays, busy, while the file uploads, and gives way to the preview (and, for a PDF of more than one page, its page picker) once the server has it; an upload that fails leaves the zone and the error, so another file can be chosen.
An image previews as the file chosen; a PDF previews as the page the server drew from it, fetched from `GET /floorplans/<id>` and following the page chosen, since a browser draws no PDF in an image.
When that first page cannot be fetched, the zone comes back with "The floorplan was uploaded, but its page could not be shown. Choose the file again.", and any upload that does not end on a shown PDF page forgets the earlier PDF's pages, so no picker offers them under an image.
The server draws each page at 200 dpi with pypdfium2 ([`pdf_converter.py`](../../../back-end/utils/pdf_converter.py)), whose `manylinux_2_17` wheel carries PDFium, so it needs no system package on Vercel, Docker or CI (T205).
Images uploaded before images named a market have no `marketId`, so no route reads them, `GET /floorplans/<id>` included; the wizard never reopens a saved floorplan's image, so nothing on screen asks for them, and no migration gives them one.
Deleting a market deletes every image whose `metadata.marketId` names it, with its other records ([market deletion](market-deletion.md)); an image with no `marketId` names no market, so no deletion takes it.

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
**Any dependency added to `requirements.in` must install on glibc 2.34**: this one failed every production build from June to October 2026.

**Konva cannot read a CSS variable.**
Handed `var(--mm-red)`, a canvas keeps painting with whatever colour it last had, silently.
Pass a canvas colour through `canvasColor()` ([`front-end/src/utils/canvasColor.ts`](../../../front-end/src/utils/canvasColor.ts)), which resolves a `var(--name)` to the stylesheet's value at the moment of drawing and passes anything else, or a token the stylesheet lacks, through unchanged.

**Nothing of the wizard reaches the market until the save, so leaving before it asks** (T271).
The upload, the scale, the table types, the tables and the sections live in the page and the floorplan store until "Save & Continue", so a link, a market tab, Back or a reload dropped all of it with no word.
[`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue)'s `holdsAFloorplan` is true from an upload in this visit of the wizard until the floorplan is saved to the market, and is handed to `useUnsavedWork` ([unsaved work asks before it is dropped](../conventions/unsaved-work-asks-before-it-is-dropped.md)), so a move off the wizard asks "Leave without saving?" and a reload is asked by the browser.
The wizard sets `savedToMarket` before it emits `saved`, so the move back to Market Setup that follows never asks.
The rule is the wizard's, not the store's: the store keeps its data across a visit, but a new visit opens on Upload with nothing uploaded, so it asks nothing until a new upload.

**Saving writes the plan's sections and locations, so it is a draft's only** ([the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md)).
`POST /floorplans/save-to-market` ([`back-end/api/floorplans_save.py`](../../../back-end/api/floorplans_save.py)) refuses a body that is not a JSON object (400) and a `floorplan` that is not one ("floorplan is required"), needs EDITOR, refuses an archived market (403) and a settled setup (409), then parses the floorplan as `FloorplanObject`: a field that does not parse answers 400 "Invalid floorplan: ..." naming it, a floorplan with no id of its own answers "A floorplan needs its id.", and an unknown key is dropped.
**It writes through the plan's own writer, so it can never store a market that does not read.**
It builds the plan from the stored one, or from the empty plan Market Setup starts from when the market has none (empty dates, tiers, priority, locations and sections, both assignment options null, no pricing), with `sections` and `locations` the floorplan's and the floorplan in `floorplans` in the place of the stored one of its id, or added after them, so saving again replaces it; then `prepared_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) judges it as it judges a plan write, and the route writes the whole `setupObject` that returns through [the market write](market-write.md#the-plans-revision), holding the phase and the plan's revision as read and counting it: a plan saved meanwhile refuses the save with the 409 "market changed", and a Market Setup page read before it is refused the same way rather than storing its older plan over the floorplan.
It used to write the three fields by hand, which on a market whose plan was never saved left a plan of those three alone, and with one wrong field a floorplan that did not parse: either way the market then answered as missing to every reader and refused every write, its Delete included (T272, [`a-floorplan-save-keeps-the-market-readable.spec.ts`](../../../front-end/e2e/a-floorplan-save-keeps-the-market-readable.spec.ts), [`test_a_floorplan_save_keeps_the_market_readable.py`](../../../back-end/tests/test_a_floorplan_save_keeps_the_market_readable.py)).
The route has no blanket `except`, so a refusal `prepared_plan` raises answers its own status and sentence.
**A later visit's wizard saves over the market's floorplan too**: when the wizard opens, [`FloorplanEditorView.vue`](../../../front-end/src/views/FloorplanEditorView.vue) hands [`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue) the id of the floorplan the market stores, the last saved when it holds several, and `openOnMarket()` in the wizard's store, [`front-end/src/stores/floorplan.ts`](../../../front-end/src/stores/floorplan.ts), gives the wizard's floorplan that id, so a run after a reload or on another day replaces it; it used to start each page session's floorplan under a new id, so every visit added one, until the 21st save was refused for good with nothing on screen to free a place.
**A floorplan is held to its bounds wherever it is written.**
[`back-end/floorplan_limits.py`](../../../back-end/floorplan_limits.py) is the one statement of them, and `prepared_plan` asks it, so the wizard's save and a plan write (`PUT /markets/:id/plan`, which carries the stored floorplans back as Market Setup read them) are refused alike, with 400 and one sentence: more than 20 floorplans on a market, more than 100 walls, 100 obstacle zones, 100 points in an obstacle zone, 50 table types, 1,000 tables, 200 sections or 1,000 tables in a section, a string over 200 characters, or a number that is not finite or past 10,000,000 by absolute value ("A floorplan's measurements must be finite numbers no larger than 10,000,000.").
`floorplan_refusal()` finds the strings and numbers by walking the floorplan's model dump, so a field added to `FloorplanObject` later is bounded with no new line; the list bounds are named one by one.
`NaN` and `Infinity` pass Flask's JSON reader and a float field alike, and a market holding one is echoed back by the market read as bare tokens that are not JSON, so the browser could not read the market at all (Market Setup said "This market could not be loaded.").
**The bounds are the request's, never the stored model's**: `datatypes.py` gains no constraint, since one there would make a market already holding a larger floorplan fail to read.
So a floorplan restated unchanged (equal, as a model, to one the market holds) is not judged again, the same "restating is not a change" rule as [the setup lock](../../business/rules/the-setup-settles-on-leaving-draft.md), and the count refuses only a list longer than both 20 and the stored one, since the save once added a copy on every save; a stored floorplan holding `NaN` never equals itself, so it is always judged.
**A floorplan names only an image uploaded for its market**: each changed floorplan's `image_gridfs_id` must be one `get_image_market_id()` answers this market for, else 400 "The floorplan's image was not uploaded for this market.", which covers another market's image, an image stored without a market and an id naming no image.

**The editor keeps the tables it is handed.**
[`FloorplanEditor.vue`](../../../front-end/src/components/floorplan/FloorplanEditor.vue)'s `loadBackgroundImage()` calls `store.initFloorplan()` only when no floorplan exists yet, spreading the store's `placedTables`, `tableTypes`, `sections`, `walls`, `obstacles` and scale into it, so moving forward through the wizard keeps the auto-placed tables; when a floorplan exists it only refreshes the background image's fields.
This replaced a snapshot-and-restore workaround in the E2E page object.

**Saving a floorplan to the market and deleting an image record into [the market's history](../data/history.md)** (`floorplan`, `floorplan_image_deleted`, under `change-setup`), a floorplan save as one `floorplan` entry and never also a `plan` one, whose detail summarises the saved floorplan as it was under its id and as it is (its tables, walls, obstacle zones and table types counted, and a digest of its layout, never the floorplan itself, which could hold 1,000 tables), so a save that moved only its tables or walls is recorded, and Manage market reads it as its counts and "Layout: as saved before, changed"; a calibration and an Auto-Place keep nothing, and an upload stores an image the market uses only once a floorplan is saved, so none of them records.

## Why

Auto-Place exists so an organizer with a hall plan gets section table counts from the room rather than typing them; the counts it saves become the plan's sections, which the [assignment solver](assignment-solver.md) seats vendors at.
The organizer's side of it, the beta's five-step wizard, is [sections from a floorplan](../../business/flows/planning.md#e6-sections-from-a-floorplan).

The glossary concept it serves: [Placement and pin](../../business/concepts/placement-and-pin.md).
