# 04: What becomes of the whole-market PUT?

Type: grilling
Status: resolved
Blocked by: -

## Question

[03](03-one-market-every-surface-reads.md) decided that each write names what it changes, and moved the plan's autosave off `PUT /markets/:id` onto a write that carries only the plan.
That leaves the whole-market PUT with one caller, Manage Market (`ManageMarketOverlay`), which uses it three ways, each by spreading its copy of the market and changing one field:

- **Rename.** The slug is derived from the name, so a rename moves the public check-in URL of a published market.
- **Add organization.** Sets `organizationId` to an organization picked by name, or to the typed text itself when no name matches.
- **Remove organization.** Sets `organizationId` to null, a state the product refuses everywhere else. E21/F03/S01 makes the server refuse it here too.

The branches to settle:

- **Is moving a market between organizations a capability the product has at all?** A market belongs to exactly one organization, chosen at creation. If it can move, who may move it (EDITOR is today's bar, which is lower than organization membership), and what happens to the members of the organization it leaves?
- **Rename**: its own named write, and is renaming a published market (which moves its check-in URL) allowed, warned or refused?
- **Then the PUT itself**: once no caller needs it, is it deleted outright? Deleting it also deletes `_preserve_server_owned_fields` and the rule that every new server-owned field must be added there.

## Answer

Grilled 2026-09-26.
**The whole-market PUT is deleted. A market's organization is fixed when it is created, its name can change only while it is a draft, and no two markets can share a public address.**

### Facts that decided it

- **A market's organization is its container and an access grant at once.** Deleting an organization deletes its draft and archived markets (E20), and every member of the organization gets VIEWER on its markets (`get_user_market_role`). Manage Market presents it as a list, "Organizations with access", with a Viewer badge, but there is only ever one: "Add organization" **replaces** it, and falls back to the typed text as an id when no organization of that name exists.
- **A rename can take another market's name.** Reproduced on the primary stack: renaming market B to market A's exact name through the PUT answered 200, and both then carried the same stored slug; creating a market with that name was refused ("Market already exists").
- **Creation compares exact names, not slugs.** `market_name_slug` folds accents and punctuation, so "Café Market" and "Cafe Market" are two names with one slug, and both are accepted. The slug is the unauthenticated public address (applicant links, check-in), so a collision can resolve a stranger to the wrong market.

### Decisions

1. **A market cannot move between organizations.**
   Its organization is set at creation and fixed.
   Manage Market shows it as one read-only line naming the organization and saying its members can view the market; the add and remove organization controls go.
   Moving can return as its own feature if a real need appears, and would then need owner rights on the market and membership of the destination, with the old organization's members losing access.
2. **Renaming is its own write, and only while the market is a draft.**
   After draft the name is the public address that has been shared, and a rename is refused with that reason.
   Decoupling the slug from the name (freeze it at first publish) was considered and held back: it adds a second stored identity to every public lookup for a need nobody has yet.
3. **The whole-market PUT is deleted,** once the plan write, the rename write and the organization change leave it with no caller.
   `_preserve_server_owned_fields` and the rule that every new server-owned field must be added to it go with it, and the AGENTS.md entries that warn about a stale market PUT are rewritten rather than left describing a route that is gone.
4. **No two markets share a public address.**
   Creating or renaming a market is refused when its **slug** is taken, not only its exact name.
   The slug index becomes unique, built by a migration that stops with an error naming any colliding markets for the operator to rename, the way the market-key migration fails loud.

### Buildable work

[E21/F03](../../../backlog/E21-the-market-frame/F03-each-write-names-what-it-changes/feature.md) gains `S03` to `S06`.

