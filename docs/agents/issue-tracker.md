# Issue tracker: Local Markdown in the team home

Conventioner's durable backlog and its Wayfinder maps are committed markdown files in the team home, outside this repo.
A task's own working documents (its spec and tickets) are markdown files in `.scratch/`, which is ignored and never committed.

There is no GitHub Issues usage in this repo.
GitHub is used for pull requests only.

## Where things live

- **The durable backlog** is `~/agent-team/projects/conventioner/backlog/`, and **the Wayfinder maps** are `~/agent-team/projects/conventioner/wayfinding/<effort>/`.
  `~/agent-team` is the team home, a checkout of the private repo `chanjdaniel/agent-team`; its `projects/conventioner/` also holds the brain dumps (`brain-dump/`), the QC walk (`qc/`) and the plan-era review pages (`lavish/`).
- **The history came with it**: the planning was imported from Conventioner `dev` at `84b97f70eb19ec610496dd6e37b28a7d29349097` (the source sha), and `git log --follow` on a file in the team home lists the commits Conventioner had for it.
  Until then it was `.scratch/` and four `.lavish/` pages in this repo, and it can still be read at the source sha in Conventioner's own history.
  `~/agent-team/projects/conventioner/README.md` records the import.
- **`.scratch/` is transient and task-local**: it is ignored, exists only in a worktree with a task in flight, and dies with that worktree.
  The one exception is `.scratch/examples/` in the primary checkout, which holds real applicants' data (the organizers' Google Form exports): never commit, quote or paste from it.
- The team home is outside this repo, so this file and the knowledge graph name its paths in backticks, never as relative links.

## Two artifacts, two purposes

The team home holds two kinds of thing, and conflating them is the main way this system rots.

- **Work items** (`~/agent-team/projects/conventioner/backlog/`) are things to *build*.
  They form an Epic > Feature > Story hierarchy and live as long as the work does.
- **Wayfinder maps** (`~/agent-team/projects/conventioner/wayfinding/<effort>/`) are open *questions* to resolve.
  A map exists to burn down uncertainty about direction; it is closed and archived once the way is clear.

A Wayfinder map is upstream of the backlog.
Resolving a map's tickets is what produces or reshapes epics and features.
A decision never lives in both places: the map's ticket holds it, and the work item links to that ticket.

A task's tickets in `.scratch/tickets/` are neither: they are the task's own breakdown, die with its worktree, and are never copied into the team home.

## Work-item hierarchy

Three levels, modelled on Azure DevOps but with the Story/PBI distinction collapsed.
A Story is sized to fit one fresh agent context window, which is exactly what a PBI would have been.

```
~/agent-team/projects/conventioner/backlog/
  E01-<slug>/
    epic.md
    F01-<slug>/
      feature.md
      S01-<slug>.md
      S02-<slug>.md
    F02-<slug>/
      feature.md
      S01-<slug>.md
  E02-<slug>/
    ...
```

- **Epic**: a strategic outcome spanning many PRs and likely several releases.
  Rarely more than a handful open at once.
- **Feature**: a coherent capability inside an epic, demoable as a whole.
- **Story**: one vertical slice through every layer (schema, API, UI, tests), sized to a single agent session and verifiable on its own.
  Stories are the only level an agent implements directly.

Ids are stable and never reused.
A Story's full reference is its path-derived id, e.g. `E01/F02/S03`.

### Front-matter

Every work-item file opens with the same block:

```markdown
---
id: E01/F02/S03
title: <short descriptive name>
type: epic | feature | story
status: proposed | ready | in-progress | blocked | done | wontfix
blocked_by: [E01/F02/S01]
pr: [#45]
---
```

- `status` is the single source of truth for progress.
  `ready` means the triage bar below is met.
- `blocked_by` lists sibling or cross-epic ids that must reach `done` first.
  Empty list means startable now.
- `pr` accumulates the Conventioner PRs that delivered it, so a `done` story is auditable back to code.

### Body

