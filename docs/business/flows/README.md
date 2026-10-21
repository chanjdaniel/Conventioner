# Flows

Part of the [knowledge graph](../../README.md), business layer.
Every file here but this one is a node of kind `flow`, named in kebab-case.

A flow node says what a person does on a screen or across screens: who, where they start, numbered steps with what they see, its `**Status:**`, and links to the rules it obeys.
[`USER_FLOWS.md`](../../USER_FLOWS.md) is the index of flows and paths.
`describes` is optional; `verified` is required.

## Nodes

One line per node, sorted by file name.

- [Accounts](accounts.md) - A: registering and verifying, signing in by password or code, resetting a password
- [Creating a market](creating-a-market.md) - D: the create-market dialog, how vendors will apply, the organization and the name
- [Finding and opening markets](finding-a-market.md) - C: the dashboard, the Markets list and its finder, a market's addresses, the menu
- [Building the application form](form-tab.md) - F: the form tab's steps, the essential and custom questions, the review setup, the lock
- [The market lifecycle at a glance](lifecycle.md) - the phases on both paths, the page each opens on, the moves and what refuses them
- [Organizations](organizations.md) - B: creating one, its people, renaming and deleting it
- [Planning the market](planning.md) - E: Market Setup's dates, tiers, locations, sections and intake, and the setup settling
- [Starting from a Google Form's responses](starting-from-a-google-form.md) - G: the upload, the proposal, confirm and cancel
- [The Google Form path](the-google-form-path.md) - P1 and P2: a market whose vendors' responses are imported, from creation to the end
- [The mixed path](the-mixed-path.md) - P4: an online form plus imported stragglers, not offered
- [The online path](the-online-path.md) - P3: a market whose vendors apply on its own page, from creation to the end
