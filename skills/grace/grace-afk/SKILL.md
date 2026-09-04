---
name: grace-afk
description: "Autonomous work mode for when the user is AFK. Use when the user types `/afk [hours] [budget%] [--checkpoint <min>]` or asks the agent to keep working on its own. The CLI enforces the time budget — the agent polls `grace afk tick` between steps and stops when the CLI says so. One-way-door decisions are escalated to Telegram via `grace afk ask`; everything else is acted on, deferred, or rolled back per the autonomy matrix."
---

Run the /afk harness: keep working through the active GRACE 4 change plan
(`.grace/changes/active/C-*/plan.xml`) on an isolated branch,
making decisions from the user on their behalf within declared boundaries, until the CLI-enforced
budget expires or the user sends STOP via Telegram.

<EXTREMELY-IMPORTANT>
You are NOT the budget tracker. The CLI is.

Between every logical step you MUST run `grace afk tick --path <project-root>`. If it exits
non-zero, your session is over — commit the in-progress work (if any), run `grace afk report`,
and stop. Do NOT try to estimate remaining budget yourself and keep going. The hard gate is
the CLI exit code.
</EXTREMELY-IMPORTANT>

## Prerequisites

- Project is GRACE 4-managed (`.grace/` exists). If it is still on the GRACE 3 `docs/*.xml` layout, run `$grace-migrate` first; if it has no GRACE at all, run `$grace-init` first.
- `@osovv/grace-cli` installed (the binary `grace` is on PATH).
- Telegram config resolved by lookup priority: `$GRACE_AFK_CONFIG` env var, then `<project>/.grace-afk.json`, then `~/.grace/afk.json` (global user-level fallback). Configure one of these if `grace-ask-human` escalations are expected — otherwise one-way-door decisions fall back to `grace afk defer`.

## Command Surface (CLI)

Every subcommand below takes `--path <project-root>` (defaults to `.`).

| Command | Purpose |
|---|---|
| `grace afk start <hours> [<budget%>] [--checkpoint <min>]` | Initialize a session; writes `docs/afk-sessions/<id>/state.json` with `expiresAt`. |
| `grace afk tick` | CLI-side active-session check. Non-zero exit = session over. |
| `grace afk ask --title ... --context ... --options "A:...;B:..." --mypick B --confidence 60 [--details "A\|pros\|cons\|opps\|risks;B\|..."] [--wait 120]` | Send a Telegram escalation; returns `{correlationId, messageId}`. Use `;` as a separator (safer across Windows shells) or `\|`. `--details` (5-field SWOT per option) adds a `[📖 Details]` button that sends a follow-up breakdown without cancelling the ask. `--wait N` blocks up to N seconds polling, ack-ing inline-button taps within ~2s so the user's Telegram spinner stops immediately. |
| `grace afk check --correlation <id> --messageid <n> [--offset <o>]` | Poll Telegram; returns `{status, verb, raw, nextOffset}`. |
| `grace afk journal --class <c> --title ... --rationale ... --outcome ...` | Append to `decisions.md`. |
| `grace afk defer --question ... --contextLine ...` | Append to `deferred.md`. |
| `grace afk increment <commits\|escalations\|deferred>` | Update session counters after an action. |
| `grace afk report` | Print the return dashboard and mark session completed. |
| `grace afk stop --reason "..."` | Manual stop (e.g. when user sends `STOP` in Telegram). |

Exit codes from `tick`:
- `0` — session active, continue
- `42` — `BUDGET_EXHAUSTED` (time expired)
- `43` — no active session
- `44` — session was stopped
- `45` — Telegram sendMessage failed (only from `ask`)
- `46` — grace-afk config missing at env var, project root, and `~/.grace/afk.json` (only from `ask` / `check`)
- `2`  — bad arguments (unknown --class, missing --context, etc.)

### Windows-specific note on exit codes

On Windows, if the agent invokes `bun run ./src/grace.ts afk tick` via a shell
wrapper, `bun run` can squash custom exit codes into `1` or `255`. Two defences:

1. Prefer invoking `bun <file>` directly (no `run` verb) when spawning subprocesses
   from the harness.
2. Also parse the first line of stderr as a fallback — `tick` prints the reason
   before exiting (`Budget exhausted`, `no active session`, `stopped`). If the
   numeric code is squashed to 1/255, the stderr line still disambiguates.

The agent must NOT assume a non-zero exit is always `BUDGET_EXHAUSTED`. Check the
value first; if it is 1 or 255, read stderr to disambiguate before acting.

