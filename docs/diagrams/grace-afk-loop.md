# `grace-afk` autopilot loop

Visual reference for the `grace-afk` skill (see `skills/grace/grace-afk/SKILL.md`).
GitHub renders the mermaid block inline.

## The loop

```mermaid
flowchart TD
    Start([User: /afk 8 20]) --> CreateSess["grace afk start<br/>• tag baseline<br/>• branch afk-TS<br/>• write state.json with expiresAt"]
    CreateSess --> Tick{"grace afk tick<br/>exit code"}

    Tick -->|"0 — active"| NextStep["Pick next pending T-task<br/>from .grace/changes/active plan"]
    Tick -->|"42 — BUDGET_EXHAUSTED"| Report["grace afk report<br/>(dashboard)"]
    Tick -->|"44 — stopped"| Report

    NextStep --> Classify{"Autonomy matrix:<br/>decision class?"}

    Classify -->|"reversible"| Act["invoke grace-fix /<br/>grace-execute /<br/>grace-refactor<br/>→ commit on afk branch"]
    Classify -->|"one-way door"| Ask["grace afk ask<br/>→ Telegram"]
    Classify -->|"scope creep"| Defer["grace afk defer<br/>→ deferred.md"]
    Classify -->|"threshold yellow"| Rollback["git reset --hard<br/>on afk branch"]

    Act --> Gates{"bun test<br/>+ grace lint"}
    Gates -->|"green"| Tick
    Gates -->|"yellow"| Rollback
    Gates -->|"red"| Ask

    Ask -->|"A / B / PROCEED"| Act
    Ask -->|"STOP"| StopCmd["grace afk stop"]
    Ask -->|"no reply 2h"| Defer

    StopCmd --> Report
    Defer --> Tick
    Rollback --> Tick

    Report --> End(["Session complete:<br/>human reviews deferred.md,<br/>merges afk-TS branch"])
```

## How to read it

- **Rectangles** — actions (CLI commands, git operations).
- **Diamonds** — decision forks (tick gate, autonomy matrix, gates).
- The central **`grace afk tick` gate** is the "clock you cannot fast-forward": control returns
  there after every action. The CLI, not the LLM, decides when the session ends.
- The **red path through Telegram** is the only way out of autopilot mid-session: the agent only
  pages the human for genuinely irreversible decisions (one-way doors) or hard-red gate failures.
- **`deferred.md`** is the log of questions the agent chose not to answer. On return, the human
  reads it first, then merges the `afk-TS` branch.

## Related

- `skills/grace/grace-afk/SKILL.md` — protocol the agent follows inside the loop.
- `skills/grace/grace-ask-human/SKILL.md` — message format for the Telegram escalation box.
- `src/grace-afk.ts` — CLI wiring that owns the state transitions shown here.
- `src/afk/session.ts` — atomic state.json writes and the exit-code constants.
- `PLAN.md` → "PR-3 `grace-afk`" section — design rationale.
