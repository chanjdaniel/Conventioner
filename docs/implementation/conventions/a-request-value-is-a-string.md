---
layer: implementation
kind: convention
describes:
  - back-end/utils/request_body.py
  - back-end/tests/test_a_request_value_is_a_string.py
verified: 2026-10-27
sources:
  - T66
---

# A request value is a string before it reaches a query

**A value read from a request body reaches a MongoDB filter only as a string, read with `string_field()`** ([`back-end/utils/request_body.py`](../../../back-end/utils/request_body.py)).
A JSON body may hold an object, a list, a number or a boolean wherever a string belongs, and Flask hands each through as the Python value it is.
PyMongo puts a value into the filter as it is given, and the database reads an object there as query syntax.
It is the per-request half of the [security invariants](security-invariants.md), which keep the process itself from booting unsafe.

## The one spelling

`string_field(body, key)` returns the body's `key` when it is a string, and None otherwise: for a missing key, for a value of any other type, and for a body that is not a JSON object at all.
It never raises, so each handler keeps its own words and status, and answers None as it answers a missing value:

- the account endpoints (`back-end/api/users.py`) answer their "required" 400, for every address, password, token and sign-in code they read;
- the applicant sign-in (`back-end/api/applicant_auth.py`) answers its one same 200 for a code request and its one same 401 for a verify, so a wrong type tells a caller nothing a missing value does not;
- the public check-in and its undo (`back-end/app.py`) answer 400 for an address or a date;
- creating an organization (`back-end/app.py`) answers 400 for a name that is not a string or is blank;
- saving a floorplan to a market, placing its tables, and analysing, calibrating and exporting a floorplan image (`back-end/api/floorplans_save.py`, `back-end/api/floorplans_placement.py`, `back-end/api/floorplans_analysis.py`, `back-end/api/floorplans_calibrate.py`, `back-end/api/floorplans_export.py`) answer 400 for the id they name.

An address read this way still goes through `normalized_email()` ([users, and the one spelling of an address](../data/users-and-email.md)), which spells it as stored.

## What is not a body string

- A path parameter and a query-string value are strings already: Flask gives nothing else.
- A value that is a structure by design (an application form, a plan, a floorplan) is written, not looked up by, and is checked by the module that owns it.
- The organizer handlers in `back-end/app.py` that coerce with `str()` (a placement, a swap, the organizer's check-in) are safe, since a string is never query syntax, but they turn a wrong type into text nobody sent; new code reads with `string_field()` instead.

## How it is enforced

[`test_a_request_value_is_a_string.py`](../../../back-end/tests/test_a_request_value_is_a_string.py) sends each of those endpoints an object, a list, a number and a boolean in place of each string it reads, and a list whose text holds an address where an address belongs.
Each is refused, and nothing changes: no password, no verified flag, no counted try, no check-in, no organization.
Its users collection matches as the database does, an operator included, so a lookup that let a non-string through would find what the database finds.
A reset, a verification and a sign-in with the right string still work.

What breaks it: `data.get(key)` handed to a filter, or to anything that builds one, without `string_field()`.
