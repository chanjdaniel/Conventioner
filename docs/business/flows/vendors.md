---
layer: business
kind: flow
describes:
  - front-end/src/views/VendorsView.vue
  - front-end/src/components/ExportVendorsDialog.vue
  - front-end/src/utils/vendorExport.ts
  - back-end/api/vendor_export.py
  - front-end/src/components/GiveRolesDialog.vue
  - front-end/src/components/DiscordRoleReport.vue
verified: 2026-11-05
sources:
  - wayfinding/claims-and-room/04
  - wayfinding/rejection-visibility/02
  - E11/F04
  - E26/F05/S04
  - E35/F01/S01
  - E36/F02/S04
  - E36/F03/S01
  - bug/10
  - bug/33
  - E28/F02/S02
  - T123
  - E42/F01/S01
  - E42/F01/S02
  - E42/F01/S03
  - E42/F01/S04
  - E41/F01/S01
  - E38/F08/S02
  - T139
  - E46/F01/S03
  - E43/F01/S03
  - E46/F01/S05
  - T137
  - E42/F01/S05
  - E46/F01/S04
  - T180
  - T210
  - T217
---

# Vendors

**Who:** anyone who can read the market; placing and adding are an Editor's, and exporting is the Export CSV row's, a Viewer's by default, so the button shows only to someone it lets ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Vendors page, the Assignment tab's third page, or the Assignments page's "N unassigned".
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

