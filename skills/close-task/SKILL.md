---
name: close-task
description: Step-10 lifecycle closer. Three variants — Full lifecycle close (spec + alpha test + report done, human-validated at Step 9), Research / non-lifecycle close (investigation, spike, governance/docs — no spec, no alpha test, no forced ticket Done), and Transitory close (multi-session boundary — snapshot, plus KB curation only when the session produced a report, spec or review). The kb-curator (if enabled) folds the session's durable knowledge into docs/knowledge_base/ at every Full and Research close, and at a Transitory close only when the session produced a report, spec or review. Refreshes the context snapshot and TODO, appends to the chronicle on a decision of record, conditionally re-audits architecture from live sources, rebuilds the INDEX, and moves the ticket to Done. The chronicle + context_snapshot + knowledge base ARE the persisted memory. Tracker-parameterized (Jira | Linear | none, read from .claude/settings.json). Honors protected (proposed for human authorization) and append-only doc rules.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, TodoWrite
---

# Close Task

Close a work session cleanly. Run after the human validates a lifecycle task at **Step 9**, or after a
non-lifecycle work session (investigation, spike, governance/docs). The **PM** runs this — it is the only role that
closes. There is no shortcut past the close: a session that produced work is not done until it is closed.

This skill is **plugin-resident** and **stack-/tracker-neutral**. It reads everything it needs at runtime — never
assume a stack, tracker, table, or path. Read these first, then act:

- **`.claude/settings.json`** — `tracker` (`jira | linear | none`) and its connection identity, `stack`
  (`web | data | generic`), enabled MCP servers, and the **`agents` roster block** (`agents.kb_curator`,
  `agents.linear_steward`, `agents.separation_of_duties_mode`). An absent block or key means the documented
  defaults: `kb-curator` ON, `linear-steward` OFF, SoD `collapsed`.
- **`scripts/corpus.config.mjs`** — per-project paths, ticket prefix, project slug, the corpus script names.
- **`CLAUDE.md`** — model policy, lifecycle numbering, role roster, communication language, protected-doc list.
- **`.claude/rules/*.md`** — especially `frontmatter.md` (the taxonomy SSOT) and `mcp-usage.md` (MCP server usage).

If the tracker is not declared in `settings.json`, ask the PM which variant of close to run before writing anything.

## 0. Pick the variant FIRST

The variant decides which sections run. Choose before touching any file.

| Variant | When | What runs |
|---|---|---|
| **Full lifecycle close** | A task is done and the human validated it at Step 9 — tier M/L: spec + alpha test + report exist; tier S: the short spec, plus the code-reviewer review when production code changed | §1 (lifecycle read) + §2 + §3 + §4 + §5 |
| **Research / non-lifecycle close** | Investigation, spike, or governance/docs work — no spec, no alpha test, maybe no ticket | §1 (research read) + §2 + §4 + §5. **SKIP §3** (no spec flip/archive, no alpha test, no forced ticket Done) |
| **Transitory close** | A multi-session task at a session boundary — it continues next session | ONLY: overwrite `docs/context_snapshot.md` + **KB curation (§2 "Knowledge-base curation") — only if the session produced a report, spec or review** + the linear-steward (§2, if enabled) + INDEX rebuild *if the curator wrote* + `/log-activity paused` + **§5 "Commit (Transitory close)"** (curation bundle, only if the curator wrote) + **§5 Report**. The snapshot IS the persisted memory the next session resumes from; the KB keeps what must outlive the task. **No** chronicle, **no** ticket Done, the spec stays `in_progress` |

A multi-session lifecycle task gets a **transitory close at each boundary** and **exactly one full close at the end**.

**Machine boundary?** If the session ends because work moves to the user's OTHER machine, do not run a bare
Transitory close — run **`/handshake out`**, which wraps this exact Transitory variant and adds the transport
steps (sync verification on a synced-folder repo; WIP transport commit + durable handoff doc + push on a
git-remote repo).

