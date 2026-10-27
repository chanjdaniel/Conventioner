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
verified: 2026-10-27
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

## The types

[`back-end/client_errors.py`](../../../back-end/client_errors.py) holds them.

- `ClientError` is the base: constructed with the client copy, it holds it as `message`, has a class-level `status`, and answers `body()`, by default `{"error": message}`.
- `BadRequestError` 400, `ForbiddenError` 403, `NotFoundError` 404 and `ConflictError` 409 are the statuses a refusal raises.
  The `Error` suffix keeps them apart from Werkzeug's `BadRequest`, `Forbidden`, `NotFound` and `Conflict`.
- A refusal with more to say than a sentence overrides `body()`, its keys camelCased as the front end reads them.
- While routes still catch builtins to answer them, `BadRequestError` and `NotFoundError` also subclass `ValueError` and `ForbiddenError` also subclasses `PermissionError`, so an `except ValueError` or `except PermissionError` that has not been removed yet still answers as it did.

A raise site decides a refusal and raises the type for it; the route writes no `try`/`except` to answer it.
An internal invariant (a guard's own consistency check, a model validator) stays a builtin: escaping is a bug, and it answers 500.

## The two handlers

`install_error_answers(app)`, called once in [`back-end/app.py`](../../../back-end/app.py) right after the public endpoint defenses are configured, registers both on the app, so every blueprint is covered too.

- A `ClientError` is answered `jsonify(error.body())` with `error.status`, and is not logged: it is an answer, not a failure.
- Any other `Exception` is logged once with `logger.exception` and answered `{"error": "Internal server error"}`, 500.
  A Werkzeug `HTTPException` is an `Exception` too, so this handler returns one unchanged: Flask's 404 and 405, an `abort()`, the 413 of an oversized upload and Flask-Login's 401 answer as Flask writes them.
- The handler is on `Exception`, not `InternalServerError`, because under `TESTING` or debug Flask propagates an unhandled exception instead of calling a 500 handler; registered on `Exception`, the suite exercises it the way production runs it.

**The log line** names the method, `request.endpoint`, and the view argument `market_id`, `market_slug` or `org_id` when the route has one, with the traceback.
It never names the path, the query string, the body or the view argument `vendor_email`, since each can hold an applicant's address.

The assignment reads (`get_assigned_market`, `get_assignment_statistics`, `get_assignment_csv` and `get_market_tables`, in `app.py` and in `api/markets.py`) answer this way: an `IncompleteApplicationsError` is still their 400 with its own message, and anything else reaches the handler.

## How it is enforced

- [`test_an_exception_never_reaches_a_client.py`](../../../back-end/tests/test_an_exception_never_reaches_a_client.py) calls the real routes through the test client.
  A client error answers its status and body, a structured `body()` is answered as given, and an injected exception carrying a secret-shaped string answers exactly the generic 500 on each assignment read, with the string nowhere in the response and one log record holding the traceback and the market id but no email.
  A vendor-note write that fails logs neither the vendor's address, the path nor the body.
  An unknown URL, a wrong method and a signed-out call still answer Flask's 404, 405 and Flask-Login's 401.
- CodeQL's `py/stack-trace-exposure`, run on every pull request, flags a route that catches an exception and answers its text.
  It stops following a flow at a `raise`, so the client copy rule and these tests keep the guarantee where the tool cannot see.

What breaks it: a route `except` that answers what it caught, a library's message in client copy, or a 500 body with more than `error` in it.
