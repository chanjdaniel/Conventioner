---
layer: implementation
kind: module
describes:
  - front-end/src/dev/
  - front-end/src/router/index.ts
  - front-end/vite.config.ts#noDevModules
  - front-end/eslint.config.ts
  - back-end/tests/fixtures/component_library_fixture.py
  - back-end/tests/test_component_library_fixture.py
  - front-end/e2e/helpers/componentLibrary.ts
verified: 2026-11-08
sources:
  - T200
  - T191
  - T211
  - T205
  - T214
  - T223
  - T217
  - T224
---

# The component library

A page of the running app, at `/dev/components`, that shows every reusable component, existing and proposed, in its variants and states, on synthetic data the size of a real market, at a desk's width and a phone's.
It is where a component is looked at, critiqued and workshopped before a screen takes it: Daniel opens it on any local stack, the primary checkout's or a worktree's, with no sign-in and no seeded data.
It is a page of the app's own components, not a component library in [ADR 0015](../../adr/0015-the-app-owns-its-components.md)'s sense, an installed widget kit, which the app has none of.

## Where it lives

**Everything the library alone uses is under [`front-end/src/dev/`](../../../front-end/src/dev/), in `library/`**: the index view, the entry view and its side index, the entries, the parts the entries are drawn with, and the data.
The components it shows live in `front-end/src/components/` with the rest, since screens use them.

**The router registers its two routes only inside `if (import.meta.env.DEV)`** ([`front-end/src/router/index.ts`](../../../front-end/src/router/index.ts)): `/dev/components`, the index, and `/dev/components/:entry`, one entry, each a lazy `import()` of its view, with `meta: { public: true, fitsAPhone: true }`.
They read no API and no store, so they open signed out and on an empty database, and the shell lays them out on a phone.
An `:entry` the library has no entry for shows the app's "page not found".

## How it is kept out of production

**A production build emits nothing of `src/dev/`.**
`vite build` replaces `import.meta.env.DEV` with `false`, so the router's block is dead code and its `import()`s are dropped, and the views and the data are never emitted; in production `/dev/components` falls through to "page not found" as any unknown address does.
The docker stack's front end runs the Vite dev server, so the library is on every local stack and in CI's E2E stack.

**Two checks hold that.**
An ESLint `no-restricted-imports` rule ([`front-end/eslint.config.ts`](../../../front-end/eslint.config.ts), `app/dev-pages-stay-out`) refuses a static import of `src/dev/` from any file outside it but the router, by the `@/dev` alias or by a relative path through a `dev` folder (`src/dev/` is the only one).
And the build itself: `noDevModules`, a plugin in [`front-end/vite.config.ts`](../../../front-end/vite.config.ts), fails a production build when any module under `src/dev/` is in any chunk, naming each, so a dynamic import, a path the rule does not match or the router's block kept alive is caught too ([no development page in the build](../testing/ci-and-the-gate.md#no-development-page-in-the-build)).
`src/__tests__/theComponentLibraryNeverShips.test.ts` drives both through their seams: ESLint over each form of import, and a production build of a shipped module that imports the fixture or a part, refused; `src/__tests__/theComponentLibraryIsDevOnly.test.ts` resolves the two addresses with `DEV` true and false.

## The page

**The index lists every entry, written once and whole** in [`catalog.ts`](../../../front-end/src/dev/library/catalog.ts): its id (its address), its title, what it is, and the places it serves, by T191's survey numbers (C1-C15 for a choice among many, L1-L13 for a long list), a finding, or the screens.
An entry's file is under `entries/`, named for its id in PascalCase with `Entry` after it (`filter-toggles` is `FilterTogglesEntry.vue`), where `import.meta.glob` finds it; the index and the side index link every entry.

**An entry page** ([`LibraryEntryView.vue`](../../../front-end/src/dev/library/LibraryEntryView.vue)) draws the title and the "Serves" line from the catalog, then the entry's file; beside it a side index of every entry at a desk, and a native select of them on a phone.
An entry is drawn from the parts in `parts/`:

- `LibrarySection`: one part of the entry, an `h2` and a line saying what it is, its panels in a grid that is one column on a phone;
- `LibraryPanel`: one variant or state in a labelled box, a region named by its label;
- `TodayAndProposed`: how a place looks today beside how it would look, two columns at a desk, stacked on a phone;
- `ReadOut`: the line under a live demo that reads out its value ("Chosen: North Wing"), so a choice is seen to land;
- `ChoicesForYou`: the note that ends an entry with choices left for Daniel, one item per choice; an entry whose choices are all answered has none.

