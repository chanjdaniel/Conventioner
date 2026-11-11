---
layer: implementation
kind: module
describes:
  - back-end/discord_client.py
  - back-end/discord_fake.py
  - back-end/api/discord_connection.py
  - back-end/datatypes.py#DiscordConnection
  - front-end/src/components/market/MarketDiscordCard.vue
  - front-end/src/views/DiscordConnectedView.vue
  - front-end/src/utils/discordConnected.ts
  - front-end/src/utils/discordQuestion.ts
  - front-end/src/utils/discordCheck.ts
  - front-end/src/components/VendorDiscordOffer.vue
  - scripts/discord_rest_proof.py
  - front-end/src/utils/discordRoles.ts
  - back-end/datatypes.py#DiscordRoleRun
verified: 2026-11-10
sources:
  - T92
  - E46
  - E46/F01/S01
  - E46/F01/S02
  - E46/F01/S03
  - E46/F01/S05
  - T137
  - E42/F01/S05
  - E46/F01/S04
  - T210
  - T217
  - T223
  - T263
---

# The Discord connection

A market is connected to one Discord server, so that a later run can give the market's vendors a role there (E46).
One Discord application, Conventioner's, is added to each organizer's server through Discord's own approval screen (Daniel, T92 Q11: "one bot").
[`back-end/discord_client.py`](../../../back-end/discord_client.py) is the only code that talks to Discord, and [`back-end/api/discord_connection.py`](../../../back-end/api/discord_connection.py) is the market's side: connecting, the card's choices, disconnecting, checking who is in the server, declining a possible match, and giving the role.

## The Discord card

**A "Discord" card on the market's Tools tab** ([`MarketDiscordCard.vue`](../../../front-end/src/components/market/MarketDiscordCard.vue), in [`ToolsView.vue`](../../../front-end/src/views/ToolsView.vue)) connects the market, names the server with "Disconnect", and holds three choices.
The server's name stands on a line of its own, 16px and 600, under its "Connected to" label, since run into one sentence it read cramped (Daniel's hand walk).
The choices:

