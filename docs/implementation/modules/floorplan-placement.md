---
layer: implementation
kind: module
describes:
  - back-end/services/placement_service.py
  - back-end/api/floorplans_placement.py
  - back-end/requirements-floorplan-solver.in
  - back-end/requirements-floorplan-solver.txt
  - back-end/api/floorplans_save.py
  - back-end/api/floorplans_analysis.py
  - back-end/api/floorplans_calibrate.py
  - back-end/api/floorplans_export.py
  - back-end/api/floorplans.py
  - back-end/api/floorplans_access.py
  - back-end/api/floorplans_templates.py
  - back-end/services/gridfs_service.py
  - front-end/src/components/floorplan/FloorplanUploader.vue
  - front-end/src/components/floorplan/FloorplanWorkflow.vue
  - front-end/src/utils/canvasColor.ts
  - front-end/src/components/floorplan/AutoPlaceButton.vue
  - front-end/src/components/floorplan/FloorplanEditor.vue#loadBackgroundImage
verified: 2026-10-29
sources:
  - bug/38
  - E26/F09/S01
  - E31/F01/S02
---

# Floorplan placement

The floorplan beta: an organizer uploads a floor plan, calibrates its scale, defines table types, Auto-Places them, groups them into sections, and saves the result into the market's plan.
The wizard is five steps (Upload, Calibrate, Place Tables, Edit Layout, Save) and the Konva canvas draws every one of them.
Each component that draws imports the vue-konva components it renders (`Stage as VStage`, `Layer as VLayer` and so on) rather than the app installing vue-konva for every page, so Konva rides only in the floorplan route's lazily loaded chunk, and [the bundle budget](../testing/ci-and-the-gate.md#the-bundle-budget) fails a pull request that brings it back to every page.

**Despite the "Floorplan AI" name, the wizard makes no LLM or vision call.**
Auto-Place (`POST /floorplans/place-tables`, [`back-end/api/floorplans_placement.py`](../../../back-end/api/floorplans_placement.py)) is a pure geometry solver in [`back-end/services/placement_service.py`](../../../back-end/services/placement_service.py): Shapely for the room and the zone, `pyckingsolver` for the packing.
The Gemini or OpenAI vision endpoint, `POST /floorplans/analyze` ([`back-end/api/floorplans_analysis.py`](../../../back-end/api/floorplans_analysis.py)), exists and nothing in the front end calls it: walls are drawn by hand.
So the flow can be exercised end to end in CI with no API keys and no stubbing ([floorplan E2E](../testing/floorplan-e2e.md)).

## Interface

`auto_place_tables(walls, obstacles, table_types, counts, scale_px_per_mm, aisle_config, room_mm)` returns placed tables in millimetres (`x_mm`, `y_mm`, `rotation`, `width_mm`, `height_mm`, `table_type_id`).
The organizer asks for a count per table type ([`AutoPlaceButton.vue`](../../../front-end/src/components/floorplan/AutoPlaceButton.vue)), and the wizard reports how many it placed.
`POST /floorplans/place-tables` takes the `market_id` the wizard is open on beside the geometry, read with `string_field()`, and places only for an editor of that market on a market that is not archived; `AutoPlaceButton.vue` sends the `marketId` [`FloorplanWorkflow.vue`](../../../front-end/src/components/floorplan/FloorplanWorkflow.vue) gives it.
The zone is the room less a wall buffer (1500 mm unless configured) and the obstacles; tables keep a spacing between them (1200 mm unless configured).

## Who may use the floorplan routes