An entry's own parts sit beside these in `parts/`, such as `PagedApplicationRows` and `SeatRow`.
The `combobox` entry draws [`ChoiceField`](../../../front-end/src/components/ChoiceField.vue) too: the real `ValueFixes` at 12 answers, a select, and at 13, a field, C1's long list of values through `ChoiceField`, which keeps no typed words, C2, "Maps to" as the import builds it, with two targets taken, and C12, "Add an answer", a choice that adds, and C13, the role on the Discord card, a choice that may go back to none.
The `list-frame` entry draws [`PagedList`](../../../front-end/src/components/PagedList.vue) beside `ListFrame`: a box of its own, a page that fails once until "Try again" brings it, and a body-scroll dialog whose body is the box, each with a `ReadOut` of how many it has read.
Each pages the fixture's 359 applications 25 at a time through `pagedRead`, a short timer in the entry in place of a request, so a page is seen to land with no endpoint and no store.

The page uses only the design tokens, the primitives and the app's components; Stylelint holds its files as it holds every file, so a raw colour, size or spacing is an error there.
A state the pointer or the keyboard makes (hover, held down, focus) is drawn held beside the live control by a class of the entry's own that copies what `primitives.css`, or the component it mounts, draws for it (`FileDropZone`'s focus halo); the live control is the one to trust.
A state its component draws from an attribute of its own needs no copy: the entry passes the attribute, as `FileDropZone`'s panel "A file over it, held" passes `data-dragging`, so the component's own rule draws it.
What a proposal would replace is listed by its file and left in its screen rather than copied, as the `proposals` entry lists its one-off badges and five tables, so nothing of a screen's markup lives in the library to drift.

## Its data

**[`fixture.json`](../../../front-end/src/dev/library/fixture.json) is a market at a real market's sizes, every value synthetic**, typed by `fixture.ts`.
[`component_library_fixture.py`](../../../back-end/tests/fixtures/component_library_fixture.py) writes it from the committed synthetic Google Form exports ([test data](../testing/test-data.md)) with the product's own readers: the files through `csv_import.parse_csv`, a choice column's answers split and counted by `csv_proposal.proposal`, and the export's columns and answer filters from `api.vendor_export`'s `offered_columns` and `offered_questions` for a market `csv_start` starts from the four-day grid in memory, with Discord connected and every answer to the question kept, and each vendor's answers to that market's questions from their row, as the import reads a cell.
What no file holds (each application's status and reviewer, each person's role, who reviews, who sits where, each vendor's Discord state and what they have paid) is dealt from a seeded draw in counts the deriver states.

It holds 359 applications (every applicant of the four-day grid with a full name and an address), 150 people with access (the five-day grid's first distinct applicants), 12 reviewers among those who may decide, the question "What kinds of work will you sell?" with its 228 answers and their counts, the 43 answers of the five-day grid the question does not offer, the approved applications seated over four dates in "North Wing" (31 tables, the Gold tier) and "South Wing" (28, Silver), and what the export's preview offers: its 43 columns in its five groups, its default columns, its statuses, dates, sections, tiers, payment and Discord states, and its 6 answer filters.
Each application's `export` holds what those columns and filters read of a vendor, which the `export-vendors` entry reads: there [`exportVendors.ts`](../../../front-end/src/dev/library/exportVendors.ts) answers as the product's server would, so [`ExportVendorsForm.vue`](../../../front-end/src/components/ExportVendorsForm.vue), the dialog that ships, mounted there on the fixture, follows its filters with no endpoint, and its Download only reads out what it would export.
The `summaries` entry reads only each approved vendor's Discord state from it, as the outcome of L9's role run.

**Never edit it by hand**: change the deriver and run `python tests/fixtures/component_library_fixture.py` from `back-end/`.
[`test_component_library_fixture.py`](../../../back-end/tests/test_component_library_fixture.py) fails when the committed file is not exactly its output, and pins every count above, since the library exists to judge a pattern at the size it must work at.
Prettier leaves the file alone (`.prettierignore`), so the bytes stay the deriver's.

## Adding an entry

1. Add its line to `ENTRIES` and write `entries/<Id>Entry.vue` from the parts above, ending with `ChoicesForYou` for what it leaves to choose; the index links it with no other change.
2. Write its spec, `front-end/e2e/the-component-library-<id>.spec.ts`, with [`helpers/componentLibrary.ts`](../../../front-end/e2e/helpers/componentLibrary.ts): `eachWindow` declares its tests at a desk and on a phone, `openEntry` opens it, and `expectLaidOut` holds it to the window's width and to the layout detectors' gating findings.
   It needs no seed and no sign-in.
   An entry that mounts an existing component as it is shows that component's faults too: its spec may leave out a finding the component brings, by name and with why, and fail on every other (`the-component-library-components.spec.ts` leaves out `StepHeader`'s 32px steps, whose one screen is built for a desk).

**A new reusable component gets an entry**, or a panel in the entry its kind belongs to, in the same pull request.

## Why

The library is where T191's large-list patterns are tried on realistic data before any screen converts to them, so a choice is made where it matters: at 359 applications, 150 people and 228 answers.
A page in the app, rather than static pages beside a walk's report, renders the app's own components, styles and tokens faithfully, and once merged it is on Daniel's primary checkout's stack.
It shows the app's own components, which the app owns rather than installs ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)), and the [design language](../../design-system.md#the-primitive-layer) they are drawn in.
