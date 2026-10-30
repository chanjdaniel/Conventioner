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
verified: 2026-10-30
sources:
  - T92
  - E44/F01/S01
---

# Payments, and what a vendor owes

What each vendor owes for each table-day, and the payments an organizer records against it.
[`back-end/payments.py`](../../../back-end/payments.py) owns both collections, and every reader and writer goes through it; [`back-end/api/payments.py`](../../../back-end/api/payments.py) loads the market, asks the table and answers the drawer's Payment tab ([the vendor drawer](../../business/flows/vendor-drawer.md)).

Conventioner tracks what is expected and what came in, not accounting (Daniel, T92 Q5): vendors pay outside the app, by e-transfer or cash (Q7), and an organizer records each payment by hand.

## The amount owed, per table-day

**A line per table-day**: the date, the table, its tier, full or half, and the amount owed for it.
By default the amount is the price of the seat the vendor holds that day (`assignment_price` in [`back-end/pricing.py`](../../../back-end/pricing.py), [a price follows the table](../../business/rules/a-price-follows-the-table.md)), so a line nobody has set follows its seat: a seat moved from Gold to Silver owes the Silver price (Q26: "the pricing scheme sets the default amount owed by calculating it").
The seats are read off the market's stored assignment, through the same rows and the same pricing the drawer's date cards read (`derive_market_table_rows`, `seats_by_vendor`), so a line and its date card never disagree.
A seat held now is never copied into these collections; only what the assignment cannot say is kept.

**Freeing a table never changes either amount by itself** (Q26: after the cancellation deadline "the amount owed and amount paid dont change even though the table did").
`remove_placement` in [`back-end/api/placements.py`](../../../back-end/api/placements.py), the one door that frees a seat ([placements](../modules/placements.md)), keeps the seat's line as it stood (`keep_freed_line`) before it frees the seat, so a line that could not be kept leaves the seat where it was.
The line stays, owing what the seat cost the day it was freed, until someone sets the amount, and says where that number came from: the seat, and that it was freed and when ("Atrium 1, Gold, full table - table freed Oct 30, 2026", `lineSource` in `payments.ts`; Daniel: "from Sunday, now deleted"); seated again that day, the vendor's line follows the new seat.
A run keeps no line for a seat of its own that a later run moves: it runs only in assignment, before results are published, while the assignment is still being made, and every hand placement is a pin each run keeps.

**An amount set by hand holds whatever the seat does** (`set_amount_owed`): setting it to $0 is the waiver (Q26).
Nothing offers it yet: changing the amount owed is an Admin's row of its own, E44/F01/S02.

## The amount paid

**The sum of the vendor's payments**: each an amount in whole cents of the market's currency, e-transfer or cash, the day it was paid, an optional note, and who recorded it and when (Q15, Q7b).
A payment is never zero or negative: taking money back, a refund, is an Admin's adjustment of the amount paid, E44/F01/S02, and the app never proposes one (Q20).
Paid more than owed reads "Paid $15 more than owed", the case where a refund is to be issued by hand (Q26).

## The stored shape

Two collections, each snake_case with the market foreign key `market_id` and the vendor's address lowercased (`vendor_email`), like `vendor_notes`:

| Collection | One document per | Fields |
| --- | --- | --- |
| `payments` | payment | `id`, `market_id`, `vendor_email`, `cents`, `method` (`e-transfer` or `cash`), `paid_on` (`YYYY-MM-DD`), `note` (blank for none), `recorded_by`, `recorded_at` |
| `amounts_owed` | vendor per table-day that holds something | `market_id`, `vendor_email`, `date`; `freed`: the seat as it was freed (`table_code`, `tier`, `table_choice`, `cents`, null where unpriced, `by`, `at`); `set_by_hand`: `cents`, `by`, `at` |

A payment's body is `PaymentEntry` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), strict, so an amount sent as text or with a fraction of a cent is refused rather than read: from 1 cent to $100,000, the most a price cell holds; a date that is a calendar day; a note of at most 500 characters.
Both collections are indexed on `market_id, vendor_email` ([lookup indexes](lookup-indexes.md)), and both are deleted with the market (`delete_for_market`, called by [market deletion](../modules/market-deletion.md)).

**No applicant endpoint reads either**: what a vendor owes is for organizers only (Q20.2), which is why it is kept apart from the application, as the organizer's notes are.

## Reading and recording

Both routes are in [`back-end/app.py`](../../../back-end/app.py) (`get_vendor_account`, `record_payment`).

- `GET /markets/:id/payments/:email` (`vendor_account`) answers one vendor's account: `currency` (null on a market that sets no prices), `lines` (each `date`, `tableCode`, `tier`, `tableChoice`, `priceCents`, `owedCents`, `owedSetBy`, `owedSetAt`, `freed`, and `freedAt` and `freedBy` for a freed seat), `payments` (the last recorded first), `owedCents` and `paidCents`; an unpriced line owes nothing toward the total.
  It asks the table's Read row: anyone with a role reads it.
- `POST /markets/:id/payments/:email` (`record_payment`), body `{cents, method, paidOn, note}`, records one payment and answers the account as it now reads.
  It asks the row "Record a payment", an Editor's by default (Q15: "editors can"; [what each role may do](../../business/rules/what-each-role-may-do.md)), refuses an archived market, and a vendor the market has no application from, 404, as a seat is.
- Each payment is recorded in [the market's history](history.md) under `record-payment`, with the payment's id as its subject and its fields after, none before.

The front end words the account in [`front-end/src/utils/payments.ts`](../../../front-end/src/utils/payments.ts) ("Owes $27", "Paid in full", "Paid $15 more than owed", "Nothing owed") and shows it in [`VendorPaymentTab.vue`](../../../front-end/src/components/VendorPaymentTab.vue), recording through [`RecordPaymentDialog.vue`](../../../front-end/src/components/RecordPaymentDialog.vue).

## How it is tested

- `back-end/tests/test_a_vendors_payments.py`: $70 for two Gold full days, the half share, a seat moved from Gold to Silver, an amount set by hand that stays, a freed day's line kept with neither amount changed, every refusal of a payment, who may record, the history entry, and deletion with the market.
- `front-end/src/__tests__/payments.test.ts` and `vendorPaymentTab.test.ts`.
- `front-end/e2e/the-payment-tab.spec.ts`: two Gold full days owe $70, $35 reads "Owes $35", $35 more "Paid in full", a freed day keeps its line; a Viewer reads the tab with no "Record payment".
  `market-records-go-with-it.spec.ts` finds no payment or amount owed left after a market is deleted.