Every floorplan action asks its row of the table ([the market's actions](market-actions.md)) on the floorplan's market, the way saving a floorplan to a market always did.
The roles are [what each role may do](../../business/rules/what-each-role-may-do.md) says, and a route that changes the floorplan keeps [an archived market is read-only](../../business/rules/an-archived-market-is-read-only.md).
[`back-end/api/floorplans_access.py`](../../../back-end/api/floorplans_access.py) is the one place a floorplan route decides it: `market_refusal(market_id, action, edits=...)` asks on a market the request names, `image_refusal(gridfs_id, action, edits=...)` asks on the market an image was uploaded for, and each answers None or the refusal the route returns.
They answer in save's order: no market named 400, unknown market 404, unreadable market data 400, a person the row refuses 403 with its sentence, and, for a route that changes the floorplan (`edits`), an archived market 403.
A route checks access right after it has read the id it is checked by, before the rest of its body, its key check or its image read.

| Route | Needs | Archived market |
| --- | --- | --- |
| `POST /floorplans/upload` | Change Market Setup (EDITOR) on the `market_id` sent | refused |
| `POST /floorplans/place-tables` | Change Market Setup (EDITOR) on the `market_id` sent | refused |
| `DELETE /floorplans/<id>` | Change Market Setup (EDITOR) on the image's market | refused |
| `POST /floorplans/analyze` | Change Market Setup (EDITOR) on the image's market | refused |
| `POST /floorplans/calibrate` ([`floorplans_calibrate.py`](../../../back-end/api/floorplans_calibrate.py)) | Change Market Setup (EDITOR) on the image's market | refused |
| `POST /floorplans/export` ([`floorplans_export.py`](../../../back-end/api/floorplans_export.py)) | the Read row (any role) on the image's market, signed in | allowed |
| `GET /floorplans/<id>` | nothing: public by opaque id | allowed |
| `POST /floorplans/save-to-market` | Change Market Setup (EDITOR), and a setup that has not settled (409) | refused |

The wizard's steps are an editor's work on a market that can still change, which is when the front end offers the wizard at all.
**The export's audience is the people on the market**: it is a read of the plan, a rendering of the hall with its table codes, so it needs a sign-in and any role, and an archived market still exports.
The raw image read stays public by its opaque id, so pages that show a floorplan image need no session; it is the one route that does not check a market.
The settled-setup refusal stays on save alone, since only save writes the sections.
**Every floorplan route but the image read needs a sign-in**, and `TestEveryFloorplanRouteNeedsASignIn` in [`back-end/tests/test_floorplan_access.py`](../../../back-end/tests/test_floorplan_access.py) keeps it so: it asks each route the floorplan blueprints register without a session and expects a 401, so a new route, or one whose `@login_required` is missing or above its `@route`, fails it.

**An image belongs to the market it was uploaded for.**
`POST /floorplans/upload` ([`back-end/api/floorplans.py`](../../../back-end/api/floorplans.py)) takes a `market_id` form field beside the file, needs an editor of that market on a market that is not archived, and checks it before it reads the file.
[`upload_image()`](../../../back-end/services/gridfs_service.py) keeps the market's id in the GridFS file's metadata (`metadata.marketId`), on every page of a PDF too, and `get_image_market_id()` reads it back: None for an unknown image, an id that is not an ObjectId, or an image stored without a market, so `image_refusal()` answers all three "Image not found", and no route but the public read treats an unowned image as anyone's.
The wizard's [`FloorplanUploader.vue`](../../../front-end/src/components/floorplan/FloorplanUploader.vue) sends the market it is in.
Images uploaded before images named a market have no `marketId`; the wizard never reopens a saved floorplan's image, so they are read only by the public `GET /floorplans/<id>`, and no migration gives them one.

**A template is its creator's, and one filed under an organization is filed by someone in it.**
[`back-end/api/floorplans_templates.py`](../../../back-end/api/floorplans_templates.py) reads a create's or an update's `organizationId` with `string_field()`: null or absent files it under none, another type answers 400, an organization nobody has 404, and one the caller is not in (as owner, admin or member) 403, the test listing an organization's templates applies.
The other fields a template takes are typed too, and any other key is ignored ([a write takes only its fields](../conventions/a-request-value-is-a-string.md#a-write-takes-only-its-fields)).
A stored `organizationId` that is not a non-empty string reads as none, so only the template's creator reaches it; [`back-end/tests/test_floorplan_template_access.py`](../../../back-end/tests/test_floorplan_template_access.py) keeps both.

## Sharp edges

**The room is the floor plan** (bug 38).
With no walls drawn, the room is the uploaded image's extent at the calibrated scale, `room_mm` from its top-left corner, which is where the editor draws a table at `(x_mm, y_mm)`.
It was a fixed 10 m square centred on the origin whatever was uploaded, so a 55 m hall had a 49 m² zone and every table landed off the image.
The endpoint answers 400 with neither walls nor `room_mm`: there is no default room.
Walls that enclose nothing fall back to the image's extent when it is known.

**The solver is bounded by its own `time_limit`** (`SOLVER_TIME_LIMIT_S`, 10 seconds): it is an anytime solver, returning the best packing found by then.
A thread timeout wrapped around the call bounded nothing: it raised in the caller while the solver ran on to its own 60-second default, and the request waited for it.
When the solver fails or finds no packing, a grid-based greedy placement runs instead.

**Production has no `pyckingsolver`.**
It ships only `manylinux_2_35` wheels and Vercel builds on Amazon Linux 2023 (glibc 2.34), so it lives in [`back-end/requirements-floorplan-solver.in`](../../../back-end/requirements-floorplan-solver.in) and its lock [`requirements-floorplan-solver.txt`](../../../back-end/requirements-floorplan-solver.txt), which Docker, CI and local development install; the service imports it lazily, and production's Auto-Place runs the grid.
**Any dependency added to `requirements.in` must install on glibc 2.34**: this one failed every production build from June to October 2026.

**Konva cannot read a CSS variable.**
Handed `var(--mm-red)`, a canvas keeps painting with whatever colour it last had, silently.
Pass a canvas colour through `canvasColor()` ([`front-end/src/utils/canvasColor.ts`](../../../front-end/src/utils/canvasColor.ts)), which resolves a `var(--name)` to the stylesheet's value at the moment of drawing and passes anything else, or a token the stylesheet lacks, through unchanged.

**Saving writes the plan's sections and locations, so it is a draft's only** ([the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md)).
`POST /floorplans/save-to-market` ([`back-end/api/floorplans_save.py`](../../../back-end/api/floorplans_save.py)) refuses a body that is not a JSON object (400), needs EDITOR, refuses an archived market (403) and a settled setup (409), then replaces `setupObject.sections` and `.locations` with the floorplan's and appends the floorplan to `setupObject.floorplans`.
It tolerates a market with no `setupObject` (`isinstance(existing_setup, dict)` chooses between updating the existing object and seeding a fresh one).

**The editor keeps the tables it is handed.**
[`FloorplanEditor.vue`](../../../front-end/src/components/floorplan/FloorplanEditor.vue)'s `loadBackgroundImage()` calls `store.initFloorplan()` only when no floorplan exists yet, spreading the store's `placedTables`, `tableTypes`, `sections`, `walls`, `obstacles` and scale into it, so moving forward through the wizard keeps the auto-placed tables; when a floorplan exists it only refreshes the background image's fields.
This replaced a snapshot-and-restore workaround in the E2E page object.

**Saving a floorplan to the market and deleting an image record into [the market's history](../data/history.md)** (`floorplan`, `floorplan_image_deleted`, under `change-setup`); a calibration, an analysis and an Auto-Place keep nothing, and an upload stores an image the market uses only once a floorplan is saved, so none of them records.

## Why

Auto-Place exists so an organizer with a hall plan gets section table counts from the room rather than typing them; the counts it saves become the plan's sections, which the [assignment solver](assignment-solver.md) seats vendors at.
The organizer's side of it, the beta's five-step wizard, is [sections from a floorplan](../../business/flows/planning.md#e6-sections-from-a-floorplan).

The glossary concept it serves: [Placement and pin](../../business/concepts/placement-and-pin.md).
