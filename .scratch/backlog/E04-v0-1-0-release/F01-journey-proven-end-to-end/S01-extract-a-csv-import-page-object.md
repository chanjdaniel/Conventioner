---
id: E04/F01/S01
title: Extract a CSV import page object
type: story
status: done
blocked_by: []
pr: [#66]
---

## What to build

The CSV import wizard is driven through a page object, the way every other organizer surface in the
e2e suite is.

`csv-import.spec.ts` is 645 lines that drive the upload, mapping, value-resolution and preview steps
inline. The journey story that follows needs to drive the same wizard, and without this it would
copy that driving rather than reuse it.

This is a prefactor: no product behaviour changes, and the import suite must still assert exactly
what it asserts today.

## Acceptance criteria

- [ ] A `CsvImportPage` under the e2e page objects wraps the wizard's steps, following the
      `MarketSetupPage` / `ManageMarketPage` pattern: `getByTestId()` selectors, action methods
- [ ] `csv-import.spec.ts` uses it throughout, and no longer reaches for raw selectors on the wizard
- [ ] Every test in the import suite still passes, with its assertions unchanged
- [ ] Any `data-testid` added is purely additive - no product behaviour changes
- [ ] The spec is materially shorter, and what each test is *about* is readable without scrolling
      through wizard mechanics
