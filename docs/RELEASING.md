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

## Files

| File | Purpose |
|------|---------|
| `release-please-config.json` | Configures release-please behavior (release type, tag format); holds the one-time `release-as: 0.1.0` bootstrap that must be removed after the first release |
| `.release-please-manifest.json` | Tracks current version per package (auto-updated by release-please); seeded at the `0.0.0` baseline, with the first release pinned to `v0.1.0` via `release-as` |
| `.github/workflows/release-please.yml` | GitHub Actions workflow that runs release-please on pushes to `main` |
| `CHANGELOG.md` | Auto-generated changelog (created on first release) |
