---
name: log-tracker
description: Dual-write milestone logger. Posts a mirrored comment to the active tracker issue (Linear OR Jira) AND appends one JSON Lines record to docs/activity_log.jsonl, cross-referenced by the tracker comment id. Branches on the tracker chosen at init (linear | jira | none). Also applies/removes state labels and state transitions based on the comment tag. Use at every milestone worth surfacing to the tracker. For the cheap, tracker-free half of the dual-write, use /log-activity instead.
allowed-tools: Bash, Read, Edit, Write, mcp__linear, mcp__atlassian
---

# Log to Tracker (dual-write milestone logger)

Post an activity-log entry as a comment on the active tracker issue **and** append one paired
JSON Lines record to `docs/activity_log.jsonl`, cross-referenced by the tracker comment id. Apply
state labels / status transitions when the comment tag requires it.

This is the milestone half of the dual-write. It **branches on the tracker** configured at init:

- **`linear`** — comment via the Linear MCP, labels via `save_issue`. (Formerly `log-linear`.)
- **`jira`** — comment via the Atlassian MCP `addCommentToJiraIssue`, status via `transitionJiraIssue`,
  labels via `editJiraIssue`.
- **`none`** — no tracker; append the JSONL line only (`tracker_comment_id: null`). Equivalent to
  `/log-activity`, kept here so a single skill serves every tracker setting.

> **Pairing rule (one-directional).** Every tracker comment posted here gets its paired JSONL line.
> The reverse does NOT hold — `/log-activity` and the `post-commit` git hook write JSONL lines with
> `tracker_comment_id: null` (and, for the hook, `agent: null` / `step: null`). If you only need the
> local log, use `/log-activity`; reserve `/log-tracker` for milestones worth surfacing to the tracker.

## When to Use

After every significant step in a task that is worth surfacing on the tracker:

- Spec review completed (Step 5)
- Spec revised / resolved after review (Step 6)
- Implementation started / completed (Step 7)
- Blocker encountered / resolved
- Tests / validations (the frozen alpha test) passed or failed (Step 8)
- Code committed (include the hash)
- Deployed
- Task report written (Step 7)
- Any decision that deviates from the plan
- Task closed (Step 10)

For routine, non-milestone progress that does not need to reach the tracker, use `/log-activity`
(JSONL only).

---

## Step 0 — Read the tracker config (do this first, every invocation)

This skill is plugin-resident; it carries **no** hardcoded tracker identity. Read every project
specific value at runtime from the scaffolded config:

1. **`corpus.config.mjs`** (repo root) — the source of truth for `tracker`, `trackerKey`,
   `trackerCloudId`, `trackerProject`, `trackerTeam`, `trackerOrg`.
