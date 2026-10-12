---
name: log-activity
description: "The lifecycle's single logger. After every lifecycle step, append one machine-readable record to docs/activity_log.jsonl. At milestones add --tracker: the same call also posts the mirrored comment on the active tracker issue (Linear or Jira), writes the SAME line cross-referenced by the comment id, and applies the step's state markers (blocker, type:*). Append-only; never moves a ticket to Done (/close-task owns that). The machine copy of the contract — LOG_FIELDS, EVENTS, LOG_AGENTS — lives in scripts/corpus.config.mjs; this file documents it. Commits are not logged — git log is their record."
allowed-tools: Bash, Read, Write, mcp__linear, mcp__atlassian
---

# Log Activity — the single logger

Append one JSON Lines record to `docs/activity_log.jsonl`. Two modes, one line shape:

| Mode | When | Writes |
|---|---|---|
| `/log-activity <event>: <summary>` | after **every** semantic step | the JSONL line (`tracker_comment_id: null`) |
| `/log-activity <event>: <summary> --tracker` | at **milestones** worth surfacing on the ticket: Step 1 start, a blocker and its resolution, a decision of record, the Step-10 Full close (optionally the Step-8 pass/fail) | the tracker comment **first**, then the **same** JSONL line carrying the comment id, plus the step's state markers (§E) |

The contract has one machine copy, `scripts/corpus.config.mjs`: `LOG_FIELDS` (the line shape), `EVENTS` (the
vocabulary, each event with its step), `LOG_AGENTS` (who may author a line). This file documents that copy and
the plugin's consistency test keeps the two equal. This skill is the only writer. Commits are not logged:
`git log` is the record of commits.

**What this logger never does:** move a ticket to Done. `/close-task` owns that transition and performs it
exactly once. `--tracker` posts comments and state markers only. Reserve `--tracker` for milestones so the
tracker stays signal, not spam; `tracker = none` makes `--tracker` a no-op (the line is still written).

## §A — JSONL line schema

One JSON object per line. **All twelve fields always present** — use `null`, never omit a key:

```json
{
  "ts": "2026-06-29T14:32:00Z",
  "session": "a1b2c3d4",
  "ticket": "ABC-912",
  "branch": "feat/abc-912-slug",
  "pr_url": null,
  "step": 7,
  "agent": "de",
  "model": "claude-opus-4-8",
  "event": "implementation-started",
  "summary": "Started implementation against the frozen spec; scaffolding committed.",
  "artifacts": ["docs/claude_tasks/03_example_spec.md"],
  "tracker_comment_id": null
}
```

Field rules:

- `ts` — ISO-8601, UTC, second precision (e.g. `2026-06-29T14:32:00Z`).
- `session` — 8-char id shared by every line of one continuous work session (§C). The fixed token `"backfill"`
  (8 chars) is the one sanctioned exception — it marks historical reconstructions (see §C).
- `ticket` — the tracker ticket id, e.g. `ABC-912`. The **prefix is project-specific** — read it from
  `scripts/corpus.config.mjs` (`ticketKey`) at runtime; never hardcode it here. Derived from the current git branch by
  **substring search** with the case-insensitive regex built from that prefix (`BRANCH_TICKET_REGEX`: for `ABC`,
  `(?i)abc-?(\d+)` matches `feat/abc-912-slug` and `username/abc-912-slug`). If not derivable, prompt once and
  persist in the session file. `null` is valid when the project has no tracker (`tracker = none`).
- `branch` — current git branch verbatim (`git branch --show-current`).
- `pr_url` — string, or `null` if no PR. Resolve via `gh pr view --json url -q .url`; trap a non-zero exit → `null`.
- `step` — integer `1`–`10` (the lifecycle step the event closes), or `null`. Taken from `EVENTS` **at invocation
  time** — never reverse-parsed from a comment. `null` for events with no fixed step.
- `agent` — the role that authored the step: one of `LOG_AGENTS` (`pm`, `de`, `da`, `code-reviewer`,
  `devils-advocate`, the optional roles `kb-curator` and `linear-steward`, or `human`) — the role-descriptive id,
  never a display name or a `CC.` tag. (`null` survives only on historical lines.)
- `model` — the model id the authoring agent runs on (its frontmatter pin, or the session model for the PM), or
  `null` when unknown.
- `event` — a tag from the §B vocabulary (`EVENTS`). New tags are added to `scripts/corpus.config.mjs` first, then
  here.
