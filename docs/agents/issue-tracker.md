# Issue tracker: Local Markdown

Issues, specs, and long-term work tracking for this repo live as committed markdown files under `.scratch/`.
`.scratch/` is version-controlled on purpose: it is the project's durable work-item backlog, not throwaway scratch space.

There is no GitHub Issues usage in this repo.
GitHub is used for pull requests only.

## Two artifacts, two purposes

`.scratch/` holds two kinds of thing, and conflating them is the main way this system rots.

- **Work items** (`.scratch/backlog/`) are things to *build*.
  They form an Epic > Feature > Story hierarchy and live as long as the work does.
- **Wayfinder maps** (`.scratch/wayfinding/<effort>/`) are open *questions* to resolve.
  A map exists to burn down uncertainty about direction; it is closed and archived once the way is clear.

A Wayfinder map is upstream of the backlog.
Resolving a map's tickets is what produces or reshapes epics and features.
A decision never lives in both places: the map's ticket holds it, and the work item links to that ticket.

## Work-item hierarchy

Three levels, modelled on Azure DevOps but with the Story/PBI distinction collapsed.
A Story is sized to fit one fresh agent context window, which is exactly what a PBI would have been.

```
.scratch/backlog/
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
- `pr` accumulates the PRs that delivered it, so a `done` story is auditable back to code.

### Body

Epics and Features carry **Outcome** (what becomes true when this is done) and **Why now**.
Stories carry **What to build** (end-to-end behaviour from the user's perspective, never a layer-by-layer implementation list) and **Acceptance criteria** as a checklist.

Avoid file paths and code snippets in work items; they go stale faster than the ticket does.
Point at the authoritative module instead.

### The frontier

The frontier is every Story whose `blocked_by` entries are all `done` and whose `status` is `ready`.
That is the set an agent may pick up without asking.

## Maintaining it as work completes

This is the part that decays if left implicit.

- A Story moves to `in-progress` when its branch is cut, and to `done` when its PR merges to `dev`, with the PR number appended to `pr`.
- A Feature moves to `done` only when every child Story is `done` or `wontfix`.
  Same rule one level up for Epics.
- Discovering new work mid-Story means creating a sibling Story, not growing the current one.
- A work item proven wrong is set to `wontfix` with a one-line reason, never deleted.
  Deleting loses the record that the path was considered.

## When a skill says "publish to the issue tracker"

For implementation work (`to-tickets`), create the Story files under the owning Feature directory, creating `epic.md` / `feature.md` if the parent does not exist yet.
For a one-off spec unattached to an epic, `.scratch/specs/<slug>.md` is acceptable.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced id or path.
The user will normally pass the id (`E01/F02/S03`) or the path directly.

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

Used by `/wayfinder`.
The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/wayfinding/<effort>/map.md` (the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body).
- **Child ticket**: `.scratch/wayfinding/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body.
  A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `open`/`claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top.
  A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/wayfinding/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

A resolution that implies buildable work creates or updates items under `.scratch/backlog/` and links them from the `## Answer` section.
The map itself never holds a work breakdown.
