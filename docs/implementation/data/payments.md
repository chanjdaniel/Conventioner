---
layer: implementation
kind: data
describes:
  - back-end/payments.py
  - back-end/api/payments.py
  - back-end/datatypes.py#PaymentEntry
  - back-end/app.py#get_vendor_account
  - back-end/app.py#record_payment
  - back-end/api/placements.py#remove_placement
  - front-end/src/utils/payments.ts
  - front-end/src/components/VendorPaymentTab.vue
  - front-end/src/components/RecordPaymentDialog.vue
  - front-end/src/components/ChangeOwedDialog.vue
  - front-end/src/components/RowMenu.vue
  - back-end/app.py#record_refund
  - back-end/app.py#set_amount_owed
  - back-end/app.py#use_calculated_price
  - back-end/app.py#edit_payment
  - back-end/app.py#remove_payment
verified: 2026-10-31
sources:
  - T92
  - E44/F01/S01
  - E44/F01/S02
---

# Payments, and what a vendor owes

What each vendor owes for each table-day, and the payments an organizer records against it.
[`back-end/payments.py`](../../../back-end/payments.py) owns both collections, and every reader and writer goes through it; [`back-end/api/payments.py`](../../../back-end/api/payments.py) loads the market, asks the table and answers the drawer's Payment tab ([the vendor drawer](../../business/flows/vendor-drawer.md)).

Conventioner tracks what is expected and what came in, not accounting (Daniel, T92 Q5): vendors pay outside the app, by e-transfer or cash (Q7), and an organizer records each payment by hand.

## The amount owed, per table-day

**A line per table-day**: the date, the table, its tier, full or half, and the amount owed for it.
By default the amount is the price of the seat the vendor holds that day, by the price group their answers put them in (`Groups` and `row_prices` in [`back-end/pricing.py`](../../../back-end/pricing.py), [a price follows the table](../../business/rules/a-price-follows-the-table.md)), and the line names the group as the date card does ("North Wing 1, Gold, full table, Example College student + club member"), so a line nobody has set follows its seat: a seat moved from Gold to Silver owes the Silver price (Q26: "the pricing scheme sets the default amount owed by calculating it").
The seats are read off the market's stored assignment, through the same rows and the same pricing the drawer's date cards read (`derive_market_table_rows`, `seats_by_vendor`), so a line and its date card never disagree.
A seat held now is never copied into these collections; only what the assignment cannot say is kept.
A day seated again, by hand or by a run, forgets its freed line (`clear_freed_lines`), so a freed record never outlives the seat that replaced it, and with it the $0 the free's deduction set (marked `by_free`), which was about the freed table; an amount an Admin set by hand stays.
Each deduction taken back is recorded under the seating's own row, `assign`, kind `owed_taken_back`, by whoever placed the vendor or ran the assignment ("… seated Alice Example again on May 8, 2099, taking back the $0 set when the table was freed"); Manage market's "Kind of change" lists it under Assignment, and under Payments beside the $0 it undoes.
The tab tells the two apart: a free's $0 reads "Removed when the table was freed, by …", an amount set by hand "Set by …" (`owedByFree` on the line).