## 1. Read context

Read what the session actually produced before writing anything.

- **Full:** the latest report in `docs/claude_tasks/reports/` (tier S: the DE's summary instead); the spec
  (`docs/claude_tasks/<NN_slug>.md`) for its tier, acceptance criteria and tracker id; the alpha-test result in
  `docs/claude_tasks/alpha_tests/` (tiers M and L);
  `git diff --stat <default-branch>` (resolve the default branch — do not hardcode `main`); `TODO.md`.
- **Research:** the artifact(s) the session produced (the `docs/research/` doc, knowledge-base or schema files,
  governance edits); `git diff --stat <default-branch>`; `TODO.md` and the tracking ticket if one exists.
- **Transitory:** the in-flight spec and report draft; the current branch state. Read only enough to write an
  accurate snapshot.

## 2. Universal updates (Full + Research)

### Artifact placement (tidy first)
Confirm every file the session produced is in its canonical folder per the repository's doc-structure guide
(research → dated `docs/research/`; domain knowledge → `docs/knowledge_base/`; schema → `docs/schema/` if the stack
uses one; lifecycle artifacts under `docs/claude_tasks/`), each with valid frontmatter. Nothing orphaned at the
`docs/` root. A tidy tree is the precondition for a trustworthy index.

### project_chronicle.md — APPEND-ONLY, CONDITIONAL
`docs/project_chronicle.md` is **append-only**: add a new dated entry, **never** edit or delete a prior one.
Append **ONLY IF a decision of record or a change of project direction was made**. Routine task completion and
research extracts do **not** earn a chronicle entry — a research doc's home is `docs/research/`. When in doubt,
the chronicle records *why the project changed direction*, not *what was done this session*.

```
## YYYY-MM-DD — {decision / direction title}
**Context:** {what prompted it}
**Decision of record:** {what was decided; also recorded in strategy.md if a formal decision}
**Cited evidence:** {file:line, data finding, council doc, or prior chronicle entry}
**Status:** Decision of record
```

### context_snapshot.md — OVERWRITE
Overwrite `docs/context_snapshot.md` (the single where-we-are handoff; usually gitignored). The deliberate overwrite
keeps it a snapshot, not a log. It is **the one page the next session reads at start** (with the spec in flight), so
keep the scaffolded section headings and fill each, facts only, one page:
- **State in force** — the task in flight, its tier and step reached, the ticket's tracker status, the governing
  spec and sealed alpha test by path (and the deploy/pipeline status if the stack has one).
- **Next action** — what the next session does first (mirror the top of `TODO.md` when no task is in flight).
- **Recent decisions** — the last 3 decisions of record from `docs/project_chronicle.md`, one line each with the date.
- **Open decisions** — the open decisions in `docs/strategy.md` that constrain the next task.
- **Dependencies of the task in flight** — `node scripts/affects-lookup.mjs` on the spec's `affects:`, one line each.
- **Carry-over** — blockers and open questions.

### Distilled knowledge — folded into the corpus
There is no separate memory write: **the chronicle + context_snapshot + knowledge base ARE the persisted memory.**
Distilled knowledge that future sessions need is recorded in the corpus, not in a side store. Fold each kind into
its home:

**What to capture, and where it lands:**
- Schema surprises (unexpected types, nullability, format quirks), platform gotchas, data patterns (cardinality
  anomalies, NULL rates, cross-source inconsistencies) → the task report at the time; **the KB-bound share is
  folded in by the kb-curator (next subsection) — do not hand-write `docs/knowledge_base/` in parallel with it**
  (`docs/schema/` stays per §4); a baseline count that anchors future work goes in the report and, if it shaped a
  decision, the snapshot.
- Decisions that change how future work is done → `project_chronicle.md` (a decision of record) and `strategy.md`.
- Current-state anchors the next session needs immediately → `context_snapshot.md`.

**Do NOT re-record:** routine progress (already in the activity log / tracker); anything already in a report;
anything derivable from code or `git log`; secrets, tokens, hostnames, or infrastructure identifiers.

The activity log is the audit trail; the chronicle + snapshot + report + KB articles are the distilled knowledge —
keep them distinct.

### Knowledge-base curation — kb-curator (Full + Research; Transitory only with a report, spec or review)

On a **Transitory** close, run it only when the session created or changed a report, a spec or a review
(`docs/claude_tasks/reports/`, `docs/claude_tasks/reviews/`, or a spec in `docs/claude_tasks/` — check
`git status --porcelain` and the session's commits). A session that produced none of them has nothing the KB
needs yet, and it stays inside the next curator's diff window (below), so nothing is lost; say "KB curation: skipped (transitory, no
report/spec/review)" in the close report.

On a **tier-S** Full close, run it only if the DE's summary reported a lesson — a one-file change rarely produces
durable knowledge; say "KB curation: skipped (tier S, no lesson)" in the close report otherwise.

Read `agents.kb_curator` from `.claude/settings.json` (absent block/key = **enabled**, the default). If enabled,
spawn the `kb-curator` teammate with a self-contained brief: the variant, the ticket id, the session id, and the
diff window: from the last `kb-curated` or `task-closed` line in `docs/activity_log.jsonl` to now — never from a
`paused` line, so sessions whose Transitory close skipped curation stay in the window. The curator ingests the session's outputs, applies its notability gate and dedup
ladder against the existing KB, and writes ONLY under `docs/knowledge_base/` — duplicates skipped, stale articles
rewritten in place, genuinely new topics created from `docs/_templates/kb_article.md` — then validates its own
files and returns a **filing plan**. Its changes ride the close commit, so the diff stays reviewable.

The PM (you) owns everything downstream. **First resolve every FAILED entry in the filing plan** (fix the file or
`git restore` it — a file with invalid frontmatter never rides the close commit). Then, if ≥1 KB file **survived
validation and your fix-or-restore decision**, log `/log-activity kb-curated` (step 10 on a Full/Research close,
`null` on Transitory; `agent: "kb-curator"`; `artifacts` = only the surviving KB files — restored files are noted
in the close report instead), and let the next subsection's INDEX rebuild pick up the frontmatter changes. The
curator NEVER rebuilds the INDEX, logs, or commits — those are yours.

If Agent Teams is unavailable or the spawn fails, run the same protocol inline yourself, following
`kb-curator`'s rules (the `docs/knowledge_base/**` write allow-list included). If curation fails (validation
cannot be fixed, evidence unreadable), report it loudly in the close report and close anyway — a failed curation
is skipped-and-reported, never a blocked close. If `agents.kb_curator` is explicitly `false`, note
"KB curation: disabled" in the close report and skip this subsection.

