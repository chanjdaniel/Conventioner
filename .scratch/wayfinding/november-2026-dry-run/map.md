# Map: November 2026 dry run

Charted 2026-10-09.

## Destination

A rehearsal of the real market: a Playwright MCP walk of the organizer journey, run locally against the real November 2026 UBC Makers Market export (212 responses, market days Wednesday 18 to Friday 20 November 2026), has its scope, its pass criteria and its inputs fixed, on an environment proven ready and local-only.
The way is clear when the run can start with nothing left to decide.
The run itself and its report (a `docs/MVP_TEST_RUN_<date>.md` in the shape of the two before it) are the execution this map hands off to.

## Notes

**Where this came from.** The organizer's real export for the upcoming market, at `.scratch/examples/markets/UBC Makers Market Application - November 2026 (Responses) - Form Responses 1.csv`.
It is git-ignored and holds real applicants' names, emails, Discord handles and links.
Two runs came before it on older exports: [the 2026-09-30 usage run](../../../docs/MVP_TEST_RUN_2026-09-30.md) and [the 2026-10-03 re-walk](../../../docs/MVP_TEST_RUN_2026-10-03.md).
This is the first run on a market that has not happened yet.

**Keep everything local.** This is a standing rule for this effort, not a ticket.
Nothing from the file leaves the machine: no email (the stack must run with `DISABLE_EMAIL=true`), no hosted TypeSafe (the CSV proposal must run on its rules alone), no Artifact or doc publishing, no commit of the file or of any screenshot.
Screenshots and copies of the file stay in the git-ignored `.playwright-mcp/`.
This map is in a tracked directory, so it quotes counts and the form's own question wording, never an applicant's answer.

**Skills every session should consult.** `grilling` and `domain-modeling` for the open tickets.
`AGENTS.md` is authoritative on the codebase's sharp edges; `docs/USER_FLOWS.md` names every path and flow by the ids the run will report against.

**This map carries execution once the way is clear.** Unlike the planning maps beside it, the walk is the point; when every ticket is resolved, the next session runs it.

## Decisions so far

- [01: What is built and working today?](issues/01-what-is-built-and-working.md): every intake path the run could take (P1 to P4, P6) completed with real exports on the 2026-10-03 re-walk, and the only changes since are a dependency bump, lookup indexes and test-reset chores, all green in CI. P5 (offers) and outcome email are not built. A dry run of the proposal rules on this file reads its three dates, the year, both tiers and every essential question it asks.
- [02: Is the local environment ready, and local-only?](issues/02-environment-ready-and-local.md): ready, after one fix. The primary stack was sending real email (a working Resend key, `DISABLE_EMAIL` blank); its back end was recreated with `DISABLE_EMAIL=true`, which does not persist across a plain `docker compose up`. TypeSafe is off, the database is clean seed state, and Playwright MCP signs the organizer in.
- [03: Rehearsal or product test?](issues/03-rehearsal-or-product-test.md): a rehearsal, on the market's real plan and real verdicts, so the result can be judged and used.
- [04: What is the market's real plan?](issues/04-the-real-plan.md): Spring 2025's four sections, every day: A Gold 53, B Silver 37, and C (6) and D (5), Bronze in reality but planned as Silver because the form offers no Bronze. Half tables at the solver's 30%, no market ceiling.
- [05: Whose verdicts does the run use?](issues/05-whose-verdicts.md): the sheet's 165 Accepted approved and its withdrawn row rejected; the other 46 decided by the agent on the form's stated rules and marked as stand-ins.
- [06: Which path, and how far?](issues/06-path-and-how-far.md): P2, all 212 rows imported (any refusal stops the run for the user), the same file re-imported once, rules students then clubs then timestamp, through publish and check-in on all three days, no archive.
- [07: What counts as a pass?](issues/07-what-counts-as-a-pass.md): every row imports; no day, tier or limit broken; every unplaced vendor says why; pairs sit together; nobody unplaced outranks someone placed. Bugs are fixed as found, behind a failing spec first.
- [08: How is a table-share request read?](issues/08-how-table-share-pairs-are-read.md): both applicants must exist and both accept a half table; the address is extracted and lowercased where an application is written; one-way is enough and a person's own request wins; an unusable answer is shown, never blocking. Built before the run - today only 29 of the file's 55 answers could pair, and a full-only partner can be put on a half table.

## Reaching the destination

**Reached on 2026-10-09.**
The rehearsal ran and passes every criterion in [07](issues/07-what-counts-as-a-pass.md); the report is [docs/MVP_TEST_RUN_2026-10-09.md](../../../docs/MVP_TEST_RUN_2026-10-09.md).
The pairing work [08](issues/08-how-table-share-pairs-are-read.md) called for was built as [E27 A table-share request finds its partner](../../backlog/E27-table-share-pairs/epic.md) before the run, and the run amended 08 twice with the user: an answer naming several addresses pairs with the first applicant, and the half-table share never blocks a pair.
What the real market still needs from the product is in the report's "Standing" list, led by Attendance saying who is missing.

## Not yet specified

- **Whether the result can be compared with what the organizer would have done by hand.** Only if a hand assignment for this market exists; if it does, the comparison belongs in the run report.

## Out of scope

- **Offers, and vendors accepting or refusing** (`E05`), and **outcome emails**: not built.
- **Anything that reaches a real applicant**: sign-in codes, verification or reset mail to an address from the file. The vendor side, if walked, uses an invented address.
- **Registration**: the stack's reCAPTCHA scores an automated browser as a bot, as on both earlier runs.
- **The floorplan beta**, deployment and hosting.
- **Disqualifying answers** ("not UBC" must never get a table, and each market has its own): the general design is its own wayfinder map, decided while grilling this map on 2026-10-09 (see [05](issues/05-whose-verdicts.md)). This run rejects such applicants on the review cards and records each as evidence for that map.
- **Price per tier**, carried over from [Real-market readiness](../real-market-readiness/map.md).
