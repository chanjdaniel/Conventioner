---
layer: implementation
kind: convention
describes:
  - back-end/client_errors.py
  - back-end/utils/request_body.py#json_object
  - back-end/tests/test_an_exception_never_reaches_a_client.py
  - back-end/app.py#get_assigned_market
  - back-end/app.py#get_assignment_statistics
  - back-end/app.py#get_assignment_csv
  - back-end/app.py#export_vendors
  - back-end/app.py#preview_vendor_export
  - back-end/app.py#get_market_tables
  - back-end/app.py#get_organizations
  - back-end/app.py#create_organization
  - back-end/app.py#get_organization
  - back-end/app.py#get_organization_history
  - back-end/app.py#update_organization
  - back-end/app.py#organization_deletion_preview
  - back-end/app.py#delete_organization
  - back-end/app.py#add_org_admin
  - back-end/app.py#add_org_member
  - back-end/app.py#remove_org_user
  - back-end/app.py#transfer_org_ownership
  - back-end/app.py#_named_market_role
  - back-end/app.py#add_market_role
  - back-end/app.py#remove_market_role
  - back-end/app.py#update_market_role
  - back-end/app.py#get_market
  - back-end/app.py#get_markets_by_owner_email
  - back-end/app.py#create_market
  - back-end/app.py#rename_market
  - back-end/app.py#save_plan
  - back-end/app.py#get_vendor_notes
  - back-end/app.py#save_vendor_note
  - back-end/app.py#mark_vendor_request_handled
  - back-end/app.py#save_review_highlights
  - back-end/app.py#save_rejection_rules
  - back-end/app.py#delete_market
  - back-end/app.py#set_applications_stopped
  - back-end/app.py#save_application_form
  - back-end/app.py#get_application_form
  - back-end/app.py#_named_phase
  - back-end/app.py#transition_market
  - back-end/app.py#pending_offers_count
  - back-end/app.py#run_assignment
  - back-end/app.py#add_vendor
  - back-end/app.py#write_placement
  - back-end/app.py#get_placement_history
  - back-end/app.py#get_history
  - back-end/app.py#swap_placements
  - back-end/app.py#remove_placement
  - back-end/app.py#applicant_login_request_code
  - back-end/app.py#applicant_login_verify_code
  - back-end/app.py#public_get_application_form
  - back-end/app.py#public_get_applicant_application
  - back-end/app.py#public_save_applicant_application
  - back-end/app.py#list_market_applications
  - back-end/app.py#_named_status
  - back-end/app.py#review_application
  - back-end/app.py#review_selection
  - back-end/app.py#next_for_review
  - back-end/app.py#hold_for_review
  - back-end/app.py#reassign_follow_up
  - back-end/app.py#propose_from_csv
  - back-end/app.py#confirm_csv_proposal
  - back-end/app.py#inspect_application_import
  - back-end/app.py#preview_application_import
  - back-end/app.py#import_applications
  - back-end/app.py#publish_market_results
  - back-end/app.py#get_market_attendance
  - back-end/app.py#_door_write
  - back-end/api/markets.py#_load_market_for
  - back-end/api/markets.py#parsed_application_form
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#_log_unreadable_market
  - back-end/api/markets.py#_load_organization_context
  - back-end/application_write.py#_field_answer
  - back-end/csv_import.py#parse_csv
  - back-end/csv_start.py#confirm
  - back-end/api/applicants.py#list_market_applications
  - back-end/api/applications.py#find_or_create_application
  - back-end/api/added_vendors.py#AddVendorRefused
  - back-end/api/vendor_export.py#ExportInvalid
  - back-end/api/placements.py#AssignPhaseError
  - back-end/csv_start.py#ConfirmRefused
  - back-end/seed_test_markets.py#main
  - front-end/src/utils/api.ts
  - front-end/src/utils/download.ts#downloadErrorMessage
  - front-end/src/components/ReadFailed.vue
  - front-end/src/utils/signInNext.ts
  - front-end/src/utils/sessionEnded.ts
  - front-end/src/utils/pageFailed.ts
  - front-end/e2e/a-failure-says-what-to-do.spec.ts
  - back-end/app.py#vendor_check_in
  - back-end/app.py#vendor_undo_check_in