## Startup Protocol

1. Parse the user's `/afk [hours] [budget%] [--checkpoint <m>]` invocation. Defaults: `hours=2`,
   `budget%=default`, `checkpoint=30`.
2. **Create isolation:**
   - `git tag afk-baseline-<timestamp>`
   - `git checkout -b afk-<timestamp>` from the current branch tip
3. **Start session:** `grace afk start <hours> [<budget%>] [--checkpoint <min>] --path .`
4. **Announce to user** (single line): session id, expiresAt, first step to be worked.
5. Enter the loop.

## The Loop

Every iteration:

1. **Tick.** Run `grace afk tick --path .`. Non-zero exit → jump to "End of session" below.
2. **Pick next task.** Read the active change bundle in `.grace/changes/active/C-*/`: take the
   approved `plan.xml`, find the first pending `T-NNN` task in `<ImplementationPlan>` whose
   `<DependsOn>` tasks are all done. If none, jump to "End of session". If several bundles are
   active, work them one at a time, in `C-*` id order.
3. **Route via autonomy matrix** (see below). Act / defer / escalate.
4. **If acting:** execute the task (invoke the appropriate `grace-*` skill — usually
   `grace-execute` for the next plan task, or `grace-fix` for a bug). Commit the result with the
   project's usual message convention, referencing the change id and task id. Run `grace afk increment commits`.
5. **Record decision.** `grace afk journal --class <c> --title ... --rationale ... --outcome ...`.
6. **Verify gates.** Run the project's test command and `grace lint --path . --assertions current`.
   The green/yellow/red gate logic applies even in single-task mode:
   - green → next iteration
   - yellow → rollback the step (`git reset --hard HEAD~1` on your afk branch ONLY), journal the rollback,
     next iteration
   - red → escalate to Telegram if budget allows; else defer and stop
7. **Checkpoint check.** If `checkpointMinutes` have passed since start or last checkpoint, run
   a summary (tick, lint, journal entry `class=checkpoint`).

## Autonomy Matrix

| Class | Trigger | Action |
|---|---|---|
| `reversible-act` | Obvious implementation step; well-defined contract; single credible approach | **Act** — invoke `grace-execute` or `grace-fix`; journal; continue. |
| `uncertain-deferred` | Multiple credible approaches with different tradeoffs, no obvious winner | **Defer** to `deferred.md` with a note on the competing approaches. |
| `one-way-door-escalated` | Irreversible or main-branch-affecting: push to main, force push, drop DB, deploy, external API side-effects, changing a public MODULE_CONTRACT | **`grace afk ask`** via Telegram; poll `grace afk check` with backoff 10 / 30 / 60 / 120 min. |
| `one-way-door-deferred` | Same as above but Telegram unavailable OR max escalations already sent | **Defer** and move to next step. |
| `scope-creep-deferred` | The step's description would pull in edits outside the declared write scope | **Always defer**, never act. |
| `threshold-yellow-rollback` | Tests / lint / graph consistency between green and red | Rollback + next step. |
| `threshold-red-escalated` | Hard fail on any gate | Telegram ask with options `ROLLBACK / STOP`; default to ROLLBACK on timeout. |
| `checkpoint` | Periodic summary | Journal entry; never an action. |

Rule (anti-Goodhart): "one-way door" is a **behavioural test**, not a feeling. If a single
`git reset --hard afk-baseline-<ts>` cannot fully undo the action, it is one-way. If the action
is file edits on the `afk-*` branch only — it is reversible, act freely.

## Telegram Escalation Format

Delegated to `$grace-ask-human`. Key rules:
- Short (≤10 lines). No prose summaries.
- A/B/C options, 1 line each.
- State your current pick + confidence.
- User replies with one of: `A B C D E PROCEED STOP EVOLVE DEFER` (case-insensitive, any position).
- Polling: 10min → 30min → 60min → 120min. No reply after 120min → fall through: if the ask was
  `uncertain` → defer; if `one-way-door` with no default → stop the session; if `threshold-red`
  with ROLLBACK as option → rollback.

Hard cap: **3 escalations per session** (enforced by CLI via `--autoStop.maxEscalationsPerSession`).
Past that, you must defer remaining one-way-door decisions.

## Idle-fill: review while awaiting a reply

