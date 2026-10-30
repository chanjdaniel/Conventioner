# The knowledge graph

Conventioner's durable knowledge is a graph of Markdown files in this repository.
A file is a **node** when it carries a small YAML frontmatter saying its layer, its kind, the code it describes, the day it was last verified against that code, and where its content came from.
Nodes link each other with plain relative Markdown links, so GitHub, an agent reading the file and Obsidian all follow the same edges.
The **business** layer says what the product does and why; the **implementation** layer says how the code does it; every link across the two layers is answered by a link back, so from a line of code you can climb to the rule it keeps, and from a rule you can reach the code that keeps it.
A **hub** is a file with no frontmatter that lists nodes: this file, [`CONTEXT.md`](../CONTEXT.md), [`USER_FLOWS.md`](USER_FLOWS.md) and the `README.md` of each graph folder.
[`scripts/knowledge_graph.py`](../scripts/knowledge_graph.py) checks the graph in CI.

## Layers and kinds

| Layer | Kind | A node of this kind says |
| --- | --- | --- |
| business | `concept` | A hub for one glossary term: the rules, flows and modules about it. Its definition stays in `CONTEXT.md`. |
| business | `flow` | What a person does on a screen or across screens, step by step, and what they see. |
| business | `rule` | One product rule: what the product does or refuses, who may, and why. |
| business | `intent` | An enduring outcome the product commits to, with its why. |
| implementation | `module` | How one module or cohesive set of files works, and its sharp edges. |
| implementation | `data` | One stored shape: the collection, its keys, indexes and migrations. |
| implementation | `convention` | A rule for all code that no one module owns. |
| implementation | `adr` | One architecture decision that is hard to reverse, surprising without context, and a real trade-off. |
| implementation | `runbook` | How to do an operational task. |
| implementation | `testing` | How a part of the product is tested, and the test-only sharp edges. |
| implementation | `record` | A dated report, frozen when written. |

## Where everything lives

| Holds | Hub or node |
| --- | --- |
| Concepts, one per glossary term | [business/concepts/](business/concepts/README.md) |
| Flows | [business/flows/](business/flows/README.md), indexed with the paths in [USER_FLOWS.md](USER_FLOWS.md) |
| Rules | [business/rules/](business/rules/README.md) |
| Intents | [business/intents/](business/intents/README.md) |
| Modules | [implementation/modules/](implementation/modules/README.md) |
| Data | [implementation/data/](implementation/data/README.md) |
| Conventions | [implementation/conventions/](implementation/conventions/README.md) |
| Testing | [implementation/testing/](implementation/testing/README.md) |
| Architecture decisions | [adr/](adr/README.md) |
| Records | [records/](records/README.md) |
| The glossary | [CONTEXT.md](../CONTEXT.md) |
| The stack and the implementation folders | [TECH_STACK.md](TECH_STACK.md) |
| Running it on your machine | [STARTUP.md](STARTUP.md) |
| Shipping, hotfixes, rolling back | [RELEASING.md](RELEASING.md) |
| Running production | [OPERATIONS.md](OPERATIONS.md) |
| Rebuilding production from nothing | [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) |
| Worktrees and their stacks | [scripts/README-treehouse.md](../scripts/README-treehouse.md) |
| Running the tests | [TESTING.md](TESTING.md) |
| The Google Form test corpus | [back-end/tests/test_data/README.md](../back-end/tests/test_data/README.md) |
| What the product looks like | [design-system.md](design-system.md) |

The runbooks, `TESTING.md`, `TECH_STACK.md`, `design-system.md` and the corpus README stay where they are, because code and scripts cite them by path; they are nodes outside the graph folders, and declare their layer.

## Adding a node

