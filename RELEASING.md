# Releasing GRACE Marketplace

## Release Commands

```bash
# Prepare the next stable patch from a clean non-main release branch
bun run release:bump patch

# Other stable or prerelease targets
bun run release:bump minor
bun run release:bump major
bun run release:bump prepatch --preid rc

# Or prepare an exact unreleased stable version
bun run release:bump X.Y.Z

# After that PR passes required checks and is merged, run from clean synchronized main
bun run release:finalize X.Y.Z
```

`release:bump` will:

1. Verify required tools, clean working tree, checked-out branch, target tag absence, and target changelog-block absence. Stable targets additionally fetch `origin/main`, require a non-`main` release branch, and require that branch to contain the fetched `origin/main` so the pull request cannot omit newer base changes.
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
11. For a prerelease, create an annotated tag `v<version>`, push the branch, then push the tag.
12. For a stable release, push only the release branch and find or create its PR to protected `main`; no stable tag is created before required checks pass and the PR is merged.

The workflow fails closed at every boundary. A failed preflight creates no release mutation. A failure after version files change leaves the worktree uncommitted for inspection. A prerelease commit failure creates no tag; a prerelease tag failure leaves only the local release commit. A stable branch-push failure leaves only the local release commit, and PR-creation failure leaves the pushed branch for manual PR creation. Stable finalization is a separate post-merge command and never pushes `main` directly.

Every command uses argument arrays without shell interpolation. Release automation rejects detached HEAD, dirty worktrees, stale release branches, existing local or remote target tags, unexpected changed files, invalid version surfaces, missing changelog summaries, marketplace drift, and validation failures before publish-triggering tag push.

`release:finalize` accepts exactly one stable semantic version. It fetches `origin/main` without broad tag mutation, requires clean checked-out `main` with `HEAD == origin/main`, verifies package/changelog version equality, rejects an existing remote tag, reruns `validate:release`, creates or recovers the exact local annotated tag, verifies the tag resolves to `HEAD`, and pushes only that tag.

> **Note:** Canonical skill mirror syncing (`skills/grace/*` → `plugins/grace/skills/grace/*`) is **not** done automatically. The `validate:marketplace` script catches drift. Sync skills separately when needed.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GRACE_RELEASE_SUMMARY_MODEL` | OpenCode model for AI release summary | `deepseek/deepseek-v4-flash` |
| `GRACE_RELEASE_SUMMARY_TIMEOUT_MS` | Per-attempt timeout for OpenCode | `120000` (2 min) |

## Stable Release Preparation

Published stable tags are immutable release history. Choose a new semantic version that has no local or remote tag and no existing changelog block, then create the release branch from current `origin/main`:

```bash
git fetch --no-tags origin main:refs/remotes/origin/main
git switch -c release/X.Y.Z origin/main
git merge-base --is-ancestor origin/main HEAD
bun run release:bump X.Y.Z
```

`release:bump X.Y.Z` performs exact local and remote target-tag checks, commits and pushes the version surfaces to the release branch, and finds or creates its PR to protected `main`. It deliberately does not create `vX.Y.Z` before the PR is merged.

After the required checks pass and the PR is merged:

```bash
git switch main
git pull --ff-only origin main
bun run release:finalize X.Y.Z
```

Stable preparation refuses an existing local or remote target tag or target-version changelog block before mutation. Post-merge finalization refuses any content drift from `origin/main` and is recovery-aware only for an exact local tag left by a prior failed tag push.

The publish workflow fetches full history. Stable tags must resolve to the exact fetched `origin/main` commit, and the stable npm/GitHub job requires approval through the protected `stable-release` environment. Repository settings must keep explicit environment deployment policies for branch `main` and tags `v*`; keep `main` protected with required `validate`, `windows-compatibility`, and `dart-adapter` checks but no mandatory PR approval; and keep an active tag ruleset preventing deletion or non-fast-forward updates of `v*` tags. Prerelease tags remain on their explicit npm identifier channel such as `rc` and create GitHub prereleases.

`bun run release:checklist` validates repository protections as well as post-publication integrity. Run it before promotion to confirm the protected environment/branch/tag controls, and again from the exact published tag commit. The publication-state portion fails when `HEAD` differs from that tag or when the current local `npm pack` shasum differs from the published package shasum, preventing unreleased workspace content from being mistaken for the released artifact.

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
3. Runs `release:check`, `typecheck`, `test`, `validate:cli`, `validate:marketplace`, and the packed CLI smoke gate.
4. Publishes stable versions to npm with the default dist-tag, and prerelease versions with the prerelease identifier as the dist-tag (for example, `4.0.0-rc.0` publishes with `--tag rc`).
5. Creates a GitHub Release with the matching changelog block as body.

After both publication steps succeed, check out the exact release tag and run `bun run release:checklist` to verify the tag commit, npm dist-tag, published tarball shasum, and GitHub prerelease flag as one consistent state.

## Partial Publication Recovery

- **npm publish succeeded, GitHub Release creation failed:** do not rerun `release:bump` or republish the immutable npm version. Verify the existing tag and npm dist-tag, then create the missing release with `gh release create <tag> --verify-tag --notes-file <release-body>` (add `--prerelease` only for prerelease tags).
- **GitHub Release exists, npm publish failed or never ran:** verify that the package version is absent from npm, correct the authentication/channel issue, and run the exact `npm publish --access public` command for stable or `npm publish --access public --tag <identifier>` for a prerelease. Do not recreate or retag the GitHub Release.
- **Both publication steps report success but channel state is wrong:** stop. Run `bun run release:checklist`, inspect npm dist-tags and the GitHub prerelease flag, and correct only the channel metadata; never rewrite an existing git tag or duplicate a changelog block.

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
6. Put stable version changes through a required-check PR to protected `main`; after merge, run `bun run release:finalize X.Y.Z`. For prereleases, push the annotated `vX.Y.Z-prerelease` tag after branch validation.
