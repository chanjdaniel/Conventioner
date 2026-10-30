---
layer: implementation
kind: adr
describes:
  - back-end/review_team.py
  - back-end/datatypes.py#ReviewTeam
  - back-end/api/applications.py#deal
verified: 2026-10-30
sources:
  - E38/F07
  - E38/F07/S01
  - E38/F07/S02
status: accepted
---

# An application is dealt to one reviewer, and the review's record is the market's history

The nodes it constrains: [the review is dealt among chosen reviewers](../business/rules/the-review-is-dealt-among-chosen-reviewers.md), [the application document](../implementation/data/application-document.md) and [the market document](../implementation/data/market-document.md).

## Context

A market's applications are reviewed by a team, and every reviewer worked the same queue, first come, first served.
Nobody could be given a share ahead of time, so a team of four starting on 200 applications had no way to say "these 50 are yours", and nobody could tell afterwards who was meant to decide which.
The one person an application named was a follow-up's owner, and its document kept only its latest verdict; who had it before was the market's whole history to answer.
The model carried an `assigned_reviewer_id` on the application and an untyped `review_config` on the market, which nothing ever wrote.

## Decision

**An application carries its reviewer, and a market its review team.**
`reviewer` on the application (`{user_id, email}`, `Application` in [`back-end/datatypes.py`](../../back-end/datatypes.py)) names whose share it was dealt to, and a verdict never clears it, so it stays the record of whose share it was.
It sits beside the hold of [ADR 0014](0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md): the hold is who is looking at it now, the reviewer is whose share it is, and a deal never moves a hold.
`reviewTeam` on the market (`{reviewers: [{userId, email}], turn}`) is the chosen people in the order they are dealt to, by address, so the deal is the same whoever chose them, and `turn`, how many applications were dealt since they last changed.
Absent, both read as before this existed: no reviewers, first come, first served, and no migration.
`assigned_reviewer_id` and `review_config` are gone.

**The deal is strict round robin, in arrival order.**
One module, [`back-end/review_team.py`](../../back-end/review_team.py), writes both fields; nothing else does.
Choosing reviewers stores the team with its turn reset, then deals every open application (undecided: `open` or `under_review`) round robin from the first reviewer in the order they arrived, and moves the turn on by as many; the first reviewers in address order take the remainder, and the next arrivals go first to those who got one fewer.
A deal never counts what each reviewer has left open.
An arrival is first won for its deal, a short lease on the application, and only then takes its turn by one atomic increment of the market's, so a turn is never taken for an application another deal writes, and two at once skip no reviewer.
Each application's write (`deal` in [`back-end/api/applications.py`](../../back-end/api/applications.py)) is conditioned on it still being open and still dealt as it was read, so a verdict landing mid-deal is never touched.
A decided application stays where it is, and so does a follow-up, unless its owner is a reviewer the change removed: then it is dealt with the open applications and handed, still a follow-up, to the reviewer it goes to. An unchanged set writes and records nothing; no reviewers returns every open application to first come, first served.

**Choosing is a row of the market's table**, "Choose reviewers" (default Admin, [ADR 0019](0019-a-markets-permissions-are-a-table.md)), open while the review is (draft through the stage) and refused on an archived market.
A reviewer is chosen from the people the chooser may hand a follow-up to, so someone outside the market's organization is never offered its people.

**The review's record is the market's history** ([ADR 0017](0017-one-history-for-every-change.md)): a change of reviewers, the deal it made and each arrival's deal are entries of their own (`reviewers`, `dealt`).
A verdict's entry names whom the application was dealt to beside who decided it (`dealt_to`), so help and mistakes can be told apart.
One application's story is the history narrowed to its vendor, in the vendor drawer's History tab.

## Consequences

- Every write that can leave an application open and undealt must ask `review_team.py` to deal it, or it stays out of every share.
- A chosen reviewer who loses their role on the market is skipped by every deal and served as not `able` until an Admin removes them: removing someone is always a person's act, recorded, never a side effect of a role taken away.
- A verdict on someone else's share is not refused: dividing the review is a soft filter, and the warning is the screen's.

## Considered and rejected

- **A history array on the application**: [ADR 0017](0017-one-history-for-every-change.md) keeps one history, and an application's story is that history narrowed.
- **Balancing by what each reviewer has left open**: it punishes the fast reviewer with more (Daniel: "we don't want to punish our viewer for being fast").
- **A random shuffle**: unpredictable, untestable, and impossible to explain to the team.
- **A hard lock on another's share**: helping someone who is behind must stay easy (Daniel: "this is not a hard filter").
- **Being chosen as a new role**: a role is market-wide and outlives the review; being chosen is per review and is lost when removed.
- **Reusing the untyped `review_config`**: it said nothing about its shape, and nothing wrote it.
