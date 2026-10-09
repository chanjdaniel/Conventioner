---
id: E27/F01/S01
title: The partner's address is read where the application is written
type: story
status: done
blocked_by: []
pr: []
---

## What to build

Today `_store_table_share_email` (`back-end/essential_fields.py`) stores the table-share answer as typed.
The solver then compares it with applicants' addresses as an exact string.
Applicant addresses are lowercased at import, and a typed answer often is not, or holds a sentence around the address.

At the write (the one function both the CSV import and the applicant's online save already pass through), read the answer into the partner's address:

- The **one** address found anywhere in the answer, lowercased and trimmed: "I want to share with Someone@Example.com." yields `someone@example.com`.
- An answer with **no** address, or **more than one**, yields no partner address.
  It is not a validation failure; the field stays optional, and the application is saved.
- **The applicant's own wording is kept** and stays readable to the organizer, beside the address the product read from it.
  The solver reads only the address.

One function in `essential_fields.py` does this, and both doors call it.
The front-end mirror (`front-end/src/utils/essentialFields.ts`) stays in step with whatever shape is stored.

**Stored applications are migrated with the same function** (a plain script under `back-end/migrations/`, as `migrate_submitted_at_to_iso.py` was).
The table-share answer is solver-relevant, so without the migration a re-import of an unchanged file would read every rewritten answer as changed and send approved applicants back to review.

## Acceptance criteria

- [x] An address alone, in any case or with surrounding spaces, is stored as the lowercased address.
- [x] An address inside a sentence is extracted; trailing punctuation is not part of it.
- [x] An answer with no address ("N/A", a name) or two addresses stores no partner address and saves without error.
- [x] The applicant's wording is still readable after the save, by the organizer's review screens.
- [x] The CSV import and the online applicant save produce the same stored shape from the same answer (pytest through both doors).
- [x] Importing the same file twice changes nothing and returns nobody to review, before and after the migration has run.
- [x] The migration is idempotent and rewrites only the table-share answer.
