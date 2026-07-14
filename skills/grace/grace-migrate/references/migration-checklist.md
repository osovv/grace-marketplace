# GRACE 4 Migration Checklist

## Before Writing `.grace`

- [ ] Every legacy source path is inventoried with its intended GRACE 4 destination or an explicit unsupported/omitted reason.
- [ ] A restorable backup exists at a recorded path outside the cleanup set.
- [ ] Backup verification evidence and timestamp are recorded.
- [ ] Ambiguities and unsupported legacy structures are listed.
- [ ] No retroactive `C-*` bundles are proposed.
- [ ] The user explicitly approved writing the reviewed `.grace` artifacts.

## After Writing `.grace`

- [ ] Generated `.grace/context` artifacts and source coverage were reviewed.
- [ ] Generated graph index, routed graph documents, and projection coverage were reviewed.
- [ ] Generated verification index, routed verification documents, and projection coverage were reviewed.
- [ ] `grace lint --path <project-root> --assertions current` passed and the exit state is recorded.
- [ ] `grace status --path <project-root> --json` reports `projectKind` `grace4`, no integrity errors, and its exit state is recorded.
- [ ] Any failed or incomplete gate stopped cleanup while preserving legacy sources.

## Before Legacy Cleanup

- [ ] The cleanup proposal lists exact inventoried paths and actions; it contains no broad glob or unreviewed recursive deletion.
- [ ] The restorable backup remains available and is not included in cleanup.
- [ ] Git availability and project worktree membership were recorded.
- [ ] For a git worktree, `git status --porcelain --untracked-files=all` output was recorded before cleanup.
- [ ] The user separately and explicitly approved the exact cleanup proposal.
- [ ] A dirty worktree or non-git project has a second explicit acknowledgement naming that risk.
- [ ] Each archive/delete action and result will be recorded in the migration report.
- [ ] Any cleanup failure stops immediately, preserves remaining legacy files, and is never retried automatically.
