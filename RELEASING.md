# Releasing GRACE Marketplace

## One-Command Release

```bash
# Bump patch version (most common)
bun run release:bump patch

# Other version targets
bun run release:bump minor
bun run release:bump major
bun run release:bump prepatch --preid rc
```

`release:bump` will:

1. Verify the working tree is clean.
2. Run `npm version --no-git-tag-version` with the given target.
3. Generate a conventional-changelog entry from git history.
4. Generate a mandatory AI release summary with OpenCode (requires `opencode` in PATH).
5. Prepend the changelog entry to `CHANGELOG.md`.
6. Update all version surface files:
   - `README.md` — `Current packaged version: \`x.y.z\`` marker
   - `openpackage.yml` — `version:` line
   - `.claude-plugin/marketplace.json` — `metadata.version` and plugin `version`
   - `plugins/grace/.claude-plugin/plugin.json` — `version` field
7. Run `bun run release:check` to validate consistency.
8. Assert only expected release files have changed.
9. Commit those files with a `chore:` message.
10. Create an annotated tag `v<version>`.
11. Push the branch and tag.

> **Note:** Canonical skill mirror syncing (`skills/grace/*` → `plugins/grace/skills/grace/*`) is **not** done automatically. The `validate:marketplace` script catches drift. Sync skills separately when needed.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GRACE_RELEASE_SUMMARY_MODEL` | OpenCode model for AI release summary | `deepseek/deepseek-v4-flash` |
| `GRACE_RELEASE_SUMMARY_TIMEOUT_MS` | Per-attempt timeout for OpenCode | `120000` (2 min) |

## Pre-Release Validation

Before the first automated `release:bump` in this repository, ensure a reachable baseline tag exists for the current published version. For the current `4.0.0` baseline, create and push it before the release-automation workflow is introduced on the tagged commit:

```bash
git tag -a v4.0.0 -m v4.0.0
git push origin v4.0.0
```

After that one-time seed tag exists, future `release:bump` runs generate changelog and summary context from the latest reachable tag.

Before running `release:bump`, ensure CI passes:

```bash
bun run validate:ci
```

Or run individual checks:

```bash
bun run typecheck
bun run test
bun run validate:cli
bun run validate:marketplace
bun run release:check
```

## CI Publishing

When a tag matching `v*` is pushed, the `publish.yml` GitHub Actions workflow:

1. Verifies the tag matches `package.json` version.
2. Runs `bun install --frozen-lockfile`.
3. Runs `release:check`, `typecheck`, `test`, `validate:cli`, and `validate:marketplace`.
4. Publishes to npm with `npm publish --access public`.
5. Creates a GitHub Release with the matching changelog block as body.

## Commit Message Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: correct a bug
chore: bump version / tooling
docs: update documentation
refactor: restructure without behavior change
test: add or update tests
ci: CI configuration changes
```

A `commitlint` hook enforces the convention on new commits.

## Manual Checklist (Fallback)

If you need to release without the automated script:

1. Update `package.json` version.
2. Update `CHANGELOG.md` with a vv-opencode-style entry:
   ```
   ## <small>X.Y.Z (YYYY-MM-DD)</small>

   ### Summary

   One-paragraph summary of changes...

   * conventional commit bullets...
   ```
3. Update version in `README.md`, `openpackage.yml`, `.claude-plugin/marketplace.json`, `plugins/grace/.claude-plugin/plugin.json`.
4. Run `bun run validate:marketplace` to catch any drift between canonical skills and the packaged mirror.
5. Run `bun run release:check` to verify consistency.
6. Push tag `vX.Y.Z` to trigger CI publish.
