---
name: audit-corpus
description: Corpus health check — validate all .md frontmatter, rebuild docs/INDEX.md + docs/index.json, and write a tiered health report to docs/audits/. Findings are tiered High/Medium/Low; High includes frontmatter parse errors, dangling refs, broken mandatory-read paths, sealed alpha tests modified after sealing (the freeze-rule enforcement) and tier-S tasks that skipped the gate. With --archival it also writes a proposal-only archival manifest (closed-ticket bundles, superseded docs, consolidation candidates) — it never moves a file. Use weekly, after a batch of .md edits, or after a /close-task that changed frontmatter broadly. Triggers include "/audit-corpus", "audit the corpus", "rebuild the index", "check frontmatter", "archival sweep", "propose what to archive".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# audit-corpus

Full corpus health check for the governance corpus:

1. validate every governed `.md` frontmatter,
2. rebuild the queryable index `docs/INDEX.md` + `docs/index.json`,
3. write a tiered **High / Medium / Low** health report to `docs/audits/`.

Run **weekly**, after any large batch of `.md` edits, or after a `/close-task` that changed frontmatter broadly.

> **Scripts (project-scaffolded — invoked by repo-relative path, never `${CLAUDE_PLUGIN_ROOT}`):**
> `scripts/validate-frontmatter.mjs` + `scripts/build-index.mjs`
> **Output:** Console summary + `docs/INDEX.md` + `docs/index.json` + `docs/audits/<YYYY-WW>_health_audit.md`

The corpus engine lives in the **project repo** (`scripts/*.mjs` + `scripts/corpus.config.mjs`), not in the plugin, because the same scripts are called by git hooks and CI by relative path. Always call them with the repo-relative path shown below.

---

## Trigger

- `/audit-corpus`
- "audit the corpus" / "rebuild the index" / "check frontmatter" / "audita el corpus"
- `/audit-corpus --archival` — "archival sweep", "propose what to archive", "limpia el corpus": Steps 1–5, the
  archival proposal (below), then Step 6, which commits the manifest with the health report.

---

## Steps

1. **Run validation** across all governed docs:
   ```
   node scripts/validate-frontmatter.mjs docs .claude
   ```
   - Hard violations are listed with a `[HARD]` prefix; soft warnings with `[WARN]`.
   - Exit 0 = clean; exit 1 = hard violations present.

2. **Run the health checks** (these go beyond the validator — execute them explicitly):

   - **Dangling refs:** every `depends_on:` / `affects:` / `supersedes:` value must resolve to an existing file (or, where the schema allows it, to a known ticket id). An unresolved reference is a High finding.
   - **Sealed alpha-test integrity (the FREEZE RULE):** for every file in `docs/claude_tasks/alpha_tests/` whose `status:` is `sealed`, `passed`, or `failed`, compare the date of the last commit touching the file against its `sealed_date`:
     ```
     git log -1 --format=%cs -- <file>
     ```
     A modification dated **after** `sealed_date` that is **not** a sanctioned status transition (`sealed` → `passed`/`failed` at lifecycle Step 8) is a **High** finding — the alpha test was edited after it was frozen, which defeats the bias-free verdict. Report the file, the `sealed_date`, and the offending commit date.
   - **Mandatory-read paths:** every file referenced by the session-start protocol in `.claude/CLAUDE.md` (legacy scaffolds: the repo-root `CLAUDE.md`) must exist. Treat a path that `CLAUDE.md` itself marks as expected-absent (e.g. `docs/architecture.md` before it is first authored) as not-a-finding.
   - **Staleness:** `updated:` older than 60 days on docs with `status: active | living | in_progress`.
   - **Orphan specs:** a tier-M or L spec with `status: done` and no matching report in `docs/claude_tasks/reports/` nor any review in `docs/claude_tasks/reviews/` for its `task_number` (tier S has no report by design).
   - **Activity silence:** a spec with `status: in_progress` and no line for its ticket / `task_number` in `docs/activity_log.jsonl` within the last 14 days (ignore `session: "backfill"` lines).
   - **`task_number` collisions:** two specs — or two alpha tests — sharing the same `NN`.
   - **Tier evidence** (specs with `status: done`; a spec without `tier:` counts as M):
     - **S** whose `affects:` names `data.`, `migration.` or `dep.` → **High**: the change was outside tier S (data,
       schema or a dependency) and skipped the M cycle.
     - **S** whose `affects:` names code (`fn.`, `api.`, `ui.`, `auth.`, `job.`, `module.`, `interface.`) with no
       `review` carrying `reviewer: code-reviewer` for the same `ticket` → **High**: production code skipped the gate.
     - **M or L** with neither an alpha test for its `task_number` nor `alpha test: N/A — no behavioral change` in
       the spec → **Medium**.
     - **L** with no council doc for its `ticket` → **Medium**.

