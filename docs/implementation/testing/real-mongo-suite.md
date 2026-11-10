---
layer: implementation
kind: testing
describes:
  - back-end/tests/real_mongo/
  - back-end/tests/test_the_real_mongo_harness.py
  - back-end/tests/mongo_cases.py
  - back-end/tests/test_the_shared_matcher.py
  - back-end/tests/test_the_shared_applications_fake.py
  - back-end/tests/test_the_shared_markets_fakes.py
  - back-end/tests/test_every_order_of_a_deal.py
  - back-end/tests/conftest.py#mongo_matches
  - back-end/tests/conftest.py#mongo_update
  - back-end/tests/conftest.py#mongo_project
  - back-end/tests/conftest.py#FakeApplicationsCollection
  - back-end/tests/conftest.py#FakeMarketsCollection
  - back-end/tests/conftest.py#FakeSlugMarketsCollection
  - back-end/db_config.py#uri_targets
verified: 2026-11-11
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

- **CI**: the `backend` job runs a `mongo:7` service ([the MongoDB version](#the-mongodb-version)), its port 27017 published on the runner as 27117, with a `mongosh` ping as its health check and no credentials, and sets `REAL_MONGODB_URI=mongodb://127.0.0.1:27117/?serverSelectionTimeoutMS=5000` and `REAL_MONGODB_REQUIRED=true` for the job ([CI and the gate](ci-and-the-gate.md#ci)).
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

| Fixture                         | Gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `real_db`                       | the test's own database, every handle bound to it                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `boot_indexes`                  | every index the boot builds, built on the test's database by the `ensure_*` functions [`app.py`](../../../back-end/app.py)'s boot calls, listed once in `harness.BOOT_INDEX_BUILDS`; a hermetic test runs `app.py`'s boot on the fakes under a profile hook, recording every back-end `ensure_*` it calls (through a helper, or defined in `app.py` itself), and fails when it calls one the list lacks. Opt-in: without it the lazy index builds do nothing, since the boot under the suite already ran them on the fakes |
| `signed_in(email)`              | a Flask test client signed in through `POST /login`, the real route, as a verified account `create_account.create_account` made; it carries `account_id` and `email`. Addresses are fixture addresses (`@example.com`)                                                                                                                                                                                                                                                                                                     |
| `market_in(phase, **overrides)` | `stored_market(...)` from `tests/conftest.py` with `COMPLETE_PLAN`, the first signed-in account as owner, and a fresh `id` and name, inserted and returned                                                                                                                                                                                                                                                                                                                                                                 |
| `interleave(target, then)`      | wraps the function `target` names (`"module.attribute"`) so that on its first call, after it returns, `then()` runs once and then the result is handed back: the one seam for "a second request between this write's read and its write"                                                                                                                                                                                                                                                                                   |
| `race(n, fn)`                   | `fn(i)` on `n` threads released together by a barrier, each result or the exception it raised returned in order; a thread that makes a request makes its own test client                                                                                                                                                                                                                                                                                                                                                   |

`interleave` replaces one attribute, so name the one the reader calls through: a module that imported the function by name holds its own reference, and the wrap does not reach it.

## The differential cases

[`back-end/tests/mongo_cases.py`](../../../back-end/tests/mongo_cases.py) holds the cases that check the shared fakes of [`tests/conftest.py`](../../../back-end/tests/conftest.py) against the server: each a document, an operation and the answer MongoDB gives, written in the table.
Each table is read twice.
[`test_the_shared_matcher.py`](../../../back-end/tests/test_the_shared_matcher.py) (the filters), [`test_the_shared_applications_fake.py`](../../../back-end/tests/test_the_shared_applications_fake.py) (the updates, reads and projections) and [`test_the_shared_markets_fakes.py`](../../../back-end/tests/test_the_shared_markets_fakes.py) (the updates but the upserts, through both markets fakes) run every case through the fakes on every run, without a server, so the gate checks the fakes; [`real_mongo/test_the_filter_cases_on_the_server.py`](../../../back-end/tests/real_mongo/test_the_filter_cases_on_the_server.py) and [`real_mongo/test_the_collection_cases_on_the_server.py`](../../../back-end/tests/real_mongo/test_the_collection_cases_on_the_server.py) run every case through the server, so CI checks the tables.
A case the fakes do not model names what they refuse (`fake_refuses`); the hermetic test asserts that refusal and the server test still asserts the server's answer.
Documents are compared with `as_stored`, which tells field order and number types apart as the server does, except for the one document whose field order the server does not keep steady: the one an upsert makes, whose filter terms it lays out in its query planner's order (`update_one` and `find_one_and_update` lay out `{"a.b": 1, "a.c": 2}` in two different orders).

| Table              | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILTER_CASES`     | `mongo_matches`, the filter most shared fakes find documents by (the applications, markets and organizations fakes among them): equality by BSON type (`true` is not `1`, `1` is `1.0`), null against missing, a value, `$in`, `$ne` and `$nin` against a list field, a whole sub-document in and out of field order, dotted paths through sub-documents and through lists (any element, a numeric index, and what reads as missing there), `$exists`, the four ranges (across two types, on dates, on strings, over list elements), `$size` (a negative or fractional one refused, as the server refuses it), `$type: "object"`, `$and`, `$or` and `$nor`, the shapes production's filters send, and what the matcher refuses: `$regex`, `$elemMatch`, `$not`, any other `$type`, `$all`, `$mod`, `$expr`, an unknown operator and a malformed condition |
| `UPDATE_CASES`     | `mongo_update`, through `FakeApplicationsCollection`'s `update_one` and `find_one_and_update` and the markets fakes' `update_one` and `find_one_and_update`: the document after and the matched and modified counts for `$set`, `$unset`, `$inc`, `$push` and `$addToSet` (with `$each`), `$pull` (a value, or an equality condition on sub-document elements) and `$setOnInsert`, on dotted paths and list indexes; a value set to what it holds modifying nothing, new fields landing in the order of their names, the shapes production's writes send, the document an upsert makes, the updates the server refuses, and what the fakes refuse: `$rename`, `$min`, `$max`, `$mul`, `$pop`, `$pullAll`, a positional path, `$push`'s `$slice` and `$position`, `$pull` of an operator condition, an upsert over `$and` or `$in`                         |
| `READ_CASES`       | `find(...).sort(...).limit(...)`: one key or several in either direction, null and missing first, the order across types (numbers, strings, booleans, dates), a dotted path, `limit` and `limit(0)`, and the sorts over a list or a sub-document the fakes refuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PROJECTION_CASES` | `mongo_project`: inclusion and exclusion by `1`, `0`, `True` and `False`, the `_id`, the document's own field order, dotted paths into sub-documents and through lists, what the server refuses (inclusion beside exclusion, a path beside its parent) and what the fakes refuse: `$slice`, `$elemMatch`, a literal or any other value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`mongo_matches`, `mongo_update`, `mongo_project` and the fake's sort raise `UnmodelledQuery`, a subclass of `AssertionError`, naming what they do not model, so a test of a filter, an update or a read they cannot answer fails instead of passing on a guess.
`FakeApplicationsCollection` reads its filter even when it holds no document, so an unmodelled filter is refused there too.
A new operator is modelled there with its cases in the tables, or its test runs here, on the server.

`FakeApplicationsCollection` also stores a copy of what it is given and hands back copies, adds an `ObjectId` `_id` to an inserted document as the driver does, and refuses a second document with one `_id` with `DuplicateKeyError`; each test of that runs on both sides.
It has no other unique index and no TTL, so a race on a unique index is tested here, on the server.

The two markets fakes, `FakeMarketsCollection` (one market, `doc`) and `FakeSlugMarketsCollection` (a list, `docs`), apply an `update_one`'s filter with `mongo_matches` and its update with `mongo_update` to the first market matched, and answer the server's counts, `0` on no match.
Their `find_one_and_update` writes the same way and answers the market before it, or after it when asked, projected, or None on no match, which is what [the market write](../modules/market-write.md) reads.
So a market write that holds what it read, the phase move's stored phase or Publish results' phase, matches nothing over a market that no longer holds it, and its test fails as the server would refuse it, where the fakes once answered every write as landed and left their market alone.
A write that lands replaces the stored market with a new dict, so the document a test built a fake from is not the store, and reads hand back copies; `last_update` keeps the update document sent, matched or not, for a test asserting what was written.
They make no upsert, which no market write asks for.

## The applicant side's guarantees

Each guarantee the applicant side rests on the server for is run here with its losing branch, on real threads (`race`), in [`real_mongo/test_the_applicant_side_races.py`](../../../back-end/tests/real_mongo/test_the_applicant_side_races.py) and [`real_mongo/test_the_boot_indexes_on_the_server.py`](../../../back-end/tests/real_mongo/test_the_boot_indexes_on_the_server.py).
Each test's name says what it proves.

| Guarantee                                                     | Tests                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One applicant is one application                              | 20 `find_or_create_application` calls at once for one address leave one document, and each is answered it; 20 split between a main and a waitlist application leave one of each                                                                                                                                                                                                         |
| Two reviewers are handed different cards                      | 10 `claim_next_for_review` calls at once, by 10 reviewers over 10 open applications, hand 10 different cards; `renew_claim` by anyone but the holder changes nothing; `release_claim` by another does nothing, and by the holder frees the card for the next reviewer                                                                                                                   |
| A sign-in code is tried at most five times, and signs in once | through `POST /public/markets/<slug>/applicant-login/verify-code`: 5 right tries at once sign in once; 10 wrong tries at once count exactly 5 and spend the code; a right try among 3 wrong ones signs in, and the count holds every wrong try answered "try again"; a right try among 9 wrong ones signs in at most once, never counts past 5, and counts exactly 5 when none signs in |
| The rate limit counts every attempt                           | 20 `count_attempt` calls at once for one key make one counter counting 20, and let exactly the limit's 5 through                                                                                                                                                                                                                                                                        |
| Every boot index builds over an existing database             | the boot's builds run twice over one database change no index, and the second makes no lookup index                                                                                                                                                                                                                                                                                     |
| Each unique boot index refuses over duplicates                | the boot's unique indexes are exactly the three with a case (`market_applicant_type_unique`, `market_email_unique`, `user_email`); over two planted duplicates, each one's boot check (`verify_application_indexes`, `verify_applicant_login_indexes`, `verify_user_indexes`) raises its error, logs "Refusing to start", builds no index, and never repeats the address                |

A sign-in code allows five tries, so "one right try among nine wrong ones" cannot promise a sign-in: the right try may come sixth, or land after a fifth wrong try spent the code.
What it promises, at most one sign-in, at most five tries counted, and exactly five when none signs in, is its test; the other exact counts are the other three's.
Each race opens its connections first (`harness.warm(collection, n)`, `n` reads at once): on a cold pool each thread opens and authenticates its own, which spreads the threads out until their writes no longer meet, and the first race of a run once passed with the unique index taken away.

## The market side's guarantees

Each guarantee the market side rests on the server for is a write conditional on what its request read, and is run here with its losing branch, on real threads, in [`real_mongo/test_the_market_side_races.py`](../../../back-end/tests/real_mongo/test_the_market_side_races.py).
Every racing thread stands on the same read of the market, so their writes meet on the server however the threads are scheduled.
Each test's name says what it proves.

| Guarantee                                                   | Tests                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two phase moves from one phase land one                     | two `apply_phase_transition` calls from one read, the same move out of Draft twice or two moves out of Applications: one lands, the other raises `PhaseChangedUnderRequest` naming the phase the winner moved to, and the phase history gains one entry, the winner's                                                                                              |
| Back to review and Publish results are never both taken     | Back to review and `publish_results` from one read, at once ten times over, and once with each writing first: one is refused (`MoveBlockedUnderRequest` with the `results_not_published` blocker, or Publish's `MarketChanged`), and the market never stands in Applications with its results published                                                            |
| Two assignment writes from one revision land one            | two `_store_vendor_assignments` calls from one revision, on a counted revision, on revision 0 and on an assignment with no revision yet: one lands with the revision counted up once, the other raises `AssignmentChangedUnderRequest`, and the stored rows and date are the winner's                                                                              |
| The dealing lease is held by one deal at a time, and lapses | 10 `_hold` calls at once, on a market with a team and on one that never had one, leave one holding it; a held lease refuses 10 deals a second before it lapses, and one of 10 takes it a second after; `_let_go` by a deal whose lease lapsed and was taken leaves the market unchanged, and so does `_let_go` on a market nobody holds, with a team and with none |

The lease tests set `review_team`'s clock rather than wait for a lease to run out.
[`real_mongo/test_every_order_of_a_deal_on_the_server.py`](../../../back-end/tests/real_mongo/test_every_order_of_a_deal_on_the_server.py) imports the cases of [`test_every_order_of_a_deal.py`](../../../back-end/tests/test_every_order_of_a_deal.py) ([ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md)), every order of a change of reviewers against an arrival and of two arrivals, and runs them over a world whose markets, applications and history are the real collections, so its `Counted` wrapper steps over the server's own calls.
Those cases read and write their world through collection calls alone (`find_one`, `find`, `insert_one`, `update_one`, `delete_many`), which is what lets one set of cases run over the fakes and over the server.

## The MongoDB version

CI's service and the local stack's `mongodb` service ([`docker-compose.yml`](../../../docker-compose.yml)) run `mongo:7`, while production's Atlas cluster runs 8.0 ([`OPERATIONS.md`](../../OPERATIONS.md)).
mongod 8.0 refuses to start on Linux kernel 6.19 and newer (MongoDB SERVER-121912), and GitHub's `ubuntu-latest` and `ubuntu-24.04` runners both boot one now, so the move to 8.0 waits for MongoDB's fix.
A local stack on 8.0 fails the same way on a machine with kernel 6.19 or newer, its `mongodb` container never becoming healthy.
The move changes three lines: the compose file's `image`, the `backend` job's service `image` in [`test.yml`](../../../.github/workflows/test.yml), and the image [`test_compose_overlay.py`](../../../scripts/tests/test_compose_overlay.py) expects among the primary stack's, which the required `knowledge-graph` job checks.
The docs naming the version follow it: [`STARTUP.md`](../../STARTUP.md), [`TECH_STACK.md`](../../TECH_STACK.md), [`TESTING.md`](../../TESTING.md), [CI and the gate](ci-and-the-gate.md) and this node, found with `git grep -n 'mongo:7'`.
The tables hold on both versions: on 2026-11-10 the whole back-end suite, every case of every table included, passed on a worktree stack on 8.0.34 and again on 7.0.45.

A stack volume MongoDB 7 wrote opens on 8.0 unchanged, since its feature compatibility version stays `7.0`: on 2026-11-10 a worktree stack seeded on `mongo:7` came up healthy on 8.0.34 with its data, its E2E seed ran, and it opened on 7.0.45 again.
The other way does not hold: a volume 8.0 makes has feature compatibility version `8.0`, and MongoDB 7 refuses to start on one, as MongoDB allows a binary downgrade only once the version has been set back.
So once the move lands, a branch cut before it still names `mongo:7`, and its stack on a slot whose volume 8.0 made restarts its `mongodb` over and over.
Merge `dev` into that branch, or, when the stack's data can go, bring the stack down with its volume (`scripts/th-compose.sh down -v`) so 7 makes a new one.

Both allow `mongod` 64000 open files, the number MongoDB asks for, where Docker's default soft limit is 1024.
WiredTiger keeps a dropped collection's files open until its next checkpoint, a minute apart, and each test using `boot_indexes` makes 13 collections and about 40 indexes, a file each, so at 1024 the second of two back-to-back runs of the applicant side's two files above took `mongod` down with "Too many open files".
A stack started before the limit was set takes it when it is next brought up, which recreates its `mongodb` container.
