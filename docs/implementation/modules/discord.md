---
layer: implementation
kind: module
describes:
  - back-end/discord_client.py
  - back-end/api/discord_connection.py
  - back-end/datatypes.py#DiscordConnection
  - front-end/src/components/market/MarketDiscordCard.vue
  - front-end/src/views/DiscordConnectedView.vue
  - scripts/discord_rest_proof.py
verified: 2026-10-30
sources:
  - T92
  - E46/F01/S01
  - E46/F01/S02
---

# The Discord connection

A market is connected to one Discord server, so that a later run can give the market's vendors a role there (E46).
One Discord application, Conventioner's, is added to each organizer's server through Discord's own approval screen (Daniel, T92 Q11: "one bot").
[`back-end/discord_client.py`](../../../back-end/discord_client.py) is the only code that talks to Discord, and [`back-end/api/discord_connection.py`](../../../back-end/api/discord_connection.py) is the market's side: connecting, the card's choices, and disconnecting.

## The Discord card

**A "Discord" card on Market Setup** ([`MarketDiscordCard.vue`](../../../front-end/src/components/market/MarketDiscordCard.vue)) connects the market, names the server with "Disconnect", and holds three choices:

- **Role to give**: one of the server's roles, read by the bot when the card opens (`GET /markets/:id/discord/roles`); never `@everyone` and never a role an integration manages.
  The role is the organizer's choice (Q11), so a role at or above the bot's own highest role is still offered, marked "above Conventioner's role", and choosing it shows "Move the Conventioner role above this one in your server's settings.": a bot gives only roles below its own ([Discord, permissions](https://docs.discord.com/developers/topics/permissions)).
- **Username question**: one of the form's text questions.
  Connecting chooses one when none is chosen yet: the first text question whose label says "discord", as a market started from a Google Form with a "Discord Username" question has (Q12).
- **Invite link**: optional, an `https://` address of at most 200 characters.

Each choice saves as it is made (`PUT /markets/:id/discord`, any of `roleId`, `usernameQuestion`, `inviteLink`, each a string or null), and the page then re-reads the market ([one market, from the server](../conventions/one-market-from-the-server.md)).

**It is drawn outside the plan's fieldset, beneath the plan**, in [`MarketSetupView.vue`](../../../front-end/src/views/MarketSetupView.vue), because it is a manual tool the organizer runs when they choose (Q10, Q19): [the setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md), and this card stays editable in every phase until the market is archived.

**Who may change it is the table's "Connect Discord and give roles" row** (`connect-discord`, Admin by default; Q19: "admins only"), [the market's actions](market-actions.md).
Anyone the row refuses reads the card: the server, the role's name, the question's label and the link, with no control and no call to Discord.
Every write loads through `_load_market_to_change`, so an archived market refuses it.

## Connecting

Connecting is two requests around Discord's approval screen:

1. `POST /markets/:id/discord/authorization` keeps a one-time state in the person's session, bound to this market, and answers the screen's address: `scope=bot`, the permissions Manage Roles and Create Instant Invite, `response_type=code`, and the redirect `FRONTEND_URL` + `/discord/connected`.
   The state leads with the market's id and a dot, so the page Discord returns to knows which market it was.
2. Discord sends the person back to [`DiscordConnectedView.vue`](../../../front-end/src/views/DiscordConnectedView.vue) with a code and the state, and the page posts both to `POST /markets/:id/discord/connection`, then opens the market's Market Setup.
   The server spends the state, refuses one this session never started, one for another market or one older than 15 minutes, exchanges the code with Discord, and keeps the server the token answer names.

**The server is read from the code exchange's token answer, never from the redirect's `guild_id`**: Discord calls that one "only a hint" ([OAuth2, Advanced Bot Authorization](https://docs.discord.com/developers/topics/oauth2)), and anyone can type one.
The user's access token in the same answer is neither kept nor used.
The Developer Portal's "Requires OAuth2 Code Grant" setting makes the code exchange the only way the bot joins a server; the code reads the token answer whether it is on or off.

Connecting again to the same server keeps the role and the invite link; connecting to another server forgets them.
**Disconnecting** (`DELETE /markets/:id/discord/connection`, after a confirmation) forgets the server, its role and its invite link, and keeps the username question, which is about the form; the bot stays in the server until someone removes it there, since another market may use it.

## The values, and a deployment without them

**`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` are optional, and never a boot requirement.**
They defend nothing the product serves without them, so they are not among the [boot check's](../conventions/security-invariants.md#the-boot-check) six: any one missing turns Discord off, as `TYPESAFE_API_KEY` turns TypeSafe off.
Each is read through `configured_secret` when asked for (`credentials()`), never at import, so a blank or a published placeholder is no value.
The market read serves `discordSetUp`, and without it the card says "Discord is not set up on this Conventioner." and offers nothing; a route that needs Discord answers that sentence as a 503.
The redirect registered in the Developer Portal is `FRONTEND_URL` + `/discord/connected` for each deployment: `https://conventioner.io/discord/connected`, and `http://127.0.0.1:5173/discord/connected` for the primary checkout's stack.

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

**A failure is answered in Conventioner's words, never Discord's, and never with a value sent**: a 400 or 401 from the exchange asks to connect again, a 403 or 404 from the bot says it can no longer reach the server, a 429 asks to wait, and anything else is "could not reach Discord"; a log line names the status and the route's first segment only.
Nothing retries yet; the runs of E46/F01/S03 and S04 meet Discord's rate limits (50 requests a second per bot, 429 with `retry_after`, [rate limits](https://docs.discord.com/developers/topics/rate-limits)) and handle them there.

**Every request names itself** as `DiscordBot (https://conventioner.io, 1.0)`, the shape Discord asks of an HTTP client.

**The market keeps the role's and the server's names** beside their ids, so a reader the row refuses, and a card whose roles cannot be read, still says them; a role the server no longer lists stays offered under its kept name.

**The market document's `discord` field is `DiscordConnection`** in [`back-end/datatypes.py`](../../../back-end/datatypes.py), stored camelCase ([the market document](../data/market-document.md)).

**Every change records one entry** in [the market's history](../data/history.md) under `connect-discord`, with the card's fields before and after (`discord_connected`, `discord`, `discord_disconnected`); who connected it and when are the entry's actor and time, and starting the approval screen changes nothing on the market.

## Why

- [What each role may do](../../business/rules/what-each-role-may-do.md): connecting and giving the role are an Admin's and the owner's (Q19).
- [The setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md): the rule this card is the stated exception to.