3. **Triage findings by severity:**

   | Tier | Findings | Action |
   |------|----------|--------|
   | **High** | Frontmatter parse errors · missing required fields · dangling `depends_on:`/`affects:`/`supersedes:` refs · **sealed alpha test modified after `sealed_date`** · broken mandatory-read paths · **a tier-S task that touched data/schema/dependencies or skipped the code-reviewer gate** | **Block:** fix before committing the index. Sealed-test and tier violations escalate to the human — never silently "fix" the test or the tier (see Hard rules). |
   | **Medium** | Stale `updated:` (>60d on active docs) · orphan specs (no report/review chain) · spec `in_progress` with no activity-log line in 14d · an M/L spec with no alpha test or N/A declaration · an L spec with no council doc | Report + propose fixes; apply only the mechanical ones (a date bump requires the doc to actually be re-verified, not blind-bumped). |
   | **Low** | Empty `tags: []` · `task_number` collisions | Report; fix opportunistically. |

   For files needing human judgment (wrong `type`, wrong `status`, ambiguous `authority`): present them to the user for a decision — do not guess.

4. **Rebuild the index** (after High findings are cleared, or standalone if the corpus is already clean):
   ```
   node scripts/build-index.mjs
   ```
   - Outputs `docs/INDEX.md` and `docs/index.json` — **never hand-edit these.**
   - Reports: files indexed, sections, elapsed time. The script enforces a <5s performance gate and exits non-zero if it is breached.

5. **Write the health report** to `docs/audits/<YYYY-WW>_health_audit.md` (ISO week, e.g. `2026-24_health_audit.md`), with frontmatter `type: audit`, `status: snapshot`, `authority: secondary`. Contents:
   - Total files checked, broken down by `type`.
   - High / Medium / Low findings — each with its file path and the specific check that fired.
   - What was auto-fixed vs. what awaits a human decision.
   - Index rebuild stats (files indexed, elapsed time).
   - Delta vs. the previous week's audit (new findings, resolved findings).

6. **Commit** (only if **no High findings remain**). The health report (and an `--archival` manifest) are governed
   docs and the INDEX lists only tracked files — stage them, rebuild, then commit, or the committed INDEX misses
   them and the CI freshness check fails:
   ```
   git add docs/audits/
   node scripts/build-index.mjs
   git add docs/INDEX.md docs/index.json
   git commit -m "docs: corpus audit <YYYY-WW> — index rebuilt, N findings"
   ```
   Use the project's commit convention from `.claude/rules/git-workflow.md`; if the project ties commits to a ticket prefix, read that prefix from `scripts/corpus.config.mjs` / `CLAUDE.md` rather than hardcoding one.

---

## Archival proposal (`--archival`)

A **proposal-only** sweep of `docs/`: it writes one dated manifest and never moves, renames, edits or deletes a file —
the PM executes the moves after the human approves the manifest. Run it after Step 5 (Step 4 left the INDEX
fresh); Step 6 then commits the manifest with the health report.

**Eligible** (cite the rule for every proposal):

