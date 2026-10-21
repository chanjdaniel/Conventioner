---
layer: business
kind: rule
describes:
  - back-end/csv_import.py#APPLICANT_EMAIL_TARGET
  - back-end/csv_import.py#_EMAIL_ADDRESS
  - back-end/api/added_vendors.py#add_vendor
verified: 2026-10-22
sources:
  - E05
---

# An imported email is asserted

An imported applicant's email address is asserted by the organizer's file; a vendor who applies on the market's page has proven theirs with a code.
Nothing on the application records which, so how an asserted address is treated must be settled before the product sends a vendor any mail but a sign-in code.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

## The rule

- **A vendor applying online proves their address**: a code is sent to it and they sign in with it before their first save ([a vendor signs in before they have applied](a-vendor-signs-in-before-applying.md)).
- **An imported applicant's address is transcribed**: the import takes the column mapped to "Applicant email" as the file has it, lowercased and trimmed, and refuses a row only when the value is plainly not an address (a name, or a timestamp from a row whose cells shifted), never one a mail server might accept.
- **A vendor added by hand is the same**: the organizer types the address ([adding a vendor who never applied](adding-a-vendor-who-never-applied.md)).
- **The application does not say which**: no field records how its address was given; the market's [intake mode](intake-mode-decides-how-vendors-arrive.md) says how its applications arrived, and `added_by` marks a vendor added by hand.
  The import deliberately adds no `source` field, since it would only copy the intake mode ([ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md)).

## Why

Today the difference costs nothing.
The only mail the product sends a vendor is the sign-in code, which goes to the address that asked for it, and a Google Form market has no applicant pages ([a gated market answers as absent](a-gated-market-answers-as-absent.md)), so an imported vendor never signs in and is never mailed.
It stops being harmless the moment the product mails an outcome or an offer: that mail would go, at a market's whole volume, to addresses nobody has verified, and one mistyped address in a spreadsheet becomes a bounce at best and mail to a stranger at worst.
What to do with an asserted address is not decided yet; it is decided before the first such mail is sent.

## Where it is kept

- [The CSV import](../../implementation/modules/csv-import.md) reads the address (`APPLICANT_EMAIL_TARGET`) and judges its shape (`_EMAIL_ADDRESS`) in [`back-end/csv_import.py`](../../../back-end/csv_import.py).
- [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py) takes a hand-added vendor's address (`add_vendor`).
- [The application document](../../implementation/data/application-document.md) holds the address, `applicant_email`, with nothing beside it to say how it was given.
- The sign-in that proves an address is `request_login_code` and `verify_login_code` in [`back-end/api/applicant_auth.py`](../../../back-end/api/applicant_auth.py).