2. **`.claude/settings.json`** — fallback / confirmation for the same values (look under the
   project's tracker block).
3. **`CLAUDE.md`** — human-readable tracker identity if the above are absent.

Resolve at minimum:

| Value | Meaning | Used by |
|-------|---------|---------|
| `tracker` | `linear` \| `jira` \| `none` | selects the branch below |
| `trackerKey` | ticket prefix, e.g. the project's issue key (no value is hardcoded) | issue-id regex |
| `trackerCloudId` | Atlassian cloud id or site URL | Jira branch only |
| `trackerProject` | Linear project/initiative OR Jira project key | both |
| `trackerTeam` / `trackerOrg` | Linear workspace/team | Linear branch only |

If `tracker` cannot be resolved, **stop and ask** — do not guess a tracker.

---

## Common procedure (tracker-agnostic)

These steps run for **every** branch. The branch only differs in how the comment/labels are written.

### A — Gather context

- `branch` ← `git branch --show-current`
- `issue` ← derive from the branch by **substring search** with the regex built from `trackerKey`:
  `(?i)<KEY>-?(\d+)` applied against the full branch name (matches `feat/<key>-825-slug` and
  `someuser/<key>-825-slug`). If no match, read from `.claude/log_session`; if still unknown, prompt
  once and persist. `<KEY>` is the lowercased `trackerKey` read in Step 0 — never a literal prefix.
- `pr_url` ← `gh pr view --json url -q .url`; trap non-zero exit → `null` (do not propagate as error).
- `session` ← read/generate per **§ Session Id**.
- `ts` ← current time, ISO-8601, UTC, second precision.

### B — Resolve the entry

`event` + `step` + `agent` + `summary` + `artifacts` come from the invocation
(`/log-tracker <event>: <summary>`). If invoked with no args, infer all from recent work and **show
them to the user for confirmation before writing anything**.

### C — Write the comment, then the JSONL line

Execute the chosen branch (Linear / Jira / none) to post the comment and capture its id, then append
the paired JSONL line. **Both records are written together or not at all** — if the comment fails,
write nothing.

---

## Comment format (identical across trackers)

Every comment MUST start with a **role tag**, followed by a step or non-step tag, the timestamp, then
the summary. The role tag is the agent identity from the lifecycle, prefixed `CC.` for Claude Code
agents. Do not hardcode any human name — read the human's display name from config/git if you need it.

| Role | Tag in comment |
|------|----------------|
| PM | `**CC.PM** ·` |
| DE | `**CC.DE** ·` |
| DA | `**CC.DA** ·` |
| code-reviewer | `**CC.code-reviewer** ·` |
| devils-advocate | `**CC.devils-advocate** ·` |
| Human (manual) | `**<human>** ·` |

```markdown
**CC.DE** · **[Step N — {milestone}]** YYYY-MM-DD HH:MM

{What happened in 1-3 sentences.}

{Optional: files touched, numbers, decisions made}
```

### Examples

```markdown
**CC.DE** · **[Step 5 — Spec review complete]** 2026-04-08 14:30

Review written to `docs/claude_tasks/reviews/2026-04-08_35_de_review.md`.
3 findings: missing edge case for NULLs, wrong partition key, unclear acceptance criterion #5.
Sent back to PM for resolution.
```

```markdown
**CC.PM** · **[Step 7 — DE team spawned]** 2026-04-09 09:00

Team task-35 created. de working on implementation against the frozen spec.
Schema created, starting core logic.
```

```markdown
**CC.DE** · **[Blocker]** 2026-04-09 11:00

Unexpected data format in 12 rows — nested arrays instead of flat objects.
Escalating to PM for decision.
```

> Side-effect: this comment MUST also add the `blocker` state marker to the issue.

```markdown
**CC.PM** · **[Blocker resolved]** 2026-04-10 08:15

Decision: treat nested arrays as an `additional_params` JSON blob. DE unblocked.
```

> Side-effect: this comment MUST also remove the `blocker` state marker.

```markdown
**CC.DE** · **[Step 7 — Commit]** 2026-04-09 16:00

`a1b2c3d feat(core): add new stage`
Files: src/new_stage (new), src/reference_tables (DDL added)
All acceptance criteria PASS.
```

---

## State markers (labels / transitions)

State that needs to show in tracker views (Blocked, In Review, Done) is driven automatically by the
comment tag. Only these tags trigger a state side-effect; how the side-effect is applied differs per
tracker (see each branch).

| Comment tag | State action | Notes |
|-------------|--------------|-------|
| `[Blocker]` | Add `blocker` marker | Issue is stuck — needs unblock |
| `[Blocker resolved]` | Remove `blocker` marker | Complementary close of `[Blocker]` |
| `[Step 3 — Spec written]` | Apply ONE work-type marker (see below) | Set once at spec time |
| `[Step 8 — Tests …]` | Optional: move to "In Review" state | Only if the project models review status |
| `[Step 10 — Task closed]` | Move to "Done" state | The lifecycle close |

### Work-type marker — set once at Step 3, don't change later

When the PM creates or first scopes the issue (Step 3 — spec written), apply exactly ONE work-type
marker describing what the issue delivers:

| Marker | When to use |
|--------|-------------|
| `type:feature` | New capability or user-facing enhancement |
| `type:bug` | Defect — something is not working as expected |
| `type:refactor` | Code cleanup, no behavior change |
| `type:data-audit` | SQL profiling, data quality, or DA analysis |
| `type:doc` | Documentation-only change |

> **Preservation rule (both trackers):** state writes must **preserve all pre-existing markers** —
> never clobber project-specific labels. Read the current set, compute the new set, write the union
> (or the difference for a removal). Never replace blindly.

---

## Branch: `tracker = linear` (formerly log-linear)

> Tool names below are **indicative** — the wired server (`linear` per `settings.json → mcp.servers`, official
> remote endpoint) may name its verbs differently across versions. Discover the exact `mcp__linear__*` tool
> names from the session tool list before calling; the same applies to the Jira branch (`mcp__atlassian__*`,
> whose verbs below match the official Atlassian server today).

### Prerequisite
Confirm a comment-creation tool under `mcp__linear__*` is available. If the Linear MCP is not connected →
**fail with a clear message**; write nothing (no comment, no JSONL line).

### Post the comment
Create the comment via `mcp__linear__save_comment`:
- `issueId`: the derived issue id (`<KEY>-NNN`)
- `body`: the markdown comment in the standard format above

### Capture the comment id
Extract `response.id` from the `save_comment` response. This is `tracker_comment_id` for the JSONL
line. Use `response.id` directly — no fallback lookup.

### Apply labels (state markers)
Linear `save_issue` `labels` param **REPLACES** the full set. To add or remove one label:
1. Read current labels: `mcp__linear__get_issue` → `issue.labels.nodes[].name`
2. Compute new set = current + added (or current − removed)
3. Pass as `labels` (array of names or ids) to `mcp__linear__save_issue`

Never drop unrelated labels. Always preserve project-specific labels (phase markers, `frontend`,
`backend`, `Decision Needed`, etc.).

---

## Branch: `tracker = jira` (net-new, Atlassian MCP)

Semantics mirror the Linear branch exactly — post a mirrored comment, cross-reference the JSONL line
by the returned comment id, apply state via labels and status transitions. Jira splits "labels" and
"status" into two different operations, so the side-effects map to two different tools.

### Prerequisite
Confirm `mcp__atlassian__addCommentToJiraIssue` is available **and** `trackerCloudId` was
resolved in Step 0. If either is missing → **fail with a clear message**; write nothing.

### Post the comment
Create the comment via `mcp__atlassian__addCommentToJiraIssue`:
- `cloudId`: `trackerCloudId` (from Step 0)
- `issueIdOrKey`: the derived issue key (`<KEY>-NNN`)
- `commentBody`: the **same** markdown comment built in the common procedure (identical to Linear)
- `contentFormat`: `"markdown"` (the comment body is markdown; let Jira render it)
- Omit `commentId` — this is always a NEW comment (append-only; never update a prior comment)

### Capture the comment id
The `addCommentToJiraIssue` response contains the created comment object. Extract its `id` (the Jira
comment id, a numeric string). This is `tracker_comment_id` for the JSONL line. Capture it directly
from the response — do not re-fetch.

### Apply labels (state markers: `blocker`, `type:*`)
Jira labels live on the `labels` field and are edited with `editJiraIssue`. The `fields.labels`
write **replaces** the label array, so apply the same read-compute-write discipline as Linear:
1. Read current labels: `mcp__atlassian__getJiraIssue` with `fields: ["labels"]` →
   `fields.labels` (array of strings).
2. Compute new set = current + added (or current − removed).
3. Write via `mcp__atlassian__editJiraIssue`:
   - `cloudId`: `trackerCloudId`
   - `issueIdOrKey`: the issue key
   - `fields`: `{ "labels": [ <the computed full set> ] }`

   > Jira labels cannot contain spaces. If a marker name contains a space, use the hyphenated form
   > (e.g. `decision-needed`). Never drop unrelated labels.

### Apply status transitions (`In Review`, `Done`)
Jira status is NOT a field write — it is a workflow transition, applied with `transitionJiraIssue`.
A transition id is workflow-specific, so resolve it by name at runtime; never hardcode an id:
1. List available transitions: `mcp__atlassian__getTransitionsForJiraIssue` with
   `cloudId` + `issueIdOrKey` → array of `{ id, name, to.name }`.
2. Match the transition whose target status name corresponds to the desired state
   (e.g. `[Step 10 — Task closed]` → the transition leading to `Done`; `[Step 8 — Tests …]` →
   `In Review`, if the project's workflow has it). Match case-insensitively on `to.name` / `name`.
3. Apply: `mcp__atlassian__transitionJiraIssue` with
   - `cloudId`: `trackerCloudId`
   - `issueIdOrKey`: the issue key
   - `transition`: `{ "id": "<resolved transition id>" }`
4. If no matching transition exists in the workflow (e.g. the board has no "In Review" column), skip
   the transition, note it in the comment summary, and continue — never fail the log over a missing
   optional transition. A missing `Done` transition at Step 10 IS reported loudly (it is required).

> **Tag → Jira side-effect mapping:**
> - `[Blocker]` → add label `blocker` (editJiraIssue).
> - `[Blocker resolved]` → remove label `blocker` (editJiraIssue).
> - `[Step 3 — Spec written]` → add ONE `type:*` label (editJiraIssue).
> - `[Step 8 — Tests …]` → optional transition to `In Review` (transitionJiraIssue).
> - `[Step 10 — Task closed]` → transition to `Done` (transitionJiraIssue), required.

---

## Branch: `tracker = none`

No tracker comment. Run the **common procedure** (gather context, resolve the entry), then append the
JSONL line directly with `tracker_comment_id: null`. There are no labels or transitions to apply.
This branch is functionally identical to `/log-activity`; it exists so one skill covers every setting.

---

## Dual-write: the JSONL activity log

> The JSONL contract (schema, vocabulary, session id) is **canonical in `/log-activity`**. The full
> procedure is repeated inline below so `/log-tracker` stays self-sufficient when injected alone — a
> subagent invoking `/log-tracker` does not auto-load `/log-activity`. This is the **paired variant**:
> post the tracker comment first, then append the JSONL line with the real `tracker_comment_id`
> (or `null` when `tracker = none`).

Every `/log-tracker` invocation (except `tracker = none`) posts the tracker comment first, then
appends one JSON Lines record to `docs/activity_log.jsonl` cross-referenced by the comment id. The
comment and its JSONL line are written together or not at all (if the comment fails, write nothing).

### §A — JSONL line schema

One JSON object per line. All 11 fields always present (use `null`, never omit):

```json
{
  "ts": "2026-05-22T14:32:00Z",
  "session": "a1b2c3d4",
  "issue": "ABC-830",
  "branch": "feat/abc-830-log-dual-write",
  "pr_url": "https://github.com/<owner>/<repo>/pull/90",
  "step": 7,
  "agent": "CC.DE",
  "event": "implementation-started",
  "summary": "Built the dual-write procedure in log-tracker; session-id state file added.",
  "artifacts": ["skills/log-tracker/SKILL.md", ".gitignore"],
  "tracker_comment_id": "6c47d1b7-f9c8-46c6-b9a4-e0aabe497dbe"
}
```

Field rules:

- `ts` — ISO-8601, UTC, second precision.
- `session` — 8-char id shared by every line of one continuous work session (§C).
- `issue` — `<KEY>-NNN`. Derived from the current git branch via **substring search** with the regex
  `(?i)<KEY>-?(\d+)` against the full branch name, where `<KEY>` is the lowercased `trackerKey` from
  Step 0. Matches both `feat/<key>-825-slug` and `someuser/<key>-825-slug`. If not derivable, prompt
  once and persist in the session file. `null` when `tracker = none` and no key is configured.
- `branch` — current git branch verbatim (`git branch --show-current`).
- `pr_url` — string, or `null` if no PR exists. Run `gh pr view --json url -q .url`; trap non-zero
  exit and write `null` — do not propagate the failure as an error.
- `step` — integer `1`–`10` (lifecycle step), or `null` for non-step events. **Determined at
  invocation time from the event being logged — NOT reverse-parsed from the written comment.** Data
  flow is fields → comment, never comment → fields.
- `agent` — one of `CC.PM`, `CC.DE`, `CC.DA`, `CC.code-reviewer`, `CC.devils-advocate`, or the human's
  name. Set at invocation time from the logging context; the same value the comment's role tag uses.
- `event` — lowercase-hyphenated tag from the §B vocabulary. New tags require an addition to that table.
- `summary` — 1–3 plain sentences. The human record. Written, not boilerplate.
- `artifacts` — repo-relative paths created/changed in this step. `[]` if none.
- `tracker_comment_id` — id of the comment created in this same invocation. For Linear, the top-level
  `id` from the `save_comment` response. For Jira, the created comment's `id` from the
  `addCommentToJiraIssue` response. `null` when `tracker = none`. No fallback lookup — use the
  response id directly.

### §B — Event vocabulary

Canonical, closed list mapped to the lifecycle. New tags require a line added here.

| `event` | Description | `step` |
|---|---|---|
| `task-scoped` | ticket filed / scoping forensics | 1 |
| `data-profiled` | Step 2 — DA data profiling | 2 |
| `spec-written` | Step 3 — PM spec authored | 3 |
| `alpha-test-designed` | Step 4 — DA alpha-test design | 4 |
| `spec-review-complete` | Step 5 — DE spec review | 5 |
| `objections-raised` | Step 5 — devils-advocate objections | 5 |
| `spec-resolved` | Step 6 — spec resolved + frozen | 6 |
| `implementation-started` | Step 7 — implementation begins | 7 |
| `implementation-complete` | Step 7 — implementation done | 7 |
| `committed` | code committed | 7 (manual invocation only; the post-commit hook writes `step: null`) |
| `code-review-complete` | Step 7 — code-reviewer verdict | 7 |
| `tests-passed` | Step 8 — frozen alpha test passed | 8 |
| `tests-failed` | Step 8 — frozen alpha test failed | 8 |
| `pr-opened` | Pull request created | `<from invocation>` |
| `validated` | Step 9 — human validation | 9 |
| `task-closed` | Step 10 — `/close-task` | 10 |
| `blocker-hit` | Work blocked — needs unblock | `null` |
| `blocker-resolved` | Blocker cleared — work resumed | `null` |
| `paused` | Work paused for the day | `null` |
| `decision` | A decision deviating from plan | `null` |

`<from invocation>` means the caller supplies the step number at invocation time. `blocker-hit` /
`blocker-resolved` carry their state side-effects (the `blocker` marker) unchanged.

**Comment tags for non-step events:** `paused` → `[Paused]`, `decision` → `[Decision]`,
`blocker-hit` → `[Blocker]`, `blocker-resolved` → `[Blocker resolved]`.

```markdown
**CC.PM** · **[Paused]** 2026-05-22 18:00

End of day. Resuming tomorrow — implementation 80% complete, SKILL.md written, acceptance test pending.
```

```markdown
**CC.PM** · **[Decision]** 2026-05-22 15:30

Chose Option A over Option B: addCommentToJiraIssue returns the comment id on the created object
(verified). No list-comments fallback needed.
```

### §C — Session id

State file `.claude/log_session`, JSON:
`{ "id": "<8-char>", "branch": "<branch>", "issue": "<KEY-NNN or null>" }`.

`.claude/log_session` is gitignored — local, per-machine state. Never commit it.

On each `/log-tracker` invocation:

1. Read `.claude/log_session`.
2. If missing, **or** `branch` differs from the current branch, **or** the user explicitly said a new
   session began → generate a fresh 8-char hex id (`openssl rand -hex 4` or equivalent), write the
   file with the current branch + issue.
3. Otherwise reuse the stored `id`. For `issue`, **always attempt the branch regex first**
   (`(?i)<KEY>-?(\d+)` as substring search against the current branch name); fall back to the stored
   `issue` only when the branch yields no match. This lets a session that started on `main` (stored
   `issue: null`) pick up the correct issue after a branch checkout, without a session reset.

### §D — Dual-write procedure

Execute in this exact order:

1. **Read tracker config** (Step 0). Resolve `tracker` and the identity values. Select the branch.
2. **Prerequisite check** for the selected branch. Linear → `save_comment` available. Jira →
   `addCommentToJiraIssue` available + `trackerCloudId` resolved. `none` → no check. On failure for a
   tracker branch, **fail clearly and write nothing** (both records together or not at all).
3. **Gather context** (common procedure §A): `branch`, `issue`, `pr_url`, `session`, `ts`.
4. **Resolve the entry** (common procedure §B): `event`, `step`, `agent`, `summary`, `artifacts`.
   If invoked with no args, show the inferred entry for confirmation before writing.
5. **Post the comment first** (skip for `none`):
   - Linear → `save_comment`. Apply labels per the Linear branch.
   - Jira → `addCommentToJiraIssue`. Apply labels via `editJiraIssue` and status via
     `transitionJiraIssue` per the Jira branch.
6. **Capture the comment id** → `tracker_comment_id` (`response.id` for Linear; created comment `id`
   for Jira; `null` for `none`).
7. **Append the JSONL line** to `docs/activity_log.jsonl`:
   - Construct the complete JSON object with all 11 fields.
   - Append as a single line followed by a newline.
   - Create the file if it does not exist (first invocation).
   - Never edit or overwrite any existing line.

### §E — Failure semantics

- **Comment fails** (Linear or Jira) → write nothing. Report the failure clearly. The two records
  stay consistent.
- **Comment succeeds, label/transition side-effect fails** → the comment + JSONL line still stand
  (the audit record is intact). Report the side-effect failure clearly with the marker/transition
  that did not apply, so it can be set manually. Do not delete the comment.
- **Comment succeeds, JSONL append fails** (file lock, disk error) → do **not** retry the comment.
  Report the failure **loudly** with:
  1. The captured `tracker_comment_id`
  2. The complete JSON line, verbatim, so it can be appended manually

  This is the one tolerable drift scenario — it must be visible, never silent.

### §F — Validation

After every invocation, confirm:

- Exactly one new line appended to `docs/activity_log.jsonl`.
- The file parses:
  `node -e "require('fs').readFileSync('docs/activity_log.jsonl','utf8').trim().split('\n').forEach(l=>JSON.parse(l))"`
- `tracker_comment_id` matches the id returned by the comment call (or is `null` for `none`).
- A second invocation only appends; it never rewrites or deletes a prior line.

---

## Record to the corpus (if applicable)

After logging to the tracker, evaluate: did this step reveal something a future session needs to know?

**Record if:**
- Schema surprise (unexpected types, nullability, format quirks)
- Platform / tooling gotcha (a behavior or limitation worth remembering)
- Data pattern (cardinality anomaly, NULL rates, cross-source inconsistency)
- Decision that changes how future work is done

**Do NOT record:**
- Routine progress ("implementation started", "tests passed")
- Information already captured in the task report or the issue description

Record findings in the corpus — the task report (`docs/claude_tasks/reports/`), and the chronicle
(`docs/project_chronicle.md`) via `/close-task`. The corpus is the memory; there is no
`create_entities` / `add_observations`. (If the project enabled basic-memory, you may also use its
write_note/search_notes/build_context tools — but the corpus remains the default source of truth.)

The tracker = audit trail (everything). The corpus = distilled knowledge (only what future sessions
need): `project_chronicle.md` + `context_snapshot.md`, indexed by the INDEX.

---

## Rules

- Every comment is append-only — never edit or delete a previous comment (on either tracker).
- Be concise but specific — include numbers, file paths, commit hashes.
- Any agent can log — DE logs implementation steps, PM logs review/close decisions, DA logs analysis
  and test findings.
- The comment history IS the audit trail — future sessions read it to understand what happened.
- State markers are side-effects of specific tags — applying them is not optional when the tag is used.
- Both records (comment + JSONL line) are written together or not at all; the JSONL append failure is
  the single tolerable, loudly-reported drift.
- Never hardcode the tracker, the ticket prefix, the cloud id, a transition id, or a human name —
  read them from `corpus.config.mjs` / `.claude/settings.json` / `CLAUDE.md` / git at runtime.
- Label/transition writes must preserve all pre-existing markers — never clobber project-specific
  labels (phase markers, `frontend`, `backend`, `Decision Needed`, etc.).
