# Releasing GRACE Marketplace

## One-Command Release

```bash
# Bump patch version (most common)
bun run release:bump patch

# Other version targets
bun run release:bump minor
bun run release:bump major
bun run release:bump prepatch --preid rc
bun run release:bump 4.0.0 # promote an approved RC line to stable
```

`release:bump` will:

1. Verify required tools, clean working tree, checked-out branch, target tag absence, and target changelog-block absence.
2. Run the full current `validate:release` suite before mutating release files.
3. Resolve the target version and run `npm version --no-git-tag-version` with the given target.
4. Generate a conventional-changelog entry from git history.
5. Generate a mandatory AI release summary with OpenCode (requires `opencode` in PATH).
6. Prepend exactly one target-version changelog entry to `CHANGELOG.md`.
7. Update all version surface files:
   - `README.md` — `Current packaged version: \`x.y.z\`` marker
   - `openpackage.yml` — `version:` line
   - `.claude-plugin/marketplace.json` — `metadata.version` and plugin `version`
   - `plugins/grace/.claude-plugin/plugin.json` — `version` field
   - `src/grace.ts` — CLI metadata shown by `grace --version`
8. Run `bun run validate:release` again against the proposed release state.
9. Assert only expected release files have changed.
10. Commit those files with a `chore:` message.
11. Create an annotated tag `v<version>`.
12. Push the branch first, then the tag.

The workflow fails closed at every boundary. A failed preflight creates no release mutation. A failure after version files change leaves the worktree uncommitted for inspection. A commit failure creates no tag. A tag failure leaves only the local release commit. A branch-push failure leaves the local commit and tag. If branch push succeeds but tag push fails, rerun only the reported tag push after inspecting the remote; do not rerun the version bump.

Every command uses argument arrays without shell interpolation. Release automation rejects detached HEAD, dirty worktrees, existing target tags, unexpected changed files, invalid version surfaces, missing changelog summaries, marketplace drift, and validation failures before publish-triggering tag push.

> **Note:** Canonical skill mirror syncing (`skills/grace/*` → `plugins/grace/skills/grace/*`) is **not** done automatically. The `validate:marketplace` script catches drift. Sync skills separately when needed.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GRACE_RELEASE_SUMMARY_MODEL` | OpenCode model for AI release summary | `deepseek/deepseek-v4-flash` |
| `GRACE_RELEASE_SUMMARY_TIMEOUT_MS` | Per-attempt timeout for OpenCode | `120000` (2 min) |

## Pre-Release Validation

The release automation baseline is the existing `v3.11.0` tag, and GRACE 4 release-candidate tags are already published. Do **not** create a synthetic `v4.0.0` baseline tag: `v4.0.0` is reserved for the actual stable release.

Before a release bump, fetch tags and confirm that the latest reachable tag is the release being promoted from. For the final GRACE 4 promotion, the expected predecessor is the latest `v4.0.0-rc.*` tag. Run the explicit stable target only after the release branch is confirmed as the intended stable source:

```bash
git fetch origin --tags
git describe --tags --abbrev=0
bun run release:bump 4.0.0
```

Future `release:bump` runs generate changelog and summary context from that latest reachable tag.

Stable promotion refuses an existing `v4.0.0` tag or existing `4.0.0` changelog block before mutation. The successful `4.0.0-rc.*` to `4.0.0` path prepends one stable block while preserving the RC history below it.

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
4. Publishes stable versions to npm with the default dist-tag, and prerelease versions with the prerelease identifier as the dist-tag (for example, `4.0.0-rc.0` publishes with `--tag rc`).
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