- `summary` — 1–3 plain sentences. The human record. Written, not boilerplate. In the project's documentation
  language (English by default; see `CLAUDE.md`).
- `artifacts` — repo-relative paths created or changed in this step. `[]` if none.
- `tracker_comment_id` — the id of the tracker comment posted by this same invocation (`--tracker`), else `null`.
  The cross-reference between the machine record and the human-readable one.

## §B — Event vocabulary

Canonical, **closed list** mapped to the 10-step lifecycle (the machine copy is `EVENTS`):

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
| `code-review-complete` | Step 7 — code-reviewer gate done (verdict in summary) | 7 |
| `alpha-test-executed` | Step 8 — the FROZEN alpha test was run | 8 |
| `tests-passed` | Step 8 — alpha test / validations passed (binary) | 8 |
| `tests-failed` | Step 8 — alpha test / validations failed (binary) | 8 |
| `validation-complete` | Step 9 — human accepted (or sent back — say which in `summary`) | 9 |
| `task-closed` | Step 10 — `/close-task`, Full or Research variant (the `summary` names the variant) | 10 |
| `kb-curated` | Knowledge folded into `docs/knowledge_base/` by the kb-curator at close (summary carries created/updated/skipped counts) | 10 (Full/Research close) / **`null` (Transitory)** |
| `blocker-hit` | Work blocked — needs unblock | `null` |
| `blocker-resolved` | Blocker cleared — work resumed | `null` |
| `decision` | A decision of record or a deviation from plan | `null` |
| `paused` | Work paused (end of day / Transitory close — a session boundary completes no step) | `null` |
| `handshake-out` | Machine transfer packed by `/handshake out` (summary carries the machine hint and, on git-remote transport, the wip-commit hash + handoff doc path) | `null` |
| `handshake-in` | Machine transfer unpacked by `/handshake in` (summary carries the source machine, snapshot regenerated yes/no, and the environment-verification result) | `null` |
| `council-convened` | A `/council` deliberation was convened | `null` |

