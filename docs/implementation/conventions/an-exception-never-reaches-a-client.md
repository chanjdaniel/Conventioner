---
layer: implementation
kind: convention
describes:
  - back-end/client_errors.py
  - back-end/tests/test_an_exception_never_reaches_a_client.py
  - back-end/app.py#get_assigned_market
  - back-end/app.py#get_assignment_statistics
  - back-end/app.py#get_assignment_csv
  - back-end/app.py#get_market_tables
  - back-end/app.py#get_organizations
  - back-end/app.py#create_organization
  - back-end/app.py#get_organization
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
  - back-end/app.py#application_form_amendment_availability
  - back-end/app.py#amend_application_form
  - back-end/app.py#resume_application_form_amendment
  - back-end/app.py#save_application_form
  - back-end/app.py#get_application_form
  - back-end/app.py#_named_phase
  - back-end/app.py#transition_market
  - back-end/app.py#pending_offers_count
  - back-end/app.py#run_assignment
  - back-end/app.py#add_vendor
  - back-end/app.py#write_placement
  - back-end/app.py#get_placement_history
  - back-end/app.py#swap_placements
  - back-end/app.py#remove_placement
  - back-end/api/markets.py#_load_market_for
  - back-end/api/markets.py#parsed_application_form
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#_log_unreadable_market
  - back-end/api/markets.py#_load_organization_context
  - back-end/application_write.py#_field_answer
  - back-end/csv_import.py#parse_csv
verified: 2026-10-28
sources:
  - T74
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
  The plan is parsed in `prepared_plan`, the application form in `parsed_application_form` and a new market's body in `create_owned_market` (`Invalid market: ...`), all in [`back-end/api/markets.py`](../../../back-end/api/markets.py); the form write and the [form amendment](../modules/form-amendment.md) share the form's parse.
  It names each failing field by its dotted location and pydantic's short `msg`, and never the error's `input`, `ctx`, `url` or `type`.
  Its log line is `parse_failure_detail(error)`: each location and pydantic's error type.
  The body is parsed with `model_validate`, so a body that is not an object is refused the same way rather than raising a `TypeError`.
- A stored market the model refuses answers `Invalid market data`, 400, and `_log_unreadable_market` logs the same detail with the market's id, for `_load_market_for` and `load_market_context` alike.
  A stored organization the model refuses is logged the same way with its id by `_load_organization_context`, and its market is still served, granting nothing through the organization.
- A number question answered with text ([`back-end/application_write.py`](../../../back-end/application_write.py)) answers `'<label>' must be a number.`, 422, and logs nothing: why the conversion failed is the answer itself, which is the applicant's and never a log's.
- A CSV Python's reader refuses (`parse_csv` in [`back-end/csv_import.py`](../../../back-end/csv_import.py)): the import's endpoints and the [CSV start](../modules/csv-proposal-and-start.md)'s proposal answer `That file could not be read as CSV.`, 400, and the CSV start's confirm answers it as a `ConfirmRefused`, 409.
  The reader's message is logged, which names a limit or a character, never a cell.

## The types

[`back-end/client_errors.py`](../../../back-end/client_errors.py) holds them.

- `ClientError` is the base: constructed with the client copy, it holds it as `message`, has a class-level `status`, and answers `body()`, by default `{"error": message}`.
- `BadRequestError` 400, `ForbiddenError` 403, `NotFoundError` 404 and `ConflictError` 409 are the statuses a refusal raises.
  The `Error` suffix keeps them apart from Werkzeug's `BadRequest`, `Forbidden`, `NotFound` and `Conflict`.
- A refusal with more to say than a sentence overrides `body()`, its keys camelCased as the front end reads them.
- While routes still catch builtins to answer them, `BadRequestError` and `NotFoundError` also subclass `ValueError` and `ForbiddenError` also subclasses `PermissionError`, so an `except ValueError` or `except PermissionError` that has not been removed yet still answers as it did.