**Freeing a table never changes either amount by itself** (Q26: after the cancellation deadline "the amount owed and amount paid dont change even though the table did").
`remove_placement` in [`back-end/api/placements.py`](../../../back-end/api/placements.py), the one door that frees a seat ([placements](../modules/placements.md)), keeps the seat's line as it stood (`keep_freed_line`) before it frees the seat, so a line that could not be kept leaves the seat where it was.
The line stays, owing what the seat cost the day it was freed, until someone sets the amount, and says where that number came from: the seat, and that it was freed and when ("North Wing 1, Gold, full table - table freed Oct 30, 2026", `lineSource` in `payments.ts`; Daniel: "from Sunday, now deleted"); seated again that day, the vendor's line follows the new seat.
A run keeps no line for a seat of its own that a later run moves: it runs only in assignment, before results are published, while the assignment is still being made, and every hand placement is a pin each run keeps.
Every free keeps the line, before results are published too (Daniel chose this over dropping it, after T121's review).

**Freeing a table asks** (Q26: "when we remove a table, promp the user to ask if it should also dedudct from amount owed"): whoever may change the amount owed is asked in the placement dialog, beside "Free this seat", "Also remove its $15 from what Alice owes? (Cancelled before the deadline: a refund may be due.)", unticked, naming what the day's line owes, set by hand or calculated, read from the vendor's account as the dialog opens; a line that owes nothing asks nothing.
Ticked, the free sends `deductOwed: true`, and `remove_placement` asks the row "Change the amount owed" before it frees anything, then sets the line's amount to $0 in the same change (`deduct_freed_line`); the amount paid is untouched, so a vendor who paid reads paid more than owed, a refund to issue.
Anyone else frees the seat with no such question, and the line stays owed for an Admin to decide.

**An amount set by hand holds whatever the seat does** (`set_amount_owed`): setting it to $0 is the waiver (Q26: "instead of a button to waive, the admin will set amount owed to zero"), and there is no waive control anywhere.
The line then shows the calculated price struck beside the amount set, with who set it and when; "Use the calculated price" (`use_calculated_price`) takes the amount back.

## The amount paid

**The sum of the vendor's entries still standing**: each an amount in whole cents of the market's currency, e-transfer or cash, the day it was paid, an optional note, and who recorded it and when (Q15, Q7b).
An entry is a payment, or a refund: money given back, recorded once it is given (Q26: "when the refund is settled they can come back and adjust amount paid so it zeros out"), the same fields, stored as a negative amount and shown "-$15", "Refund by e-transfer, given …".
The app never proposes a refund (Q20), and there is no "refund due" state: paid more than owed, "Paid $15 more than owed", is the sign one is to be issued.

**An edit or a removal keeps the entry's own history**: an edit sets the entry's fields and pushes what it read before onto its `changes`, with who and when; a removal marks it `removed_by` and `removed_at`, pushes the same, and leaves it listed, its amount struck, out of the amount paid.
Either way the entry still reads "Recorded by …", with "Edited by …" or "Removed by …" under it.
A removed entry is changed no more.

## The stored shape

Two collections, each snake_case with the market foreign key `market_id` and the vendor's address lowercased (`vendor_email`), like `vendor_notes`:

| Collection | One document per | Fields |
| --- | --- | --- |
| `payments` | payment or refund | `id`, `market_id`, `vendor_email`, `kind` (`payment` or `refund`; none on an entry before refunds, which reads as a payment), `cents` (negative for a refund), `method` (`e-transfer` or `cash`), `paid_on` (`YYYY-MM-DD`), `note` (blank for none), `recorded_by`, `recorded_at`; `changes`: each edit or removal, `{by, at, what, before}`; `removed_by`, `removed_at` |
| `amounts_owed` | vendor per table-day that holds something | `market_id`, `vendor_email`, `date`; `freed`: the seat as it was freed (`table_code`, `tier`, `table_choice`, `cents`, null where unpriced, `group`, `by`, `at`); `set_by_hand`: `cents`, `by`, `at`, and `by_free` on the $0 a free's deduction set |

A payment's or a refund's body is `PaymentEntry` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), strict, so an amount sent as text or with a fraction of a cent is refused rather than read: from 1 cent to $100,000, the most a price cell holds; a date that is a calendar day; a note of at most 500 characters.
Both collections are indexed on `market_id, vendor_email` ([lookup indexes](lookup-indexes.md)), and both are deleted with the market (`delete_for_market`, called by [market deletion](../modules/market-deletion.md)).

**No applicant endpoint reads either**: what a vendor owes is for organizers only (Q20.2), which is why it is kept apart from the application, as the organizer's notes are.

## Reading and recording

Every route is in [`back-end/app.py`](../../../back-end/app.py) (`get_vendor_account`, `record_payment`, `record_refund`, `set_amount_owed`, `use_calculated_price`, `edit_payment`, `remove_payment`), and every write answers the vendor's account as it now reads.

- `GET /markets/:id/payments/:email` (`vendor_account`) answers one vendor's account: `currency` (null on a market that sets no prices), `lines` (each `date`, `tableCode`, `tier`, `tableChoice`, `group`, `priceCents`, `owedCents`, `owedSetBy`, `owedSetAt`, `owedByFree`, `freed`, and `freedAt` and `freedBy` for a freed seat), `payments` (the last recorded first), `owedCents` and `paidCents`; an unpriced line owes nothing toward the total.
  It asks the table's Read row: anyone with a role reads it.
