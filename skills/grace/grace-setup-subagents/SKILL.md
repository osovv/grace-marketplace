---
name: grace-setup-subagents
description: "Create GRACE subagent presets for the current agent shell. Use when you want GRACE worker and reviewer agent files scaffolded for Claude Code, OpenCode, Codex, or another shell."
---

Create GRACE subagent files for the current shell by reusing the shell's own agent-file conventions.

## Purpose

`$grace-multiagent-execute` works best when the shell already has GRACE-specific worker and reviewer presets.

This skill scaffolds those presets into the correct local agent directory for the current shell.

The controller remains in the main session. Workers should expect compact execution packets, fresh one-module ownership, scoped reviews, and controller-managed graph updates.

## Default Roles

By default, create these subagents:

1. `grace-module-implementer`
2. `grace-contract-reviewer`
3. `grace-verification-reviewer`
4. `grace-fixer`

The main session remains the controller. This skill does **not** create a controller agent.

## Process

### Step 1: Detect the Current Shell
Use the current environment and project structure to determine where the skill is running.

Prefer, in this order:

1. explicit environment hints from the shell
2. project-local config directories
3. user-level agent directories

Typical examples:
- Claude Code projects often use `.claude/`
- OpenCode projects often use `.opencode/`
- Codex projects often use `.codex/`

If detection is ambiguous, ask the user which shell to target.

### Step 2: Find a Real Agent File Example
Do **not** guess the target file format if a local example exists.

Search for an existing agent file for the current shell:
- first in the current project
- then in the user's global config for that shell
- then in nearby projects if needed

Use a real example to infer:
- file extension
- frontmatter or config structure
- model field names
- tool/permission layout

If no reliable local example exists:
- look for official shell documentation
- if documentation is still unclear, ask the user for a canonical sample or doc link

### Step 3: Choose Scope and Target Directory
Default to project-local setup unless the user explicitly asks for global setup.

Create the GRACE presets under the shell's local agent directory in a `grace/` subfolder when the shell supports subfolders cleanly.

If the shell does not support nested subfolders for agents, place the generated files directly in the local agent directory with GRACE-prefixed names.

### Step 4: Read the Role Prompts
The role prompt bodies live in `references/roles/`:

- `references/roles/module-implementer.md`
- `references/roles/contract-reviewer.md`
- `references/roles/verification-reviewer.md`
- `references/roles/fixer.md`

These are the shared role bodies. Reuse them. Only the shell-specific wrapper should change.

These shared prompts assume the newer multi-agent workflow:
- workers receive execution packets instead of rereading full XML artifacts whenever possible
- reviewers default to scoped gate review and escalate only when evidence suggests wider drift
- verification is split across module, wave, and phase levels
- the controller owns `docs/verification-plan.xml` in addition to plan and graph artifacts

### Step 5: Render Shell-Specific Agent Files
For each role:

1. wrap the shared role body in the file format discovered in Step 2
2. preserve the shell's conventions for:
   - metadata fields
   - model names
   - permissions or tool declarations
   - subagent mode flags
3. write the file into the target directory

If the shell has no first-class subagent file concept, create the nearest useful equivalent and explain the limitation.

### Step 6: Report What Was Created
After scaffolding, report:

- detected shell
- target directory
- created files
- any assumptions copied from the local example
- any fields the user should adjust manually, such as model aliases

## Rules
- Prefer copying the shell's real local format over inventing one
- Keep prompts aligned with `grace-multiagent-execute`, `grace-reviewer`, `grace-fix`, and `grace-verification`
- Do not overwrite existing files without user intent
- Do not create architecture-planning agents here; this skill is for execution support
- Do not introduce worker-pool or worker-reuse assumptions into the generated presets
- If the shell supports agents differently, create the nearest working equivalent and explain the difference
