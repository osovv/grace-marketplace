---
name: grace-fix
description: "Debug an issue using GRACE semantic navigation. Use when encountering bugs, errors, or unexpected behavior - navigate through the graph, verification plan, and semantic blocks to analyze the mismatch and apply a targeted fix."
---

Debug an issue using GRACE semantic navigation.

## Process

### Step 1: Locate via Knowledge Graph
From the error/description, identify which module is likely involved:
1. Read `docs/knowledge-graph.xml` for module overview
2. Read `docs/verification-plan.xml` for relevant scenarios, test files, or log markers if available
3. Follow CrossLinks to find the relevant module(s)
4. Read the MODULE_CONTRACT of the target module

### Step 2: Navigate to Block
If the error contains a log reference like `[Module][function][BLOCK_NAME]`:
- Search for `START_BLOCK_BLOCK_NAME` in the codebase — this is the exact location
- Read the containing function's CONTRACT for context

If the failure came from a named verification scenario or test:
- read the matching `V-M-xxx` entry in `docs/verification-plan.xml`
- open the mapped test file and expected evidence for that scenario

If no log reference:
- Use MODULE_MAP to find the relevant function
- Read its CONTRACT
- Identify the likely BLOCK by purpose

### Step 3: Analyze
Read the identified block, its CONTRACT, and relevant verification entry. Determine:
- What the block is supposed to do (from CONTRACT)
- What evidence should prove that behavior (from tests, traces, or log markers)
- What it actually does (from code)
- Where the mismatch is

### Step 4: Fix
Apply the fix WITHIN the semantic block boundaries. Do NOT restructure blocks unless the fix requires it.

### Step 5: Update Metadata
After fixing:
1. Add a CHANGE_SUMMARY entry with what was fixed and why
2. If the fix changed the function's behavior — update its CONTRACT
3. If the fix changed module dependencies — update knowledge-graph.xml CrossLinks
4. If the fix changed tests, commands, or required markers — update `docs/verification-plan.xml`
5. Run the relevant module-local verification commands
6. If the failure revealed weak tests, weak logs, or poor execution-trace visibility — use `$grace-verification` to strengthen automated checks before considering the issue fully closed

### Important
- Never fix code without first reading its CONTRACT
- Never change a CONTRACT without user approval
- If the bug is in the architecture (wrong CONTRACT) — escalate to user, don't silently change it