- `POST /markets/:id/payments/:email` (`record_payment`), body `{cents, method, paidOn, note}`, records one payment and answers the account as it now reads.
  It asks the row "Record a payment", an Editor's by default (Q15: "editors can"; [what each role may do](../../business/rules/what-each-role-may-do.md)), refuses an archived market, and a vendor the market has no application from, 404, as a seat is.
- `PUT /markets/:id/payments/:email/owed/:date`, body `{cents}` from 0 to $100,000, sets a table-day's amount owed, and `DELETE` on the same path uses the calculated price again; both ask the row "Change the amount owed", an Admin's by default (Q26: "this number can be changed by the admin"), and refuse a day with no line, 404.
- `POST /markets/:id/payments/:email/refunds` records a refund, `PUT /markets/:id/payment-entries/:payment_id` edits an entry and `DELETE` on it removes it; all three ask the row "Adjust the amount paid", an Admin's by default, and an entry of another market, or one removed, is not found, 404.
- Each write is recorded in [the market's history](history.md): a payment under `record-payment`; an amount owed set, a free's deduction included, or set back to the calculated price under `change-owed`, subject `{date, currency}`, the line's `owed_cents` before and after; a refund, an edit or a removal under `adjust-paid`, subject `{payment_id, payment_kind, currency}`, the entry's fields before and after; `payment_kind` (`payment` or `refund`, on `record-payment` too) words an edit that changed no amount.
  Each names the vendor, so it reads in their drawer's History tab as in Manage market's ([reading the market's history](../../business/flows/reading-the-markets-history.md)), worded by `marketHistory.ts` ("… recorded a payment of $50 from Alice Example", "… set what Alice Example owes on May 8, 2099 to $0", "… recorded a refund of $15 to Alice Example"), opening to its fields in the Payment tab's words and money.

The front end words the account in [`front-end/src/utils/payments.ts`](../../../front-end/src/utils/payments.ts) ("Owes $27", "Paid in full", "Paid $15 more than owed", "Nothing owed") and shows it in [`VendorPaymentTab.vue`](../../../front-end/src/components/VendorPaymentTab.vue).
A payment, a refund and an edit go through [`RecordPaymentDialog.vue`](../../../front-end/src/components/RecordPaymentDialog.vue), an amount owed through [`ChangeOwedDialog.vue`](../../../front-end/src/components/ChangeOwedDialog.vue), which says the change before Save, and "Use the calculated price" and a removal through a confirmation; each line's and each entry's actions sit behind a "..." menu ([`RowMenu.vue`](../../../front-end/src/components/RowMenu.vue)), offered on its row's answer.

## How it is tested

- `back-end/tests/test_a_vendors_payments.py`: $70 for two Gold full days, the half share, a seat moved from Gold to Silver, an amount set by hand that stays, a freed day's line kept with neither amount changed, every refusal of a payment, who may record, the history entry, and deletion with the market.
- `back-end/tests/test_changing_owed_and_paid.py`: an amount set to $0 and taken back, each recorded, and every change in the vendor's own history read; a free ticked and unticked; a refund that squares the account; an edit and a removal with the entry's own history; an Editor refused every one of them, and the deduction before anything is freed.
- `front-end/src/__tests__/payments.test.ts`, `vendorPaymentTab.test.ts` and `placementDialog.test.ts` (the question, unticked).
- `front-end/e2e/the-payment-tab.spec.ts`: two Gold full days owe $70, $35 reads "Owes $35", $35 more "Paid in full", a freed day keeps its line; a Viewer reads the tab with no "Record payment".
  `changing-owed-and-paid.spec.ts`: an Admin sets a $35 line to $0 and back; frees a paid $15 seat ticked, reads "Paid $15 more than owed", records a $15 refund and reads "Paid in full", and finds each change in the drawer's History with who and when; unticked, the line stays $15 owed.
  An Editor freeing the owed seat is asked nothing, its page never reads the account (`mayTake(ChangeOwed)` in `ResultView.vue`), and the line stays $15 owed.
  `market-records-go-with-it.spec.ts` finds no payment or amount owed left after a market is deleted.