- **Role to give**: one of the server's roles, read by the bot when the card opens (`GET /markets/:id/discord/roles`); never `@everyone` and never a role an integration manages.
  The role is the organizer's choice (Q11), so a role at or above the bot's own highest role is still offered, marked "above Conventioner's role", and choosing it shows a warning in the attention tone, under the three choices: "Conventioner cannot give <role> yet", why, the steps (in Discord, Server Settings, then Roles; drag the Conventioner role above it, and save), and "Check again", which reads the server's roles again and drops the warning once the bot is above, or says it is still below.
  A bot gives only roles below its own ([Discord, permissions](https://docs.discord.com/developers/topics/permissions)), as Daniel's REST proof met (403 Missing Permissions until the bot's role was moved); Daniel's hand walk asked for a warning with the steps rather than a hint.
- **Username question**: one of the form's text questions.
  Connecting chooses one when none is chosen yet: the first text question whose label says "discord", as a market started from a Google Form with a "Discord Username" question has (Q12).
  The form builder offers that question ready-made, "Add Discord username" (optional, key `discord_username`, [`discordQuestion.ts`](../../../front-end/src/utils/discordQuestion.ts)), until the form has a text question labelled for Discord ([building the application form](../../business/flows/form-tab.md#f2-custom-questions)).
- **Invite link**: optional, an `https://` address of at most 200 characters.

**The role and the question are each a [`ChoiceField`](../../design-system.md#the-primitive-layer) that writes as it is taken** (`T223`): a select at 12 choices or fewer, and past that a field that finds by typing and draws 50 of what the words find, so a server of 250 roles and a form of many text questions read the same way.
Typing writes nothing, and on leaving the field it names the choice that held.
The role's count holds a stored role the server no longer lists, which is still offered and still shown.
Taking the choice the field holds again writes nothing, as a select never fires for that.
A refused choice says so in `discord-save-error`, announced (`role="alert"`) and in the red every refusal reads in ([the design language](../../design-system.md#colour)), and the control goes back to what is stored (`showHeld`), so it never names a choice the market does not have.
While one holds, the field's first row, "No role" or "No question" (`noneRow`), writes null, as the select's empty row does; with none held the row is not drawn.
The card sets where each list runs: the first column's runs right from its field, and on a phone each is its field's width, since `ChoiceField`'s own width and right edge would pass the window's left edge from a narrow field near it.

Each choice saves as it is made (`PUT /markets/:id/discord`, any of `roleId`, `usernameQuestion`, `inviteLink`, each a string or null), and the page then re-reads the market ([one market, from the server](../conventions/one-market-from-the-server.md)).

**A refused invite link stays in its field, under its refusal's words** (`discord-invite-error`, `T210`).
The field holds its own draft, since it saves only when left: a value bound to the stored link would be written back by the render that shows the refusal, leaving the organizer to retype what they are told to correct.
A re-read never overwrites what is unsaved ([one market, from the server](../conventions/one-market-from-the-server.md)): a stored link read later shows only while the field still holds the link it held before, so a re-read after saving another choice or on coming back to the tab leaves typed text alone, and so does one that brings a link saved elsewhere.
Another server or market always replaces the draft and drops the words, since what was typed was about the last one.
The link's refusal stands apart from the role's and the question's (`discord-save-error`), so saving those clears only their own: the refused text is still in the field and still not saved, and the next save of the link clears its words, whether it was finished or cleared.

**A refused save is logged by `save`, at warning level, in the refusal's own words with the market's id**: `Discord card save refused for market <id>: <words>`.
The words are copy our code wrote with nothing sent in them (`NOT_A_ROLE`, `NOT_A_TEXT_QUESTION`, `NOT_AN_INVITE_LINK`, `NOT_CONNECTED`, a key's `must be a string.`, and `BOT_NOT_IN_SERVER`, the `DiscordRefused` a role's choice meets on a server the bot has left), so the log says which refusal it was and never holds the link, the role id or the question key sent ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).
The refusals of `_load_market_to_change` are not the card's, and `DiscordUnavailable` and `DiscordNotSetUp` are not 400s, so none of them is this line.

**Once a server is connected, the card says where roles are given** (`T210`): a "Giving roles" block ends it, "Check who is in the server and give roles on the Vendors page.", since those controls stand on [the Vendors page](../../business/flows/vendors.md) and the card alone read as a dead end (Daniel's walk).
Under that, "Still needed:" and a list of only what is missing, in this order, each item a link to where it is done:

- **"Choose the role to give"**, to the role's choice.
- **"Choose the question that asks their Discord username"**, to the question's choice; on a form with no text question, "Add a question that asks their Discord username", to the form page, since that select would be empty.
- **"Make the assignment"**, to the Settings page, in every phase, where Vendors' own "Nothing assigned yet" sends the same reader: in a phase that refuses a run the page there says why, so the card does not repeat it.

With nothing missing there is no list, and one link, "Give roles on Vendors".
A link to a choice is a real `href`, naming the control's id whichever it is (`fieldId`), whose click stays on the address and calls `ChoiceField`'s `open()`: a field takes the focus and opens its list, and a select does so with `showPicker()`.
A browser without that method, as every released Safari on a desk and on an iPhone is by MDN's compatibility data on 2026-11-04, or one that refuses the call, opens no list on a select: it still takes the focus, and since [a field shows no focus at all](../../design-system.md), its `field-label` takes the link ink for a moment (1.5 seconds), or the link would look dead (Daniel's choice, T210).
Every link in the block is `.link-alone`, 44px tall on a phone.
Someone the row refuses, an archived market and a Conventioner without Discord's values read no block, since it would point at controls they are not offered.

**What is missing is one reading, `rolesStillNeed`, beside `mayGiveRoles`** ([`discordRoles.ts`](../../../front-end/src/utils/discordRoles.ts)): a role when the connection names none, an assignment by `hasAssignment`, and a question unless the connection names one that is still among the form's text questions (`formTextQuestions`, [`discordQuestion.ts`](../../../front-end/src/utils/discordQuestion.ts), which the card's choice reads too).
So nothing missing always means Vendors offers "Give roles" to someone the row allows.
The reverse does not hold: `mayCheckDiscord` reads only that a question is named, so a question gone from the form is on the list while Vendors still offers the button, and the server refuses it in its own words.
A role above the bot's counts as chosen, since the card's warning, right above the block, already says what to do about it.

**It stands on the Tools tab, not Market Setup**, because it is a manual tool the organizer runs when they choose (Q10, Q19): [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md), and this card stays editable in every phase until the market is archived; it stood beneath the plan until Daniel's hand walk moved it to a tab of its own ([the market frame](market-frame.md)).
The Tools tab fits a phone, and the card's choices stand one under another there.

**Who may change it is the table's "Connect Discord and give roles" row** (`connect-discord`, Admin by default; Q19: "admins only"), [the market's actions](market-actions.md).
Anyone the row refuses reads the card: the server, the role's name, the question's label and the link, with no control, no call to Discord, and no word of when it may be changed.
Every write loads through `_load_market_to_change`, so an archived market refuses it.

## Connecting

Connecting is two requests around Discord's approval screen, which opens in a new tab so the market stays open in its own:

1. "Connect Discord" opens a blank tab in the click itself (one opened after the request would be taken for a pop-up), cuts its `opener`, which `noopener` would do but leave nothing to send on, then posts `POST /markets/:id/discord/authorization` and sends the tab to the address it answers; a blocked tab says how to allow it and starts nothing.
   The request keeps a one-time state in the person's session, bound to this market, and answers the screen's address: `scope=bot`, the permissions Manage Roles and Create Instant Invite, `response_type=code`, and the redirect `FRONTEND_URL` + `/discord/connected`.
   The state leads with the market's id and a dot, so the page Discord returns to knows which market it was.
2. Discord sends the person back, in that tab, to [`DiscordConnectedView.vue`](../../../front-end/src/views/DiscordConnectedView.vue) with a code and the state, and the page posts both to `POST /markets/:id/discord/connection`, then says "Discord is connected. You can close this tab: the market's Tools tab shows the server.", with a link to the market's Tools; a cancelled approval or a refused state is said there too.
   On success it tells the market's own tab on a `BroadcastChannel` ([`discordConnected.ts`](../../../front-end/src/utils/discordConnected.ts)), and the card re-reads the market and the server's roles without a reload; a browser that misses the message re-reads the market when its tab is shown again (`useOpenMarket`).
   A cancel or a refusal is told the same way, and the card drops its "Discord opened in a new tab" line, as it does when its tab is shown again, so a closed Discord tab leaves no stale line.
   The server spends the state, refuses one this session never started, one another person started (a second account signed in on the same browser), one for another market or one older than 15 minutes, exchanges the code with Discord, and keeps the server the token answer names.

**The server is read from the code exchange's token answer, never from the redirect's `guild_id`**: Discord calls that one "only a hint" ([OAuth2, Advanced Bot Authorization](https://docs.discord.com/developers/topics/oauth2)), and anyone can type one.
The user's access token in the same answer is neither kept nor used.
**The application runs with "Requires OAuth2 Code Grant" on** (the Developer Portal's Bot page): it makes the code exchange the only way the bot joins a server, so every server it is in was added through Conventioner's approval screen, and Discord sends the code this flow needs.
Discord's OAuth2 page describes the bot-only flow without the setting as needing no redirect, so a deployment with it off is not one this flow is built or walked for.

Connecting again to the same server keeps the role and the invite link; connecting to another server forgets them.
**Disconnecting** (`DELETE /markets/:id/discord/connection`, after a confirmation) forgets the server, its role and its invite link, and keeps the username question, which is about the form; the bot stays in the server until someone removes it there, since another market may use it.

## Who is in the server

**"Check Discord" on the Vendors page** ([the Vendors page](../../business/flows/vendors.md)) reads who is in the connected server and keeps each vendor's state with when it was checked (`POST /markets/:id/discord/check`, `check`).
It asks the same row as the card, and is offered on a market connected to a server, with a username question chosen, on a Conventioner with Discord's values ([`discordCheck.ts`](../../../front-end/src/utils/discordCheck.ts), `mayCheckDiscord`); an archived market refuses it, as every write.
The check reads every member of the server, a page of 1000 at a time after the last member read (`server_members`), and matches each vendor to them:

- **The vendors** are the market's main applications, one each, whatever their status; a waitlist application is not one.
- **The username** is the answer to the card's username question as the organizer reads it, an organizer's update in its place (`effective_answers`, [the application document](../data/application-document.md#an-organizers-update-of-an-answer)), tidied: lowercased, trimmed, a leading `@` dropped and an old `#1234` tag dropped (`tidied_username`).
- **A member matches by their username alone**, tidied the same way, never their display name or their server nickname, which anyone may set to anything (Daniel, T92 Q19); those names are read only to offer a possible match ([below](#possible-matches)).
- **The states**: `has_role` (a member, holding the card's role), `in_server` (a member, without the role or with no role chosen), `not_found` (no member has the username: not joined yet, or the username is wrong, which cannot be told apart) and `no_username` (the question has no answer); the page says them "Has the role", "In the server", "Not found" and "No username".

**The username question is checked again when the check runs**, since it is checked only when the card saves it and a form changed since may have lost it: none chosen says "Choose the username question on the Discord card first", and one no longer a text question of the form says "Choose the username question again" (T113 rereview note 10); neither calls Discord.

**A check reads the members for `MEMBERS_READ_SECONDS` (15) at most, from the route's start, as a run does** ([giving the role](#giving-the-role)): each page is asked, waited for and waited on no longer than that, so a large or slow server cannot hold the check past the host's time limit, which would end it with a bare 504 (T155 rereview, finding 5).
A read that runs out writes and records nothing and answers "Discord was slow to list the server's members. Check Discord again." (a 502, `CHECK_TOO_SLOW`).

**What it found is kept on the market's connection**: `checkedAt`, and `vendorStates`, each `applicationId` with its `state`, the `answer` it was read for (the username answer as the organizer read it, untidied, left out when there was none) and, for a vendor not found, the `possibleMatches` offered and how many more looked alike (`moreMatches`, left out when none), written whole by each check; a vendor who applied since has no state until the next.
**The check writes those two fields only, and only while the card still names the server, the role and the username question it read against** (`CHECKED_AGAINST`): the members take up to `MEMBERS_READ_SECONDS` to read, so a card saved meanwhile is kept, and a check whose server, role or question changed under it answers 409, "The Discord card changed, or roles were given, while Discord was being checked. Check Discord again.", and records nothing; an invite link saved meanwhile is kept and the check stands.
**It writes them only while `checkedAt` is what it read, too**: a "Give roles" run, or another check, that wrote since read the members later, and a run's grants are newer than any list read before them, so the check's states never put "In the server" back over a vendor the run just gave the role; it answers the same 409.
The page offers neither the check nor "Give roles" while the other runs.
**The card's writes set only their own fields too**: saving a choice, and connecting to the same server, `$set` only the fields they change, so a check finishing meanwhile is not undone, and their history still records the card's fields before and after as it always did.
They are about that server and that username question, so connecting to another server forgets them as it forgets the role, choosing another username question forgets them (on the card, or when connecting again chooses afresh because the form lost the old one; `CHECK_FIELDS`), and disconnecting forgets them, each even when a check finished after the connection was read; connecting again to the same server with the same question keeps them; the members declined as a possible match (`declinedMatches`) are about the server, so they go with it, and stay when only the question changes.
The market read serves every reader each vendor as the pages show them (`discordVendors`, below), so whoever reads the Vendors page reads its Discord column and filter, and only someone the row allows is offered the check.
Neither the market read nor the Markets list serves `vendorStates` or `declinedMatches` in the connection (`leave_out_what_is_not_served`): they are the inputs of `discordVendors`, which stays the one copy a page reads (T156 rereview note 8).
The market's contract says the same (`DiscordConnectionContract` and `ServedDiscordVendorContract` in `back-end/datatypes.py`, generated into `docs/schema.d.ts`), and a test pins it to what the read serves (T156 rereview note 9).

**The Vendors page shows them** once a check has run: a Discord chip on each vendor's row, a "Discord" filter of every state with how many are in it, in the address as `discord` (`?discord=not_found`) so a filter is a link, and "Checked 5 minutes ago", ageing as the page sits.
**The pages show two more than the check keeps, worked out by the server on every market read** (`shown_vendors`, served as `discordVendors`: each vendor's `state`, what is `shown`, the members still offered and `moreMatches`), from the kept states and the applications as the organizer reads them now, so the Vendors page, the drawer and the export say the same (T156 review note 1): `possible_match`, "Possible match", a vendor not found with a member still offered, the declined left out; and `check_again`, "Check again", with nothing offered, a vendor whose answer now reads as another username than the one their state was read for, from an update, a confirmed match, their own edit or a re-import (T137 ticket 28's note: until then a corrected username kept its old state until the next check, with nothing to say so).
The answers are compared as the check matches them, tidied, so a change of case, spaces, a leading `@` or an old tag reads the same member and keeps the state; "No username" had nothing to read, so any username that tidies to something is new, while one that tidies to nothing (" @ ") keeps it (T156 review note 2); any other state an older build kept, without its `answer`, cannot tell, and reads as it was kept.
The read lists the market's applications for it only once a check has run, and only each one's id and its answer to the username question (`list_applications_with_answers`), never its whole `form_data`.
The vendor export reads them as the pages do, through `shown_vendors` over the applications it lists: a Discord state filter of all six and a "Discord state" column, beside the username, tidied as the check reads it and offered while the form still asks its question (`asked_username_question`), and the invite link ([export the vendors](../../business/flows/vendors.md#j15-export-the-vendors-to-a-csv), [`vendor_export.py`](../../../back-end/api/vendor_export.py)), each state in the page's words (`STATE_LABELS`, one for each of `SHOWN`).
After a check the page reads the market again ([one market, from the server](../conventions/one-market-from-the-server.md)), and after a refusal too, since the card may have changed; a refusal is said on its own line under the row, in the server's words.

## Possible matches

**A vendor "Not found" is offered the members whose name looks like the username on file** (E46/F01/S05), since a vendor often writes a display name, a real name or a shop's name where the form asks for a username (the 29 unmatched of the March 2025 market, T92).
The check works them out as it reads the members (`_possible_matches`): a member is offered when their username, display name (Discord's `global_name`) or nickname in this server reads the same as the vendor's answer once both are tidied as a username is, folded (`NFKC`, then case) and kept to their letters and digits (`looks_alike`), so "Maple Crafts", "maple_crafts" and "@MAPLE-crafts" are alike; an answer with no letter or digit offers nobody.
At most five are offered, in username order, each with its username, display name and nickname (`DiscordPossibleMatch`), one of which looked alike, and none that was declined for that vendor; how many more looked alike is kept beside them.

**An offer is never applied by the check** (Daniel, T92 Q19: never by a display name alone).
In the vendor's drawer ([`VendorDiscordOffer.vue`](../../../front-end/src/components/VendorDiscordOffer.vue), [the vendor drawer](../../business/flows/vendor-drawer.md)) the lead says how many look alike, "A member whose name looks like it may be them." or "2 members whose names look like it may be them.", counting those past five, which it says are not listed, "And 3 more not shown."; each offered reads "Possible match: <name> @<username>":

- **"Confirm…"** opens a dialog of what the vendor wrote and the member's username, and "Save update" sends it as the ordinary update of the vendor's answer, `PUT /markets/:id/applications/:applicationId/answers` ([the application document](../data/application-document.md#an-organizers-update-of-an-answer)): who, when, and their own answer kept beside it, recorded as every update is; the row is "Update a vendor's info" (Editor by default), and "Update info the assignment or price reads" too where a price group reads the username question, as for any update.
  The vendor's state then reads "Check again", and the next check reads the update, so it matches them.
- **"Not them"** declines the member, `POST /markets/:id/discord/possible-matches/:applicationId/declined` with the `username` (`decline_match`): the member's username joins that vendor's list in `declinedMatches` (`$addToSet`, written only while the market is still connected to the server it was loaded with, else 409), which a check never writes and reads to leave the member out of that vendor's offers; the vendor stays "Not found".
  It asks the rows confirming asks (`assert_may_update_what_the_assignment_or_prices_read`, shared with the update), the price-read row too where a price group reads the username question, since answering an offer is about the vendor's info, not the check; only a member the last check offered that vendor may be declined, else it answers 400; an archived market refuses it.
  A price group reads only a choice question and the username question is a text one, so that row is asked only once the question stopped being text.
  It records one entry (`discord_match_declined`, under `update-vendor-info`), naming the vendor, with the member's username and names and the answer it was offered for.

Someone either row refuses reads the members offered, with no control (`answersDiscord` in [`VendorDrawer.vue`](../../../front-end/src/components/VendorDrawer.vue)).

## Giving the role

**"Give roles" on the Vendors page gives the card's role to every assigned vendor in the server, in one run** (`POST /markets/:id/discord/role-run`, `give_roles`; [the Vendors page](../../business/flows/vendors.md#j18-give-the-markets-role-to-the-assigned-vendors)).
It asks the same row as the card and the check, and is offered where the check is, on a market whose card names a role, once anyone holds a seat (`mayGiveRoles` in [`discordRoles.ts`](../../../front-end/src/utils/discordRoles.ts)); an archived market refuses it, as every write.
It confirms first, by the role's name and how many vendors hold a seat on any date, counted from where the page reads them: "Give Vendor Nov 2026 to 54 assigned vendors?".

- **Assigned is holding a seat on any date** of the stored assignment (`seated_addresses` in [`result_outcome.py`](../../../back-end/result_outcome.py)), among the market's main applications.
- **The run reads the members once, as a check does, within the first `MEMBERS_READ_SECONDS` (15) of the run's time**, so the grants keep at least 35 seconds, matching by tidied username alone, then asks Discord to give the role (Add Guild Member Role, `RoleGrants` in [`discord_client.py`](../../../back-end/discord_client.py)) only to an assigned vendor whose username a member has and who does not hold the role yet. A read that runs out gives nobody the role, writes nothing and records nothing, answering "Discord was slow to list the server's members. Give roles again." (a 502).
- **Each assigned vendor ends in one outcome**: `given`, `already_had`, `not_found` (no member has the username), `no_username`, `not_yet` (the run's time ended first), or `failed` with its reason in Conventioner's words.
- **A run asks Discord for `ROLE_RUN_SECONDS` (50) at most, from the route's start**, then stops asking, and every assigned vendor still to be given the role is "Not given yet", with "A run asks Discord for under a minute, and Discord was still pacing it. Give roles again to finish."; a second run finds those given already holding the role and gives the rest.
  The back end is a Vercel function, ended at its maximum duration with whatever it had not yet written: with Fluid compute, which [`back-end/vercel.json`](../../../back-end/vercel.json) turns on, that is 300 seconds by default and at most on the Hobby plan ([Vercel's duration limits](https://vercel.com/docs/functions/configuring-functions/duration#duration-limits)), and nothing in this repository lowers it.
  The run stops far sooner, since the organizer watches "Giving roles…" meanwhile and a connection idle for a minute may be closed on the way.
  At half a second a page of 1000 members, a slow pace for Discord, the read's 15 seconds fit 29 full pages and a last one, a server of fewer than 30,000 members (`PAGES_THAT_FIT` in `test_discord_connection.py`); a larger or slower server answers "Discord was slow to list the server's members".
  No request, neither the member read nor a grant, is sent, no 429 waited out and no request waited on past that time: a wait that would pass it, or a request cut short by it, ends the run there (`OutOfTime`); a grant cut short while Discord answered may have landed, and the second run then finds the role held.
- **The grants are paced by Discord's own count**: each answer says how many requests the route has left and when it refills (`X-RateLimit-Remaining`, `X-RateLimit-Reset-After`, [rate limits](https://docs.discord.com/developers/topics/rate-limits)), and at none the next grant waits for the refill, within the run's time, rather than meet a 429.
- **Each grant names the run in the server's audit log** (`X-Audit-Log-Reason`, URL-encoded and cut to Discord's 512 characters, [audit log](https://docs.discord.com/developers/resources/audit-log)): "Conventioner: Give roles for" and the market's name, so the server's moderators can tell these grants from a role given by hand.
- **A run only gives** (Daniel, T92 Q19: "no" to taking a role away): it never asks Discord to remove one, so a vendor who has lost their seat keeps the role, and is not in the run's report.
- **A refusal of one member is theirs alone**: a member who left between the list and the grant (Discord's Unknown Member or Unknown User) fails with "No longer in the server." and reads "Not found", and the run goes on.
  **Any other refusal would refuse every grant alike**, so the run stops asking and every assigned vendor still to be given the role fails with the same reason: the bot's role below the market's role, or the bot without Manage Roles (Discord's Missing Permissions), says "Conventioner's role is below Vendor Nov 2026, or may not manage roles." with the card's steps to fix it; a role the server no longer has asks to choose the role again; a server the bot cannot reach, the deployment's settings refused, a 429 that holds and Discord out of reach say what any call says. A run thus asks a limit that holds, or a permission it lacks, once, never once a vendor.
- **The run updates every vendor's state**, as a check would set it, with the possible matches a check would offer, a vendor given the role then "Has the role" and one who left "Not found", and sets `checkedAt`; a check that wrote while the run asked is overwritten, since the run's grants are newer than what that check read.
- **The last run's report is kept on the connection** as `roleRun` (`DiscordRoleRun`): `ranAt`, the role's name then, and each assigned vendor's outcome with a failure's reason, by application id; the page counts the groups from them.
  The market read serves it to every reader, so the report stands above the list for anyone who reads the page ([`DiscordRoleReport.vue`](../../../front-end/src/components/DiscordRoleReport.vue)): "Vendor Nov 2026, last run 5 minutes ago", how many in each group, and "Show who" opening a dialog over the page (`vendors-role-report-who`, `size="wide"`, `scroll="body"`, titled with the report's own line) of each group's vendors, a failure's reason, or the reason the rest are not given yet, said once for the vendors it held back, so a list of up to every vendor never pushes the table down.
  The dialog is a [`ListFrame`](../../design-system.md#the-primitive-layer) over one row per vendor, each knowing its group (`roleRunRows`), with no `findKey`, so its words go with the dialog (T223): past `LIST_FIND_FROM` (12) vendors it opens on "Find by name or address", which finds by the name the page shows, the address and the name on their identification, as the Vendors page's search does, and draws 50 at a time; the `rows` slot puts each group's outcome, whole count, reason and possible-match line over its first drawn row (`roleRunGroupsDrawn`), and a group with no row drawn is not there.
  A vendor the page no longer lists is a row no words find, drawn with no words typed.
  At 12 or fewer the frame is given no `finds`, so the dialog has no field and no count line, as before.
  A vendor not found whom the market's `discordVendors` now show as a possible match is counted beside "not found" ("1 not found (1 possible match)"), so the report and their row agree.
  It is about the server and the username question it read against, so connecting to another server, choosing another username question (`CHECK_FIELDS`, on the card or when connecting again chooses afresh) or disconnecting forgets it, as each forgets the check, even when the run finished after the card was read; restating the same question keeps it, and so does a later check, which writes only its own fields.

**The run writes its report, the states and `checkedAt` only while the card still names the server, the role and the username question it read against**, as a check does; but the roles are already given in Discord by then, so a card changed meanwhile is kept, the run is still recorded in the history with the roles it gave, and the answer is a 409, "The Discord card changed while roles were being given. The roles given are in the market's history; check Discord again."

## The values, and a deployment without them

**`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` are optional, and never a boot requirement.**
They defend nothing the product serves without them, so they are not among the [boot check's](../conventions/security-invariants.md#the-boot-check) eight: any one missing turns Discord off, as `TYPESAFE_API_KEY` turns TypeSafe off.
Each is read through `configured_secret` when asked for (`credentials()`), never at import, so a blank or a published placeholder is no value.
The market read serves `discordSetUp`, and without it the card says "Discord is not set up on this Conventioner." and offers nothing; a route that needs Discord answers that sentence as a 503.
The redirect registered in the Developer Portal is `FRONTEND_URL` + `/discord/connected` for each deployment: `https://conventioner.io/discord/connected`, and `http://127.0.0.1:5173/discord/connected` for the primary checkout's stack.
**`FRONTEND_URL` must be the address the organizer signs in at**: the state lives in that host's session, so a stack whose `FRONTEND_URL` says `localhost` while the organizer signs in at `127.0.0.1` sends Discord a redirect that is not registered, or brings the organizer back to a host without their session; locally it is `FRONTEND_URL=http://127.0.0.1:5173`.

**A local stack may have a fake answer for Discord** (`DISCORD_FAKE=true`, [a fake Discord](../../TESTING.md#a-fake-discord), T156 review note 6): the client's one sender, `_send`, then asks [`back-end/discord_fake.py`](../../../back-end/discord_fake.py) instead of Discord, which answers the routes the client uses (the bot itself, a server's roles and members, a page at a time, the code exchange, and a role given to a member) from the servers in the `fake_discord_servers` collection, in Discord's own shapes, and 404 for a server it has none of; a grant lands on the member's `roles` in that collection, so a check after a run reads the role held, and is refused as Discord refuses one: Unknown Member, Unknown Role, or Missing Permissions for a role at or above the bot's highest; `credentials()` are the fake's own, and the approval address is the market's return address with a code naming the first fake server.
It is honoured only under `ALLOW_INSECURE_LOCAL_DEV` ([security invariants](../conventions/security-invariants.md#the-one-escape-hatch)), so the E2E runs the real check, the offers and the history against it, and a deployment never does.

## REST only

**Everything the bot does is a plain HTTPS request; no gateway connection is ever opened**, since the serverless back end cannot hold one.
The calls the Discord stories need, each from [Discord's guild resource](https://docs.discord.com/developers/resources/guild):

| Call                                                                              | What it needs                              | Used by                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Get Current User, `GET /users/@me`                                                | the bot's token                            | the bot's own id, for its roles                                    |
| Get Guild Member, `GET /guilds/{guild.id}/members/{user.id}`                      | the bot in the server                      | the bot's roles, to mark each role above its highest (`below_bot`) |
| Get Guild Roles, `GET /guilds/{guild.id}/roles`                                   | the bot in the server                      | the card's roles                                                   |
| List Guild Members, `GET /guilds/{guild.id}/members`                              | the `GUILD_MEMBERS` privileged intent      | who is in the server (E46/F01/S03)                                 |
| Add Guild Member Role, `PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}` | `MANAGE_ROLES`, and a role below the bot's | giving the role (E46/F01/S04)                                      |

The intent is a switch in the Developer Portal, not something a connection asks for: "privileged intents also affect the HTTP API endpoints your app is permitted to call", and "HTTP API restrictions are independent of Gateway restrictions", "unaffected by which intents your app passes in the `intents` parameter" ([Gateway, privileged intents](https://docs.discord.com/developers/events/gateway)).
None of these endpoints says a gateway connection is required.
[`scripts/discord_rest_proof.py`](../../../scripts/discord_rest_proof.py) proves it against a real server: run by hand with the bot's token read from the environment, it lists every member a page of 1000 at a time and gives one member a role, then reads the member back; its tests run it against a fake.

## Sharp edges

**A failure is answered in Conventioner's words, never Discord's, and never with a value sent**: a 400 from the exchange asks to connect again, a 401 from the exchange or the bot says Discord refused this Conventioner's Discord settings and logs the 401 (the client secret or the bot token is wrong or revoked, which only whoever runs the deployment can fix), a 403 or 404 from the bot says it can no longer reach the server, a 429 asks to wait, and anything else is "could not reach Discord"; a log line names the status and what was asked, never a value.
**A 429 is waited out**: every request waits the `retry_after` it names (its body's, else the `Retry-After` header) and asks again, up to three waits of at most 10 seconds each ([rate limits](https://docs.discord.com/developers/topics/rate-limits): 50 requests a second per bot, 429 with `retry_after`); a longer wait, or a fourth 429, is answered as asking to slow down, so one request never holds the back end for long and a run never keeps asking a limit that holds, since 10,000 refused requests in 10 minutes block the address.
A "Give roles" grant also never waits past the run's time ([giving the role](#giving-the-role)).
A 403 or 404 from List Guild Members says "can no longer reach this server", as from any other call; the list also needs the application's `GUILD_MEMBERS` intent, so a deployment whose intent is off is refused there, in whatever words Discord's status then maps to (unverified against a real server with the intent off).

**Every request names itself** as `DiscordBot (https://conventioner.io, 1.0)`, the shape Discord asks of an HTTP client.

**The market keeps the role's and the server's names** beside their ids, so a reader the row refuses, and a card whose roles cannot be read, still says them; a role the server no longer lists stays offered under its kept name.

**The market document's `discord` field is `DiscordConnection`** in [`back-end/datatypes.py`](../../../back-end/datatypes.py), stored camelCase ([the market document](../data/market-document.md)).

**Every change records one entry** in [the market's history](../data/history.md) under `connect-discord`, with the card's fields before and after (`discord_connected`, `discord`, `discord_disconnected`), the username question's label beside its key; who connected it and when are the entry's actor and time, and the market keeps no field of its own for them, and starting the approval screen changes nothing on the market.
**Declining a possible match is one entry** (`discord_match_declined`, under `update-vendor-info`), and confirming one is the update it is ([possible matches](#possible-matches)).
**A check is one entry** (`discord_checked`), as an assignment run is, naming each vendor whose state it changed, with their states before and after and their address, each by application id, and how many it found in each; one that changed nobody still records who checked and when.
**A "Give roles" run is one entry** (`discord_roles_given`), even one that gave nobody the role: the role by its name, the application ids it gave the role, each vendor it gave the role or whose state it changed, with their states before and after and their address, by application id, and how many assigned vendors ended in each outcome ([the market's history](../data/history.md)).
The history says each in words, by the server's and the role's names and the question's label, never Discord's ids or the question's key (T127 review 6 note 30, [`historyReaders/discord.ts`](../../../front-end/src/utils/historyReaders/discord.ts)).

## Why

- [Planning the market](../../business/flows/planning.md): the plan cards on Market Setup, which settle on leaving draft as this card does not.
- [Building the application form](../../business/flows/form-tab.md): the one-click Discord username question this card picks up.
- [What each role may do](../../business/rules/what-each-role-may-do.md): connecting and giving the role are an Admin's and the owner's (Q19).
- [The Vendors page](../../business/flows/vendors.md): where the check and the run happen, their states and report show, and where a possible match is answered.
- [Reading the market's history](../../business/flows/reading-the-markets-history.md): the card's changes and the check, in words.
- [The setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md): the rule this card is the stated exception to.
