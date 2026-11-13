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
  - front-end/src/utils/useAmountField.ts
  - front-end/src/components/RowMenu.vue
  - back-end/app.py#record_refund
  - back-end/app.py#set_amount_owed
  - back-end/app.py#use_calculated_price
  - back-end/app.py#edit_payment
  - back-end/app.py#remove_payment
  - back-end/app.py#get_market_payments
  - back-end/app.py#verify_payment_indexes
verified: 2026-11-13
sources:
  - T92
  - T315
  - E44/F01/S01
  - E44/F01/S02
  - E42/F01/S04
  - E44/F02/S01
  - T263
  - T270
  - T201
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
**A held seat always wins** (T270): on a day the vendor holds a seat, the day owes the seat's price, or an amount an Admin set by hand, which holds whatever the seat does.
A freed record and a free's $0 on such a day are ignored (`lines`), so the line reads `owedByFree` false and `owedSetBy` and `owedSetAt` null.
A free's $0 written over an amount an Admin set by hand keeps that amount as `replaced`, and on a held day the line reads it as the day's amount set by hand, with the Admin's `owedSetBy` and `owedSetAt`.
Such a record is one a seating again left when it stopped before clearing it, or a free that stopped before its seat went, so a table the vendor holds never reads as given away by a free.
Every write of the assignment, a placement, a swap or a run, forgets the freed record of each vendor-day it touched (`seated_again` and `clear_freed_lines`, which reads only the market's records holding one; [placements](../modules/placements.md) says which days each write hands it), and with it the $0 the free's deduction set (marked `by_free`), which was about the freed table; an amount an Admin set by hand stays.
An Admin's amount by hand belongs to the vendor's day, not the table, so a move of the seat keeps it; a free's $0 stands only while the table is freed, so clearing it, on any day and whatever stopped before, sets the amount it replaced by hand again, with the Admin's `cents`, `by` and `at`, and a $0 that replaced nothing clears to none.
Each deduction taken back is recorded only for a day not held in the assignment the write read, which is a day that really read as freed; a held day's freed record is one a stopped free left, and goes with no entry.
Its entry runs from the $0 to what the day owes now, the Admin's amount where the $0 replaced one.
It is recorded under the seating's own row, `assign`, kind `owed_taken_back`, by whoever placed the vendor or ran the assignment ("… seated Alice Example again on May 8, 2099, taking back the $0.00 set when the table was freed"); Manage market's "Kind of change" lists it under Assignment, and under Payments beside the $0 it undoes.
The tab tells the two apart: a free's $0 reads "Removed when the table was freed, by …", an amount set by hand "Set by …" (`owedByFree` on the line).

**Freeing a table never changes either amount by itself** (Q26: after the cancellation deadline "the amount owed and amount paid dont change even though the table did").
`remove_placement` in [`back-end/api/placements.py`](../../../back-end/api/placements.py), the one door that frees a seat ([placements](../modules/placements.md)), keeps the seat's line as it stood (`keep_freed_line`) before it frees the seat, in the one write that also sets the deduction when it is asked (below), so a line that could not be kept leaves the seat where it was.
A free whose seat write is refused because another change to the tables landed first puts the record back as it held before (`restore_freed_line`), but only while the record still holds what this free wrote: a free of the same seat that landed meanwhile kept its own record, and that record, with any $0 its deduction set, stays the line's.
A seat write that fails any other way may have reached the database before its error, a network error on the way back, so the record goes back only while the stored assignment still seats the vendor that day (`_still_holds`); a seat that went keeps its line and any $0, and one that cannot be read again keeps them too, read over by the held seat until the next write of the day forgets them.
The line stays, owing what the seat cost the day it was freed, until someone sets the amount, and says where that number came from: the seat, and that it was freed and when ("North Wing 1, Gold, full table - table freed Oct 30, 2026", `lineSource` in `payments.ts`; Daniel: "from Sunday, now deleted"); seated again that day, the vendor's line follows the new seat.
A run keeps no line for a seat of its own that a later run moves: it runs only in assignment, before results are published, while the assignment is still being made, and every hand placement is a pin each run keeps.
Every free keeps the line, before results are published too (Daniel chose this over dropping it, after T121's review).

**Freeing a table asks** (Q26: "when we remove a table, promp the user to ask if it should also dedudct from amount owed"): whoever may change the amount owed is asked in the placement dialog, beside "Free this seat", "Also remove its $15.00 from what Alice owes? (Cancelled before the deadline: a refund may be due.)", unticked, naming what the day's line owes, set by hand or calculated, read from the vendor's account as the dialog opens; a line that owes nothing asks nothing.
Ticked, the free sends `deductOwed: true`, and `remove_placement` asks the row "Change the amount owed" before it frees anything, then writes the line's $0, marked `by_free`, in the same upsert that keeps the freed line, before the seat goes (`keep_freed_line` with `deduct`); the amount paid is untouched, so a vendor who paid reads paid more than owed, a refund to issue.
That write, and an unticked free's write of its freed line too, lands only while the day's amount by hand is still the one the free read, so an Admin's amount set in between is the one kept as `replaced`, never written over: the free reads the day again, up to three times, and then frees nothing and is refused, 409, "What this vendor owes for that day changed as the seat was freed, so nothing was freed. Try again." (`OwedChangedUnderFree`); with no record read, a record created since is refused by the unique index, and the free reads again the same way.
The "owed set" entry it records once the seat is freed runs from what the line owed as the request read it, while the seat was held, to 0, and reads nothing again.
So no stop after the seat leaves the day freed and owing its full amount.
A stop after that write and before the seat goes, with no undo run, loses nothing either: the $0 keeps the Admin's amount it replaced (`replaced`), the held seat reads it, and the next write of the day sets it by hand again; a seating again that stopped before it forgot the freed record leaves the same, read and then put back the same way.
A free is such a write: the seat is held as it writes, so a free's $0 it finds is a stopped free's, and a free asked nothing puts the `replaced` amount back by hand in its own write, or none where there was none, so the day it frees owes the Admin's amount or the seat's price, never that $0, with no "owed set" entry.
Pressing Free again, ticked, on a day the vendor no longer holds sets the free's $0 when the line is freed and holds no amount set by hand at all (`deduct_freed_day`, with its "owed set" entry), and answers `{"removed": 0}`: that heals a day an older free left owing its full amount; on any other day it writes nothing.
Anyone else frees the seat with no such question, and the line stays owed for an Admin to decide.

**An amount set by hand holds whatever the seat does** (`set_amount_owed`): setting it to $0 is the waiver (Q26: "instead of a button to waive, the admin will set amount owed to zero"), and there is no waive control anywhere.
The line then shows the calculated price struck beside the amount set, with who set it and when; "Use the calculated price" (`use_calculated_price`) takes the amount back.

## The amount paid

**The sum of the vendor's entries still standing**: each an amount in whole cents of the market's currency, e-transfer or cash, the day it was paid, an optional note, and who recorded it and when (Q15, Q7b).
An entry is a payment, or a refund: money given back, recorded once it is given (Q26: "when the refund is settled they can come back and adjust amount paid so it zeros out"), the same fields, stored as a negative amount and shown "-$15.00", "Refund by e-transfer, given …".
The app never proposes a refund (Q20), and there is no "refund due" state: paid more than owed, "Paid $15.00 more than owed", is the sign one is to be issued.

**An edit or a removal keeps the entry's own history**: an edit sets the entry's fields and pushes what it read before onto its `changes`, with who and when; a removal marks it `removed_by` and `removed_at`, pushes the same, and leaves it listed, its amount struck, out of the amount paid.
Either way the entry still reads "Recorded by …", with "Edited by …" or "Removed by …" under it.
A removed entry is changed no more.

## The stored shape

Two collections, each snake_case with the market foreign key `market_id` and the vendor's address lowercased (`vendor_email`), like `vendor_notes`:

**`payments`**, one document per payment or refund:

- `id`
- `market_id`
- `vendor_email`
- `kind`: `payment` or `refund`; none on an entry before refunds, which reads as a payment
- `cents`: negative for a refund
- `method`: `e-transfer` or `cash`
- `paid_on`: `YYYY-MM-DD`
- `note`: blank for none
- `recorded_by`
- `recorded_at`
- `request_key`: the press of Record it was recorded by; none on an entry before T270, or from an older tab
- `changes`: each edit or removal, `{by, at, what, before}`
- `removed_by`
- `removed_at`

**`amounts_owed`**, one document per vendor per table-day that holds something:

- `market_id`
- `vendor_email`
- `date`
- `freed`: the seat as it was freed:
  - `table_code`
  - `tier`
  - `table_choice`
  - `cents`, null where unpriced
  - `group`
  - `by`
  - `at`
- `set_by_hand`: an amount set by hand:
  - `cents`
  - `by`
  - `at`
  - `by_free`, on the $0 a free's deduction set
  - `replaced`, on that $0 when it was written over an amount an Admin set by hand: that amount's `cents`, `by` and `at`

A payment's or a refund's body is `PaymentEntry` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), strict, so an amount sent as text or with a fraction of a cent is refused rather than read: from 1 cent to $100,000, the most a price cell holds; a date that is a calendar day; a note of at most 500 characters.
`payments` is indexed on `market_id, vendor_email` ([lookup indexes](lookup-indexes.md)) and unique on `market_id, request_key` where the key is a string (below), `amounts_owed` is unique on `market_id, vendor_email, date` (below), and both are deleted with the market (`delete_for_market`, called by [market deletion](../modules/market-deletion.md)).

### One vendor's day is one owed record, by the database

The one `amounts_owed` document per vendor's day is the database's to hold, not the upserts' (T270).
An amount set by hand (`set_amount_owed`) is an upsert by market, vendor and date, and so is the freed line (`keep_freed_line`) on a day with no record yet, and two that land at once on a day with no record can both insert: without the index an Admin setting the amount as an Editor freed the seat could leave two records, and whichever the server found first won, so the amount set did not stick or the freed line was lost.

- `ensure_payment_indexes` builds `amounts_owed_vendor_day_unique`, unique on `(market_id, vendor_email, date)`, through [`unique_indexes.py`](../../../back-end/unique_indexes.py), and `app.py`'s `verify_payment_indexes` refuses to boot without it, naming any duplicates by market id, date and record id, never by address ([OPERATIONS.md](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)).
- `set_amount_owed`'s upsert goes through `_upsert_owed`, which runs once more on a `DuplicateKeyError` and so lands on the winner's record: the day holds what each wrote; a second refusal goes on as the error it is.
- A free's write, refused the same way, reads the day again and writes held to the amount by hand it now reads, as [freeing a table asks](#the-amount-owed-per-table-day) says, so the Admin's amount that won is kept as `replaced` or left standing; a second refusal goes on as the error it is too.
- The index's prefix serves a vendor's days and a market's, so `amounts_owed` has no lookup index of its own; a database that already held the old `(market_id, vendor_email)` one keeps it, which is harmless.

### A payment is recorded once per press

An organizer who pressed Record payment, got an error because the answer never arrived, and pressed it again recorded the payment twice, and the vendor read as paid twice (T270).
Each opening of the dialog to record a payment or a refund is now one entry, however often Record is pressed:

- `RecordPaymentDialog` makes a request key with `crypto.randomUUID()` as it opens in payment or refund mode and sends it as `requestKey` on every press of that opening (`recordPayment` and `recordRefund` in `payments.ts`); an edit sends none.
- `_record_entry` in `api/payments.py` reads it with `string_field` and takes it out of the body before `PaymentEntry`, which forbids any other field, reads the rest; absent or null, the entry is recorded as before, so a tab on an older bundle during a deploy still works, and anything else that is not a UUID is refused 400, "A payment's request key must be a UUID.".
  It is stored as `request_key`, in the one lowercase spelling of the UUID, and never reaches the account's entries or the history.
- When the market already holds an entry with the key (`entry_with_request_key`), or the insert is refused by the index because a press with it landed first, the stored entry decides (`same_entry`): the same vendor, kind and fields answer the account as it stands, 200, with no new entry and no history entry; anything else is refused 409 (`AlreadyRecorded`), "This payment was already recorded, as it was first sent. Close this and edit it if it should read differently." ("This refund …" for a refund), with the account as it stands under `account`.
  The dialog keeps that refusal shown and stays open, and hands the account on (`refreshed`), which `VendorPaymentTab` shows, so the entry the first press recorded appears behind it.
- `ensure_payment_indexes` builds `payments_request_key_unique`, unique on `(market_id, request_key)`, partial to documents whose `request_key` is a string, through [`unique_indexes.py`](../../../back-end/unique_indexes.py), and `verify_payment_indexes` refuses to boot without it ([OPERATIONS.md](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)); no entry before it had a key, so no older database holds a duplicate.
- Two openings of the dialog make two keys and record two payments: two organizers recording the same e-transfer from two dialogs still record it twice, which an Admin cures by removing one.

**No applicant endpoint reads either**: what a vendor owes is for organizers only (Q20.2), which is why it is kept apart from the application, as the organizer's notes are.

## Reading and recording

Every route is in [`back-end/app.py`](../../../back-end/app.py) (`get_vendor_account`, `record_payment`, `record_refund`, `set_amount_owed`, `use_calculated_price`, `edit_payment`, `remove_payment`), and every write answers the vendor's account as it now reads.

- `GET /markets/:id/payments` (`market_payments`) answers [the Payments page](../../business/flows/payments.md): `currency`; `vendors`, each vendor with a line or any entry, by address, with `owedCents` and `paidCents` as their own account reads them and `balanceState`, their `balance_state` (below), which the page's lists read; `totals`, `byTier` and `byDate`, each `owedCents`, `paidCents`, `stillOwedCents` and `paidMoreCents`.
  Its accounts are `accounts` (below), the same `lines` and `account` the drawer's tab reads, so the page, the tab and the export never disagree on what a vendor owes, paid or is.
  `market_summary` in `payments.py` shares what each vendor paid across their lines by what each owes, evenly where they owe nothing, to the cent by largest remainder (`shares`), so a vendor's lines are all owing or all paid more, and each breakdown adds up to `totals`, which are each vendor's figures summed; a vendor with no line puts what they paid under a `tier` and `date` of null, last, unless it comes to nothing (a payment removed), which adds no row.
  It sums by the rule the states are read by (`compares`, below): what an account that compares with nothing paid counts toward `paidCents` but never toward `paidMoreCents`, in `totals` or any share of them (T153 review finding 12), so on a market with no prices `paidCents` less `owedCents` need not equal `paidMoreCents` less `stillOwedCents`.
  Tiers come in the market's order, a tier it no longer has after them; dates in order.
  It asks the table's Read row.
- `GET /markets/:id/payments/:email` (`vendor_account`) answers one vendor's account: `currency` (null on a market that sets no prices), `lines` (each `date`, `tableCode`, `tier`, `tableChoice`, `group`, `priceCents`, `owedCents`, `owedSetBy`, `owedSetAt`, `owedByFree`, `freed`, and `freedAt` and `freedBy` for a freed seat), `payments` (the last recorded first), `owedCents` and `paidCents`; an unpriced line owes nothing toward the total.
  It asks the table's Read row: anyone with a role reads it.
- `POST /markets/:id/payments/:email` (`record_payment`), body `{cents, method, paidOn, note}` and the press's `requestKey`, records one payment, once per key ([above](#a-payment-is-recorded-once-per-press)), and answers the account as it now reads.
  It asks the row "Record a payment", an Editor's by default (Q15: "editors can"; [what each role may do](../../business/rules/what-each-role-may-do.md)), refuses an archived market, and a vendor the market has no application from, 404, as a seat is.
- `PUT /markets/:id/payments/:email/owed/:date`, body `{cents}` from 0 to $100,000, sets a table-day's amount owed, and `DELETE` on the same path uses the calculated price again; both ask the row "Change the amount owed", an Admin's by default (Q26: "this number can be changed by the admin"), and refuse a day with no line, 404.
- `POST /markets/:id/payments/:email/refunds` records a refund, `PUT /markets/:id/payment-entries/:payment_id` edits an entry and `DELETE` on it removes it; all three ask the row "Adjust the amount paid", an Admin's by default, and an entry of another market, or one removed, is not found, 404.
- Each write is recorded in [the market's history](history.md): a payment under `record-payment`; an amount owed set, a free's deduction included, or set back to the calculated price under `change-owed`, subject `{date, currency}`, the line's `owed_cents` before and after; a refund, an edit or a removal under `adjust-paid`, subject `{payment_id, payment_kind, currency}`, the entry's fields before and after; `payment_kind` (`payment` or `refund`, on `record-payment` too) words an edit that changed no amount.
  Each names the vendor, so it reads in their drawer's History tab as in Manage market's ([reading the market's history](../../business/flows/reading-the-markets-history.md)), worded by [`historyReaders/payments.ts`](../../../front-end/src/utils/historyReaders/payments.ts) ("… recorded a payment of $50.00 from Alice Example", "… set what Alice Example owes on May 8, 2099 to $0.00", "… recorded a refund of $15.00 to Alice Example"), opening to its fields in the Payment tab's words and money.

`accounts` in `back-end/api/payments.py` answers every vendor's account on the market at once, by address, each as `vendor_account` answers it, for every vendor with a seat, a kept line or an entry, from one read of each collection (`amounts_owed_by_vendor`, `payments_by_vendor`), a record with no address being nobody's; its caller has asked the table already.
The vendor export reads it for its money columns and its payment filter ([J15, export the vendors](../../business/flows/vendors.md#j15-export-the-vendors-to-a-csv)), and only when one is asked for; `market_money` reads it for the Payments page (`market_payments`, which asks the table first) and for the Stats tab's money headlines and its Money card (`count_money` in `back-end/market_stats.py`, [where the money stands](../../business/flows/stats.md#n5-see-where-the-money-stands)), so the two tell the same figures.
`balance_state` in `back-end/payments.py` reads an account as the tab does: `owes` while the amount owed is above the amount paid, `over` below it, `paid` when they are equal and something is owed, and none for nothing owed and nothing paid (`BALANCE_STATES` holds the words, "Owes", "Paid in full", "Paid more than owed").
On a market with no prices (`currency` null) an account owing nothing is in none, whatever was paid, since a payment there is not "more than owed" (T153 review finding 8); one owing an amount set by hand reads as anywhere, since the reading follows the account, not the market (finding 10), and so does one owing nothing whose amount paid is below nothing (a refund beyond what was paid), which owes it back (finding 14); `compares` in the same file is that rule, which `market_summary` sums by too, and `compares` in `front-end/src/utils/payments.ts` its twin, which `balanceText`, `balanceChip` and `owingCounted` read.
`_offers_payment_states` in `back-end/api/vendor_export.py` says whether anyone may be in a state: always where the market sets prices, and where it sets none only where some account `compares`; where it says no, the export's preview offers no payment state and `_build` drops a `payment` filter sent anyway, as the Payments page ignores one in its address (`owingCounted` in `front-end/src/utils/paymentsPage.ts`).
It is the one reading of who owes: the export's payment filter and the Payments page's lists both read it (`vendorShownIn` in `front-end/src/utils/paymentsPage.ts`, whose filters' ids are its own), while `balanceState` in `front-end/src/utils/payments.ts` only tones a chip.
An amount in the file is `money_cell` in `back-end/api/vendor_export.py`: `money_text` in `back-end/pricing.py`, the tab's own writing ("$35.00", "$15.01", "-$15.00"), except that a minus leading a currency's letters ("-A$15.00", a cell reference to a spreadsheet) is the minus sign U+2212.
Every amount, on screen and in the file, reads to the cent, pinned on both sides by one table of cases ([an amount reads to the cent](../../business/rules/an-amount-reads-to-the-cent.md)).

The front end words the account in [`front-end/src/utils/payments.ts`](../../../front-end/src/utils/payments.ts) ("Owes $27.00", "Paid in full", "Paid $15.00 more than owed", "Nothing owed"; on a market with no prices a payment by someone owing nothing reads "Paid $35.00"), tones its chip with `balanceChip` for the tab and the Payments page alike, and shows it in [`VendorPaymentTab.vue`](../../../front-end/src/components/VendorPaymentTab.vue).
A payment, a refund and an edit go through [`RecordPaymentDialog.vue`](../../../front-end/src/components/RecordPaymentDialog.vue), an amount owed through [`ChangeOwedDialog.vue`](../../../front-end/src/components/ChangeOwedDialog.vue), which says the change before "Set amount owed", and "Use the calculated price" and a removal through a confirmation; each line's and each entry's actions sit behind a "..." menu ([`RowMenu.vue`](../../../front-end/src/components/RowMenu.vue)), offered on its row's answer.
The tab teleports the three dialogs to the body, so each opens centred on the window over the drawer, which stays behind it, inert, and Escape closes the dialog alone ([dialogs](../conventions/dialogs.md#the-rules)).
Both dialogs' amount fields are amount fields as [an amount reads to the cent](../../business/rules/an-amount-reads-to-the-cent.md#an-amount-field) says, through `useAmountField` in [`front-end/src/utils/useAmountField.ts`](../../../front-end/src/utils/useAmountField.ts): left, "$35.00" in the account's currency (`currencyOf`, Canadian dollars where the market sets no prices), focused, "35.00"; an edit opens on the entry's amount and an amount owed on the line's, "$0.00" where none is set.

## How it is tested

- `back-end/tests/test_a_vendors_payments.py`: $70 for two Gold full days, the half share, a seat moved from Gold to Silver, an amount set by hand that stays, a freed day's line kept with neither amount changed, every refusal of a payment, who may record, the history entry, and deletion with the market.
- `back-end/tests/test_the_payments_page.py`: the page's vendors as their tabs read, its totals against the sum of the tabs, the sharing by tier and by date to the cent, a vendor owing nothing, a vendor with no table whose payment was removed adding no row, a market with no prices (nobody owing in a payment state, an amount set by hand reading as anywhere, the figures summed by the account rule, a refund beyond what was paid owed back) or nobody, and who may read it.
- `back-end/tests/test_changing_owed_and_paid.py`: an amount set to $0 and taken back, each recorded, and every change in the vendor's own history read; a free ticked and unticked; a refund that squares the account; an edit and a removal with the entry's own history; an Editor refused every one of them, and the deduction before anything is freed; an amount set and a free racing for a new day's record, each losing once, leaving one record that holds both, and a second refusal going on; seating again reading only the records that hold a freed line.
- `back-end/tests/test_a_held_seat_wins_over_a_free.py`: a re-seat after a deducted free owing the new seat even when it stopped before the freed line was cleared, and an Admin's amount still holding on a held seat, and outliving a deducted free that stopped before its seat went and the next write of the day; a deducted free owing $0 whatever stops it after the seat, its "owed set" entry from what the held seat owed, and a free again on a day an older free left owing deducting it once, leaving an Admin's amount and a day with no line alone; a free whose seat write fails leaving nothing a later run could surface, and an Admin's amount as it was; a seat write that landed before its error keeping the day's line, and its $0, and one whose seat cannot be read again keeping the line; a run, a swap and a move clearing a stale freed record of a day held before with no entry, and a run or a placement seating a freed day again recording the taking back; an Admin's amount put back by a re-seat after a deducted free that landed, with its entry from $0 to that amount, and by one that stopped before it forgot the free and the next write of the day, and kept by a move with no free; an Admin's amount changed, or first set, between a free's read and its write kept as the one its $0 replaced, and one that keeps changing refusing the free with nothing freed.
- `back-end/tests/test_a_payment_is_recorded_once_per_press.py`: a payment or a refund pressed again recorded once, with one history entry; a repeat differing in each field, or in kind, refused 409 in its own words with the account as it stands; two presses at once, the second refused by the index, answering the same way; two keys making two entries, no key or a null one recording as before, and every key that is not a UUID refused; the key kept, and never answered or recorded; the boot building the partial index, or refusing naming no address, counting no entry recorded without a key and naming two that share one.
- `back-end/tests/test_one_record_for_a_vendors_day.py`: the boot builds the owed index and refuses on duplicates, naming them without an address, and the check before a release reads `amounts_owed` beside `attendance`.
- `back-end/tests/test_the_exports_money_columns.py`: `accounts` answers each vendor as `vendor_account` does, `balance_state` sorts five vendors into owing, paid in full, paid more and none, a market with no prices offers no payment state and ignores a payment filter where nobody owes, and offers and applies them where an amount was set by hand or a refund went beyond what was paid, `money_text` writes every offered currency as the screen does, and `money_cell` writes no amount a spreadsheet reads as a formula.
- `front-end/src/__tests__/payments.test.ts`, `vendorPaymentTab.test.ts` and `placementDialog.test.ts` (the question, unticked); `aPaymentIsRecordedOncePerPress.test.ts`: the same key on a second press after a lost answer, for a payment and a refund, a new key on a new opening, none on an edit, and a 409's account shown behind the dialog, its refusal kept; `paymentAmountFields.test.ts`: each dialog's amount field focused, typed, left, refocused, refused and left, cleared, and an edit's or an amount owed's fill.
- `front-end/e2e/the-payment-tab.spec.ts`: two Gold full days owe $70, $35 reads "Owes $35.00", $35 more "Paid in full", a freed day keeps its line; "35" typed reads "$35.00" once left and "35.00" focused again, "3x" keeps its error; Record payment, Change owed and a removal's confirmation each centred across the window at 390 and 1440, Record payment's and Change owed's tops held 48px down and the confirmation centred down, the drawer inert behind each, and Escape closing it alone with focus back on what opened it; a Viewer reads the tab with no "Record payment".
  `changing-owed-and-paid.spec.ts`: an Admin sets a $35 line to $0 and back, the field opening on "35.00" and reading "$0.00" once left; frees a paid $15 seat ticked, reads "Paid $15.00 more than owed", records a $15 refund and reads "Paid in full", and finds each change in the drawer's History with who and when; unticked, the line stays $15 owed.
  An Editor freeing the owed seat is asked nothing, its page never reads the account (`mayTake(ChangeOwed)` in `ResultView.vue`), and the line stays $15 owed.
  `exporting-a-payment-reminder.spec.ts` checks the export's "Owes" against the Payments page's "Owes" list too.
  `one-record-for-a-vendors-day.spec.ts`, on the stack's real MongoDB: a second owed record for a vendor's day is refused, and an Admin's amount set and an Editor's free of the same day, sent at once, leave one record holding both, which the tab reads as the freed line owing the amount set; a payment whose first answer is dropped after the server recorded it, pressed again from the same dialog, lists one entry and counts it once in what the vendor paid, and the database refuses a second entry with its key; a second press that differs is refused, with the entry shown behind the dialog.
  [The real-MongoDB suite](../testing/real-mongo-suite.md) builds both unique indexes through the boot, and over two planted owed records of one vendor's day, or two entries of one request key, the boot refuses to start; and it races 20 amounts set by hand against 20 frees of one day with no record, which leave one record, every free landing or answering `OwedChangedUnderFree` ([one record per vendor's day](../testing/real-mongo-suite.md#one-record-per-vendors-day)).
  `the-payments-page.spec.ts`: the Payments page's totals against the sum of three vendors' tabs, each filter and the sort kept by a reload, and a payment recorded in the drawer read on the page again.
  `market-records-go-with-it.spec.ts` finds no payment or amount owed left after a market is deleted.
