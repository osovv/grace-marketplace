# Releasing GRACE Marketplace

## Checklist

1. Update `CHANGELOG.md` for the target version.
2. Keep versions synchronized across:
   - `package.json`
   - `README.md`
   - `openpackage.yml`
   - `.claude-plugin/marketplace.json`
   - `plugins/grace/.claude-plugin/plugin.json`
3. Sync canonical skills in `skills/grace/*` with the packaged mirror in `plugins/grace/skills/grace/*`.
4. Confirm the GRACE 4 published surface includes `grace-spec` and `grace-migrate`, excludes `grace-multiagent-execute`, and keeps `.grace` templates in `grace-init`.
5. Run:
   - `bun run validate:ci`
   - `bun run release:checklist`
6. For CLI release confidence, verify a valid GRACE 4 fixture with:
   - `bun run ./src/grace.ts lint --path <valid-grace4-fixture>`
   - `bun run ./src/grace.ts status --path <valid-grace4-fixture> --json --fail-on never`
7. Review the GitHub Actions `Validate` workflow result before publishing.

## Notes

- `bun run validate:ci` covers tests, GRACE 4 CLI regression tests, and marketplace validation.
- `bun run release:checklist` verifies the current version is represented in `CHANGELOG.md` and that the release workflow/scripts exist.
- `scripts/validate-marketplace.ts` also checks packaged-vs-canonical drift and version consistency.
