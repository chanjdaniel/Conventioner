# E04 progress and acceptance audit

Running record of E04 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with
evidence, not merely asserted.

Branch: `feat/e04-v0-1-0-release`, cut from `dev` at `c32ee06b` (E03's merge, PR #65).

`docs/agents/issue-tracker.md` defines done as "its PR merges to `dev`, with the PR number appended
to `pr`". The table below is what is finished in the working tree; the front-matter is what has
shipped.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Extract a CSV import page object | - | done (unpushed) | |
| 2 | F02/S01 STARTUP.md walks a fresh clone to a running stack | - | not started | |
| 3 | F01/S02 Walk the whole journey in one session | F01/S01 | not started | |
| 4 | F02/S02 TESTING.md describes the suites that exist | F01/S02 | not started | |
| 5 | F03/S01 Promote dev to main and cut v0.1.0 | F01/S02, F02/S01, F02/S02, E06/F01/S02 | not started | |
| 6 | F03/S02 Later versions follow conventional commits | F03/S01 | not started | |

F01/S01 and F02/S01 are both unblocked and may run in either order, or in parallel: one is e2e
infrastructure and the other is documentation, and they do not touch the same files.

## Blocked outside this epic

- **`E06/F01/S02`** - the public application-form request stalls under full-suite load, papered over
  by a retry workaround in the essential-fields spec. F03/S01 requires a green suite, and a release
  whose suite is known-flaky teaches everyone to re-run rather than read failures. The story stays in
  E06; only the blocking edge lives here.

## Not in this epic, deliberately

- **Bulk-approve in the application monitor.** Settled as needed, but its shape is still an open
  question in [wayfinding ticket 08](../../wayfinding/v0-1-0/issues/08-bulk-approve-shape.md), a
  prototype ticket that needs a live session. It becomes a fourth feature once that resolves.
  F01/S02 is deliberately written to a fixture small enough that per-row approval is honest.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->

### F01/S01 Extract a CSV import page object

Branch `feat/e04-v0-1-0-release`.
Import suite green at 9 passed, against an isolated stack (unique compose project + free ports,
the isolation `scripts/nm-test.sh` uses), run twice: once on the first cut and again after the
code-review polish.
Front-end unit suite green at 89 passed, 13 files. Prettier, ESLint and `vue-tsc` all clean.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A `CsvImportPage` wraps the wizard's steps, following the `MarketSetupPage` / `ManageMarketPage` pattern | met | `front-end/e2e/pages/CsvImportPage.ts`: `readonly page`, `Locator` fields assigned from `getByTestId` in the constructor and grouped by wizard stage, action methods below. Re-exported from `e2e/fixtures.ts` beside the other sixteen. The standards review confirmed the shape matches. |
| `csv-import.spec.ts` uses it throughout, and no longer reaches for raw selectors on the wizard | met | `grep -E "getByTestId\|page\.(locator\|getByRole\|getByText\|goto\|evaluate\|setInputFiles)\|localStorage"` over the spec returns zero hits. Only `page.screenshot` remains, which addresses no selector. |
| Every test in the import suite still passes, with its assertions unchanged | met | 9 passed, twice. Audited mechanically rather than asserted: the multiset of matchers is identical, every expected string literal survives, and every testid survives (the ten that appear "missing" are the indexed ones the page object now builds as template literals). The only deltas are four `toBeVisible()` waits that moved inside `previewAndConfirm()`, where they still run, and one extra `toBeVisible()` the grid test gained - strictly stronger. The spec-axis review reached the same conclusion independently, counting 68 expects across both versions. |
| Any `data-testid` added is purely additive - no product behaviour changes | met, vacuously | `git diff --stat HEAD~1...HEAD -- front-end/src back-end` is empty. No product file was touched and no testid was added; the page object reuses what already existed. |
| The spec is materially shorter, and what each test is *about* is readable without scrolling through wizard mechanics | met | 645 -> 487 lines. The bigger win is structural: the eight-line hand-mapping block that appeared four times is now one `FULL_MAPPING` constant, the `openImport` + `fetchMarket` pair that appeared thirteen times is one helper, and grids are addressed by header rather than by bare index. |

#### Review findings acted on

Both axes of `/code-review` ran against `b9f405e1`. Neither found a hard violation. Acted on:

- `mapColumnAt` respelled the testid `targetSelectAt` already built - now calls it.
- `open(market, userEmail)` was called with byte-identical arguments thirteen times. The repetition
  moved into one spec-local `openImport(importPage, request, marketId)`; the page object stays
  ignorant of the API and of which user is driving it.
- Grids were addressed by magic index (`mapGroupAt(3)`, `splitGroupAt(1)`). They are now named by
  the header of their first member column, and one private `columnIndex()` turns a header into a
  position.
- `statusRaw ?? status` appeared at three call sites; one `statusOf()` says which field is
  authoritative.
- Speculative surface trimmed: `chooseFile`'s unused filename override is gone, and the positional
  forms plus `valueFix` are private.

Declined, with reason: `mapColumns(headers, mapping)` could read the rendered column rows instead
of being handed the file's header row. That would couple the mapping to how the view renders a
header, in a story whose contract is that no assertion changes. The spec owns `HEADERS` as its
fixture anyway, so passing it is honest.

#### Sibling work discovered

- **`csv_exports/` is vestigial.** No Python reads or writes it - `GET /markets/<id>/assignment-csv`
  builds the CSV in memory and returns it as an attachment - yet `back-end/Dockerfile` creates it,
  `docker-entrypoint.sh` chowns it, `docker-compose.yml` mounts a named volume at it, and
  `docs/STARTUP.md` tells the reader to `mkdir` it. Found while reading STARTUP.md for F02/S01.
  The docs half is F02/S01's; removing the directory and its volume is a sibling story.
