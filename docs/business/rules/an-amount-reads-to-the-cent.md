---
layer: business
kind: rule
describes:
  - front-end/src/utils/pricing.ts#formatPrice
  - front-end/src/utils/pricing.ts#priceText
  - front-end/src/utils/pricing.ts#centsFromText
  - front-end/src/utils/pricing.ts#focusedAmountText
  - front-end/src/utils/pricing.ts#leftAmountText
  - front-end/src/utils/payments.ts#money
  - front-end/src/utils/useAmountField.ts
  - back-end/pricing.py#money_text
  - back-end/api/vendor_export.py#money_cell
  - back-end/tests/fixtures/money_texts.json
verified: 2026-11-03
sources:
  - T191
  - T203
---

# An amount reads to the cent

Every amount the app shows or writes reads in the market's currency with exactly two decimals, "$50.00", "$15.01", "-$15.00", "US$35.00", the same on screen and in the exported file.
Every field where an amount is typed (a Pricing card cell, Record a payment's amount, Change the amount owed) reads the same once left, "$50.00", and gives the plain number to edit while focused, "50.00".

**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

**An amount always shows its cents** (Daniel, T191's walk: "normalize dollar amounts should normalize to show cents ($50.00 rather than $50)"), so "$50.00" and "$15.01" read alike in one column, and a whole amount never reads as a different kind of number from one with cents.
**A price field reads as currency once left** (Daniel, T191's walk: "note that after input in the pricing section it should display as currency"), as the amounts beside it do, so a typed "35" is checked as the price it became.
**The screen and the file write an amount alike**, so a payment reminder says what the vendor's Payment tab says, to the cent.

## The text

- An amount is written in en-CA for every currency, its sign before it: "$35.00" for Canadian dollars, "US$35.00", "€35.00", "£35.00", "A$35.00", "NZ$35.00"; grouped by commas in threes, "$1,234,567.50".
- Below zero, a refund for instance, a hyphen-minus leads it, "-$15.00".
- In a file, where a minus would lead a currency's letters ("-A$15.00", "-US$15.00", "-NZ$15.00", a minus and a cell reference to a spreadsheet), it is the minus sign U+2212 instead, "−A$15.00"; "-$15.00", "-€15.00" and "-£15.00" keep the hyphen-minus, so a spreadsheet reads them as numbers ([J15, export the vendors](../flows/vendors.md#j15-export-the-vendors-to-a-csv)).
- A market that sets no prices writes its amounts in Canadian dollars, the card's own default.

## An amount field

- Left, a field reads its amount as currency in the market's currency, "$50.00" or "US$50.00"; focused, the plain number, "50.00", the caret at its end rather than the number selected.
- It takes a plain number ("50", "50.5"), one led by an offered currency's sign and spaces ("$50", "€ 50"), and the text the app writes, pasted ("$1,234.50", the whole part grouped by commas in threes); a sign is decoration, never a conversion, so the amount is the field's currency's.
- It refuses a minus, a decimal comma ("35,50"), a comma out of place ("1,23"), a third decimal and more than $100,000.00; text it refuses keeps what was typed and its error once left, and a blank stays blank, no amount.
- The text changes only on focus and on leaving, never while typing, so the text under the caret is always what was typed.

## Where it is kept

- The screen writes every amount through `formatPrice` in [`front-end/src/utils/pricing.ts`](../../../front-end/src/utils/pricing.ts), and a vendor's account through `money` in [`front-end/src/utils/payments.ts`](../../../front-end/src/utils/payments.ts), which puts the hyphen-minus before a negative amount; `priceText` in the same pricing file writes a stored price as a plain number to the cent, "35.00".
- An amount field reads its text through `focusedAmountText` and `leftAmountText` in the same file, and takes it back through `centsFromText`, whose currency signs are read off `formatPrice` itself, so every text the screen writes is one a field takes back; `front-end/src/__tests__/pricing.test.ts` reads every case of the table below at or above zero back to its cents.
  `useAmountField` in [`front-end/src/utils/useAmountField.ts`](../../../front-end/src/utils/useAmountField.ts) is a field's focus and leaving, and `useAmountCaret` there its caret at the end, under a mouse press too.
  The Pricing card's cells ([`ElementPricing.vue`](../../../front-end/src/components/elements/ElementPricing.vue)) are such fields, on [planning the market](../flows/planning.md#e9-pricing), and so are Record a payment's amount and Change the amount owed, on the vendor's Payment tab ([payments, and what a vendor owes](../../implementation/data/payments.md)); `front-end/src/__tests__/paymentAmountFields.test.ts` pins the two dialogs' fields.
  An E2E spec focuses such a field before it fills it ([E2E patterns](../../implementation/testing/e2e-patterns.md#sharp-edges)).
- The file writes every amount through `money_text` in [`back-end/pricing.py`](../../../back-end/pricing.py), its currency signs in `CURRENCY_SIGNS` there, and `money_cell` in [`back-end/api/vendor_export.py`](../../../back-end/api/vendor_export.py) applies the minus sign rule.
- One table of cases, [`back-end/tests/fixtures/money_texts.json`](../../../back-end/tests/fixtures/money_texts.json) (`cents`, `currency` or null, `text`), is the rule's evidence on both sides: `test_the_exports_money_columns.py` runs `money_text` over every case and `front-end/src/__tests__/moneyTexts.test.ts` runs `money` over every case, so a case added there is checked on screen and in the file at once.
- What a vendor owes and paid, and where each amount is shown, are [payments, and what a vendor owes](../../implementation/data/payments.md); what a table costs is [a price follows the table](a-price-follows-the-table.md).