While a `grace afk ask` is outstanding and you are polling `grace afk check` (the 10/30/60/120 min
backoff is long idle time), do NOT sit idle — spend it on a **read-only** `$grace-reviewer` pass over
the work done so far on the `afk-*` branch (5 axes + `grace lint --path .`). Queue findings in the
journal (`grace afk journal --class review ...`); do not block on them.

Guardrails:
- **Read-only by default.** Apply only clearly-reversible fixes that are in-scope AND unrelated to the
  question under escalation. Anything touching the escalated decision waits for the answer.
- **Interruptible.** The moment `grace afk check` returns a verb, drop the review immediately and act
  on the reply. Never make the user wait on a review.
- Keep running `grace afk tick` between review chunks — the budget clock keeps running during the wait.

## STOP handling

If you see `grace afk check` return `{verb: "STOP"}`, immediately:
1. Commit any in-progress work (with message `grace(afk): checkpoint before STOP`).
2. Run `grace afk stop --reason "user STOP via telegram"`.
3. Run `grace afk report`.
4. Exit the loop. Do not take further actions.

## End of Session

Triggered by: `tick` non-zero, user STOP, plan exhausted, hard block (e.g. CLI failure).

1. Ensure working tree is committed (or stashed with a descriptive name).
2. **Final review.** Run a `$grace-reviewer` integrity pass over the whole `afk-*` branch (all 5 axes)
   plus `grace lint --path .`. Fold the findings (with severities) into the return dashboard so the
   human sees the QUALITY of the work, not just the list of commits. Journal it
   (`grace afk journal --class review ...`). Read-only — do NOT auto-fix at end of session; let the
   human decide what to act on.
3. Run `grace afk report --path .` (this marks the session completed).
4. Announce to the user: branch name, session id, deferred count, commits count, **review summary**,
   next suggested action (usually: review `deferred.md` + the review findings, then merge `afk-<ts>`
   into the target feature branch).
5. Do not delete the `afk-<ts>` branch — leave it for human review.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I can estimate budget better than the CLI" | You can't. LLM math on token consumption is unreliable and biased toward continuing. The CLI has the real clock. |
| "This one decision is borderline one-way, I'll just act" | Borderline = defer. Over a long session, "just act" on every borderline becomes the majority of decisions and you end up with un-reviewable diffs. |
| "Telegram escalation is overkill for this small choice" | If it is small, it is not a one-way door — act, do not escalate. If it is one-way, it is not small. |
| "The reviewer will catch anything bad" | There is no reviewer. You are alone. The human will see only the final diff + journal. Be conservative. |
| "I'll skip the journal entry for trivial steps" | The journal is how the human reconstructs what you did. Trivial steps are the ones most likely to be questioned on return. |
| "I should check budget every minute just in case" | Every tick burns API cost. Call tick between logical steps, not inside tight loops. |
| "The plan task is too vague, I'll reinterpret it" | Vague plan task = `scope-creep-deferred`. Do not reinterpret; defer and let the human clarify. |

## Red Flags

- You are about to edit a file outside the declared write scope of the current plan step.
- You are considering `git push` or anything that touches `main` / `master`.
- You are about to change a MODULE_CONTRACT without a Telegram ask.
- You have not run `grace afk tick` in the last 15 minutes.
- You have escalated more than 3 times in one session.
- You are editing `docs/afk-sessions/<id>/state.json` by hand (never do this — use CLI commands).

## When NOT to Use

- The user is present and actively iterating. `/afk` is for unattended work.
- The plan is unclear or missing. Run `$grace-plan` first.
- There are no pending `T-NNN` tasks in the active change plan. Nothing to do.
- Verification coverage is skeletal. Without `V-M-*` entries, the "verify gates" step has no teeth.
- Less than 30 minutes of intended autonomy — just keep working in the foreground instead.

## Verification

Before exiting, confirm:

- [ ] Session state shows `status=completed` or `status=stopped` (verification: `cat docs/afk-sessions/<id>/state.json | jq .status`)
- [ ] All in-progress code committed on `afk-<ts>` branch (verification: `git status` clean on that branch)
- [ ] `decisions.md` has at least one entry per iteration that took an action
- [ ] `deferred.md` is listed in the final report with count matching state.deferred
- [ ] The project's test command and `grace lint --path . --assertions current` exit 0 on the final commit (verification: attach exit codes)
- [ ] A final `$grace-reviewer` pass ran; its findings (with severities) are in the dashboard and journaled (`class=review`)
- [ ] User has been announced the final dashboard with next-action suggestion