verified: 2026-11-03
sources:
  - T74
  - E41/F01/S01
  - T139
  - E38/F11/S01
  - T161
  - T181
---

# An exception never reaches a client

**A client reads only copy our code wrote: a refusal's own sentence, or `{"error": "Internal server error"}`.**
It never reads an exception's text, its type name, a traceback, the function or endpoint that failed, or a timestamp.
That text is whatever the failing library wrote (a PyMongo error naming hosts, a pydantic error quoting the input, a `KeyError` naming a field), which is noise to an organizer.
It is the error half of the [security invariants](security-invariants.md#each-request)' rules for each request.

## Client copy

Client copy is a literal, or a sentence our code composes from values it chose: a field's label, a market's name, a phase, a list of blockers.
It is never `str()`, `repr()` or `args` of an exception, nor a library's message, even wrapped in a sentence of ours.
A domain exception of ours may carry client copy, because we wrote it where we raised it, and a route may translate one into its answer with a method of its own (`IncompleteApplicationsError.message()`).

### A refused parse

A parse that fails says what was wrong in our words, with the status it always had, and logs what the copy left out at warning level, never the input.

- A body a model refuses answers 400 with `field_named_copy(heading, error)`: `Invalid plan: sections.0.count: Input should be a valid integer, ...`.
  The plan is parsed in `prepared_plan`, the application form in `parsed_application_form` and a new market's body in `create_owned_market` (`Invalid market: ...`), all in [`back-end/api/markets.py`](../../../back-end/api/markets.py); the form write is the one parse of a form, the [form amendment](../modules/form-amendment.md)'s included.
  It names each failing field by its dotted location and pydantic's short `msg`, and never the error's `input`, `ctx`, `url` or `type`.
  Its log line is `parse_failure_detail(error)`: each location and pydantic's error type.
  The value is parsed with `model_validate`, so a value that is not an object is refused the same way rather than raising a `TypeError`.
- A stored market the model refuses is answered `Invalid market data`, 400, by `_load_market_for`, and `_log_unreadable_market` logs the same detail with the market's id for `_load_market_for` and `load_market_context` alike.
  The routes built on `load_market_context` decide their own answer, the market read among them: `get_market_for_user` serves it to no one, a 404, and the Markets list leaves it out and lists the rest ([the market document](../data/market-document.md)).
  A stored organization the model refuses is logged the same way with its id by `_load_organization_context`, and its market is still served, granting nothing through the organization.
- A number question answered with text ([`back-end/application_write.py`](../../../back-end/application_write.py)) answers `'<label>' must be a number.`, 422, and logs nothing: why the conversion failed is the answer itself, which is the applicant's and never a log's.
- A CSV Python's reader refuses (`parse_csv` in [`back-end/csv_import.py`](../../../back-end/csv_import.py)): the import's endpoints and the [CSV start](../modules/csv-proposal-and-start.md)'s proposal answer `That file could not be read as CSV.`, 400, and the CSV start's confirm answers it as a `ConfirmRefused`, 409.
  The reader's message is logged, which names a limit or a character, never a cell.
- A file that is not a CSV export, a binary the browser decoded anyway, is refused by `parse_csv` before the reader with `This file does not look like a CSV export. Download the responses again from Google Forms as .csv.`, with the same statuses, and logs nothing: a NUL or an unprintable heading is the whole of why (E38/F15/S02).

## The types

[`back-end/client_errors.py`](../../../back-end/client_errors.py) holds them.

- `ClientError` is the base: constructed with the client copy, it holds it as `message`, has a class-level `status`, and answers `body()`, by default `{"error": message}`.
- `BadRequestError` 400, `ForbiddenError` 403, `NotFoundError` 404 and `ConflictError` 409 are the statuses a refusal raises.
  The `Error` suffix keeps them apart from Werkzeug's `BadRequest`, `Forbidden`, `NotFound` and `Conflict`.
- A refusal with more to say than a sentence overrides `body()`, its keys camelCased as the front end reads them.
- No client error is a builtin refusal too: none subclasses `ValueError` or `PermissionError`, nor does any refusal built on one.
  So an `except ValueError` or `except PermissionError` catches only a builtin's failure (a date that does not parse, a role a stored document names wrongly) and never a refusal, and a library's `ValueError` is never answered as one.

A raise site decides a refusal and raises the type for it; the route writes no `try`/`except` to answer it.
An internal invariant (a guard's own consistency check, a model validator) stays a builtin: escaping is a bug, and it answers 500.

**The markets API's refusals** ([`back-end/api/markets.py`](../../../back-end/api/markets.py)) are client errors.
Every refusal it words raises `BadRequestError` or `ForbiddenError`, and a market the URL names that does not exist raises `MarketNotFoundError`, a `NotFoundError`, in the role writes and the deletion as everywhere else.
Its own types are client errors too: `MarketNotFoundError` 404, `MarketArchivedError` 403 ([an archived market is read-only](../../business/rules/an-archived-market-is-read-only.md)), `MoveUnavailable` 400, `ApplicationFormLockedError` 409, and `PhaseChangedUnderRequest` 409, whose `body()` is the transition's `phase_changed` payload ([the guards](../modules/guards.md)).
`create_market`'s "exactly one owner" stays a `ValueError`: `create_owned_market` sets the one owner, so it escaping is a bug, and it answers 500.

**Every other module's refusals** are client errors too, each with the status its routes answer today.

- [`back-end/api/organizations.py`](../../../back-end/api/organizations.py) raises `BadRequestError` and `ForbiddenError`, and `NotFoundError` for "Organization not found", which every organization route answers 404; `OrganizationHasLiveMarkets` is a 409 whose `body()` names the blocking markets ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md)).
- [Placements](../modules/placements.md): `PlacementError` is a `BadRequestError`, `SeatTakenError` one with status 409, and `AssignPhaseError` a `ConflictError`.
- `AddVendorInvalid` is a `BadRequestError` and `AddVendorRefused` a `ConflictError`, in [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py) ([adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).
- The vendor export's `ExportInvalid` is a `BadRequestError`, in [`back-end/api/vendor_export.py`](../../../back-end/api/vendor_export.py).
- Updating a vendor's info refuses with `BadRequestError` (an answer the form refuses, a question it does not ask), `ForbiddenError` (an answer the assignment or a price group reads, to whoever the row "Update info the assignment or price reads" refuses, before the answer is judged) and `NotFoundError` (an application not on the market), in [`back-end/api/vendor_info.py`](../../../back-end/api/vendor_info.py).
- `ConfirmRefused`, a [CSV start](../modules/csv-proposal-and-start.md) the request cannot write, is a `ConflictError`.
- `Rulebook.prepared` refuses a rule with `BadRequestError` ([automatic rejections](../../business/rules/automatic-rejections.md)), and so does the [floorplan placement](../modules/floorplan-placement.md) for walls that enclose no room, though its route's own catch-all still answers that 500 until the floorplan routes stop catching.
- [The Discord connection](../modules/discord.md): `DiscordNotSetUp` is a 503 when the deployment has no Discord values, `DiscordRefused` a 400, and `DiscordUnavailable` a 502 for a 401 from Discord (the deployment's settings), a 429 it asks too long or too often to wait out, a 5xx, an unreachable host or any other failed answer from the bot, each in Conventioner's words and never Discord's. Its routes raise `BadRequestError` for a card, a check or a run they refuse, and the check or the run a `ConflictError` 409 when the card changed under it.

What stays a builtin is a bug if it escapes: the room with neither walls nor a size (the route refuses that first), `normalized_submitted_at`'s refusal (every caller catches it), and the applications API's verdict without a giver, its index error and its upsert that keeps losing a race.

## The two handlers

`install_error_answers(app)`, called once in [`back-end/app.py`](../../../back-end/app.py) right after the public endpoint defenses are configured, registers both on the app, so every blueprint is covered too.

- A `ClientError` is answered `jsonify(error.body())` with `error.status`, and is not logged: it is an answer, not a failure.
- Any other `Exception` is logged once with `logger.exception` and answered `{"error": "Internal server error"}`, 500.
  A Werkzeug `HTTPException` is an `Exception` too, so this handler returns one unchanged: Flask's 404 and 405, an `abort()`, the 413 of an oversized upload and Flask-Login's 401 answer as Flask writes them.
- The handler is on `Exception`, not `InternalServerError`, because under `TESTING` or debug Flask propagates an unhandled exception instead of calling a 500 handler; registered on `Exception`, the suite exercises it the way production runs it.

**The log line** names the method, `request.endpoint`, and the view argument `market_id`, `market_slug` or `org_id` when the route has one, with the traceback.
It never names the path, the query string, the body or the view argument `vendor_email`, since each can hold an applicant's address.

The assignment reads (`get_assigned_market`, `get_assignment_statistics`, `get_assignment_csv` and `get_market_tables`, in `app.py` and in `api/markets.py`) answer this way: an `IncompleteApplicationsError` is still the preview's (`get_assigned_market`) 400 with its own message, the other three never raise it ([placements](../modules/placements.md#what-a-read-shows)), and anything else reaches the handler.

So do the organization routes (the list, create, read, update, its history, deletion preview, delete, and adding, removing and handing on its people) and the market role routes (add, remove, update): none catches anything, each keeps the literal answers it decides itself (`Organization name required`, `Invalid role: <role>`), and every refusal of `api/organizations.py` and the markets API's role writes reaches the handler.
An organization or a market that does not exist answers 404 on each of them, and a role or an address that is not a string is refused as a missing one ([a request value is a string](a-request-value-is-a-string.md)).
Removing someone already gone says what is true now, as the client half asks: "They are no longer in this organization." and "They no longer have a role on this market.", each a 404 ([the organization document](../data/organization-document.md#the-organization)); the two removal routes answer nothing of their own.

So do the market setup routes: reading a market and listing a user's markets, creating, renaming, planning and deleting one, and its vendor notes, review highlights, rejection rules and permission rows, with their history.
None catches anything, and each keeps its literal answers (`note is required`, `keys is required`, `Market not found or access denied`).
Creating a market answers a body the model refuses with its field-named 400, a refusal the markets API decides (no organization, an address another market holds) with that refusal's status, and anything else, its one-owner invariant included, with the generic 500.
Deleting a market that does not exist answers 404.

So do the application form and phase routes: reading and saving the form, the phase move, stopping and taking applications, and the pending-offers count.
None catches anything, and each keeps its literal answers (`to_phase is required`, `stopped must be true or false`, `Unknown phase: '<phase>'. Valid phases: ...`, `Market not found`, `Invalid market data`, and the permission 403s the routes ask themselves).
A form saved in a phase that has fixed it answers its lock reason, 409; the phase move answers its own guards' 409, a market moved under it with `PhaseChangedUnderRequest.body()`, and a fact its guards read changed under it with `MoveBlockedUnderRequest.body()`; a stop asked of a market that takes none answers why, 409.

So do the assignment and placement routes: running the assignment, adding a vendor who never applied, writing, swapping and freeing a placement, and reading the placement history and the market's history.
None catches anything.
A run over incomplete answers is still `run_assignment`'s 400 in [`back-end/api/placements.py`](../../../back-end/api/placements.py), with `IncompleteApplicationsError.message()` and the applicants; a run outside its phase, a vendor the market already holds, a taken seat and a change that would land over another change to the tables answer 409, and a placement the plan has no seat for 400, each as raised ([placements](../modules/placements.md)).
A builtin `PermissionError` is no longer answered 403 with its text: nothing of ours raises one, so it is a bug, and it answers 500.

So do the vendor export's download and its preview: neither catches anything, and a filter value it cannot read or a column the market does not offer answers its `ExportInvalid`, 400, while a filter key it does not know is ignored.

So do the applicant, review, import and door routes: every public route an applicant or a vendor at the door calls, the application list, the review's verdicts, selections and their undo, next card, claims and follow-up owners, updating a vendor's info, the [CSV start](../modules/csv-proposal-and-start.md)'s proposal and confirm, the [application import](../modules/csv-import.md)'s inspect, preview and import, Publish results, and [attendance and the door](../modules/attendance-and-door.md).
None catches anything, and each keeps its literal answers: the applicant's expired session 401, a gated market's answer as absent (decided in the applicants API, unchanged), `Invalid status: <status>`, `csvContent is required`, the import's phase 409 with its `phase`, and the permission 403s the routes ask themselves; a review write once the review is closed answers 403 with why it closed and what to do instead ([what a closed review says](../../business/rules/verdicts-settle-on-entering-assignment.md#what-a-closed-review-says)).
A status a request names is read by `_named_status`, which names none for anything but a status's own string, as `_named_phase` does for a phase.
A follow-up owner the market does not offer answers its `BadRequestError`, 400; `confirm` in [`back-end/csv_start.py`](../../../back-end/csv_start.py) lets a `ConfirmRefused`, a locked form and a refused plan or form reach the handler as raised; a door write on a market that does not exist, is archived or cannot be read answers what the change loader raises.
Two lines these routes reach are kept free of an applicant's address for the 500 log: an application that keeps losing its upsert race (`find_or_create_application` in [`back-end/api/applications.py`](../../../back-end/api/applications.py)) is named by its market, and an application document that cannot be parsed (`list_market_applications` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py)) logs `parse_failure_detail`, never its answers.

No route in `app.py` answers what it caught: `healthz` alone catches, to answer `{"status": "unavailable"}`, 503, when the database does not answer, and the floorplan blueprints keep their own catches, which answer the generic 500 and log, until they are rewritten.

**A body that is not an object is refused in words.**
Every route in `app.py` that reads its body in the view reads it with `json_object` in [`back-end/utils/request_body.py`](../../../back-end/utils/request_body.py), and no view there reads `request` for a body another way.
A body that is not JSON is no body, rather than Werkzeug's HTML 415.
JSON that is not an object (a list, a string, a number, a boolean) raises a `BadRequestError`, `A JSON object is required`, 400, rather than the generic 500 of an `AttributeError` or a model's own words.
A required body that is missing or an empty object raises `No data provided`, 400; an optional one reads none as `{}`, and the route answers what is then missing in its own words (`csvContent is required`, a swap that names no vendors).
The body is required for the organization and market role writes, creating a market, the plan, the application form, a phase move, adding a vendor, writing a placement, an applicant's save, a verdict on one application and the CSV start's confirm; every other body route reads it as optional.
Two groups of routes have a body another module reads: the account routes, whose views hand `request` to [`back-end/api/users.py`](../../../back-end/api/users.py), not yet on this reader, and the applicant sign-in's code request and verify, read in [`back-end/api/applicant_auth.py`](../../../back-end/api/applicant_auth.py) for answers that say nothing of who applied: one for every code request, and for a code that cannot pass, one "spent" body beside a wrong try's "retry".
A value of the wrong type inside is read as a missing one ([a request value is a string](a-request-value-is-a-string.md)): a market name that is not a string is no name, review highlights that are not a list of strings are no keys, and a ticked review entry that is not an object names no application and is skipped as not one here.

The operator's seeder (`main` in [`back-end/seed_test_markets.py`](../../../back-end/seed_test_markets.py)) catches only its own refusals and client errors, saying each as `Not done: <its copy>`, and lets anything else raise with its traceback, which is what the operator needs for a bug.
Before that it refuses a database the environment does not name, or the primary checkout's local MongoDB, exiting with the refusal's words and no traceback (`require_named_database` in [`back-end/db_config.py`](../../../back-end/db_config.py)).

## How it is enforced

- [`test_an_exception_never_reaches_a_client.py`](../../../back-end/tests/test_an_exception_never_reaches_a_client.py) calls the real routes through the test client.
  A client error answers its status and body, a structured `body()` is answered as given, and an injected exception carrying a secret-shaped string answers exactly the generic 500 on each assignment read, with the string nowhere in the response and one log record holding the traceback and the market id but no email.
  A vendor-note write that fails logs neither the vendor's address, the path nor the body.
  Each organization and market role route answers a refusal with its status and copy, an organization or market that does not exist with 404, and an injected exception with exactly the generic 500, logged with the organization or market id and no address.
  So does each market setup route, and creating a market answers its one-owner invariant with the generic 500 too, logged with its traceback.
  So does each application form and phase route, and a phase that is not a name is unknown.
  So does each assignment and placement route; a run over incomplete answers names them, and a body that is not an object is refused in words.
  So does each applicant, review, import and door route; on a public route the failure is logged with the market's slug and never the vendor's address in the path, an applicant whose session expired is asked to sign in again, and an application that cannot be parsed is logged without its answers.
  A stored market that cannot be read refuses the vendor notes, whose route catches no `ValueError`, with `Invalid market data`, 400.
  `TestABodyThatIsNotAnObject` reads `app.url_map` and classifies every POST, PUT or DELETE route whose view is defined in `app.py` as one of a required body or an optional body read in the view, no body, or a body another module reads, each route in exactly one of those lists.
  Each route that takes no body runs to its success answer, and each whose body another module reads has that module's function stubbed out, while every way to read the body (`get_json` and `request.json`, `get_data` and `request.data`, the form parser) records the read and raises: none is read in the view.
  Each route the required and optional lists hold answers JSON that is not an object `A JSON object is required`; each required one answers no body, `null`, `{}`, a body that is not JSON and broken JSON `No data provided`; each optional one reads no body as empty; and a market name, review highlights or a ticked entry of the wrong type is read as a missing one.
  No client error, nor any refusal built on one, is a `ValueError` or a `PermissionError`, and the seeder says each as `Not done` while a library's `ValueError` escapes it.
  Each refusal of the modules above, raised for real where a route reaches it and spied on as it passes, is answered with exactly its own status and `body()`.
  Each refused parse above answers its own copy with nothing of the parser's message or the input in it, and its log holds the field but not the input; so does a stored organization that cannot be read.
  An unknown URL, a wrong method and a signed-out call still answer Flask's 404, 405 and Flask-Login's 401.
- CodeQL's `py/stack-trace-exposure` is the automated backstop: it is in the default suite GitHub's default setup runs on every pull request and weekly on `dev` ([CI and the gate](../testing/ci-and-the-gate.md#codeql)), and it flags a route that catches an exception and answers its text.
  It stops following a flow at a `raise`, so the client copy rule and these route tests hold the rest: a library's message carried into a client error's copy is invisible to it.

What breaks it: a route `except` that answers what it caught, a library's message in client copy, or a 500 body with more than `error` in it.

## What the organizer reads

The client half: the generic 500 body is for the log and for support, and never reaches a screen (E38/F11/S01).
Each kind of failure reads one way, chosen in one place, `getApiErrorMessage(err, fallback)` in [`front-end/src/utils/api.ts`](../../../front-end/src/utils/api.ts), which the organizer's screens call with a fallback of their own; a line that says something narrower, such as a refresh that keeps the list it had, words itself.

| The failure | What the screen says |
| --- | --- |
| No answer at all (no connection, a dropped request, a timeout) | "You seem to be offline. Check the connection and try again." |
| A 500, whatever its body | "Something went wrong on our side. Try again in a moment." |
| Another 5xx with no sentence of the back end's (a proxy's 502 or 504) | The same |
| Another 5xx with a sentence (Discord's `DiscordNotSetUp` 503 and `DiscordUnavailable` 502) | That sentence |
| A 401 with no sentence (Flask-Login's) | "Your session has ended. Sign in again." |
| Any other refusal, a 401 with a sentence included (the applicant's code check) | Its `error`, else its `message` |
| A refusal with neither, or a failure that is not a request's | The screen's fallback |

A fallback says what did not happen ("The verdict was not saved.", "The applications could not be loaded."), never "Failed to ...".
A download asks for a blob, so `downloadErrorMessage` in [`front-end/src/utils/download.ts`](../../../front-end/src/utils/download.ts) reads a refusal's sentence out of it and then answers the same way, through `answerMessage`.
The account pages (sign in, register, password reset, email verification) still word their own failures.

**A screen whose own read failed offers Try again**: [`ReadFailed.vue`](../../../front-end/src/components/ReadFailed.vue) shows the message with a button that runs the read once more, its test ids `<name>-read-failed` and `<name>-retry`.
Applications (both views, `applications`), Markets (`markets`), Organizations (`organizations`), Assignments (`tables`) and Attendance (`attendance`) use it; a market that could not be loaded at all is [the market frame](../modules/market-frame.md)'s `MarketArrival` to say, with its own Try again.
Its button is a `.btn`, so it is 44px on a phone.

**A session that ends mid-work** answers 401 to the next request, and one response interceptor on `api`, installed from `main.ts` by `installSessionEnded` in [`front-end/src/utils/sessionEnded.ts`](../../../front-end/src/utils/sessionEnded.ts), takes the organizer to sign in again.
It clears `localStorage` and the market store, as signing out does, and goes to `/login?next=<the page's full path>&ended=1`, where the sign-in page says "Your session has ended. Sign in again.".
It leaves alone a 401 from signing in, from the shell's session probe (`/check-session`, which `App.vue` answers itself, through `keepsTheSession`) and from any `/public/...` request, which carries no organizer session (a vendor signs in on their own vendor page, where they also check in), and any 401 while the page is public.
The request still fails as it would have, so the screen's own catch runs too.
`aSessionThatEnded.test.ts` holds each of those exemptions, the sign-in endpoints' included, though no screen sends them through `api` today.

**The shell's session probe at load ends a session only on an answer that says so.**
No answer, or a 5xx, says nothing of the session, so `keepsTheSession` keeps the stored user and the page, whose own read says what went wrong; any other failure goes to sign in carrying the page, with `ended=1` on a 401.
It used to sign the organizer out on any failure, so a dropped connection at load sent them to sign in, saying nothing.

**A link opened signed out keeps its place**: `requireSignIn` in [`front-end/src/router/index.ts`](../../../front-end/src/router/index.ts) sends it to `/login?next=<its full path>`, and both ways of signing in, by password and by code, continue to `next`, else to `/dashboard`; so does a signed-in visit to `/login?next=`.
`next` is honoured only when `safeNext` in [`front-end/src/utils/signInNext.ts`](../../../front-end/src/utils/signInNext.ts) finds it a path of this app: one leading `/` (not `//`, not `/\`), no backslash or control character, not the sign-in page itself in any spelling the router matches to it (`/Login`, `/login/`: the router ignores case and one trailing slash), and resolving to this origin; anything else is dropped for `/dashboard`.
`requireSignIn` tells the sign-in page by its route's name, not its path, for the same reason.

**A page whose code could not be fetched says so**: a screen's code is fetched the first time it is opened, so with no connection, or once a deploy has replaced the files, the navigation fails and the click did nothing.
`watchPageFailed` in [`front-end/src/utils/pageFailed.ts`](../../../front-end/src/utils/pageFailed.ts), installed from `main.ts` before the router, catches any failed navigation, and `App.vue` shows a `ReadFailed` strip (`page-read-failed`, `page-retry`) under the banner: the offline line when the browser is offline, else "The page could not be opened. Try again to load it.".
Try again loads the page afresh, which fetches the files a deploy put in their place, and only where `safeNext` says it is a path of this app, as sign-in's `next` is; any other address, `//host` say, reloads the page the organizer is on instead.
The strip goes once a page opens.

[`a-failure-says-what-to-do.spec.ts`](../../../front-end/e2e/a-failure-says-what-to-do.spec.ts) holds it end to end: each screen's read and the verdict, selection, plan save, phase move and Manage organization writes under the generic 500 and with no connection, Try again on a route that fails once, a session ended mid-review returning to the same address, a signed-out link by password and by code, a `next` of another host, a page whose code could not be fetched (offline and after a deploy), the session probe failing without ending the session, and a request with no cookie answering 401.
`api.test.ts` and `signInNext.test.ts` hold each kind and each hostile shape, `aPageThatCouldNotOpen.test.ts` the strip's wording.
