---
layer: implementation
kind: module
describes:
  - back-end/discord_client.py
  - back-end/api/discord_connection.py
  - back-end/datatypes.py#DiscordConnection
  - front-end/src/components/market/MarketDiscordCard.vue
  - front-end/src/views/DiscordConnectedView.vue
  - front-end/src/utils/discordConnected.ts
  - front-end/src/utils/discordQuestion.ts
  - front-end/src/utils/discordCheck.ts
  - scripts/discord_rest_proof.py
verified: 2026-10-31
sources:
  - T92
  - E46
  - E46/F01/S01
  - E46/F01/S02
  - E46/F01/S03
---

# The Discord connection

A market is connected to one Discord server, so that a later run can give the market's vendors a role there (E46).
One Discord application, Conventioner's, is added to each organizer's server through Discord's own approval screen (Daniel, T92 Q11: "one bot").
[`back-end/discord_client.py`](../../../back-end/discord_client.py) is the only code that talks to Discord, and [`back-end/api/discord_connection.py`](../../../back-end/api/discord_connection.py) is the market's side: connecting, the card's choices, disconnecting, and checking who is in the server.

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

Each choice saves as it is made (`PUT /markets/:id/discord`, any of `roleId`, `usernameQuestion`, `inviteLink`, each a string or null), and the page then re-reads the market ([one market, from the server](../conventions/one-market-from-the-server.md)).

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
- **A member matches by their username alone**, tidied the same way, never their display name or their server nickname, which anyone may set to anything (Daniel, T92 Q19).
- **The states**: `has_role` (a member, holding the card's role), `in_server` (a member, without the role or with no role chosen), `not_found` (no member has the username: not joined yet, or the username is wrong, which cannot be told apart) and `no_username` (the question has no answer); the page says them "Has the role", "In the server", "Not found" and "No username".

**The username question is checked again when the check runs**, since it is checked only when the card saves it and a form changed since may have lost it: none chosen says "Choose the username question on the Discord card first", and one no longer a text question of the form says "Choose the username question again" (T113 rereview note 10); neither calls Discord.

**What it found is kept on the market's connection**: `checkedAt`, and `vendorStates`, each `applicationId` with its `state`, written whole by each check; a vendor who applied since has no state until the next.
**The check writes those two fields only, and only while the card still names the server, the role and the username question it read against** (`CHECKED_AGAINST`): the members take seconds to read, and up to three waits under a 429, so a card saved meanwhile is kept, and a check whose server, role or question changed under it answers 409, "The Discord card changed while Discord was being checked. Check Discord again.", and records nothing; an invite link saved meanwhile is kept and the check stands.
**The card's writes set only their own fields too**: saving a choice, and connecting to the same server, `$set` only the fields they change, so a check finishing meanwhile is not undone, and their history still records the card's fields before and after as it always did.
They are about that server, so connecting to another server forgets them as it forgets the role, and disconnecting forgets them, even when a check finished after the connection was read; connecting again to the same server keeps them.
The market read serves them to every reader, so whoever reads the Vendors page reads its Discord column and filter, and only someone the row allows is offered the check.

**The Vendors page shows them** once a check has run: a Discord chip on each vendor's row, a "Discord" filter of every state with how many are in it, in the address as `discord` (`?discord=not_found`) so a filter is a link, and "Checked 5 minutes ago", ageing as the page sits.
After a check the page reads the market again ([one market, from the server](../conventions/one-market-from-the-server.md)), and after a refusal too, since the card may have changed; a refusal is said under the button in the server's words.

## The values, and a deployment without them

**`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` are optional, and never a boot requirement.**
They defend nothing the product serves without them, so they are not among the [boot check's](../conventions/security-invariants.md#the-boot-check) six: any one missing turns Discord off, as `TYPESAFE_API_KEY` turns TypeSafe off.
Each is read through `configured_secret` when asked for (`credentials()`), never at import, so a blank or a published placeholder is no value.
The market read serves `discordSetUp`, and without it the card says "Discord is not set up on this Conventioner." and offers nothing; a route that needs Discord answers that sentence as a 503.
The redirect registered in the Developer Portal is `FRONTEND_URL` + `/discord/connected` for each deployment: `https://conventioner.io/discord/connected`, and `http://127.0.0.1:5173/discord/connected` for the primary checkout's stack.
**`FRONTEND_URL` must be the address the organizer signs in at**: the state lives in that host's session, so a stack whose `FRONTEND_URL` says `localhost` while the organizer signs in at `127.0.0.1` sends Discord a redirect that is not registered, or brings the organizer back to a host without their session; locally it is `FRONTEND_URL=http://127.0.0.1:5173`.

## REST only

**Everything the bot does is a plain HTTPS request; no gateway connection is ever opened**, since the serverless back end cannot hold one.
The calls the Discord stories need, each from [Discord's guild resource](https://docs.discord.com/developers/resources/guild):

| Call | What it needs | Used by |
| --- | --- | --- |
| Get Current User, `GET /users/@me` | the bot's token | the bot's own id, for its roles |
| Get Guild Member, `GET /guilds/{guild.id}/members/{user.id}` | the bot in the server | the bot's roles, for the hint |
| Get Guild Roles, `GET /guilds/{guild.id}/roles` | the bot in the server | the card's roles |
| List Guild Members, `GET /guilds/{guild.id}/members` | the `GUILD_MEMBERS` privileged intent | who is in the server (E46/F01/S03) |
| Add Guild Member Role, `PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}` | `MANAGE_ROLES`, and a role below the bot's | giving the role (E46/F01/S04) |

The intent is a switch in the Developer Portal, not something a connection asks for: "privileged intents also affect the HTTP API endpoints your app is permitted to call", and "HTTP API restrictions are independent of Gateway restrictions", "unaffected by which intents your app passes in the `intents` parameter" ([Gateway, privileged intents](https://docs.discord.com/developers/events/gateway)).
None of these endpoints says a gateway connection is required.
[`scripts/discord_rest_proof.py`](../../../scripts/discord_rest_proof.py) proves it against a real server: run by hand with the bot's token read from the environment, it lists every member a page of 1000 at a time and gives one member a role, then reads the member back; its tests run it against a fake.

## Sharp edges

**A failure is answered in Conventioner's words, never Discord's, and never with a value sent**: a 400 from the exchange asks to connect again, a 401 from the exchange or the bot says Discord refused this Conventioner's Discord settings and logs the 401 (the client secret or the bot token is wrong or revoked, which only whoever runs the deployment can fix), a 403 or 404 from the bot says it can no longer reach the server, a 429 asks to wait, and anything else is "could not reach Discord"; a log line names the status and what was asked, never a value.
**A 429 is waited out**: every request waits the `retry_after` it names (its body's, else the `Retry-After` header) and asks again, up to three waits of at most 10 seconds each ([rate limits](https://docs.discord.com/developers/topics/rate-limits): 50 requests a second per bot, 429 with `retry_after`); a longer wait, or a fourth 429, is answered as asking to slow down, so one request never holds the back end for long and a run never keeps asking a limit that holds, since 10,000 refused requests in 10 minutes block the address.
A 403 or 404 from List Guild Members says "can no longer reach this server", as from any other call; the list also needs the application's `GUILD_MEMBERS` intent, so a deployment whose intent is off is refused there, in whatever words Discord's status then maps to (unverified against a real server with the intent off).

**Every request names itself** as `DiscordBot (https://conventioner.io, 1.0)`, the shape Discord asks of an HTTP client.

**The market keeps the role's and the server's names** beside their ids, so a reader the row refuses, and a card whose roles cannot be read, still says them; a role the server no longer lists stays offered under its kept name.

**The market document's `discord` field is `DiscordConnection`** in [`back-end/datatypes.py`](../../../back-end/datatypes.py), stored camelCase ([the market document](../data/market-document.md)).

**Every change records one entry** in [the market's history](../data/history.md) under `connect-discord`, with the card's fields before and after (`discord_connected`, `discord`, `discord_disconnected`), the username question's label beside its key; who connected it and when are the entry's actor and time, and the market keeps no field of its own for them, and starting the approval screen changes nothing on the market.
**A check is one entry** (`discord_checked`), as a run is, naming each vendor whose state it changed, with their states before and after and their address, each by application id, and how many it found in each; one that changed nobody still records who checked and when.
The history says each in words, by the server's and the role's names and the question's label, never Discord's ids or the question's key (T127 review 6 note 30, [`marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts)).

## Why

- [Planning the market](../../business/flows/planning.md): the plan cards on Market Setup, which settle on leaving draft as this card does not.
- [Building the application form](../../business/flows/form-tab.md): the one-click Discord username question this card picks up.
- [What each role may do](../../business/rules/what-each-role-may-do.md): connecting and giving the role are an Admin's and the owner's (Q19).
- [The Vendors page](../../business/flows/vendors.md): where the check runs and its states show.
- [Reading the market's history](../../business/flows/reading-the-markets-history.md): the card's changes and the check, in words.
- [The setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md): the rule this card is the stated exception to.
