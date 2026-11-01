---
layer: business
kind: flow
describes:
  - front-end/src/views/PaymentsView.vue
  - front-end/src/utils/paymentsPage.ts
  - back-end/api/payments.py#market_payments
  - back-end/payments.py#market_summary
verified: 2026-11-01
sources:
  - T92
  - E44/F02/S01
---

# Payments

**Who:** anyone who can read the market, a Viewer included; the page changes nothing itself, and recording or changing a payment is done in the vendor's drawer, on the rows that allow it ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Payments page, the Assignment tab's fourth page, beside Settings, Assignments and Vendors ([the market frame](../../implementation/modules/market-frame.md)), at `/markets/<id>/payments` ([every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md)).
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

The Payments page ([`PaymentsView.vue`](../../../front-end/src/views/PaymentsView.vue)) is the market's money at a glance, who has yet to pay, and whose refund is to be issued (Daniel, T92 Q16, Q26).
Money lives here and in [the vendor drawer](vendor-drawer.md)'s Payment tab only; the Vendors page shows none of it (Q17).
The server counts all of it in one answer (`GET /markets/<id>/payments`, `market_payments` in [`back-end/api/payments.py`](../../../back-end/api/payments.py)), each vendor's account read as their Payment tab reads it ([payments, and what a vendor owes](../../implementation/data/payments.md)), so the page and the tab never disagree; [`market_summary` in `back-end/payments.py`](../../../back-end/payments.py) adds them up, and [`paymentsPage.ts`](../../../front-end/src/utils/paymentsPage.ts) keeps the list's filter, search and sort.

## J17. Read the market's money, and find who owes and whose refund is due

**Status:** Works (read from the code as of E44/F02/S01: `the-payments-page.spec.ts`).

1. "The market's money" heads the page with four figures: Owed, the sum of every table-day line, a freed table's kept line included; Paid, the sum of every payment and refund still standing; Still owed, what the vendors who have not paid in full owe between them; and Paid more than owed, what vendors paid beyond what they owe, the refunds to issue.
2. "By tier" and "By date" give the same four figures per tier, in the market's order, and per market day.
   A payment is a vendor's, not a day's, so what each vendor paid is shared across their table-days by what each owes (evenly where they owe nothing), to the cent; what a vendor holding no table paid stands on a row of its own, "No table".
   Each breakdown adds up to the four figures, and the page says how a payment is shared under them.
3. "Vendors" lists every vendor with a table-day line or a payment, a vendor whose table was freed included, by name with their address beneath: Owed, Paid, and the Difference in the Payment tab's words, "Owes $35", "Paid in full", "Paid $7.50 more than owed" or "Nothing owed".
4. "Owes", "Paid in full" and "Paid more than owed" each narrow the list to the vendors in that state, with how many there are; "Paid in full" is every vendor who is square and owed something, so a vendor who owes nothing and paid nothing, "Nothing owed", is in none of the three, and is listed only unfiltered; pressed again, a filter is cleared.
   The states are the server's, the ones the export's "Payment" filter reads ([J15](vendors.md#j15-export-the-vendors-to-a-csv)), so the page's "Owes" and an export of "Owes" list the same vendors.
   "Search vendors" finds a vendor by name or address within it, and "N of M vendors shown" counts what is left.
5. Each column's heading sorts the list by it, pressed again the other way: the vendor A to Z to begin with, an amount largest first; the Difference sorts who owes most first, and paid more than owed last.
6. The filter, the search and the sort are in the address (`show`, `search`, `sort` and `order`), so a reload or a shared link shows the same list.
7. A row opens the vendor's drawer on its Payment tab, the filter kept under it; a payment recorded or an amount changed there is read on the page again at once.

A market that sets no prices says "Pricing is off for this market, so nobody owes anything for a table." with a link to Market Setup, whose Pricing card sets them ([a price follows the table](../rules/a-price-follows-the-table.md)); its vendors are still listed, with what they owe and what they paid.
There a table owes nothing but an amount someone set by hand, so the reading follows each vendor's account, not the market (T153 review findings 8, 10 and 14):
- a vendor owing nothing is in no payment state, and a payment of theirs is never "more than owed": its Difference reads what was paid, "Paid $35", untoned, as their Payment tab does;
- a vendor owing an amount set by hand reads, tones and filters as on a priced market: "Owes $10", or "Paid $15 more than owed", a refund to issue;
- a vendor owing nothing who was refunded beyond what they paid (a $10 payment and a $25 refund) owes the difference back to the market, so reads, tones and filters as owing: "Owes $15".

Where nobody owes, the page shows no figures, since nothing is owed to compare what was paid with, and offers no filter, since whoever paid would all be "Paid more than owed" and the refunds filter would be everyone (Daniel, T153 review finding 3), and a filter in the address narrows nothing; the search and the sort stay.
Where someone owes, by an amount set by hand or a refund beyond what they paid, the note says "Pricing is off for this market, so a vendor owes only an amount set by hand on their Payment tab." and the three filters are offered, each listing the vendors in that state.
"The market's money" is drawn there too, summed by the same rule as the rows (T153 review finding 12): what a vendor owing nothing paid counts toward Paid, in the totals and each tier's and date's share, but never toward Paid more than owed.
So Paid less Owed need not equal Paid more than owed less Still owed there; where some vendor owing nothing paid, a caption under the figures says "\"Paid\" includes what vendors who owe nothing paid; only a vendor who owes can pay more than owed.", and where every vendor who paid owes, it is not drawn (finding 15).
The vendor export does the same: its "Payment" filter is offered only where the page's are, the server ignores one sent where nobody owes, and applies it by the same state where someone does ([J15, export the vendors](vendors.md#j15-export-the-vendors-to-a-csv)).
Before a run, with nobody seated and nothing paid, the page says nothing is assigned yet, as the Vendors page does.

Covered by: `the-payments-page.spec.ts` (the totals against the sum of the vendors' Payment tabs, each filter and a reload, a vendor freed with the seat taken off what they owe in no filter, the sort in the address, a Viewer, a market with no prices and no filter, its payments reading "Paid $35" on the page and the Payment tab and its export offering no payment filter, then an amount set by hand reading "Paid $15 more than owed" with the filters back on the page and the export, and the market's money drawn with Paid more than owed $15 alone and the caption, which goes once every vendor who paid owes), `back-end/tests/test_the_payments_page.py` (the sums, the sharing by tier and by date, a refund beyond what was paid owed back, and who may read it) and `front-end/src/__tests__/paymentsPage.test.ts` (the filters, the sort, the search and when the caption is drawn), and `exporting-a-payment-reminder.spec.ts` (the page's "Owes" against the export's).