A raise site decides a refusal and raises the type for it; the route writes no `try`/`except` to answer it.
An internal invariant (a guard's own consistency check, a model validator) stays a builtin: escaping is a bug, and it answers 500.

**The markets API's refusals** ([`back-end/api/markets.py`](../../../back-end/api/markets.py)) are client errors.
Every refusal it words raises `BadRequestError` or `ForbiddenError`, and a market the URL names that does not exist raises `MarketNotFoundError`, a `NotFoundError`, in the role writes and the deletion as everywhere else.
Its own types are client errors too: `MarketNotFoundError` 404, `MarketArchivedError` 403 ([an archived market is read-only](../../business/rules/an-archived-market-is-read-only.md)), `MoveUnavailable` 400, `ApplicationFormLockedError` 409, and `PhaseChangedUnderRequest` 409, whose `body()` is the transition's `phase_changed` payload ([the guards](../modules/guards.md)).
`create_market`'s "exactly one owner" stays a `ValueError`: `create_owned_market` sets the one owner, so it escaping is a bug, and it answers 500.

**Every other module's refusals** are client errors too, each with the status its routes answer today.

- [`back-end/api/organizations.py`](../../../back-end/api/organizations.py) raises `BadRequestError` and `ForbiddenError`, and `NotFoundError` for "Organization not found", which every organization route answers 404; `OrganizationHasLiveMarkets` is a 409 whose `body()` names the blocking markets ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md)).
- [Placements](../modules/placements.md): `PlacementError` is a `BadRequestError`, `SeatTakenError` one with status 409, and `AssignPhaseError` a `ConflictError`.
- `AddVendorInvalid` is a `BadRequestError` and `AddVendorRefused` a `ConflictError` ([adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).
- The [form amendment](../modules/form-amendment.md)'s `AmendmentUnavailable`, `AmendmentRefused` and `AmendmentStalled` are `ConflictError`s; the last two answer their blockers and their resume offer from `body()`.
- `ConfirmRefused`, a [CSV start](../modules/csv-proposal-and-start.md) the request cannot write, is a `ConflictError`.
- `Rulebook.prepared` refuses a rule with `BadRequestError` ([automatic rejections](../../business/rules/automatic-rejections.md)), and so does the [floorplan placement](../modules/floorplan-placement.md) for walls that enclose no room, though its route's own catch-all still answers that 500 until the floorplan routes stop catching.

A `ConflictError` subclasses no builtin, so `AssignPhaseError`, `AddVendorRefused` and `ConfirmRefused` also keep the `ValueError` they were, until no route or caller catches one to answer it.
What stays a builtin is a bug if it escapes: the room with neither walls nor a size (the route refuses that first), `normalized_submitted_at`'s refusal (every caller catches it), and the applications API's verdict without a giver, its index error and its upsert that keeps losing a race.

## The two handlers

`install_error_answers(app)`, called once in [`back-end/app.py`](../../../back-end/app.py) right after the public endpoint defenses are configured, registers both on the app, so every blueprint is covered too.

- A `ClientError` is answered `jsonify(error.body())` with `error.status`, and is not logged: it is an answer, not a failure.
- Any other `Exception` is logged once with `logger.exception` and answered `{"error": "Internal server error"}`, 500.
  A Werkzeug `HTTPException` is an `Exception` too, so this handler returns one unchanged: Flask's 404 and 405, an `abort()`, the 413 of an oversized upload and Flask-Login's 401 answer as Flask writes them.
- The handler is on `Exception`, not `InternalServerError`, because under `TESTING` or debug Flask propagates an unhandled exception instead of calling a 500 handler; registered on `Exception`, the suite exercises it the way production runs it.

**The log line** names the method, `request.endpoint`, and the view argument `market_id`, `market_slug` or `org_id` when the route has one, with the traceback.
It never names the path, the query string, the body or the view argument `vendor_email`, since each can hold an applicant's address.

The assignment reads (`get_assigned_market`, `get_assignment_statistics`, `get_assignment_csv` and `get_market_tables`, in `app.py` and in `api/markets.py`) answer this way: an `IncompleteApplicationsError` is still their 400 with its own message, and anything else reaches the handler.

So do the organization routes (the list, create, read, update, deletion preview, delete, and adding, removing and handing on its people) and the market role routes (add, remove, update): none catches anything, each keeps the literal answers it decides itself (`No data provided`, `Organization name required`, `Invalid role: <role>`), and every refusal of `api/organizations.py` and the markets API's role writes reaches the handler.
An organization or a market that does not exist answers 404 on each of them, and a role or an address that is not a string is refused as a missing one ([a request value is a string](a-request-value-is-a-string.md)).

So do the market setup routes: reading a market and listing a user's markets, creating, renaming, planning and deleting one, and its vendor notes, review highlights and rejection rules.
None catches anything, and each keeps its literal answers (`No data provided`, `A JSON object is required`, `note is required`, `keys is required`, `Market not found or access denied`).
Creating a market answers a body the model refuses with its field-named 400, a refusal the markets API decides (no organization, an address another market holds) with that refusal's status, and anything else, its one-owner invariant included, with the generic 500.
Deleting a market that does not exist answers 404.

So do the application form, amendment and phase routes: reading and saving the form, the amendment's availability, the amendment and its resume, the phase move and the pending-offers count.
None catches anything, and each keeps its literal answers (`No data provided`, `applicationForm is required`, `to_phase is required`, `Unknown phase: '<phase>'. Valid phases: ...`, `Market not found`, `Invalid market data`, and the permission 403s the routes ask themselves).
A form saved in a phase that has fixed it answers its lock reason, 409; the amendment answers its blockers and a stall its resume offer from `body()`; the phase move answers its own guards' 409 and a market moved under it with `PhaseChangedUnderRequest.body()`.
A stall is the one refusal logged: `_walk` in [`back-end/api/form_amendment.py`](../../../back-end/api/form_amendment.py) logs the market's id and where it stopped before it raises, because a market left between phases is worth a line for whoever is on call, and the handler logs no client error.

So do the assignment and placement routes: running the assignment, adding a vendor who never applied, writing, swapping and freeing a placement, and reading the placement history.
None catches anything, and each keeps its literal answers (`No data provided`, `A JSON object is required`).
A run over incomplete answers is still `run_assignment`'s 400 in [`back-end/api/placements.py`](../../../back-end/api/placements.py), with `IncompleteApplicationsError.message()` and the applicants; a run outside its phase, a vendor the market already holds and a taken seat answer 409, and a placement the plan has no seat for 400, each as raised ([placements](../modules/placements.md)).
A builtin `PermissionError` is no longer answered 403 with its text: nothing of ours raises one, so it is a bug, and it answers 500.

Every other route keeps its `except` ladder, and answers what it caught, until the later changes migrate it.

## How it is enforced

- [`test_an_exception_never_reaches_a_client.py`](../../../back-end/tests/test_an_exception_never_reaches_a_client.py) calls the real routes through the test client.
  A client error answers its status and body, a structured `body()` is answered as given, and an injected exception carrying a secret-shaped string answers exactly the generic 500 on each assignment read, with the string nowhere in the response and one log record holding the traceback and the market id but no email.
  A vendor-note write that fails logs neither the vendor's address, the path nor the body.
  Each organization and market role route answers a refusal with its status and copy, an organization or market that does not exist with 404, and an injected exception with exactly the generic 500, logged with the organization or market id and no address.
  So does each market setup route, and creating a market answers its one-owner invariant with the generic 500 too, logged with its traceback.
  So does each application form, amendment and phase route; a resume on a market that cannot be read answers `Invalid market data`, 400, a stall is logged with its market id and answered with its resume offer, and a phase that is not a name is unknown.
  So does each assignment and placement route; a run over incomplete answers names them, and a body that is not an object is refused in words.
  A stored market that cannot be read refuses the vendor notes, whose route catches no `ValueError`, with `Invalid market data`, 400.
  Each refusal of the modules above, raised for real where a route reaches it and spied on as it passes, is answered with exactly its own status and `body()`.
  Each refused parse above answers its own copy with nothing of the parser's message or the input in it, and its log holds the field but not the input; so does a stored organization that cannot be read.
  An unknown URL, a wrong method and a signed-out call still answer Flask's 404, 405 and Flask-Login's 401.
- CodeQL's `py/stack-trace-exposure` is the automated backstop: it is in the default suite GitHub's default setup runs on every pull request and weekly on `dev` ([CI and the gate](../testing/ci-and-the-gate.md#codeql)), and it flags a route that catches an exception and answers its text.
  It stops following a flow at a `raise`, so the client copy rule and these route tests hold the rest: a library's message carried into a client error's copy is invisible to it.

What breaks it: a route `except` that answers what it caught, a library's message in client copy, or a 500 body with more than `error` in it.