| Rule | Candidate | Signal |
|---|---|---|
| **E1 — closed-ticket bundle** | a spec with `status: done` + the reports/reviews sharing its `ticket` / `task_number` | the spec's own frontmatter `status:`, read directly — never a derived field in `index.json` (last-writer-wins collisions there) |
| **E2 — superseded / abandoned** | any doc with `status: superseded \| abandoned` or `authority: superseded`, not already archived | frontmatter, read directly |
| **E3 — consolidation** | ≥ 2 docs covering the same topic with overlapping content | judgment — flag for the human, never bundle |

Age is a soft signal; the trigger is *closed and unreferenced* (recency from `docs/activity_log.jsonl`, else `updated:`).

**Never archive** — a candidate is disqualified, and listed as kept with the rule that fired, if ANY holds:
1. It is protected, mandatory-read or append-only per `.claude/CLAUDE.md` (the chronicle, the activity log, …).
2. `node scripts/affects-lookup.mjs` shows it is an `authority: ssot` object with live consumers.
3. An **open** spec references its ticket in `depends_on:` or `supersedes:` — grep for the ticket id there, then read
   each referencing spec's `status:` directly; not `done`/`abandoned` → load-bearing.
4. A grep **across all of `docs/**/*.md`** — not just `docs/claude_tasks/` — finds its path or its bare ticket id in a
   non-archived file outside its own bundle (reviews and reports of other tickets count). A missed inbound reference is
   the worst failure mode: never write "no inbound refs" without having run that grep over the whole tree.
5. It is `docs/context_snapshot.md`, the INDEX pair, or any other generated file.

**Destination:** task bundles → `docs/claude_tasks/archive/`; standalone docs → `docs/archive/` (or the precedent the
repo already uses). **Manifest:** `docs/audits/YYYY-MM-DD_archival_proposal.md` (`type: audit`, `status: snapshot`,
`authority: secondary`) with three tables — *Proposed* (paths · rule · evidence · inbound-reference result ·
destination · risk), *Consolidation flags* (docs · overlap · suggestion), *Kept* (path · rule that fired). An empty
*Proposed* table is a valid result. Stop after the manifest; the moves are the PM's, after the human's yes.

---

## Scheduled audit (optional)

If the project wants a recurring audit, register it once via the `/schedule` skill. Pick a fixed UTC cron; document the local-time equivalent (and any DST adjustment) in the schedule label rather than assuming a timezone here:

```
/schedule create --cron "0 13 * * *" --invoke "/audit-corpus" --commit-output --label "<project>-corpus-audit"
```

The drift window between scheduled runs is the cron interval; freshness is already enforced by the `lint-frontmatter` CI gate on every pull request that touches docs (it rebuilds the INDEX and fails on drift) and by `/close-task`, which rebuilds the INDEX whenever frontmatter changed.

---

## Hard rules

- NEVER commit `docs/INDEX.md` or `docs/index.json` while **High** findings are unresolved — indexing broken frontmatter produces unreliable lookups.
- NEVER skip the validation step before rebuilding the index.
- NEVER modify a sealed alpha test to clear a High finding. The modification **is** the finding — escalate it to the human; do not edit the test to make the check pass.
- If `scripts/build-index.mjs` exceeds its 5s gate, flag it as a performance regression (the script exits non-zero on breach).
- The health report is a snapshot — never edit a previous week's report; always write a new dated file.
- Call the corpus scripts by their repo-relative path (`scripts/...`), never via the plugin root — git hooks and CI invoke the same scripts that way.

---

## Reference

- Frontmatter taxonomy SSOT: `.claude/rules/frontmatter.md`
- Validator: `scripts/validate-frontmatter.mjs`
- Indexer: `scripts/build-index.mjs`
- Affects lookup: `scripts/affects-lookup.mjs <object>`
- Per-project corpus constants: `scripts/corpus.config.mjs`
- Activity log (for the silence check): `docs/activity_log.jsonl` — contract in the `/log-activity` skill
- Alpha-test freeze rule: `.claude/CLAUDE.md` (lifecycle Step 6 seal / Step 8 run) + Hard rules above
