---
layer: business
kind: flow
describes:
  - front-end/src/components/market/MarketPlanTab.vue
  - front-end/src/components/elements/ElementPricing.vue
verified: 2026-11-11
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
  - T205
  - T217
  - T263
  - T257
  - T271
---

# Planning the market

**Who:** the market's Editor, Admin or owner, while the market is a draft.
**Where they start:** Market Setup, the page a draft opens on ([`MarketPlanTab.vue`](../../../front-end/src/components/market/MarketPlanTab.vue)).
**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

Market Setup is one scrolling page of cards that saves itself: Market Dates, Tier Setup, Location Setup, Section Setup, Pricing, How vendors apply, and Application form.
The cards run in the order the work depends on, the plan before the form built from it, and the page says that order by position rather than enforcing it: every card is reachable at once, so the page can be left and resumed, and changing one value never means walking through the rest.
It is deliberately not a wizard; a location's layout has a page of its own ([E6](#e6-a-locations-layout)).
A draft opens on Market Setup, and an address naming a tab opens that tab, so a shared link keeps working.
"Plan saved" appears after each edit (debounced about 0.6 s), once the server holds the last edit.
A save that failed on the way keeps the edit on screen, says why ("You seem to be offline. Check the connection and try again.", say), and offers Retry; one the server refused puts the plan back as the server holds it, and says the server's sentence and "The plan is back as it was last saved."
One edit is one save, and another tab's edits survive it (bug 25, `plan-saves-once.spec.ts`).
The saves go one at a time, so a slow save never stores an older plan over a later edit (T271); how the page saves itself is [the plan's autosave](../../implementation/modules/plan-autosave.md).
Any pending edit is saved before a phase move, so the guards judge what the organizer sees; a plan that did not save stops the move, Allocate tables and the start from a CSV, each saying why.
The cards share rows by the design language's one rule ([a screen of cards is a two-track grid](../../design-system.md#layout)): Market Dates, Section Setup and Pricing are wide, Tier Setup sits beside Location Setup, and How vendors apply beside Application form, at every width with room for two.
The plan is the market's setup, and it settles when the market leaves Draft ([E7](#e7-edit-the-plan-after-draft)); leaving Draft asks for dates none of which has passed, a location, tables at every tier, and Review setup's two decisions ([the lifecycle](lifecycle.md#what-refuses-a-move), [review waits on the review setup](../rules/review-waits-on-the-review-setup.md)).
Covered by:

- `plan-saves-once.spec.ts`
- `the-plan-saves-one-at-a-time.spec.ts`

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
Covered by:

- `date-display-timezone.spec.ts`
- `market-dates-by-month.spec.ts`

## E2. Tiers

**Status:** Works (walked live).
"+" adds a row; drag to set priority (1 is best); "×" removes; a tier no section uses shows "No tables", and leaving Draft is refused until it has some.

## E3. Locations

**Status:** Works (walked live).
"+" adds a row; type a name.
A market needs at least one before it leaves Draft.
Removing a location that has a layout ([E6](#e6-a-locations-layout)) asks first, "Remove Upper Hall?", "Its layout of 49 tables goes with it.", with "Remove location and layout" and Cancel, since the layout goes with its location; one with no layout is removed at once.

## E4. Sections

**Status:** Works (walked live).
"+" adds a row of name, Location, Tier and Count; "Total tables" sums the counts; tables are named after their section ("North Row 1" to "North Row 4").
A section of a location that has a layout ([E6](#e6-a-locations-layout)) has no Count to type: the cell reads the number of tables the layout places in it, "13" with "from the layout" under it, and "Total tables" sums those with the typed ones.
A section may have no tier; a plan without tiers assigns, and its form asks no tier preference (bug 23; re-walked live as P1).
Covered by:

- `alignment.spec.ts`
- `market-pipeline.spec.ts`
- `plan-cards-share-a-row.spec.ts`
- `sizing-model.spec.ts`
- `untiered-plans-assign.spec.ts`

## E5. How vendors apply

**Status:** Works (walked live).

1. Choose "I collect applications elsewhere" ("You import a spreadsheet of the responses you already have.") or "Vendors apply on this market's page" (the form goes live on the market's vendor page, `/<market-slug>`, while applications are open); the create-market dialog asked first, so one is already chosen.
2. It saves at once, and is greyed out once the market leaves Draft: "This is fixed once a market leaves draft, because changing it would strand whatever the previous choice produced."

Under it, "Draft from a Google Form's responses" opens the start from a Google Form ([G2](starting-from-a-google-form.md#g2-from-an-existing-draft)) and leaves this choice as it is.
A help line under the button says, by the choice above as it is clicked, that it drafts the market's dates, tiers and questions and imports no one, and how vendors come in after: on the market's page, or by Import responses, the phase rail's next step, once the market is ready (T205).
A market whose vendors are imported has applicant pages that answer exactly as a nonexistent market's ([a gated market answers as absent](../rules/a-gated-market-answers-as-absent.md)).
Covered by:

- `intake-mode.spec.ts`
- `where-a-form-starts.spec.ts`

## E6. A location's layout

**Status:** Begun (T257): a location's floorplan, its scale and tables placed, moved, turned, duplicated, lined up, renumbered and removed, one or several at a time; rows, areas, zones, types and the layout after Draft come with T257's later tickets.
Under Section Setup's rows, each named location offers "Lay out Upper Hall", or "Open Upper Hall's layout · 49 tables" once it has one; a location with no name offers nothing until it has one, and a plan that cannot change offers only the layouts it has, to read.
Opening one saves the plan's pending edits first, then goes to `/markets/<id>/layout/<location>`, under the Market Setup tab; `/markets/<id>/layout` opens the first location's, and the floorplan beta's old address, `/markets/<id>/floorplan`, lands there too.

1. **Upload:** "Drop the floorplan's image or PDF here, or choose a file", the app's one drop zone, with "Upload the venue's floorplan for Upper Hall to start." beside it.
   PNG, JPG, WebP or PDF up to 4 MB: a larger image is made smaller first, a larger PDF is refused ("This PDF is larger than 4 MB. Export the page with the plan on it as a PNG or a smaller PDF."), and so are a PDF of more than 20 pages and one that cannot be read ("Venue plan.pdf could not be read as a PDF."), each said as an alert; a PDF of several pages shows the page chosen with "Use page N".
   The image chosen starts the layout: the server records what Section Setup had for each of the location's sections, and a market with no table type gains "Standard 6 ft".
2. **Set the scale:** "Drag across something whose length you know, like a wall or a door.", by pointer or with the arrow keys and Enter; type its length in m, cm, mm, ft or in, and "Set the scale".
   The head row then reads "30.0 m across" (before, "Not calibrated"), and "Recalibrate" draws the line again.

3. **Place the tables:** at a desk the map is an editor, with a toolbar over it: Select, Add table, Undo, Redo, Zoom out, Zoom in, Fit.
   - "Add table" then a click on the floor places a table of the Section and Table type chosen under the toolbar, "Gold row 1", then "Gold row 2", at its true size; the tool stays on.
   - A press selects a table (Shift or Ctrl for more), a box dragged on the floor every table whose centre is in it, Ctrl+A all of them and Escape none; the panel's card reads the selection: one table's code, section, type and position in metres, or "3 tables selected" and their codes.
   - The card's Section and Table type fields change the selection's. Tables put in another section are numbered after its own, so 3 of Gold row's 9 put in Silver aisle (of 18) become Silver aisle 19 to 21, and Gold row closes to 1 to 6.
   - "Duplicate" puts a copy of each selected table beside it, numbered on, and the Align menu lines several up by an edge or a centre, or spaces them evenly across or down.
   - A drag moves the selection; near another table's edge or centre it snaps, with a guide line, and Alt places it freely; a table's centre never leaves the floorplan.
   - The handle over a selected table turns it in 15° steps (Alt: freely), and R or "Turn 90°" by a quarter; its number turns with it.
   - "Remove" takes the selection away with no question, since Undo brings it back; in Draft the section's later tables close the gap, so removing "Gold row 2" of 4 leaves 1 to 3.
   - Undo and Redo, by their buttons or Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y, take back and bring back each change, across saves.
   - The wheel or two fingers move the view, Ctrl and the wheel or a pinch zoom it, and Space and a drag pan.
4. **Sections on the layout:** the panel lists "Sections in Upper Hall", each with its colour, tier and count.
   - A section's swatch opens eight colours to choose from, and its name on the map is dragged to where it should stand.
   - Its row's menu has "Renumber by position (rows across the page)", which numbers its tables in rows from the top, each from the left.
   - A section removed on Section Setup leaves its tables on the layout, grey and numberless: "3 tables are in no section", with "Select them", to put them in a section from the card or remove them.
     Until then the market stays a draft: "Upper Hall's layout has 3 tables in no section. Put them in a section or remove them.", with "Open the layout" on the rail.
   - While a section has fewer tables than Section Setup had typed for it when the layout began, the panel says so: "Section Setup had Gold row at 13: 9 placed."

The layout is edited at a desk: at a phone's width it is read.
It saves itself a moment after each change, the head row saying "Saving…" then "Saved"; a save that did not land says why with Retry and keeps what is on screen, a move to another page then asks "Leave without saving?" first, and a reload or a closed tab with a change still waiting is asked by the browser first.
The head row's switch moves between the market's locations, each its own layout, and when another tab or person saved the layout first it says "This layout changed elsewhere. Reload to see the latest." with Reload, the tab keeping what it shows until then.
The layout makes no AI calls ([floorplan placement](../../implementation/modules/floorplan-placement.md)).
Only one table type is used by assignment in this release ([F6](form-tab.md#f6-table-type-preference)).
Past Draft the layout says the setup is settled and offers nothing to upload (`what-to-show-and-when.spec.ts`).
Covered by:

- `a-layout-saves-once.spec.ts`
- `a-table-moves-by-pointer.spec.ts`
- `numbers-follow-the-rules.spec.ts`
- `the-layout-draws-as-a-map.spec.ts`
- `the-layout-takes-the-same-zone.spec.ts`

## E7. Edit the plan after Draft

**Status:** Works, as changed by E31/F01: the setup no longer changes after Draft (read from the code: `setup_lock_reason` in `back-end/api/markets.py`; `what-to-show-and-when.spec.ts`, "past draft the setup is settled, and a form market imports nothing").
Once the market leaves Draft every card on Market Setup is disabled under one line: "The setup is settled: it cannot change once applications have opened, because applicants and the table allocation rely on it." (on the Google Form path, "once its responses have been imported").
While nobody has applied it adds the way back: "While no one has applied, go back to draft to change it: Reopen for editing, under More… on the phase rail."
The Application form card is not shown past Draft.
On an archived market every page is read only, and says so (bug 30).
A person who may change nothing finds every card disabled too, and reads why once, above the page ([what each role may do](../rules/what-each-role-may-do.md)); the plan's own line says only that the setup settled (T15).

What still changes after Draft, and where:

- the assignment rules (priority and options), on the Assignment tab, until the market can no longer return to Assignment or its results are published ([J14](assignment-and-result.md#j14-the-rules-close-with-the-assignment));
- what a reviewer reads first, on the form tab's Review setup, in every phase but Archived, and the automatic rejections there until the market reaches Assignment ([F3](form-tab.md#f3-what-a-reviewer-reads-first));
- the Discord card, in every phase until the market is archived, since it is a manual tool rather than part of the plan ([the Discord connection](../../implementation/modules/discord.md)).

What else freezes, and when:

- the intake mode, when the market leaves Draft (E5);
- the essential questions' offering, at the first applicant answer, so a plan edit in Draft no longer changes the form once anyone has applied ([F1](form-tab.md#f1-the-essential-questions));
- the setup itself, so no placement can lose its seat to a plan edit; an orphaned pin ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds)) is reached only by changing a settled plan in the database, as specs do.

## E8. Application form readiness

**Status:** Works (re-walked live on 2026-10-03).
While the market is a draft, the "Application form" card says what the plan still lacks ("Add dates, tiers, two or more sections above, and this form will have something to ask about."), offers "Build the application form" once it can, and once the form has questions of its own or is locked says so, with "Open the application form" or "See the application form" (bug 16).
Covered by:

- `the-words-say-what-is-true.spec.ts` ("the plan says what the application form is")

## E9. Pricing

**Status:** Works (E43/F01/S01, S02; `the-pricing-card.spec.ts`, `price-groups.spec.ts`).
Optional: a market with no prices shows no price anywhere ([a price follows the table](../rules/a-price-follows-the-table.md)).

1. In "Pricing" ([`ElementPricing.vue`](../../../front-end/src/components/elements/ElementPricing.vue)), the columns are the plan's tiers and the last row is "Everyone else"; type a full table's price for one market day in each tier's cell ("35", "35.50" or "$35"), paste one ("$1,234.50"), or leave it blank for no price.
   "Add a group" adds a row above it, its name field focused, with a column "In the group when" beside its prices: name it ("Example College student + club member"), add a condition on one of the form's questions with answers to choose ("Do you belong to any of these clubs? includes any of", then tick the answers that meet it, or past 12 answers find them by typing and see them as chips), as many as must all hold, and price it per tier.
   A group with another group's name says "Another group is called this.", and one left with no name "Name this group."; either way the plan waits to save until it is fixed; "Remove group", under the name, takes the row away.
   A vendor pays the cheapest group they are in at their table's tier, and "Everyone else" when they are in none ([a price follows the table](../rules/a-price-follows-the-table.md#price-groups)).
   A condition on a question the form no longer asks, or an answer it no longer offers, is drawn red with what is missing, headed "A question no longer on the form" where the question is gone, and until it is fixed Open applications waits, the rail naming the group, and from another page of the market the rail offers "Fix the price groups".
   A form that asks no question with answers to choose offers no group: the card says every vendor pays "Everyone else".
   A table of many tiers too wide for the card scrolls inside it, a shade at the end with more beyond it, under its caption ("A full table for one market day, in CAD"), which stays in view.
2. "Half table costs [50] % of a full table" sets a half table's share, a whole number from 0 to 100.
3. "Currency" is the market's one currency, "CAD - Canadian dollars" until another is picked.
4. Expect "Plan saved"; a cell shows what is typed until it is left, then the price as kept in the market's currency ("35.5" becomes "$35.50", "US$35.50" in US dollars, and a currency picked re-reads every cell); focused again, it gives the plain number, "35.50" ([an amount reads to the cent](../rules/an-amount-reads-to-the-cent.md#an-amount-field)).
5. A cell that is not an amount turns its border red, and the card says "Enter a price like 35 or 35.50, or leave it blank for no price."; a share that is not a whole number from 0 to 100 says "The half table's share is a whole number from 0 to 100."
   Either keeps the value it had before the typing - a blank cell keeps no price, never the prefix before the error ("3" then "3x" keeps nothing) - and the plan waits to save until it is fixed, so "Plan saved" never stands beside text that was not kept.

A tier renamed in Tier Setup keeps its price, and a removed tier's price goes with it; a plan with no tiers says "Prices are set by tier. Add a tier in Tier Setup to price its tables." and offers neither the share nor the currency until it has one.
Each assignment then shows its price on its date card in the vendor drawer ("Gold, full table, $35.00", naming the vendor's group where the card has groups; [the vendor drawer](vendor-drawer.md)).
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

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
