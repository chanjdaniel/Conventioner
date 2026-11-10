---
layer: implementation
kind: testing
describes:
  - back-end/tests/real_mongo/
  - back-end/tests/test_the_real_mongo_harness.py
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

## MongoDB 8.0

CI's service and the local stack's `mongodb` service ([`docker-compose.yml`](../../../docker-compose.yml)) run `mongo:8.0`, the major version production's Atlas cluster runs ([`OPERATIONS.md`](../../OPERATIONS.md)).
A stack volume MongoDB 7 wrote opens on 8.0 unchanged: its feature compatibility version stays `7.0`, so no volume is deleted.
On 2026-11-10 a worktree stack seeded on `mongo:7` came up healthy on 8.0.34 with its data and feature compatibility version `7.0`, and its E2E seed ran.
