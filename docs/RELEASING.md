# Release Process

## Branch Model

This project uses a **dev → main promotion flow**:

- **`dev`** is the default/integration branch.
  All feature branches and bugfix PRs target `dev`.
  CI (`.github/workflows/test.yml`) runs on every push and PR to `dev`.
- **`main`** is the deploy-only branch.
  It auto-deploys and is reached **only** by promoting `dev` → `main` as a deliberate, versioned release.
  Never commit or open PRs directly against `main`.

```
feature/* ──PR──▶ dev ──promotion──▶ main (versioned release + deploy)
```

## Conventional Commits

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/) to enable automatic versioning.
The commit message format is:

```
<type>(<scope>): <description>

[optional body]
```

**Types and their semver effect:**

| Type       | Semver Bump | Example                              |
|------------|-------------|--------------------------------------|
| `fix:`     | PATCH       | `fix(api): handle null market items` |
| `feat:`    | MINOR       | `feat(ui): add drag-and-drop floorplan editor` |
| `feat!:` / `fix!:` (BREAKING CHANGE in body) | MAJOR | `feat!: drop support for legacy schema` |
| `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`, `ci:`, `build:` | NONE (no release) | `chore(deps): bump axios to 1.13` |

## Release Process (Automated)

Release management is handled by [release-please](https://github.com/googleapis/release-please) (GitHub Action `googleapis/release-please-action@v5`) via `.github/workflows/release-please.yml`.

### How a Release Happens

1. **Feature work lands on `dev`** through normal PRs with conventional commit messages.
2. **A maintainer promotes `dev` → `main`** (e.g., `git checkout main && git merge dev && git push`).
   This is the **only** way code reaches `main`.
3. **release-please detects the new commits on `main`** and automatically opens (or updates) a **Release PR** targeting `main`.
   This PR contains:
   - A version bump in `.release-please-manifest.json`
   - An updated `CHANGELOG.md` with all changes since the last release
4. **A maintainer reviews and merges the Release PR.**
   On merge, release-please automatically:
   - Creates a **git tag** (e.g., `v0.1.0`)
   - Creates a **GitHub Release** with the changelog content
   - The deploy pipeline picks up the tag and deploys

### Bootstrapping Note

The release-please workflow becomes active once it reaches `main` (via the first `dev` → `main` promotion after this config is merged to `dev`).
The manifest is seeded at `0.0.0`, and the first release is pinned to `v0.1.0` via `"release-as": "0.1.0"` in `release-please-config.json`.

`release-as` is a forced version: it overrides the conventional-commit calculation on **every** run until it is removed, so it must be cleared after the first release ships.
Once `v0.1.0` is tagged, remove the `release-as` field from `release-please-config.json`; from then on release-please derives each version from the accumulated commits (`feat:` → minor, `fix:` → patch, breaking change → major).

## Pre-Deploy: Database Migrations

Migrations are never run automatically - rewriting stored documents is a deliberate operator action.
Before a promotion reaches production, run the pending migrations in `back-end/migrations/` against the production database (each is idempotent, and `--dry-run` previews the changes):

```bash
python migrations/migrate_phase.py                 # backfills `phase` on existing markets
python migrations/migrate_market_keys.py           # rewrites markets under the canonical camelCase keys
python migrations/migrate_is_draft_consistency.py  # makes `isDraft` agree with `phase` on markets that have one
```

`migrate_is_draft_consistency.py` **must** be run with the code that makes `phase` the single source of truth, and it is the migration whose omission is visible to vendors.
A market the old build published carries `phase: "draft"` + `isDraft: false` (publishing was a `PUT` of `isDraft: false`; nothing advanced the phase), and every read now derives the market's state from `phase`.
`draft` is a recognized phase, so it is taken at face value: until the migration advances those markets to `archived`, an already-live market reverts to looking unpublished - its public check-in URL returns `404`, and its organizer is routed back into the setup wizard.
The migration repairs that disagreement in favour of `isDraft`, because on those documents `isDraft` was the only publish signal that ever existed.
Run it after `migrate_phase.py`: the two are disjoint by construction (one touches only documents *with* a `phase`, the other only those without), but that ordering means a database migrated in one pass ends up fully consistent.

`migrate_market_keys.py` **must** be run before the code that reads market documents by the canonical key only.
An unmigrated market is invisible to every such read: vendors are told the market does not exist at check-in, and organization members get an empty market list.
The migration records a marker document in the `schema_migrations` collection when it completes, and the back end refuses to boot unless it can read that marker; the fatal log names the script to run.
The check fails closed on anything short of a confirmed marker - an unknown migration state is not a migrated one - so a deploy that skipped the migration fails loudly at startup rather than quietly serving half the data.

## Files

| File | Purpose |
|------|---------|
| `release-please-config.json` | Configures release-please behavior (release type, tag format); holds the one-time `release-as: 0.1.0` bootstrap that must be removed after the first release |
| `.release-please-manifest.json` | Tracks current version per package (auto-updated by release-please); seeded at the `0.0.0` baseline, with the first release pinned to `v0.1.0` via `release-as` |
| `.github/workflows/release-please.yml` | GitHub Actions workflow that runs release-please on pushes to `main` |
| `CHANGELOG.md` | Auto-generated changelog (created on first release) |