### Linear project hygiene — linear-steward (ALL variants; opt-in, Linear tracker only)

Read `agents.linear_steward` from `.claude/settings.json` (absent block/key = **disabled** — this one is opt-in).
If it is `true` **and** `tracker = linear`, spawn the `linear-steward` teammate **after the kb-curator** with a
self-contained brief: `mode: full`, **`scope: project` — the project of the ticket being closed** (the steward
resolves it live from the ticket id; a Research close with no ticket → `settings.json → tracker.project`), the
ticket id, the session id, and whether the detector's cache (`.claude/.local/linear-hygiene-cache.json`, 12 h)
is fresh. The steward runs the §7 checks **inside that one project** — never the whole workspace at a close —
**applies structural fixes only** (the project's status/dates/initiative, its issues' parent and title prefix,
labels read-compute-write, orphan issues whose prefix unambiguously belongs to the project — at most 20 writes
per run), **proposes** the rest with evidence, lists what it saw outside the project without touching it, appends a
dated section to the `Linear steward — sweep log` document in Linear, and returns a **sweep report**. Its record
lives in Linear, not in this repository — nothing to stage.

Carry the report's summary into the close report as one line (`Linear hygiene: <project> — A applied, P proposed,
O outside scope`) and relay the proposals to the human — they are decisions, not chores. A whole-workspace sweep
is a separate, explicitly requested run (`scope: workspace`), never part of a close. If the spawn fails or the
steward cannot finish, close anyway and say so: a failed sweep is skipped-and-reported, never a blocked close. If
the flag is off or the tracker is not Linear, skip this subsection silently.

### Index rebuild — unconditional when frontmatter changed
If any frontmatter changed this session, **stage the new and changed governed docs first** (`git add` their
explicit paths — the INDEX lists only tracked files, via `git ls-files`, so an unstaged new report or KB article
would be missing and CI would fail on the drift), then rebuild the corpus index by running the project's
build-index script (its name is in `scripts/corpus.config.mjs` — typically `node scripts/build-index.mjs`). If
`git diff --quiet docs/INDEX.md docs/index.json` reports dirty, stage both and include them in the close commit.
Make this **unconditional on frontmatter change** — a conditional rebuild leaves an intra-day drift window, and CI
blocks the pull request if the INDEX drifts from source.

### Activity log
Write the closing line with the single logger: `/log-activity task-closed: <summary>` on a Full or Research
close (the summary names the variant), `/log-activity paused: <summary>` on a Transitory close (a session
boundary completes no step). A **Full lifecycle close** is a milestone: add `--tracker` so the ticket gets the
closing comment cross-referenced by id (`/log-activity task-closed: <summary> --tracker`, agent `pm`; a no-op
when `tracker = none`). The logger never transitions the ticket — the move to Done happens exactly once, in §3.

## 3. Lifecycle-only updates (FULL close only — skip in Research and Transitory)

### Spec frontmatter
On the closing spec (`docs/claude_tasks/<NN_slug>.md`): set `status: done`, bump `updated:` to today's ISO date, and
append **unambiguous** `affects:` items only (table names, route paths, migration ids, RPC names that the work
actually touched — confirm against the diff; never invent). Follow the enums in `.claude/rules/frontmatter.md`.

### Spec archive
Move the spec into the archive: `git mv docs/claude_tasks/<NN_slug>.md docs/claude_tasks/archive/<NN_slug>.md`.
The frontmatter keeps `type: spec` + `status: done` (an explicit declaration wins over any archive-path heuristic).

### Tracker — branch on the configured tracker

Read `tracker` from `.claude/settings.json`. Run exactly one branch.

#### If `tracker = linear`
Use the Linear MCP wired at init (server `linear` from `settings.json → mcp.servers`; tools `mcp__linear__*` —
tool names vary by server version: discover the exact ones from the session tool list before calling; the steps
below use indicative names). The workspace/team/project identity is in `settings.json` /
`scripts/corpus.config.mjs` — read it, do not hardcode.

1. **Append Completion Notes** to the issue description (append, never replace). This is the canonical block —
   the Jira branch converts the same content to Jira markup:
   ```
   ## Completion Notes
   - **Completed:** YYYY-MM-DD
   - **Implemented by:** {de / da / pm}
   - **Files modified:** {list}
   - **Key decisions:** {any deviations from the spec}
   - **Alpha test:** docs/claude_tasks/alpha_tests/<NN_slug>.md — passed / failed / N/A
   - **Task report:** docs/claude_tasks/reports/YYYY-MM-DD_<NN_slug>_report.md
   - **Commit:** `git log -1 --oneline` (or "No commit — analysis only")
   ```
2. **Move the issue to Done** — `save_issue` with `state: "Done"`.
3. **New work discovered** → create sub-issues (labels, dependencies, dates). Post-seal alpha-test edge cases land
   here as new tickets — **never** as retroactive mutation of the sealed test.
4. **Parent has all sub-issues Done** → move the parent to Done too.

#### If `tracker = jira`
Use the Atlassian MCP wired at init (server `atlassian` from `settings.json → mcp.servers`; tools
`mcp__atlassian__*`). Read the `cloud id` / site and project key from `settings.json` /
`scripts/corpus.config.mjs`. Resolve the issue key from the spec's tracker id.

1. **Append Completion Notes** to the issue description via `editJiraIssue` (fetch the current description with
   `getJiraIssue`, append the canonical block from the Linear branch above converted to Jira markup — `h2.`
   heading, `* *Field:* value` bullets — and write it back; do not overwrite prior content).
   (Also acceptable: post the block as a comment via `addCommentToJiraIssue` if the project convention is
   comment-based completion notes — follow `scripts/corpus.config.mjs`.)
2. **Transition the issue to Done** — call `getTransitionsForJiraIssue` to find the transition id whose target is the
   Done status (the name varies per workflow: "Done", "Closed", "Resolved"), then `transitionJiraIssue` with that id.
   Never guess the transition id.
3. **New work discovered** → `createJiraIssue` under the same project/epic (set issue type, labels, links via
   `createIssueLink`). Post-seal alpha-test edge cases become new issues, never test mutation.
4. **Parent epic has all child issues Done** → transition the epic to Done as well.

#### If `tracker = none`
No tracker calls. The Completion Notes live only in `TODO.md` and the chronicle/report. Proceed.

### TODO.md — PROTECTED, STATUS-SYNC ONLY
`TODO.md` is **protected**: close-task is the **only** sanctioned agent write path. Flip status markers, add
completion dates, and unblock downstream rows that this task gated. **Never** add, remove, reword, or reprioritize
tickets — that content is the human's. Follow the file's own rewrite pattern (full rewrite, not a patch, if its
header specifies one).

## 4. Conditionally update (Full + Research — only if the thing actually changed)

Evaluate what changed; do **NOT** touch a file if nothing relevant changed. Two non-negotiable rules govern this
section: **one fact, one place** (no duplication across docs) and **re-audit live sources, never write from
memory**. **Protected files are PROPOSED for human authorization — never edited unilaterally.** Present the proposed
diff in chat and wait for the human's approval before applying it.

| Target | Update ONLY IF | How / protection |
|---|---|---|
| `docs/architecture.md` | the live system changed: schema (new/dropped tables, policy/migration/RPC/trigger/extension changes), routes/API surface, ETL or sync workflows, auth/session model, tech stack (package add/remove/major-bump), deploy topology. Single bug fixes do **not** count. | **PROTECTED.** Re-audit live sources before writing — never from memory (see §4.1). Propose the diff; the human authorizes. Update the `Audited:` date line and the snapshot counts. May not exist yet → skip and note. |
| `docs/strategy.md` | a decision of record was made (new threshold, new approach, design change) | **PROTECTED.** Lands in the Decision Log. A `/council` verdict counts as approval for its own entry. Propose; human authorizes. |
| `CLAUDE.md` | a governance-level reference changed (new skill, new convention, a TBD resolved) | **PROTECTED.** Propose the diff; wait for approval. |
| repository doc-structure guide | the repo structure, folders, or an update protocol changed | PM-maintained SSOT; flag structural changes to the human. |
| `docs/knowledge_base/` | — handled by the **kb-curator in §2** (Full and Research closes; a Transitory one only with a report, spec or review) — do not update here in parallel | Manual edits are the human-directed exception. The confidentiality gate applies either way (no secrets, tokens, hostnames, or infrastructure identifiers). |
| `docs/schema/` (data stack only) | the data layer changed (gold tables, semantic model) | Re-audit the live source; keep the directory split the project defines. |
| `README.md` | the repo-visitor-visible status changed (phase transition, major capability landed) | Normal doc. |

### 4.1 Re-auditing `docs/architecture.md` (the protocol)
When the trigger matrix above fires, **re-audit from live sources** — do not recall. Use whatever the project's
stack provides (read `stack` from `settings.json`):
- **Schema** → the stack's live introspection (e.g. `list_tables` / `list_migrations` / catalog queries via the
  configured data MCP, or the data warehouse's information-schema). Read it; do not remember it.
- **Routes / API surface** → glob the project's route files (the patterns are stack-specific — discover them from
  the repo, do not assume a framework).
- **ETL / sync schedules** → read the workflow files (`.github/workflows/*.yml` or the scheduler config).
- **Tech stack** → `package.json` / `pyproject.toml` / the lockfile — no exceptions, never from memory.
- **Deploy topology** → the deploy config file + the deploy provider's MCP if one is configured.

Because `architecture.md` is **protected**, the output of the re-audit is a **proposed diff** presented to the human
for authorization — the PM does not write it unilaterally.

## 5. Commit and report

### Commit (Full close)
Stage the index files, the archived/updated spec, any `docs/knowledge_base/` files the kb-curator wrote, and any
authorized doc edits, then commit on the task branch (`1 ticket = 1 branch = 1 PR`; never force-push; never commit
to the default branch directly).

### Commit (Transitory close)
If the kb-curator wrote, commit a curation-only bundle on the task branch: `git add` the **explicit paths**
(`docs/knowledge_base/<files>`, `docs/INDEX.md`, `docs/index.json`, `docs/activity_log.jsonl`) and commit — e.g.
`chore(kb): transitory-close curation <TICKET>`. **Never `git add -A`** — unrelated dirty working-tree files stay
untouched at a session boundary. If the curator wrote nothing, the transitory close commits nothing, as before.
(The `/handshake out` WIP transport commit on a git-remote repo is a different, earlier commit with its own
sanctioned `git add -A` — see that skill; the explicit-paths rule here governs the curation bundle only.)

### Report
State the variant and what was updated vs skipped. Examples:

**Full lifecycle close (tracker = jira):**
```
Variant: Full lifecycle close
Updated: project_chronicle.md (decision of record), context_snapshot.md, TODO.md (status-sync), INDEX, spec (done + archived)
KB curation: 1 updated (knowledge_base/billing-rules.md — stale cutoff rewritten), 2 skipped (dup), 0 created
Conditionally updated: architecture.md (§schema — proposed diff for migration 0032 + RPC fix; AWAITING human authorization)
Tracker: Jira PROJ-142 → Completion Notes appended, transitioned to Done
Skipped: strategy.md (no decision of record beyond the one chronicled)
```

**Research / non-lifecycle close (tracker = linear):**
```
Variant: Research / non-lifecycle close
Updated: docs/research/2026-06-29_slug.md (placed + frontmatter), context_snapshot.md, INDEX
KB curation: 1 created (knowledge_base/adls-auth-quirks.md), filing plan clean
Linear hygiene: project "Brisia Website" — 3 applied (orphans CRI-1072/1073/1074 filed by prefix [Site]), 1 proposed (reopen CRI-1091 or re-parent its 4 open children), 2 outside scope (empty initiatives — workspace sweep on request), sweep log appended
Conditionally updated: none (repository guide / schema unchanged)
Chronicle: skipped (no decision of record)
Tracker: comment on PROJ-123 (no Done — investigation continues)
Skipped (lifecycle-only): spec flip/archive, alpha test, ticket Done
```

**Transitory close:**
```
Variant: Transitory close (session boundary)
Updated: context_snapshot.md (overwritten — the persisted memory), activity log (paused)
KB curation: 1 updated (knowledge_base/gold-layer-grain.md — Sources row appended), INDEX rebuilt, curation bundle committed
Spec: stays in_progress. No chronicle, no tracker Done. Resume next session from the snapshot.
```
