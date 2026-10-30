---
layer: business
kind: flow
describes:
  - front-end/src/components/market/MarketPlanTab.vue
  - front-end/src/components/elements/ElementPricing.vue
verified: 2026-10-30
sources:
  - wayfinding/the-order-of-the-work/02
  - wayfinding/the-order-of-the-work/03
  - wayfinding/the-plan-uses-its-space/01
  - wayfinding/the-plan-uses-its-space/02
  - E18/F01/S01
  - E18/F04/S01
  - E23/F01/S01
  - E28/F01/S01
  - E31/F01
  - E31/F02
  - E33/F01
  - E18
  - bug/16
  - bug/23
  - bug/25
  - bug/30
  - bug/38
  - E23/F02/S01
  - T15
  - E43/F01/S01
  - E43/F01/S02
---

# Planning the market

**Who:** the market's Editor, Admin or owner, while the market is a draft.
**Where they start:** Market Setup, the page a draft opens on ([`MarketPlanTab.vue`](../../../front-end/src/components/market/MarketPlanTab.vue)).
**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

Market Setup is one scrolling page of cards that saves itself: Market Dates, Tier Setup, Location Setup, Section Setup, Pricing, How vendors apply, and Application form.
The cards run in the order the work depends on, the plan before the form built from it, and the page says that order by position rather than enforcing it: every card is reachable at once, so the page can be left and resumed, and changing one value never means walking through the rest.
It is deliberately not a wizard; the floorplan flow ([E6](#e6-sections-from-a-floorplan)) is the product's one wizard.
A draft opens on Market Setup, and an address naming a tab opens that tab, so a shared link keeps working.
"Plan saved" appears after each edit (debounced about 0.6 s); a failed save says "Could not save the plan. Retry in a moment."
One edit is one save, and another tab's edits survive it (bug 25, `plan-saves-once.spec.ts`).
Any pending edit is saved before a phase move, so the guards judge what the organizer sees.
The cards share rows by the design language's one rule ([a screen of cards is a two-track grid](../../design-system.md#layout)): Market Dates, Section Setup and Pricing are wide, Tier Setup sits beside Location Setup, and How vendors apply beside Application form, at every width with room for two.
The plan is the market's setup, and it settles when the market leaves Draft ([E7](#e7-edit-the-plan-after-draft)); leaving Draft asks for dates none of which has passed, a location, and tables at every tier ([the lifecycle](lifecycle.md#what-refuses-a-move)).

**Task for the section:** "Your market runs on two Saturdays in October in Pier Hall, with 4 premium tables in the North Row and 6 standard tables in the South Row. Set that up."

## E1. Market dates

**Status:** Works (walked live; the list beside the calendar read from the code as of E28/F01/S01).

1. In "Market Dates", step months with the arrows and click days to toggle them.
2. Expect the chosen days listed one to a row under their month, flowing in columns beside the calendar ("Sat 3 ×"), with a count ("2 market days", or "No market days yet").
3. Remove a day with its "×" or by clicking it again; a month's name in the list shows that month on the calendar, and the month on show is marked in the list.

The calendar sits on the left at 360px and the list beside it takes the rest of the card; with too little room the list goes under the calendar.
The list grows by months, a heading per month with its days a row each, flowing in columns no taller than the calendar, so twenty dates fill the room beside it rather than running below it, and every year stays in view where a market crosses one.

Dates are a calendar with the market's days marked because it reads the same for a two-day market and a twelve-day one, and leaves no native date input whose popup has to be placed.
Dates are calendar days and must show as the same day in every time zone; a calendar does month arithmetic, the likeliest place to read a day as an instant, which `date-display-timezone.spec.ts` guards.
The calendar opens on the current month and has no month or year jump.
It accepts a date in the past without comment; leaving Draft is refused while one is in the plan.
Each day is a toggle button named by its full date ("Monday, November 20, 2023").
The solver fills the dates one at a time, in the order they were picked ([dates fill one at a time, in the plan's order](../rules/dates-fill-in-calendar-order.md)).
Covered by: `market-dates-by-month.spec.ts`, `date-display-timezone.spec.ts`.

## E2. Tiers

**Status:** Works (walked live).
"+" adds a row; drag to set priority (1 is best); "×" removes; a tier no section uses shows "No tables", and leaving Draft is refused until it has some.

## E3. Locations

**Status:** Works (walked live).
"+" adds a row; type a name.
A market needs at least one before it leaves Draft.

## E4. Sections

**Status:** Works (walked live).
"+" adds a row of name, Location, Tier and Count; "Total tables" sums the counts; tables are named after their section ("North Row 1" to "North Row 4").
A section may have no tier; a plan without tiers assigns, and its form asks no tier preference (bug 23; re-walked live as P1).
Covered by: `plan-cards-share-a-row.spec.ts`, `sizing-model.spec.ts`, `untiered-plans-assign.spec.ts`, `market-pipeline.spec.ts`, `alignment.spec.ts`.

## E5. How vendors apply

**Status:** Works (walked live).

1. Choose "I collect applications elsewhere" ("You import a spreadsheet of the responses you already have.") or "Vendors apply on this market's page" (the form goes live at `/<market-slug>/apply` while applications are open); the create-market dialog asked first, so one is already chosen.
2. It saves at once, and is greyed out once the market leaves Draft: "This is fixed once a market leaves draft, because changing it would strand whatever the previous choice produced."

Under it, "Start from my Google Form's responses" opens the start from a Google Form ([G2](starting-from-a-google-form.md#g2-from-an-existing-draft)) and leaves this choice as it is.
A market whose vendors are imported has applicant pages that answer exactly as a nonexistent market's ([a gated market answers as absent](../rules/a-gated-market-answers-as-absent.md)).
Covered by: `intake-mode.spec.ts`.

## E6. Sections from a floorplan

**Status:** Beta (steps 1 to 4 walked live; grouping by lasso not driven); "Auto-Place Tables" places the count asked for of each type (bug 38, `the-floorplan-beta-places-tables.spec.ts`).
Offered as "Set up sections from a floorplan instead" on Section Setup while the plan has no sections and the market is a draft.

1. "Choose your setup path": "Manual setup" (Recommended, "Get started") or "From a floorplan" (Beta, "Try the beta").
2. `/markets/<id>/floorplan`, a five-step wizard with "← Back" and "Next →":
   1. **Upload:** drop or "Browse Files" (PNG, JPG, WebP, PDF; a PDF asks which page).
   2. **Calibrate:** drag a reference line starting on the image, "Enter Reference Length" with a unit, "Calibrate", "Done" (or "Redraw").
   3. **Place Tables:** define "Table Types" (name, width, height, unit, max capacity), optionally "Save as Template" / "Load Template", then "Auto-Place Tables", which asks how many of each type to place and says how many fitted.
   4. **Edit Layout:** draw walls and no-go zones with the "Wall Editor" toggle, move tables, "Group Sections" by lasso and "Assign Section" (name, location, optional tier), "Export PNG" with or without table codes and sections; "Next" stays disabled until sections are grouped.
   5. **Save:** "Review & Save Floorplan" lists totals, sections and locations with editable names; "Save & Continue" writes the sections to the plan.

The wizard makes no AI calls; placement is a geometry solver ([floorplan placement](../../implementation/modules/floorplan-placement.md)).
Only one table type is used by assignment in this release ([F6](form-tab.md#f6-table-type-preference)), and the path's card says so.
Past Draft the flow says the setup is settled and offers nothing to draw (`what-to-show-and-when.spec.ts`).
Covered by: `floorplan.spec.ts` (grouping and editing are driven through store state, not real gestures), `the-floorplan-beta-places-tables.spec.ts`.

## E7. Edit the plan after Draft

**Status:** Works, as changed by E31/F01: the setup no longer changes after Draft (read from the code: `setup_lock_reason` in `back-end/api/markets.py`; `what-to-show-and-when.spec.ts`, "past draft the setup is settled, and a form market imports nothing").
Once the market leaves Draft every card on Market Setup is disabled under one line: "The setup is settled: it cannot change once applications have opened, because applicants and the table allocation rely on it." (on the Google Form path, "once its responses have been imported").
While nobody has applied it adds the way back: "While no one has applied, go back to draft to change it: Reopen for Editing, under More… on the phase rail."
The Application form card is not shown past Draft.
On an archived market every page is read only, and says so (bug 30).
A person who may change nothing finds every card disabled too, and reads why once, above the page ([what each role may do](../rules/what-each-role-may-do.md)); the plan's own line says only that the setup settled (T15).

What still changes after Draft, and where:

- the assignment rules (priority and options), on the Assignment tab, until the market can no longer return to Assignment or its results are published ([J14](assignment-and-result.md#j14-the-rules-close-with-the-assignment));
- what a reviewer reads first, on the form tab's Review setup, in every phase but Archived, and the automatic rejections there until the market reaches Assignment ([F3](form-tab.md#f3-what-a-reviewer-reads-first)).

What else freezes, and when:

- the intake mode, when the market leaves Draft (E5);
- the essential questions' offering, at the first applicant answer, so a plan edit in Draft no longer changes the form once anyone has applied ([F1](form-tab.md#f1-the-essential-questions));
- the setup itself, so no placement can lose its seat to a plan edit; an orphaned pin ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds)) is reached only by changing a settled plan in the database, as specs do.

## E8. Application form readiness

**Status:** Works (re-walked live on 2026-10-03).
While the market is a draft, the "Application form" card says what the plan still lacks ("Add dates, tiers, two or more sections above, and this form will have something to ask about."), offers "Build the application form" once it can, and once the form has questions of its own or is locked says so, with "Open the application form" or "See the application form" (bug 16).
Covered by: `the-words-say-what-is-true.spec.ts` ("the plan says what the application form is").

## E9. Pricing

**Status:** Works (E43/F01/S01, S02; `the-pricing-card.spec.ts`, `price-groups.spec.ts`).
Optional: a market with no prices shows no price anywhere ([a price follows the table](../rules/a-price-follows-the-table.md)).

1. In "Pricing" ([`ElementPricing.vue`](../../../front-end/src/components/elements/ElementPricing.vue)), the columns are the plan's tiers and the last row is "Everyone else"; type a full table's price for one market day in each tier's cell ("35" or "35.50"), or leave it blank for no price.
   "Add a group" adds a row above it, its name field focused, with a column "In the group when" beside its prices: name it ("UBC student + club member"), add a condition on one of the form's questions with answers to choose ("Which clubs are you a member of? includes any of", then tick the answers that meet it), as many as must all hold, and price it per tier.
   A group with another group's name says "Another group is called this.", and one left with no name "Name this group."; either way the plan waits to save until it is fixed; "Remove group", under the name, takes the row away.
   A vendor pays the cheapest group they are in at their table's tier, and "Everyone else" when they are in none ([a price follows the table](../rules/a-price-follows-the-table.md#price-groups)).
   A condition on a question the form no longer asks, or an answer it no longer offers, is drawn red with what is missing, headed "A question no longer on the form" where the question is gone, and until it is fixed Open Applications waits, the rail naming the group, and from another page of the market the rail offers "Fix the price groups".
   A form that asks no question with answers to choose offers no group: the card says every vendor pays "Everyone else".
2. "Half table costs [50] % of a full table" sets a half table's share, a whole number from 0 to 100.
3. "Currency" is the market's one currency, "CAD - Canadian dollars" until another is picked.
4. Expect "Plan saved"; a cell shows what is typed until it is left, then the price as kept ("35.5" becomes "35.50").
5. A cell that is not an amount turns its border red, and the card says "Enter a price like 35 or 35.50, or leave it blank for no price."; a share that is not a whole number from 0 to 100 says "The half table's share is a whole number from 0 to 100."
   Either keeps the value it had before the typing - a blank cell keeps no price, never the prefix before the error ("3" then "3x" keeps nothing) - and the plan waits to save until it is fixed, so "Plan saved" never stands beside text that was not kept.

A tier renamed in Tier Setup keeps its price, and a removed tier's price goes with it; a plan with no tiers says "Prices are set by tier. Add a tier in Tier Setup to price its tables." and offers neither the share nor the currency until it has one.
Each assignment then shows its price on its date card in the vendor drawer ("Gold, full table, $35", naming the vendor's group where the card has groups; [the vendor drawer](vendor-drawer.md)).
The card sits after Section Setup because its columns are the tiers the sections give tables, and it settles with the rest of the setup (E7).

## Superseded

- Market Setup was to stay editable past Draft, its cards simply no longer gated (wayfinding/the-order-of-the-work/02); the setup settles on leaving Draft ([E7](#e7-edit-the-plan-after-draft), E31/F01).
- Each card was to take the page's full width; the cards share rows in a grid, and only the dates, sections and pricing cards are wide (E23/F01/S01).
- The application form was to be built in a gated card on this page, and opening applications to be the page's last section (wayfinding/the-order-of-the-work/02); the form is built on its own tab, in steps (E33/F01), the plan's card only says whether it can be built ([E8](#e8-application-form-readiness)), and the move out of Draft is the rail's main button (E31/F02).
- The chosen days were to be chips, one line per month (wayfinding/the-plan-uses-its-space/02); each day is a row under its month, the months flowing in columns beside the calendar (E28/F01/S01).
- Within Draft the market was to open at its earliest incomplete stage, the plan and then the form (wayfinding/the-order-of-the-work/03); a draft opens on Market Setup, whose form card says when the form can be built.

## The rules it obeys

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md).
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md).
- [The assignment rules close with the assignment](../rules/the-assignment-rules-close-with-the-assignment.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md).
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).
- [What each role may do](../rules/what-each-role-may-do.md): the plan is an Editor's.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
