---
name: log-activity
description: Use this skill after every lifecycle step to append one machine-readable record to docs/activity_log.jsonl. Tracker-agnostic and append-only — it is the cheap, local half of the dual-write (use /log-tracker when the step also warrants a tracker comment). Also invoked automatically by the .husky/post-commit hook for commits. This SKILL.md is the canonical definition of the JSONL activity-log contract.
allowed-tools: Bash, Read, Write
---

# Log Activity

Append one JSON Lines record to `docs/activity_log.jsonl`. This file is the **canonical definition** of the JSONL activity-log contract: schema, vocabulary, session id, append procedure, failure semantics, and validation. When in doubt about the JSONL shape, this file is authoritative.

This skill is **tracker-agnostic** — it never touches Jira or Linear. It is the cheap, local, spam-free half of the dual-write. Its counterpart, `/log-tracker`, performs the same append **plus** posts a mirrored tracker comment (cross-referenced by id) — but only at milestones, to avoid spamming the tracker with routine steps. Call `/log-activity` freely after every step; reach for `/log-tracker` only when the step is also worth a tracker comment (Step 1 start, blockers, decisions of record, Step 10 close).

The two halves are joined by `tracker_comment_id`: `/log-activity` always writes `null`; only `/log-tracker` writes a real id.

## When to Use

After every significant step — especially the **semantic** events a git hook cannot author (it has no idea which lifecycle step just completed). Mapped to the 10-step lifecycle:

- `brief-received` (Step 1) · `data-analysis-complete` (Step 2) · `spec-written` (Step 3)
- `alpha-test-designed` (Step 4) · `spec-review-complete` / `devils-advocate-attack-complete` (Step 5)
- `spec-revised` / `alpha-test-sealed` (Step 6) · `implementation-started` / `implementation-complete` / `code-review-complete` (Step 7)
- `alpha-test-executed` / `tests-passed` / `tests-failed` (Step 8) · `validation-complete` (Step 9) · `task-closed` (Step 10)
- `blocker-hit` / `blocker-resolved` · `decision` · `paused` (no fixed step)

`committed` lines are written **automatically** by the `.husky/post-commit` hook (`scripts/log-commit-activity.mjs`) — do **not** hand-log routine commits. Use `/log-tracker` (not this skill) when the step is also worth a tracker comment.

## §A — JSONL Line Schema

One JSON object per line. **All fields always present** — use `null`, never omit a key:

```json
{
  "ts": "2026-06-29T14:32:00Z",
  "session": "a1b2c3d4",
  "issue": "ABC-912",
  "branch": "feat/abc-912-slug",
  "pr_url": null,
  "step": 7,
  "agent": "de",
  "event": "implementation-started",
  "summary": "Started implementation against the frozen spec; scaffolding committed.",
  "artifacts": ["docs/claude_tasks/03_example_spec.md"],
  "tracker_comment_id": null
}
```

Field rules:

- `ts` — ISO-8601, UTC, second precision (e.g. `2026-06-29T14:32:00Z`).
- `session` — 8-char id shared by every line of one continuous work session (§C). The fixed token `"backfill"` (8 chars) is the one sanctioned exception — it marks historical reconstructions (see §C).
- `issue` — the tracker ticket key, e.g. `ABC-912`. The **ticket prefix is project-specific** — read it from `corpus.config.mjs` (the `tracker_key` / project prefix constant) or `CLAUDE.md` at runtime; never hardcode it in this skill. Derived from the current git branch via **substring search** with a case-insensitive regex built from that prefix — e.g. for prefix `ABC`, the regex `(?i)abc-?(\d+)` matches both `feat/abc-912-slug` and `username/abc-912-slug`. If not derivable, prompt once and persist in the session file. `null` is valid when the project has no tracker (`tracker = none`, local `TODO.md` only).
- `branch` — current git branch verbatim (`git branch --show-current`).
- `pr_url` — string, or `null` if no PR. Resolve via `gh pr view --json url -q .url`; trap a non-zero exit → `null`.
- `step` — integer `1`–`10` (lifecycle step), or `null`. Determined **at invocation time** from the event being logged — NOT reverse-parsed from any comment. `null` is valid for events with no fixed step (`blocker-hit`, `decision`, `paused`, …) and for machine-originated (hook) lines.
- `agent` — the role that authored the step. One of the role-descriptive ids `pm`, `de`, `da`, `code-reviewer`, `devils-advocate` (plus optional roles if enabled: `corpus-steward`, `kb-curator`, `data-reviewer`, `scout`, `dead-code-cleanup`), the human actor (`human`), or **`null`** for machine-originated (hook) lines. Set at invocation time from the logging context.
- `event` — a lowercase-hyphenated tag from the §B vocabulary. New tags require an addition to that table.
- `summary` — 1–3 plain sentences. The human record. Written, not boilerplate. Use the project's documentation language (English by default; see `CLAUDE.md`).
- `artifacts` — repo-relative paths created or changed in this step. `[]` if none.
- `tracker_comment_id` — `null` for `/log-activity` lines (no tracker comment). Only `/log-tracker` sets a real id (the cross-reference to the human-readable tracker comment — the other half of the dual-write).

## §B — Event Vocabulary

Canonical, **closed list** mapped to the 10-step lifecycle. New tags require a line added here.

| `event` | Description | `step` |
|---|---|---|
| `brief-received` | Step 1 — the human's brief received, task started | 1 |
| `data-analysis-complete` | Step 2 — DA profiled the real data | 2 |
| `spec-written` | Step 3 — PM spec authored (brief + analysis → acceptance criteria) | 3 |
| `alpha-test-designed` | Step 4 — DA alpha test written from the spec (`status: draft`) | 4 |
| `spec-review-complete` | Step 5 — DE feasibility review done | 5 |
| `devils-advocate-attack-complete` | Step 5 — devils-advocate adversarial attack done | 5 |
| `spec-revised` | Step 6 — PM addressed objections, spec revised | 6 |
| `alpha-test-sealed` | Step 6 — alpha test frozen (`status: sealed`, `sealed_date` set) | 6 |
| `implementation-started` | Step 7 — implementation begins | 7 |
| `implementation-complete` | Step 7 — implementation done, self-review passed | 7 |
| `committed` | code committed | 7 (manual) / **`null` (post-commit hook)** |
| `code-review-complete` | Step 7 — code-reviewer gate done (verdict in summary) | 7 |
| `alpha-test-executed` | Step 8 — the FROZEN alpha test was run | 8 |
| `tests-passed` | Step 8 — alpha test / validations passed (binary) | 8 |
| `tests-failed` | Step 8 — alpha test / validations failed (binary) | 8 |
| `validation-complete` | Step 9 — human accepted (or sent back — say which in `summary`) | 9 |
| `task-closed` | Step 10 — `/close-task` | 10 |
| `kb-curated` | Knowledge folded into `docs/knowledge_base/` by the kb-curator at close (summary carries created/updated/skipped counts) | 10 (full/research close) / **`null` (transitory)** |
| `blocker-hit` | Work blocked — needs unblock | `null` |
| `blocker-resolved` | Blocker cleared — work resumed | `null` |
| `decision` | A decision of record or a deviation from plan | `null` |
| `paused` | Work paused (end of day / transitory close) | `null` |
| `council-convened` | A `/council` deliberation was convened | `null` |

`committed` is `step: 7` for **manual** invocation; the `post-commit` hook writes `step: null` because a commit's lifecycle step is not determinable in-hook (a commit can happen at Step 7 implementation or Step 10 close).