1. Put it in the folder of its kind, named in kebab-case (`the-setup-settles-on-leaving-draft.md`); an ADR is `NNNN-kebab-title.md`, numbered from [adr/](adr/README.md).
2. Open it with the frontmatter, these keys in this order and nothing else:

   ```yaml
   ---
   layer: business            # business | implementation
   kind: rule                 # concept flow rule intent | module data convention adr runbook testing record
   describes:                 # tracked file, tracked directory ending in /, or file#symbol
     - back-end/guards.py
     - back-end/api/markets.py#setup_lock_reason
   verified: 2026-10-21       # the day the node was read against the code and found true
   sources:                   # provenance strings, never links
     - wayfinding/the-order-of-the-work/03
     - E31/F01
   status: accepted           # adr only: proposed | accepted | superseded by NNNN
   ---
   ```

   | Kind | Layer | `describes` | `verified` | `status` |
   | --- | --- | --- | --- | --- |
   | concept, intent | business | forbidden | required | forbidden |
   | flow, rule | business | optional | required | forbidden |
   | module, data, convention, testing | implementation | required | required | forbidden |
   | runbook | implementation | optional | required | forbidden |
   | adr | implementation | optional | required | required |
   | record | implementation | forbidden | forbidden | forbidden |

   A source is one of these kinds; the checker refuses any other:

   | Source | Names |
   | --- | --- |
   | `E07`, `E26/F08`, `E34/F01/S01` | an epic, a feature or a story of the backlog |
   | `wayfinding/<effort>/03`, `wayfinding/<effort>/map` | a Wayfinder ticket, or its map |
   | `brain-dump/2026-10-19`, `brain-dump/2026-10-19#22` | a brain dump, or one item of it |
   | `qc/2026-09-21` | the manual quality check of that day |
   | `bug/37` | a bug in [the bug ledger](records/MVP_BUGS.md) |
   | `known-gap/3` | a known gap of the MVP: the story of epic `E37` that names it when the gap was carried, otherwise item `n` of `docs/MVP_KNOWN_GAPS.md` at the source sha (gap 3 was not carried, so it is [this item](https://github.com/chanjdaniel/Conventioner/blob/4aa7e30429768dbe09bc8037abd115486f6fd7fb/docs/MVP_KNOWN_GAPS.md#3-attendance-cannot-say-who-is-missing)) |
   | `T15` | a task of the agent team, built on a branch named for it (`feat/T15-...`) |
   | `decision/2026-10-20` | Daniel's ruling of that day, kept as a record (`records/DECISION_2026-10-20.md`) |

   Keep `describes` narrow: a file many areas share is described by `#symbol`, and a directory only by a node that owns all of it.
3. The first line after the frontmatter is the `# Title`, one sentence per physical line, in the present tense: a node holds current truth, and history is git's.
4. Link every file in `describes` from the body, with a relative link.
   Work-item ids are never links: they go in `sources`, or inline in backticks, and resolve in the team home as [the tracker contract](agents/issue-tracker.md#resolving-provenance) says.
5. When the node links a node in the other layer, add the link back in that node too; links within one layer may be one-way.
6. Add a line to the folder's `README.md`, `- [Title](file.md) - one line`, kept sorted by file name.
7. Run `python3 scripts/knowledge_graph.py check`.

## The checks

| Command | Does |
| --- | --- |
| `python3 scripts/knowledge_graph.py check` | The frontmatter, every link and `#fragment`, the folder rules, that every node and hub is reachable from `README.md` or `AGENTS.md`, and that every cross-layer link is answered. Exits 1 on any error; CI runs it on every push and pull request, in `knowledge-graph`, a required check. |
| `python3 scripts/knowledge_graph.py drift --base origin/dev` | Warns for each node whose described code changed while the node did not, unless the node was verified on or after the day of that change. CI runs it on every pull request as its own job, `knowledge-graph-drift`, which fails on a warning but is not required: for the next 10 PRs from 2026-10-22, then it is re-judged with the close-out's replay. |
| `python3 scripts/knowledge_graph.py stale` | Nodes not verified for 60 days whose described files have changed since. |
| `python3 scripts/knowledge_graph.py ids` | Work-item ids cited in the repo that no node's `sources` covers. |

**A drift warning** means a pull request changed code a node describes without touching the node, and the node's `verified` is before the day of the pull request's newest commit to that file.
That day is the commit's committer date in the committer's own time zone, the same calendar day `verified` is written in, so a node verified today is not flagged for code changed today.
A rebased, cherry-picked or amended commit counts from the day it was rebased, picked or amended, not the day it was first written.
A merge commit never counts, so a branch merged without a rebase is dated by its own commits, not by the merge.
Answer a warning one of two ways: edit the node so it says what the code now does, or read the node against the change, find it still true, and bump its `verified` to today.
Today is your own calendar day: `check` refuses only a day that has not begun anywhere on Earth, so a node verified in the morning east of UTC passes CI, which runs in UTC.
Either way the node is in the diff, and the warning clears.
To find the nodes for a file before changing it: `git grep -l 'path/to/file' docs`.

## Merging nodes

Every story adds its id to the end of a node's `sources`, and often a path to its `describes`, so two branches that each touch one node would conflict on the frontmatter's last line though both lines belong.
[`.gitattributes`](../.gitattributes) gives every Markdown file under `docs/` the merge driver [`scripts/merge_node.py`](../scripts/merge_node.py), which merges those two lists as sets: the ancestor's items, less any either side removed, then the items ours added and the items theirs added.
It takes the later of the two `verified` days, and leaves every other line, the other keys and the body, to git's own text merge, so a prose conflict is marked as git marks it.
A list one side dropped, a list written inline and a file with no frontmatter merge as text.
Line endings are kept, and if the set merge itself fails the file is merged as text; any other failure is reported to git as a failed merge, never as a conflict that keeps ours unmarked.
The driver is registered in the repository's git config, which every worktree shares: `scripts/treehouse-setup.sh` registers it on each lease, and a clone runs `python3 scripts/merge_node.py install` once ([STARTUP.md](STARTUP.md#the-knowledge-graph-merge-driver)).
A checkout where it is not registered merges these files as text, as git does without it.

## Reading it in Obsidian

The graph is ordinary Markdown, and Obsidian draws it.
Nothing of Obsidian is committed but the `.obsidian/` line in `.gitignore`.

- **Vault root:** the repository root of the primary checkout (`~/Documents/projects/personal/Conventioner`).
  It is the only folder that holds `CONTEXT.md`, `AGENTS.md`, `README.md` and `docs/` together, and the one against which links to code resolve.
- **Settings, Files and links:** turn "Use `[[Wikilinks]]`" off, and set "New link format" to "Relative path to file", so a note written in Obsidian links the way the graph does.
  Set "Excluded files" to `front-end/`, `back-end/`, `scripts/`, `CHANGELOG.md` and `docs/agents/`.
  That also hides the two nodes that live under `scripts/` and `back-end/`, which is acceptable: both are leaves.
- **Graph view:** turn "Existing files only" on, so links to `.py` and `.ts` files draw no ghost nodes, and add two colour groups, `path:docs/business` and `path:docs/implementation`, to show the two layers.

To check that the vault works:

1. Open the vault and apply the settings above.
2. Open a rule node and follow a relative link to a module node.
3. From a concept node, follow the link to its term in `CONTEXT.md`.
4. Confirm that `.scratch/`, `.lavish/` and `.git/` appear in neither the file explorer nor search.
5. Open the graph view, confirm one connected graph in two colours, and take a screenshot.

A step that fails is a finding about Obsidian, not about the graph: the links stay relative Markdown, because GitHub and agents follow them too.