`kb-curated` is `step: 10` in a Full or Research close and `null` at a Transitory boundary. The **PM invokes** the
write (the log is outside the kb-curator's allow-list) but the line carries `agent: "kb-curator"`. Log it only
after every FAILED entry in the curator's filing plan is resolved, and only when ≥ 1 KB file survived; `artifacts`
= the surviving KB files that ride the close commit.

`handshake-out` / `handshake-in` are `step: null`, `agent: "pm"`. On git-remote transport `handshake-out` is
appended **before** the final handshake commit so the line rides the push; `handshake-in` on the arriving machine.

## §C — Session id

State file `.claude/log_session`, JSON: `{ "id": "<8-char>", "branch": "<branch>", "issue": "<TICKET or null>" }`.
Gitignored — local, per-machine state. **Never commit it.**

On each invocation: read it; if it is missing, **or** its `branch` differs from the current branch, **or** the
user said a new session began → generate a fresh 8-char hex id (`openssl rand -hex 4` or equivalent) and write
the file with the current branch + ticket. Otherwise reuse the stored `id`. For the ticket, **always try the
branch regex first**; fall back to the stored value only when the branch yields no match.

**Backfill exception:** lines reconstructing past lifecycles use `session: "backfill"`. They are historical and
**not authoritative for recency** — recency consumers (audits, staleness checks) MUST ignore them.

## §D — Procedure

Execute in order:

0. **Tracker config (only with `--tracker`).** Read `tracker.type` and the connection identity from
   `.claude/settings.json` / `scripts/corpus.config.mjs` (`tracker`). Confirm the comment tool exists: Linear →
   `mcp__linear__*` (`save_comment`; verbs vary by server version — discover them from the session tool list),
   Jira → `mcp__atlassian__addCommentToJiraIssue` plus a resolved cloud id. Missing tool or unresolved tracker →
   **stop and say so; write nothing**. `tracker = none` → continue without a comment.
1. **Gather context.** `branch`, `ticket` (§A), `pr_url`, `session` (§C), `ts`.
2. **Resolve the entry.** `event` + `summary` + `artifacts` come from the invocation; `step` from `EVENTS`;
   `agent` and `model` from the logging context. Invoked with no args → infer from recent work and **show the
   entry for confirmation before writing**.
3. **With `--tracker`: post the comment first** (§E), capture its id (`response.id` for Linear; the created
   comment's `id` for Jira — no fallback lookup), then apply the state markers the event requires (§E).
4. **Append the line** to `docs/activity_log.jsonl`: the complete object with every `LOG_FIELDS` key (in that
   order), one line, trailing newline; create the file if absent; **never edit or overwrite an existing line**.
5. **Validate** (§G).

## §E — Tracker comment and state markers (`--tracker`)

Every comment starts with a role tag (the `agent` id, prefixed `CC.` and upper-cased for the three two-letter
roles — `CC.PM`, `CC.DE`, `CC.DA`, `CC.code-reviewer`, `CC.devils-advocate`; the human's display name for
`human`), then a step or non-step tag, the timestamp, then the summary. Identical markdown on both trackers
(Jira renders it with `contentFormat: "markdown"`). Comments are append-only — never edit or delete a prior one.

```markdown
**CC.DE** · **[Step 5 — Spec review complete]** 2026-04-08 14:30

Review written to `docs/claude_tasks/reviews/2026-04-08_35_de_review.md`.
3 findings: missing edge case for NULLs, wrong partition key, unclear acceptance criterion #5.
```

Non-step tags: `blocker-hit` → `[Blocker]`, `blocker-resolved` → `[Blocker resolved]`, `decision` → `[Decision]`,
`paused` → `[Paused]`, `council-convened` → `[Council]`. `task-closed` → `[Step 10 — Task closed]`.

State markers are side-effects of specific events — applying them is not optional when `--tracker` is used:

| Event | State action | How |
|---|---|---|
| `blocker-hit` | add the `blocker` label | read-compute-write (below) |
| `blocker-resolved` | remove the `blocker` label | read-compute-write |
| `spec-written` | apply exactly ONE work-type label: `type:feature` · `type:bug` · `type:refactor` · `type:data-audit` · `type:doc` — set once, never changed later | read-compute-write |
| `tests-passed` / `tests-failed` | optional: move to "In Review" **if the project's workflow has that state** | Linear `save_issue state`; Jira `transitionJiraIssue` by name |
| `task-closed` | **nothing** — the Done transition belongs to `/close-task` | — |

**Read-compute-write (both trackers):** label writes replace the full set. Read the current labels
(Linear `get_issue` → `labels`; Jira `getJiraIssue` fields `["labels"]`), compute current + added (or − removed),
write the full set (Linear `save_issue labels`; Jira `editJiraIssue fields.labels` — no spaces in Jira labels,
use the hyphenated form). Never drop a project-specific label. Jira status is a workflow transition, resolved by
name at runtime with `getTransitionsForJiraIssue` — never a hardcoded id; a missing optional transition is noted
in the comment and skipped.

## §F — Failure semantics

- **Comment fails** (`--tracker`) → write nothing; report clearly. The two records stay consistent.
- **Comment succeeds, a state marker fails** → the comment and the line still stand; report the marker that did
  not apply so it can be set by hand. Never delete the comment.
- **Comment succeeds, the JSONL append fails** (lock, disk, permission) → do **not** retry the comment; report
  **loudly** with the captured `tracker_comment_id` and the complete JSON line verbatim, so it can be appended by
  hand. This is the one tolerable drift — it must be visible, never silent.
- **Plain mode, append fails** → report loudly with the complete line verbatim. A missing audit line is worse
  than a noisy error.

## §G — Validation

After every invocation, confirm:

- Exactly one new line was appended to `docs/activity_log.jsonl`, and every line still parses:
  `node -e "require('fs').readFileSync('docs/activity_log.jsonl','utf8').trim().split('\n').forEach(l=>JSON.parse(l))"`
- The new line has exactly the `LOG_FIELDS` keys, `event` ∈ `EVENTS`, `agent` ∈ `LOG_AGENTS` or `null`.
- With `--tracker`: `tracker_comment_id` equals the id the comment call returned (or `null` for `none`).
- A second invocation only appends; it never rewrites or deletes a prior line.

## Persist reusable knowledge (distinct from this log)

After a step that revealed something a future session needs (a schema surprise, a platform gotcha, a decision
that changes future work) → record it in the corpus: the task report at the time, the chronicle via
`/close-task` at close — the corpus is the memory. Routine progress stays here, in the log, and nowhere else.

> Activity log = the audit trail (what happened, by whom, when, with which step). The corpus (chronicle +
> reports + KB) = distilled, reusable knowledge. Keep them separate.
