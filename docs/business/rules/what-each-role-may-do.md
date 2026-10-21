---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#change_refusal
  - back-end/api/markets.py#admin_actions_refusal
  - back-end/tests/test_what_a_role_may_change.py
verified: 2026-10-22
sources:
  - E26/F08/S01
  - E34/F01/S01
  - bug/37
---

# What each role may do

A Viewer reads a market and changes nothing; an Editor changes the plan, the form, the seats, the highlights, the automatic rejections and the verdicts, and checks vendors in; an Admin or the owner also moves the phase, publishes results, imports applications, starts the market from a CSV and amends a locked form.
Each screen offers each person only what their role lets them do, and the server decides it.

## Why

A Viewer was once shown every editing control, and each edit appeared to work until its save failed with a 403 (bug 37); an Editor was offered every phase move.
A control the write would refuse is a control that lies, so the market read says, per person, what each write would answer.
An Editor works on the market (the plan, the seats, the review) but takes none of the actions that move it or bring people in or tell them: a phase move puts a public page on or off the air, publishing results tells applicants, an import adds applicants.
A verdict is Editor's (E34/F01/S01): reviewers decide applications, and a verdict records who gave it.

## Who may

| Role | May |
| --- | --- |
| Viewer | read the market, its applications and its result |
| Editor | everything a Viewer may, and the plan, the form, placements, highlights, automatic rejections, verdicts, follow-ups, vendor notes, check-ins at the door |
| Admin | everything an Editor may, and phase moves, publishing results, importing, the CSV start, the form amendment; manage editors and viewers |
| Owner | everything an Admin may, and manage admins, and delete the market |

**Organization membership gives only Viewer on its markets**, even to the organization's owner and admins; anyone who changes a market, a door volunteer included, needs a role on that market (Manage market).
See [the organization document](../../implementation/data/organization-document.md#what-a-person-may-do-on-a-market) for how a role is resolved.

## Where it is kept

- The market read serves two per-person reasons, asked through the same `user_has_permission` the writes ask ([`back-end/api/markets.py`](../../../back-end/api/markets.py)):
  `readOnlyReason` (`change_refusal`: archived, or below EDITOR) and `adminActionsReason` (`admin_actions_refusal`: that, or below ADMIN).
  The verdicts' reason (`verdictLockReason`), adding a vendor's (`addVendorReason`) and publishing's (`publishResultsReason`) are built on them.
- **A screen draws no control while the reason for it is set; never decide a role threshold on the front end beside them.**
  [The phase rail](../../implementation/modules/phase-rail.md) offers no move below ADMIN and still says where the market stands.
- [`back-end/tests/test_what_a_role_may_change.py`](../../../back-end/tests/test_what_a_role_may_change.py) pins each role's two answers.
