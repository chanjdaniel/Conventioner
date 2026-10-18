# Conventioner

Conventioner runs a vendor market from applications to the door.
An organizer plans the market (its dates, sections, tiers and tables), collects applications through its own form or imports a Google Form's responses, reviews them, assigns every approved vendor a table by the market's own rules, publishes the result, and checks vendors in on the day.

It runs in production at [conventioner.io](https://conventioner.io), first for the UBC Makers Market of November 2026.

## Where things are

| | |
| --- | --- |
| `front-end/` | Vue 3, Vite, TypeScript; Vitest and Playwright |
| `back-end/` | Python 3.12, Flask, MongoDB; pytest |
| `docs/` | Everything below |
| `.scratch/` | The backlog (Epic, Feature, Story) and the decision maps ([how it works](docs/agents/issue-tracker.md)) |
| `AGENTS.md` (`CLAUDE.md`) | The codebase's sharp edges, for anyone changing it |

## Docs

| To | Read |
| --- | --- |
| Run it on your machine | [STARTUP.md](docs/STARTUP.md) |
| Run the tests | [TESTING.md](docs/TESTING.md) |
| Ship a change, hotfix, roll back | [RELEASING.md](docs/RELEASING.md) |
| Run production: accounts, access, the database, logs, incidents | [OPERATIONS.md](docs/OPERATIONS.md) |
| Rebuild production from nothing | [VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md) |
| See what the product does, flow by flow | [USER_FLOWS.md](docs/USER_FLOWS.md) |
| Match the design language | [design-system.md](docs/design-system.md) |
| See what is known to be missing | [MVP_KNOWN_GAPS.md](docs/MVP_KNOWN_GAPS.md) |

## Contributing

Work happens on branches into `dev` by pull request, with [Conventional Commits](https://www.conventionalcommits.org/); `dev` and `main` require CI to pass.
`main` is reached only by promoting a green `dev` commit, and that is what deploys.
