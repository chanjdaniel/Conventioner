---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#change_refusal
  - back-end/api/markets.py#admin_actions_refusal
  - back-end/tests/test_what_a_role_may_change.py
  - back-end/utils/identity.py
verified: 2026-10-22
sources:
  - brain-dump/2026-10-19#22
  - E26/F08/S01
  - E34/F01/S01
  - bug/37
  - E07
---

# What each role may do

A Viewer reads a market and changes nothing; an Editor changes the plan, the form, the seats, the highlights, the automatic rejections and the verdicts, and checks vendors in; an Admin or the owner also moves the phase, publishes results, imports applications, starts the market from a CSV and amends a locked form.
Each screen offers each person only what their role lets them do, and the server decides it.

**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

## Why

A Viewer was once shown every editing control, and each edit appeared to work until its save failed with a 403 (bug 37); an Editor was offered every phase move.
A control the write would refuse is a control that lies, so the market read says, per person, what each write would answer.
An Editor works on the market (the plan, the seats, the review) but takes none of the actions that move it or bring people in or tell them: a phase move puts a public page on or off the air, publishing results tells applicants, an import adds applicants.
A verdict is Editor's (E34/F01/S01): reviewers decide applications, and a verdict records who gave it.

## Who may

| Role | May |
| --- | --- |
| Viewer | read the market: its applications, its result and tables, the statistics and the CSV export, attendance and the placement history |
| Editor | everything a Viewer may, and the plan, the form, renaming a draft, running the assignment and placing, swapping or freeing a seat, highlights, automatic rejections, verdicts, follow-ups, vendor notes, check-ins at the door |
| Admin | everything an Editor may, and phase moves, publishing results, importing, the CSV start, [the form amendment](../../implementation/modules/form-amendment.md); manage editors and viewers |
| Owner | everything an Admin may, and manage admins, and delete the market |

Whoever creates a market is its owner, and a market has exactly one.
A market may give a person a role of its own, which takes precedence over what their organization gives: Owner (4) > Admin (3) > Editor (2) > Viewer (1).
**Organization membership gives only Viewer on its markets**, in any of the organization's roles (Owner, Admin or Member), even to its owner and admins; anyone who changes a market, a door volunteer included, needs a role on that market (Manage market).
See [the organization document](../../implementation/data/organization-document.md#what-a-person-may-do-on-a-market) for how a role is resolved.

## Who signs in, and how

| Person | Signs in how | What they do |
| --- | --- | --- |
| Organizer | Email and password, or an emailed sign-in code | Runs markets, by the role each market gives them |
| Organization member | As an organizer | Sees every market of their organization as a Viewer |
| Vendor applying online | A 6-digit code emailed per market; no account | Applies to a market whose vendors apply on its own page, and reads their application ([a vendor signs in before they have applied](a-vendor-signs-in-before-applying.md)) |
| Vendor on market day | Nothing: types the address they applied with | Looks up their table and checks in |

## Where it is kept

- The market read serves two per-person reasons, asked through the same `user_has_permission` the writes ask ([`back-end/api/markets.py`](../../../back-end/api/markets.py)):
  `readOnlyReason` (`change_refusal`: archived, or below EDITOR) and `adminActionsReason` (`admin_actions_refusal`: that, or below ADMIN).
  The verdicts' reason (`verdictLockReason`), adding a vendor's (`addVendorReason`) and publishing's (`publishResultsReason`) are built on them.
- **A screen draws no control while the reason for it is set; never decide a role threshold on the front end beside them.**
  [The phase rail](../../implementation/modules/phase-rail.md) offers no move below ADMIN and still says where the market stands.
- **Who is asking is the session's answer, never the request's.**
  An organizer route learns who is asking from the signed-in session, through `authenticated_email()` ([`back-end/utils/identity.py`](../../../back-end/utils/identity.py)), and a role is looked up for that address alone; no server source reads a caller's identity from a request header.
  [`back-end/tests/test_session_is_the_identity.py`](../../../back-end/tests/test_session_is_the_identity.py) walks the header attack that once read and rejected another organizer's applications, and refuses any server source that reads an identity header again (E07).
- [`back-end/tests/test_what_a_role_may_change.py`](../../../back-end/tests/test_what_a_role_may_change.py) pins each role's two answers.
- A follow-up's owner is anyone with a role on the market ([needs follow-up](needs-follow-up.md)).

## Superseded

Verdicts were an admin action, served on `adminActionsReason`; they and follow-ups drop to an Editor, and phase moves stay an Admin's (brain-dump/2026-10-19#22, E34/F01/S01).