`kb-curated` is `step: 10` when part of a Full or Research close and `step: null` at a transitory boundary (same rationale as `paused` — no lifecycle step completed). The **PM invokes** the log write — the activity log is outside the kb-curator's write allow-list — but the line carries `agent: "kb-curator"` (authored-by semantics). Log it only **after** every FAILED entry in the curator's filing plan is resolved (fixed or `git restore`d), and only when ≥1 KB file survived that resolution; a zero-write (or fully-restored) curation is recorded in the close report, not the log. `artifacts` = only the surviving KB files that ride the close commit.

> Norse-alias cross-reference (legacy instances): `code-review-complete` was `heimdall-review-complete`; `devils-advocate-attack-complete` was `loki-attack-complete`. Use the role-descriptive tags above going forward.

## §C — Session Id

State file `.claude/log_session`, JSON: `{ "id": "<8-char>", "branch": "<branch>", "issue": "<TICKET-KEY or null>" }`. Gitignored — local, per-machine state. **Never commit it.**

On each invocation:

1. Read `.claude/log_session`.
2. If it is missing, **or** its `branch` differs from the current branch, **or** the user said a new session began → generate a fresh 8-char hex id (`openssl rand -hex 4` or equivalent), and write the file with the current branch + issue.
3. Otherwise reuse the stored `id`. For `issue`, **always attempt the branch regex first** (the case-insensitive prefix regex from §A); fall back to the stored `issue` only when the branch yields no match.

**Backfill exception:** lines reconstructing past lifecycles use the fixed `session: "backfill"` token. These are historical and **not authoritative for recency** — any recency consumer (the corpus-steward, audits, staleness checks) MUST ignore `session="backfill"` lines when computing "last meaningful touch".

## §D — Append Procedure

Execute in order:

1. **Gather context.**
   - `branch` ← `git branch --show-current`
   - `issue` ← substring-search the project's ticket-prefix regex (read the prefix from `corpus.config.mjs` / `CLAUDE.md`) on `branch`; if no match, read from `.claude/log_session`; if still unknown and the project has a tracker, prompt once and persist; if the project has no tracker, use `null`.
   - `pr_url` ← `gh pr view --json url -q .url`; trap non-zero exit → `null`
   - `session` ← read or generate per §C
   - `ts` ← current time, ISO-8601 UTC, second precision
2. **Resolve the entry.** `event` + `step` + `agent` + `summary` + `artifacts` come from the invocation (`/log-activity <event>: <summary>`). If invoked with no args, infer all from recent work and **show them to the user for confirmation before writing**.
3. **Append the JSONL line** to `docs/activity_log.jsonl`:
   - Construct the complete JSON object with **every** field present (`tracker_comment_id: null`).
   - Append it as a single line followed by a newline.
   - Create the file if it does not exist.
   - **Never edit or overwrite any existing line.** This file is append-only.

## §E — Failure Semantics

- **JSONL append fails** (file lock, disk error, permission) → report the failure **loudly** with the complete JSON line, verbatim, so it can be appended manually. **Never fail silently** — a missing audit line is worse than a noisy error.

## §F — Validation

After every invocation, confirm:

- Exactly one new line was appended to `docs/activity_log.jsonl`.
- Every line still parses:
  `node -e "require('fs').readFileSync('docs/activity_log.jsonl','utf8').trim().split('\n').forEach(l=>JSON.parse(l))"` — parses without error.
- A second invocation only appends; it never rewrites or deletes a prior line.

## Persist Reusable Knowledge (distinct from this log)

Distinct from this log. After a step that revealed something a future session needs (a schema surprise, a platform gotcha, a decision that changes future work) → record it in the corpus: the task report (`docs/claude_tasks/reports/`) at the time, and the project chronicle (`docs/project_chronicle.md`, via `/close-task`) at close — the corpus is the memory. Do **not** persist routine progress — that is exactly what this log is for. (If the project enabled basic-memory, you may also use its write_note/search_notes/build_context tools — but the corpus remains the default source of truth.)

> Activity log = the audit trail (what happened, by whom, when, with which step). The corpus (chronicle + reports) = distilled, reusable knowledge. Keep them separate.