Epics and Features carry **Outcome** (what becomes true when this is done) and **Why now**.
Stories carry **What to build** (end-to-end behaviour from the user's perspective, never a layer-by-layer implementation list) and **Acceptance criteria** as a checklist.

Avoid file paths and code snippets in work items; they go stale faster than the ticket does.
Point at the authoritative module instead.

### The frontier

The frontier is every Story whose `blocked_by` entries are all `done` and whose `status` is `ready`.
That is the set an agent may pick up without asking.

## Maintaining it as work completes

This is the part that decays if left implicit, and more so now that the backlog lives in another repo than the code.

- Status moves in the team home, never in this repo.
  A Story moves to `in-progress` when its branch is cut, and to `done` when its Conventioner PR merges to `dev`, with the PR number appended to `pr`.
- **Who moves it**: on the agent team, the coordinator, at the task's close; in a solo session, that session, by editing and committing in the team home directly.
- A Feature moves to `done` only when every child Story is `done` or `wontfix`.
  Same rule one level up for Epics.
- Discovering new work mid-Story means creating a sibling Story in the team home, not growing the current one.
  Stories for new work are created in the team home by whoever plans it.
- A work item proven wrong is set to `wontfix` with a one-line reason, never deleted.
  Deleting loses the record that the path was considered.

## When a skill says "publish to the issue tracker"

Each skill writes to a fixed place, in the worktree's `.scratch/` or in the team home:

- **`/to-spec`** writes the task's spec to `.scratch/spec.md`.
  A one-off spec unattached to an epic is `.scratch/spec.md` like any other.
- **`/to-tickets`** writes one file per ticket to `.scratch/tickets/NN-<slug>.md`, numbered from `01`, using the skill's local template, with blocking recorded as a `Blocked by:` line of text naming the other tickets.
  These task tickets are not work items: they are not created under the backlog.
- **`/wayfinder`** creates and works maps in the team home (see Wayfinding operations below).
- A Story, Feature or Epic for new durable work is created in the team home under its owning parent, creating `epic.md` / `feature.md` if the parent does not exist yet.

## When a skill says "fetch the relevant ticket"

- A work-item id (`E01/F02/S03`), whether passed by the user or found in a commit message, is read at its path under `~/agent-team/projects/conventioner/backlog/`.
- The task's spec is `.scratch/spec.md` and its tickets are `.scratch/tickets/`.
- **`/code-review`** finds the spec at `.scratch/spec.md`, or asks when there is none, and resolves any work-item id in the commit messages under review at its team-home path.

## Resolving provenance

A knowledge-graph node's `sources`, a code comment or a commit message names where a decision came from with one of these strings; none of them is a link.
Paths here are under `~/agent-team/projects/conventioner/` unless they say otherwise.

| `sources` string | Where it resolves |
| --- | --- |
| `E01`, `E01/F02`, `E01/F02/S03` | The epic, feature or story at that path under `backlog/` (folder names carry a slug after the id). |
| `wayfinding/<map>/<NN>` | Ticket `NN` of that map, `wayfinding/<map>/issues/NN-<slug>.md`. |
| `brain-dump/<day>#<n>` | Item `n` of `brain-dump/<day>.md`. |
| `qc/2026-09-21` | The manual QC walk, `qc/2026-09-21-manual-qc.md`. |
| `known-gap/<n>` | The matching story of epic `E37` (each names its `known-gap/<n>`), or item `n` of `docs/MVP_KNOWN_GAPS.md` in Conventioner's history at the source sha. |
| `bug/<n>` | Bug `n` in this repo's `docs/records/MVP_BUGS.md`. |

## Triage state

`status: ready` in front-matter is this repo's equivalent of the `ready-for-agent` label.
The five canonical triage roles map onto the `status` field:

| Canonical role    | `status` value              |
| ----------------- | --------------------------- |
| `needs-triage`    | `proposed`                  |
| `needs-info`      | `blocked`                   |
| `ready-for-agent` | `ready`                     |
| `ready-for-human` | `ready` + `human-only: true` |
| `wontfix`         | `wontfix`                   |

## Wayfinding operations

Used by `/wayfinder`, which creates and works maps in the team home.
The **map** is a file with one **child** file per ticket.

- **Map**: `~/agent-team/projects/conventioner/wayfinding/<effort>/map.md` (the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body).
- **Child ticket**: `~/agent-team/projects/conventioner/wayfinding/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body.
  A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `open`/`claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top.
  A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `~/agent-team/projects/conventioner/wayfinding/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

A resolution that implies buildable work creates or updates items under `~/agent-team/projects/conventioner/backlog/` and links them from the `## Answer` section.
The map itself never holds a work breakdown.
