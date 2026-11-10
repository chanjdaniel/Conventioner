---
layer: implementation
kind: testing
describes:
  - back-end/tests/real_mongo/
  - back-end/tests/test_the_real_mongo_harness.py
  - back-end/tests/mongo_cases.py
  - back-end/tests/test_the_shared_matcher.py
  - back-end/tests/test_the_shared_applications_fake.py
  - back-end/tests/conftest.py#mongo_matches
  - back-end/tests/conftest.py#mongo_update
  - back-end/tests/conftest.py#mongo_project
  - back-end/tests/conftest.py#FakeApplicationsCollection
  - back-end/db_config.py#uri_targets
verified: 2026-11-10
sources:
  - T244
  - T274
---

# The real-MongoDB suite

[`back-end/tests/real_mongo/`](../../../back-end/tests/real_mongo/) holds the back end's pytest tests that run against a real MongoDB server, where every other back-end test runs on in-memory fakes.
The plain `python -m pytest tests/` run collects it, so CI's `backend` job and the gate need no second command.
Its harness, [`harness.py`](../../../back-end/tests/real_mongo/harness.py), is tested without a server in the ordinary suite, by [`test_the_real_mongo_harness.py`](../../../back-end/tests/test_the_real_mongo_harness.py).

## Which server

The server is `REAL_MONGODB_URI`, a full connection string.

- Unset, every test in the package skips with "REAL_MONGODB_URI is not set: the real-MongoDB tests run in CI's backend job".
- Unset while `REAL_MONGODB_REQUIRED` is `true` (or `1`), every test fails with "REAL_MONGODB_REQUIRED is set but REAL_MONGODB_URI is not".
  CI sets the flag, so CI can never skip the suite in silence; it is a flag of its own, not `CI`, because the gate's run may set `CI` and must stay hermetic.