The Vendors page ([`VendorsView.vue`](../../../front-end/src/views/VendorsView.vue)) lists every applicant of the market, one row each, and a row opens that vendor's [drawer](vendor-drawer.md), behind which it reads as selected ([a selected row](../../design-system.md#the-primitive-layer)); what the page counts is the vendors who need a table: the run's own, and the vendors added by hand.
The page fits a phone, so a vendor is looked up, paid and corrected from the door on market day (T180): the search takes its row with the filters, Export and Add a vendor beneath it, each row stacks the name over its chips, and the drawer, Add a vendor, Export and Give roles open inside the window ([the design language](../../design-system.md#layout)).
The Discord row keeps its order there, one line under another from the line's start: the filter, then "Checked 5 minutes ago", then "Check Discord" and "Give roles" side by side.
At 320 the longer "Checking Discord…" or "Giving roles…" takes the second button to a line of its own while it runs, inside the window.

## J11. Browse by vendor

**Status:** Works (re-walked live on 2026-10-03; every applicant listed, and the filters, read from the code as of E36/F02/S04 and E36/F03/S01: `vendors-and-limits.spec.ts`, `placing-someone-not-approved.spec.ts`).

1. "Search vendors" ("Filter by name or email…") finds a vendor by name or address; each row names the vendor, with their address beside.
2. "N of M vendors assigned" counts the vendors who need a table, the approved applicants and the vendors added by hand, and never a rejected applicant (bug 10); a filter or search reads "N of M vendors shown".
   The line is in the muted ink and its counts in the brand green, each at AA on white; it once dimmed the whole line with opacity, which took the counts to 3.2:1 (T162 review).
3. Each row of a vendor who needs a table shows Assigned or Unassigned and "N of M dates", against the dates they could have had; a vendor added by hand needs a table on every market day, and shows "Added" beside it; a rejected applicant shows "Rejected".
4. "Unassigned only" lists the vendors who need a table and hold none, and with a date chosen those with none that day, a vendor added by hand included (E38/F08/S02); it and "Rejected only", shown when anyone was rejected, narrow the list, each cleared with its "×"; the Assignments page's filters (Date, Section, Tier, Table) narrow it to where vendors are placed, and are kept across the two pages.
5. The Assignments page's "N unassigned" link, and the Stats tab's "N vendors unassigned" ([the market's statistics](stats.md)), open this list filtered, as "Unassigned only", and count the same vendors.

When the server cannot say where vendors sit, the page shows its reason above the list and says nothing of who is placed: "N vendors", the whole list counted before a run or after, each row its verdict and no date count, and no "Unassigned only" or filter by where they sit, one in the address ignored and Export opening on neither; the names and the search by name still hold, from the applications (T123).

Before a run the page lists the vendors and says nothing is assigned yet.
Covered by:
- `placing-someone-not-approved.spec.ts`
- `the-drawer-reads-the-application-when-the-tables-cannot.spec.ts`, the refused read
- `the-market-on-a-phone.spec.ts`, on a phone and at a desk: the page, every tab of the drawer, a payment recorded and an Editor's Update info
- `the-open-vendor-reads-as-selected.spec.ts`, the open row's look
- `vendors-and-limits.spec.ts`
- `vendors.spec.ts`

**Adding a vendor who never applied.**
From Assignment on, "Add a vendor" opens "Add a vendor": "For someone who never applied. They are added as approved, and you assign them on the Assignments page.", with Name and Email, each marked required; on a market whose price groups read questions of its own form, "Their price is set by these answers." and each of those questions, required, a checkbox's unticked state its answer; "Add vendor", offered once each is answered.
They are listed as "Added" and Unassigned until seated, offered under "Added by hand" in the place dialog ([J6](placing-by-hand.md#j6-place-a-vendor-in-an-empty-seat)), and never placed by a run ([adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md)).
Covered by:
- `adding-a-vendor.spec.ts`
- `an-added-vendor-is-unassigned.spec.ts`
- `the-price-answers.spec.ts`

## J12. Find out why a vendor was not placed

**Status:** Works (walked live); a vendor at their date limit, or at the market's ceiling, is told so (bug 33).
On the drawer's Assignments tab each date the vendor did not get states why, in words: "Not available on this date", "Already has as many dates as they asked for", "Already has as many dates as the market allows per vendor", "No table at a tier they accept", "Every table they accept is taken", or "A table is free - they could be assigned".
Only the last offers "Assign them", which opens the Assignments page on that date, searched for them; a date stopped by a limit offers no placing.
Covered by:
- `vendors-and-limits.spec.ts`
- `vendors.spec.ts` ("an unplaced vendor is opened from the payoff screen and told why")

## J15. Export the vendors to a CSV

**Status:** Works (E42/F01/S01, `exporting-vendors.spec.ts`; the placement columns E42/F01/S02, `exporting-placements-by-date.spec.ts`; from the Applications tab E42/F01/S03, `exporting-from-the-applications-tab.spec.ts`; the money columns E42/F01/S04, `exporting-a-payment-reminder.spec.ts`; the Discord columns E42/F01/S05, `exporting-discord-columns.spec.ts`, against the stack's fake Discord).
For a Google Sheet and a mail merge such as YAMM: any of the market's vendors, filtered by what the app knows of them, with the columns chosen.

1. "Export", beside the show-only choices, opens "Export vendors" ([`ExportVendorsDialog.vue`](../../../front-end/src/components/ExportVendorsDialog.vue)) on what the page shows ([`vendorsPageSeed`](../../../front-end/src/utils/vendorExport.ts)): "Unassigned only" as the approved and added vendors not assigned, on the page's date when one is chosen; "Rejected only" as the rejected; the page's date, section, tier and table size as the vendors assigned there; the page's Discord state as the vendors in it; and the search.
   The Applications tab's All view opens the same dialog on its status filter and Mine ([the All view](review.md#the-all-view), `applicationsAllSeed`).
2. Every filter is shown and may be changed: the name or email searched; the status, any of Open, Needs follow-up, Approved, Rejected and Added by hand, none ticked being any; "Mine: the follow-ups I own", the follow-ups whose owner is the one exporting, as the server reads who asks; assigned or not ("Assigned", "Assigned or not", "Not assigned"), on any date or on one; for the assigned, the seat's section, tier and size; "Payment", one of "Paid or not", "Owes", "Paid in full" and "Paid more than owed", as the vendor's Payment tab reads what they paid against what they owe ([payments](../../implementation/data/payments.md)), a vendor owing nothing and having paid nothing being none of the three, and on a market with no prices offered only where some vendor owes, by an amount set by hand or a refund beyond what they paid, since an account owing nothing there is otherwise in none of them, as the Payments page offers its filters; once a Discord check has run, the Discord state as the Vendors page shows it, any of Has the role, In the server, Possible match, Not found, No username and Check again, none ticked being any; and the options of each of the form's choice questions, any of which the vendor chose.
   The two differ in shape on purpose: a vendor's payment is one state, so "Payment" is one choice, while the Discord states are ticked as Status is, so "Not found or No username" is one export.
3. The columns are ticked under five headings: "Vendor" (Name, the full name; Preferred name; Email; Status), "Answers" (each of the form's own questions), "Assignment", "Payment" and "Discord", each heading left out when it has no column.
   Name, Email and Status are ticked to begin with.
4. "Assignment" holds, for each market date, where the vendor sits that day: "Wed 18 Nov - table", "- section", "- tier" and "- half or full" (Full table or Half table), empty on a date they hold no seat; then "Dates assigned", how many of the market's dates they hold one on.
   The seats are the stored placements the Assignments page draws, pins and seats moved by hand included, and a vendor added by hand exports theirs like anyone.
5. "Payment" holds "Price group", the price group each of their lines is priced by, a freed day's kept line included, once each and joined by ", " ("Everyone else" for a vendor in no group; empty where no line names a group, or for a vendor with no line); "Amount owed" and "Amount paid", the two totals of their Payment tab; and "Still owed", the amount owed less the amount paid, below zero where they paid more than owed ("-$15.00", a refund to issue).
   An amount is written as the Payment tab writes it, in the market's currency: "$35.00", "$15.01".
   So a payment reminder is one export: "Owes", with Name, Email and Still owed.
6. "Discord" holds what the market knows of each vendor there (E42/F01/S05): "Discord username", the answer to the Discord card's username question as updated, tidied as the check reads it (lowercase, with no leading `@` or old `#1234` tag, so a mail merge never quotes `'@name`), offered while the card names one of the form's text questions, and then listed here rather than under "Answers"; "Discord state", the vendor's state as the Vendors page shows it, in its words, "Possible match" and "Check again" included ([J16](#j16-see-who-is-in-the-discord-server)), empty for a vendor the last check did not read (one who applied since, or a waitlist application), offered once a check has run; and "Discord invite link", the card's link on every row, offered when it holds one.
   So "please fix your Discord username" is one export: "Not found" on the page, Export, and tick the username ([who is in the server](../../implementation/modules/discord.md#who-is-in-the-server)).
7. "In the file, in this order" lists the ticked columns: a column ticked joins the end, and each is moved by dragging or with its up and down buttons.
8. "N vendors, M columns" and the file's first three rows preview it, and follow every change.
9. "Download CSV" saves one row per vendor, the header the columns as named, a multi-select answer one cell joined by ", ", a box Yes or No. The file is UTF-8 with a byte-order mark, so a spreadsheet reads accents, and is named for the market and the organizer's day, `<market>_vendors_<YYYY-MM-DD>.csv`.

The server builds the file and the preview from the filters the dialog sends ([`vendor_export.py`](../../../back-end/api/vendor_export.py)), so what is exported is what the server holds, a seat is read from the stored placements the Assignments page draws, and a Discord state as the Vendors page shows it, worked out from what the last check kept on the market and the answers now (`shown_vendors`), so the file and the page agree.
An answer an organizer updated is exported, and filtered on, as updated ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)).
Every cell but an amount is written so a spreadsheet shows it as text: one beginning with `=`, `+`, `-`, `@`, a tab, a carriage return or a newline gains a leading quote, as the assignment's download does.
An amount is the server's own, written from whole cents, so it is left as it is: "-$15.00" reaches the spreadsheet as the number it is, where the quote would make it text and show.
Where a minus would lead a currency's letters, as "-A$15.00", "-US$15.00" or "-NZ$15.00" would, each a minus and a cell reference that Excel evaluates, the amount is written with the minus sign "−" (U+2212) instead, which no spreadsheet reads as a formula.
No column set is saved between exports yet.
Covered by:
- `back-end/tests/test_exporting_vendors.py`
- `back-end/tests/test_the_exports_money_columns.py`
- `exporting-a-payment-reminder.spec.ts` ("Owes" gives exactly the vendors whose Payment tab reads "Owes", with what it says they owe, and the Payments page's "Owes" list)
- `exporting-discord-columns.spec.ts` ("Not found" gives exactly the vendors the Vendors page shows as not found)
- `exporting-from-the-applications-tab.spec.ts`
- `exporting-placements-by-date.spec.ts`
- `exporting-vendors.spec.ts`
- `exportingVendors.test.ts`

## J16. See who is in the Discord server

**Status:** Works against the stack's fake Discord (E46/F01/S03, `who-is-in-the-discord-server.spec.ts`, [the fake](../../implementation/modules/discord.md#the-values-and-a-deployment-without-them)); not yet walked against a real server.
On a market connected to a Discord server with a username question chosen ([the Discord connection](../../implementation/modules/discord.md#who-is-in-the-server)), the organizer finds who has joined, so they can ask the rest, by email, to join or to correct their username (T92 Q10).

1. "Check Discord", above the list, for an Admin or the owner (the table's "Connect Discord and give roles" row), reads the server's members and matches each vendor's username to theirs, by username alone, never a display name; it reads "Checking Discord…" while it runs.
2. Each row then shows the vendor's state: "Has the role", "In the server", "Not found" (not joined yet, or the username is wrong, which cannot be told apart) or "No username"; and two that say more: "Possible match", a vendor not found who was offered a member whose name looks like their username ([J17](#j17-answer-a-possible-discord-match)), and "Check again", a vendor whose username was updated after the check, which their state was not read for; the server works both out, so the page, the drawer and the export agree.
3. The "Discord" filter lists the vendors shown in one of those six, each with how many are in it; it stays in the address, so a link to "Not found" is the list of whom to email, and Export opens on it ([J15](#j15-export-the-vendors-to-a-csv)).
4. "Checked 5 minutes ago" says when the states were read; they change only when someone checks again.

The row reads filter, then actions: the "Discord" filter at the left, and "Checked 5 minutes ago", "Check Discord" and "Give roles" together at the far right.
Before the first check there is no filter and no "Checked", and the buttons stand at the far right all the same; someone the row refuses, once a check has run, reads the filter at the left and "Checked 5 minutes ago" at the far right, with no button.

Each row's columns keep their place down the list at every width: the Discord state, then Assigned, Unassigned or the verdict, then "Added" in a slot of its own while anyone listed was added by hand, then the date count (T137 review note 6: "Added" once stood before the badge and moved a vendor's Discord chip 63px left of every other row's).

A check that cannot run says why on a row of its own under the actions: the market lost its username question ("Choose the username question again"), Discord cannot be reached, Discord took too long to list the server's members ("Check Discord again"), or the bot is no longer in the server.
Covered by:
- `back-end/tests/test_discord_connection.py`
- `giving-the-discord-role.spec.ts` (where the row's filter, actions and error stand at 1280, 390 and 320)
- `who-is-in-the-discord-server.spec.ts`
- `whoIsInTheDiscordServer.test.ts`

## J17. Answer a possible Discord match

**Status:** Works against the stack's fake Discord (E46/F01/S05, `possible-discord-matches.spec.ts`); not yet walked against a real server.
A vendor often writes a display name, a real name or a shop's name where the form asks for a Discord username, and the check, which matches by username alone, does not find them ([J16](#j16-see-who-is-in-the-discord-server)).
For such a vendor it offers the members whose username, display name or server nickname looks like what they wrote, and the organizer says which, if any, is them (T92 Q19: never by a display name alone).

1. "Possible match" on a row, or the "Discord" filter's "Possible match", finds them; their [drawer](vendor-drawer.md) opens on a "Discord" section: "No member of <server> has the username “<their answer>”. A member whose name looks like it may be them." (or "2 members whose names look like it may be them."), then each member offered, "Possible match: <their name> @<username>", at most five, then "And 3 more not shown." when more looked alike.
2. "Confirm…", for whoever the row "Update a vendor's info" allows, and the row "Update info the assignment or price reads" too where a price group reads the username question, opens "Use this Discord username?": what they wrote, what it reads now when an update already stands, and the member's username it updates to; "Save update" saves that username as an update of their answer, the ordinary one, kept beside what they wrote with who and when ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)).
   The row then reads "Check again", and the next check finds them "In the server" or "Has the role".
3. "Not them", for the same people, declines the member: the vendor stays "Not found", or "Possible match" while another member is still offered, and that member is never offered to them again on this server.

Someone either row refuses reads the members offered with no control.
Both are in [the market's history](reading-the-markets-history.md) and the vendor's own: the update as every update is, and "said the Discord member @<username> is not <vendor>".
Covered by:
- `back-end/tests/test_discord_connection.py` (`TestPossibleMatches`, `TestWhatThePageShows`)
- `possible-discord-matches.spec.ts`
- `possibleDiscordMatches.test.ts`
- `whoMayAnswerADiscordMatch.test.ts`

## J18. Give the market's role to the assigned vendors

**Status:** Works against the stack's fake Discord (E46/F01/S04, `giving-the-discord-role.spec.ts`); not yet walked against a real server.
On a market connected to a Discord server, with a role and a username question chosen on the Discord card, the organizer gives the market's role to every vendor holding a seat who is in the server, in one run ([the Discord connection](../../implementation/modules/discord.md#giving-the-role)).
The card points here: its "Giving roles" block says what is still missing, and once nothing is, links to this page.

1. "Give roles", beside "Check Discord" at the row's far right, for an Admin or the owner (the same row), is offered once anyone holds a seat.
2. It confirms first ([`GiveRolesDialog.vue`](../../../front-end/src/components/GiveRolesDialog.vue)), by the role's name and how many vendors hold a seat on any date: "Give Vendor Nov 2026 to 54 assigned vendors?", saying that it never takes a role away.
3. The run reads the server's members as a check does, gives the role to each assigned vendor matched who does not hold it, and updates every vendor's Discord state; "Give roles" reads "Giving roles…" meanwhile, and neither it nor "Check Discord" is offered while the other runs.
   It asks Discord for under a minute: the vendors it had no time for are "Not given yet", and running it again gives them.
4. Its report ([`DiscordRoleReport.vue`](../../../front-end/src/components/DiscordRoleReport.vue)) stays above the list for everyone who reads the page: "Vendor Nov 2026, last run 5 minutes ago", how many ended in each group ("2 given, 1 already had it, 1 not found, 1 no username"), and "Show who" opens a dialog, titled with that same line, of each group's vendors, a failure's reason, or why the rest are not given yet, said once for the vendors it held back, so a long list never pushes the table down.
   A vendor the run did not find whom the check now offers a possible match ([J17](#j17-answer-a-possible-discord-match)) is counted beside "not found", as their row says it: "1 not found (1 possible match)", and the group says "1 has a possible match to confirm or decline."

**A run only gives**: a vendor who has lost their seat keeps the role they have (Daniel, T92 Q19).
A run that cannot start says why in the dialog: no role chosen, the username question gone, Discord out of reach, or the bot no longer in the server.
Covered by:
- `back-end/tests/test_discord_connection.py`
- `giving-the-discord-role.spec.ts` (the report and the rows' Discord states laid out at 390, "Show who" over a table that stays put, its body scrolling under its title, its ways of closing, and it and Give roles inside the window there)
- `givingTheDiscordRole.test.ts`

## Superseded

- The page was to list only the vendors the run places, a rejected applicant leaving it, so that it and the Assignments page counted the same people by construction (wayfinding/claims-and-room/04, E26/F05/S04).
  It lists every applicant, so a rejected one can be found and seated by hand, and only its count was the run's vendors, the people the Assignments page counted (E36/F02/S04).
- A vendor added by hand was outside "Unassigned only" and the counts, as outside the run, so one with no table was missing from the list of who still needs one; they are counted as needing a table, apart from the run (E38/F08/S02).

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): every applicant is listed, and may be seated.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md).
- [Why a vendor was not placed](../rules/why-a-vendor-was-not-placed.md): the reasons a date was not given, and which one offers a seat.
- [The ceiling on dates per vendor](../rules/max-assignments-ceiling.md) and [tier filters, section prefers](../rules/tier-filters-section-prefers.md): the limits two of those reasons name.

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
