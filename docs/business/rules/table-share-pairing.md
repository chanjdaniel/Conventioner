---
layer: business
kind: rule
describes:
  - back-end/table_share.py
  - back-end/essential_fields.py#table_share_answers
  - back-end/essential_fields.py#partner_addresses
  - back-end/migrations/migrate_table_share_answer.py
  - back-end/api/applicants.py#list_market_applications
verified: 2026-10-28
sources:
  - wayfinding/v0-1-0/01
  - wayfinding/november-2026-dry-run/08
  - E27
  - E27/F01/S01
  - E27/F01/S03
  - E27/F01/S02
---

# Table-share pairing

Two applicants share a table when one names the other and both accept a half table.
One-way is enough, a person's own request outranks one about them, and an answer naming several addresses names the first that belongs to an applicant.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## The rule

- **Both must exist**, identified by address, and both must accept a half table: half or either, never a whole table only.
  A rejected or withdrawn applicant takes no part, so a request naming them pairs nobody.
- **Naming nobody is normal**: the question is optional, and an applicant who names nobody and takes a half table shares it with whoever else takes one.
- **One-way is enough**: A naming B pairs them whether or not B named anyone, and from either end, so the one named may be reached first.
- **A person's own request outranks a request about them**: if A names B and B names C, B's stands, and A's gives way; along a chain the requests alternate from its end.
  A ring with no end is broken at its first address, so it still seats a pair.
- **Several asking for one**: the earliest of them to apply is the partner, on every date.
- **Several addresses in one answer**: the first that belongs to an applicant is the partner.
- **A pair sits where both can**: at a tier both accept, never where either one's own answers rule out, and together on every date both are placed.
  The open half of a table a pin holds never splits a pair, since it would seat one of them beside a stranger; the pair takes a table of their own.
  A pair is an exception to [the half-table share](half-table-share.md): it never stops two people who asked to share from sharing.
- Naming nobody is the ordinary case, and such a half-table applicant is paired with whoever else wants a half table.

## How the answer is written

The question asks for the exact address the partner applied with, and real answers wrap one in a sentence or type it in other case.
The write (`table_share_answers` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py)) reads every address out of the applicant's words, lowercased, once each, in the order written (`partner_addresses`): the first in `essential_table_share_email`, the rest in `essential_table_share_also`, and the words themselves in `essential_table_share_answer`, which the organizer reads.
An answer with no address in it is never refused: it costs the pairing, not the application.
[`migrations/migrate_table_share_answer.py`](../../../back-end/migrations/migrate_table_share_answer.py) rewrites stored applications into that shape, exactly as the write would; it has no boot marker, because an unmigrated answer shows as a request that pairs nobody.

## Why

Decided with Daniel before the November 2026 rehearsal, and amended during it.
**A partner is an address, not a reference to another application**: an imported row's typed address cannot be promised to name an applicant, so the answer keeps what was written and the pair is resolved when it is read ([essential fields are exactly what the solver reads](../../adr/0001-essential-fields-are-the-solver-contract.md)).
**A request that pairs nobody is shown, never blocking**: the import and the run go ahead, and the organizer follows up from the notice.
**The write keeps every address, and the partner is chosen when pairs are read**, because who has applied can change after an answer is saved.
That amendment came from the import: five answers named two addresses (two an applicant beside an address nobody applied with, three two applicants), and "the one address in the answer" paired all five with nobody.
A pair outranks the half-table share because two pairs were split on one date when Gold had used its share and the Either chooser of each pair was given a whole table.

## Where it is kept

- [`back-end/table_share.py`](../../../back-end/table_share.py) is the one statement of the rule; do not restate it beside either reader.
  The solver seats the pairs by it (`pair_mate`, in [the assignment solver](../../implementation/modules/assignment-solver.md)), and the organizer's applications list serves `tableShareNotice` by it (`list_market_applications` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py)): why a request pairs nobody, or that another applicant it named was not used.
  The notice is derived on every read, from all the market's applications, and never stored.
  Every request that pairs nobody is shown, with why: the answer holds no address, nobody applied as it, the partner wants a full table, the partner was not accepted for this market (rejected or withdrawn), or the partner's own request names someone else and stands; a request that stands is noted when its answer also names another applicant, who was not used ([`TableShareNotice.vue`](../../../front-end/src/components/TableShareNotice.vue) words each).
- How the answer is stored is [essential fields](../../implementation/modules/essential-fields.md).
- A field added to `SolverVendor` for this changes every assignment fingerprint unless `made_from._ADDED_SINCE_FINGERPRINTS` names it; `table_share_also` is there.
- The cases are in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md) (`TestATableShareRequest`) and `tests/test_table_share_notice.py`.

## Superseded

- A pair was to keep to the half-table share like anyone on a half table (E27/F01/S02); it is an exception to it, after two pairs were split on one date (wayfinding/november-2026-dry-run/08).