- A `mongodb+srv://` URI, a host that is not loopback, or loopback port 27017 (the primary checkout's stack) is refused before any client is made, and every test fails naming why.
  The hosts are read by `uri_targets` in [`back-end/db_config.py`](../../../back-end/db_config.py), the parser `require_named_database` reads too, so one parser decides what the primary stack is.
  A refusal names a host and port at most, never the URI, which may carry a password.

## In CI, at the gate and locally

- **CI**: the `backend` job runs a `mongo:8.0` service, its port 27017 published on the runner as 27117, with a `mongosh` ping as its health check and no credentials, and sets `REAL_MONGODB_URI=mongodb://127.0.0.1:27117/?serverSelectionTimeoutMS=5000` and `REAL_MONGODB_REQUIRED=true` for the job ([CI and the gate](ci-and-the-gate.md#ci)).
  The job keeps its name, so the required check is unchanged.
- **The gate**: `scripts/nm-test.sh` runs the ordinary suite with the variable unset, so the package skips there and runs in CI, as Playwright does.
- **Locally**: run it against a worktree stack's MongoDB, which listens on `127.0.0.1:$TH_MONGO_PORT` with the stack's fixed development credentials.
  Start the stack with `scripts/th-compose.sh up -d` (a team worker's with `team-stack up`), read the port from `scripts/th-compose.sh ports`, then, from `back-end/`:

  ```bash
  REAL_MONGODB_URI="mongodb://admin:secret@127.0.0.1:<port>/?authSource=admin" python -m pytest tests/real_mongo
  ```

  Each test makes and drops a database of its own, so the stack's `conventioner` database is never read or written.

## Each test's database

- `real_db` is a database named `real_mongo_` and 12 hex characters, made for the test and dropped at its teardown whether it passed or failed (`harness.fresh_database`).
  Only a database the harness made is ever written or dropped; one `MongoClient`, `real_mongo_client`, serves the session and is closed at its end.
- Every loaded back-end module (a file under `back-end/`, not under `tests/`, `migrations/` or an installed package) has each attribute that is a PyMongo `Database`, a `Collection` or a GridFS store bound to the test's database, and each that is `db_config.get_database` replaced by a function answering it (`harness.bind_handles`).
  Handles are found by their type, never by a list of names, so a module added later is bound without anyone remembering it.
  The fakes [`tests/conftest.py`](../../../back-end/tests/conftest.py) installs at import are recorded in its `IMPORT_TIME_STAND_INS` with the value each replaced, and binding puts that value back first.
  Binding fails the test when a handle on another client, or an object of a class a test file defines, is still in a back-end module.
  Every binding is a `monkeypatch.setattr`, so each attribute is its import-time value again after the test.
- The package's conftest names the three suite-wide autouse fakes again (`applications`, `market_records`, `sign_in_attempts`), so pytest resolves them to the nearer definitions, which hand back the bound real collections.
  Since every test uses those three, every test in the package runs on its own bound database.

## The fixtures

| Fixture                         | Gives                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `real_db`                       | the test's own database, every handle bound to it                                                                                                                                                                                                                                                                                                                                       |
| `boot_indexes`                  | every index the boot builds, built on the test's database by the `ensure_*` functions [`app.py`](../../../back-end/app.py)'s boot calls, listed once in `harness.BOOT_INDEX_BUILDS`; a hermetic test reads `app.py` and fails when its boot calls one the list lacks. Opt-in: without it the lazy index builds do nothing, since the boot under the suite already ran them on the fakes |
| `signed_in(email)`              | a Flask test client signed in through `POST /login`, the real route, as a verified account `create_account.create_account` made; it carries `account_id` and `email`. Addresses are fixture addresses (`@example.com`)                                                                                                                                                                  |
| `market_in(phase, **overrides)` | `stored_market(...)` from `tests/conftest.py` with `COMPLETE_PLAN`, the first signed-in account as owner, and a fresh `id` and name, inserted and returned                                                                                                                                                                                                                              |
| `interleave(target, then)`      | wraps the function `target` names (`"module.attribute"`) so that on its first call, after it returns, `then()` runs once and then the result is handed back: the one seam for "a second request between this write's read and its write"                                                                                                                                                |
| `race(n, fn)`                   | `fn(i)` on `n` threads released together by a barrier, each result or the exception it raised returned in order; a thread that makes a request makes its own test client                                                                                                                                                                                                                |

`interleave` replaces one attribute, so name the one the reader calls through: a module that imported the function by name holds its own reference, and the wrap does not reach it.

## The differential cases

[`back-end/tests/mongo_cases.py`](../../../back-end/tests/mongo_cases.py) holds the cases that check the shared fakes of [`tests/conftest.py`](../../../back-end/tests/conftest.py) against the server: each a document, an operation and the answer MongoDB 8.0 gives, written in the table.
Each table is read twice.
[`test_the_shared_matcher.py`](../../../back-end/tests/test_the_shared_matcher.py) (the filters) and [`test_the_shared_applications_fake.py`](../../../back-end/tests/test_the_shared_applications_fake.py) (the updates, reads and projections) run every case through the fakes on every run, without a server, so the gate checks the fakes; [`real_mongo/test_the_filter_cases_on_the_server.py`](../../../back-end/tests/real_mongo/test_the_filter_cases_on_the_server.py) and [`real_mongo/test_the_collection_cases_on_the_server.py`](../../../back-end/tests/real_mongo/test_the_collection_cases_on_the_server.py) run every case through the server, so CI checks the tables.
A case the fakes do not model names what they refuse (`fake_refuses`); the hermetic test asserts that refusal and the server test still asserts the server's answer.
Documents are compared with `as_stored`, which tells field order and number types apart as the server does, except for the one document whose field order the server does not keep steady: the one an upsert makes, whose filter terms it lays out in its query planner's order (`update_one` and `find_one_and_update` lay out `{"a.b": 1, "a.c": 2}` in two different orders).

| Table              | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILTER_CASES`     | `mongo_matches`, the filter every shared fake finds documents by: equality by BSON type (`true` is not `1`, `1` is `1.0`), null against missing, a value, `$in`, `$ne` and `$nin` against a list field, a whole sub-document in and out of field order, dotted paths through sub-documents and through lists (any element, a numeric index, and what reads as missing there), `$exists`, the four ranges (across two types, on dates, on strings, over list elements), `$size`, `$type: "object"`, `$and`, `$or` and `$nor`, the shapes production's filters send, and what the matcher refuses: `$regex`, `$elemMatch`, `$not`, any other `$type`, `$all`, `$mod`, `$expr`, an unknown operator and a malformed condition                                          |
| `UPDATE_CASES`     | `mongo_update`, through `FakeApplicationsCollection`'s `update_one` and `find_one_and_update`: the document after and the matched and modified counts for `$set`, `$unset`, `$inc`, `$push` and `$addToSet` (with `$each`), `$pull` (a value, or an equality condition on sub-document elements) and `$setOnInsert`, on dotted paths and list indexes; a value set to what it holds modifying nothing, new fields landing in the order of their names, the shapes production's writes send, the document an upsert makes, the updates the server refuses, and what the fakes refuse: `$rename`, `$min`, `$max`, `$mul`, `$pop`, `$pullAll`, a positional path, `$push`'s `$slice` and `$position`, `$pull` of an operator condition, an upsert over `$and` or `$in` |
| `READ_CASES`       | `find(...).sort(...).limit(...)`: one key or several in either direction, null and missing first, the order across types (numbers, strings, booleans, dates), a dotted path, `limit` and `limit(0)`, and the sorts over a list or a sub-document the fakes refuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PROJECTION_CASES` | `mongo_project`: inclusion and exclusion by `1`, `0`, `True` and `False`, the `_id`, the document's own field order, dotted paths into sub-documents and through lists, what the server refuses (inclusion beside exclusion, a path beside its parent) and what the fakes refuse: `$slice`, `$elemMatch`, a literal or any other value                                                                                                                                                                                                                                                                                                                                                                                                                              |

`mongo_matches`, `mongo_update`, `mongo_project` and the fake's sort raise `UnmodelledQuery`, a subclass of `AssertionError`, naming what they do not model, so a test of a filter, an update or a read they cannot answer fails instead of passing on a guess.
`FakeApplicationsCollection` reads its filter even when it holds no document, so an unmodelled filter is refused there too.
A new operator is modelled there with its cases in the tables, or its test runs here, on the server.

`FakeApplicationsCollection` also stores a copy of what it is given and hands back copies, adds an `ObjectId` `_id` to an inserted document as the driver does, and refuses a second document with one `_id` with `DuplicateKeyError`; each test of that runs on both sides.
It has no other unique index and no TTL, so a race on a unique index is tested here, on the server.

## MongoDB 8.0

CI's service and the local stack's `mongodb` service ([`docker-compose.yml`](../../../docker-compose.yml)) run `mongo:8.0`, the major version production's Atlas cluster runs ([`OPERATIONS.md`](../../OPERATIONS.md)).
A stack volume MongoDB 7 wrote opens on 8.0 unchanged: its feature compatibility version stays `7.0`, so no volume is deleted.
On 2026-11-10 a worktree stack seeded on `mongo:7` came up healthy on 8.0.34 with its data and feature compatibility version `7.0`, and its E2E seed ran.
