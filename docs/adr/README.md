# Architecture decisions

Part of the [knowledge graph](../README.md), implementation layer.
Every file here but this one is a node of kind `adr`, named `NNNN-kebab-title.md`.

An ADR records one architecture decision that clears a three-part bar: it is hard to reverse, it is surprising without its context, and it settled a real trade-off.
It says the context, the decision and its consequences, and links the modules and rules it constrains.
`verified` and `status` are required: `proposed`, `accepted`, or `superseded by NNNN`; a superseded ADR stays, linked from its successor.
A decision that fails the bar is a section of a module node or a rule node instead.

Numbers are taken in order and never reused.
A reserved number whose decision failed the bar is listed as "not written: became" the node that holds it.

## Decisions

- [0001: Essential fields are exactly what the solver reads](0001-essential-fields-are-the-solver-contract.md) - the essential questions are defined by the solver's inputs
- [0002: A pin is a placement row](0002-a-pin-is-a-placement-row.md) - a hand placement is a flagged row of the stored assignment, never a separate constraint
- [0003: Applications are the solver's only input](0003-applications-are-the-solvers-only-input.md) - no spreadsheet behind a market; one seam translates approved applications
- [0004: A priority rule names a target](0004-a-priority-rule-names-a-target.md) - a form field or an application attribute, ordered by its own type, with no declared type
- [0005: The phase is a market's only lifecycle state](0005-phase-is-the-only-lifecycle-state.md) - `isDraft` derived, publishing is `assignment -> market_days`, `archived` means finished
- [0006: Intake mode fails closed](0006-intake-mode-fails-closed.md) - absence means `csv`, so no market has an applicant surface it did not choose
- [0007: What may be sent to hosted TypeSafe](0007-what-may-be-sent-to-hosted-typesafe.md) - one column, a heading, counts and a shape, never a value; the key optional
- [0008: Each write names what it changes](0008-each-write-names-what-it-changes.md) - there is no whole-market write; every write has its own endpoint
- [0009: The back end is the only source of truth about a market](0009-the-back-end-is-the-only-source-of-truth.md) - the browser holds one copy, re-read after every write
- [0010: No secret has a fallback](0010-no-secret-has-a-fallback.md) - a blank or published value is not a secret, and the escape hatch never excuses one
- [0011: A re-import upserts on the market and the address](0011-re-import-upserts-on-market-and-email.md) - a later export updates by address, reopens an approval only on a changed solver answer, and leaves absent rows alone
- [0012: A market remembers every phase it entered](0012-a-market-remembers-every-phase-it-entered.md) - a log of `{phase, enteredAt, by}` on the market, pushed by the one phase writer; an older market says only what it can prove
- [0013: Verdicts settle with the review, and results settle the allocation](0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md) - a verdict is the review's record from assignment on, Publish Results ends re-runs, and an applicant reads the seat, never the verdict
- [0014: Reviewers claim what they look at, and a verdict is a conditional write](0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md) - a five-minute claim keeps reviewers apart, and a verdict lands only on what its reviewer saw
- [0015: The app owns its components](0015-the-app-owns-its-components.md) - no component library or icon font: `AppDialog`, the primitives, native inputs and local SVG icons; a headless library is the first stop for a hard widget
- [0016: One stage where applications arrive and are reviewed](0016-one-stage-for-applications-and-review.md) - `applications` replaces three phases, named Review or Applications by path; stopping applications is a fact about the form
- [0017: One history for every change](0017-one-history-for-every-change.md) - the placement history widened into the market's one history, and the organization's own, each entry an E39 action or the history's own verb; verdicts and the phase record stay as state, the deletion trail apart
- [0018: What of an applicant's answers the market may keep](0018-what-of-an-applicants-answers-the-market-may-keep.md) - only answers at least 3 applicants gave that name nobody, as a column's options; the start keeps them as `exampleColumns`
- [0019: A market's permissions are a table of actions, each with a minimum role](0019-a-markets-permissions-are-a-table.md) - built-in defaults, a market storing only the rows it differs on, changed by its owner alone and every change recorded; an organization's default is copied, and the rules of a market's life stay outside it
