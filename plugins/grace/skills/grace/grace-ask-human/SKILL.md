---
name: grace-ask-human
description: "Short Telegram escalation during autonomous sessions. Use ONLY from inside grace-afk, when a one-way-door decision must be confirmed by a human. Builds a message of 10 lines or fewer, sends it via grace afk ask, and polls grace afk check with exponential backoff. Blocks until a reply, a timeout, or session expiry."
---

Send a Telegram escalation to the human with a hard short format, then poll for the reply.

This skill is **a thin wrapper around `grace afk ask` and `grace afk check`**. It exists to
enforce message discipline — without it, LLMs send walls of text over Telegram which the user
cannot act on from a phone.

## Preconditions

- You are inside an active `grace-afk` session (checked by `grace afk tick` returning 0).
- Telegram config is available through any of: `$GRACE_AFK_CONFIG` env var, `<project>/.grace-afk.json`, or global `~/.grace/afk.json` (checked in that priority).
- You have a decision that qualifies as `one-way-door-escalated` (see `grace-afk#Autonomy-Matrix`).
  **If the decision is reversible, do NOT escalate** — act and journal.

## Message Format (hard)

The CLI generates this from your input to `grace afk ask`. You pass:

- `--title "<5-10 word decision title>"`
- `--context "<one sentence — the situation>"`
- `--options "A:<1 line>;B:<1 line>;C:<1 line>"` (2-5 options). Use `;` as a separator — it is safer than `|` across Windows shells.
- `--details "A|pros|cons|opportunities|risks;B|..."` (optional). When provided, the message gets a `[📖 Details]` button. On tap the CLI sends a SWOT breakdown (Pros / Cons / Opportunities / Risks) as a follow-up message without cancelling the ask — the user reads it, goes back to the first message, then picks A/B/C/PROCEED/DEFER/STOP.
- `--wait <seconds>` (optional, default 0). When >0, the CLI blocks and polls `getUpdates` every 2 seconds. On an inline-button tap it calls `answerCallbackQuery` immediately so the spinner stops within ~2s (inside Telegram's 15-second callback timeout window), strips the keyboard on the original message, and returns the classified answer as JSON. Without `--wait`, the agent must call `grace afk check` separately to pick up and ack the reply — on Telegram that means the user's spinner shimmers until the next check.
- `--mypick <letter>` — the option you'd pick if forced
- `--confidence <0-100>` — your percent confidence in that pick

Total message ≤10 lines. No multi-paragraph explanations. If you need paragraphs, the
question is not shaped for Telegram — simplify or defer.

## Process

### Step 1. Confirm this is escalation-worthy

Answer these in your working notes before sending:
- Is this decision irreversible (cannot be undone by `git reset --hard afk-baseline-<ts>`)?
- Is there a default that would be safe on timeout? (If yes, include it as an option.)
- Have you already escalated the maximum times this session? (CLI will refuse if so.)

If any answer is no — use `grace afk defer` instead.

### Step 2. Send

```
grace afk ask \
  --path . \
  --title "Merge afk branch into main" \
  --context "Plan step-12 complete, 14 commits, all gates green; ready to merge" \
  --options "A:merge to main;B:open PR for review;C:leave as afk branch" \
  --mypick B \
  --confidence 80
```

CLI returns JSON: `{ correlationId, messageId, sessionId }`. Store these — both are needed to poll.

### Step 3. Poll with backoff

Wait the backoff interval, then call:

```
grace afk check --path . --correlation <id> --messageid <msgId> --offset <lastOffset>
```

Result shapes:
- `{ status: "pending" }` — no reply yet
- `{ status: "answered", verb: "A|B|C|D|E|PROCEED|STOP|EVOLVE|DEFER", raw, nextOffset }` — done
- `{ status: "unrecognized", verb: "UNKNOWN", raw, nextOffset }` — user wrote free-form text

Backoff schedule:
1. First check: **10 minutes** after send
2. Then: **30 minutes** after the first check
3. Then: **60 minutes**
4. Then: **120 minutes** (final check)

Total wait ≤ 220 minutes. No reply after that → fall through to Step 4.

Between poll checks, you should NOT be idle — continue the /afk loop on independent steps.
Come back to this correlation id whenever the backoff has elapsed.

### Step 4. Fall-through if no reply

- If any option has "default on timeout" semantics (e.g. `ROLLBACK`), execute it; journal
  `class=one-way-door-escalated` with `outcome=default-on-timeout`.
- Otherwise `grace afk defer --question "<title>" --contextLine "<context>"` and continue.

### Step 5. On answer

- `A/B/C/D/E` → act per that option, journal with the chosen option.
- `PROCEED` → act per your `--mypick`, journal with confidence noted.
- `STOP` → `grace afk stop --reason "user STOP via telegram"`; exit the loop.
- `EVOLVE` → defer (grace-evolve not yet available); journal with that note.
- `DEFER` → `grace afk defer`; continue with next step.
- `UNKNOWN` (free-form) → journal the raw text under `outcome=manual-interpretation-required`,
  then defer (do not try to interpret complex free-form replies autonomously).

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Just this once, let me send a longer message with full context" | The user is on a phone at 02:00. Long context does not help them, it delays the reply. Simplify or defer. |
| "I'll send one ask and act immediately, don't need to poll" | That defeats the purpose. The ask is a BLOCKING gate for this decision path. Do work on other steps while polling. |
| "The user hasn't replied, I'll re-send to remind" | Spamming Telegram is why max-escalations exists. Stick to the backoff schedule. |
| "I can interpret 'sounds good' as PROCEED" | Only classify replies the CLI recognizes. 'sounds good' is UNKNOWN → defer to clear reply on return. |
| "This is borderline one-way; I'll ask just to be safe" | Asks are expensive (phone ping, user interruption). Borderline → reversible → act. |

## Red Flags

- You have sent >3 Telegram escalations in this session (CLI will now refuse).
- Your message is >10 lines or contains paragraphs.
- You are waiting synchronously on a single ask instead of continuing other work.
- You are interpreting free-form replies as if they were one of the enum verbs.
- You are about to ask a question that is not actually one-way-door.

## When NOT to Use

- Outside of a `grace-afk` session (the CLI will refuse, but you should not even try).
- For questions that are NOT decisions (e.g. "what's the weather?").
- For decisions that have a clear reversible path — act instead.
- When the Telegram config is missing — use `grace afk defer` directly.

## Verification

Before returning control to `grace-afk`:

- [ ] Message sent successfully (`grace afk ask` returned ok, correlationId noted)
- [ ] Reply received OR backoff exhausted OR session ended (verification: `grace afk check` result or state.json)
- [ ] Journal entry written with class `one-way-door-escalated` and the chosen verb
- [ ] Session counter `escalations` incremented (verification: `cat state.json | jq .escalations`)
- [ ] If STOP received: `grace afk stop` invoked and report emitted
