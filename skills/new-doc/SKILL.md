---
name: new-doc
description: Scaffold a governed .md document (spec, alpha_test, analysis, report, review_de, review_da, review_code-reviewer, review_devils-advocate, council, handoff, kb_article) from docs/_templates/ with valid frontmatter, then validate it. Use when the user asks to create a new spec, alpha test, data analysis, report, review, council verdict, handoff, or knowledge-base article — triggers include "/new-doc", "crea un spec", "nuevo doc", "scaffold a review", "diseña el alpha test", "create a handoff", "new KB article", "crea un artículo de KB".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# new-doc

Scaffold a new governed `.md` document with valid frontmatter from a project template, then validate it. Invoked whenever someone needs to create a spec, alpha test, data analysis, task report, a role review, a council verdict, or a session handoff — any document that lives in the governed corpus.

**This table is the single convention for where each document lives.** Agents, skills and templates name these
paths and no others; the plugin's consistency test fails on any other `docs/claude_tasks/` path.

Every governed doc must start valid: correct frontmatter, correct shape. That is the whole point of scaffolding from a template instead of writing from memory — it keeps the corpus machine-checkable (the index, the validator, the pre-push hook, and CI all depend on it).

> **Template source:** `docs/_templates/` — one template per type (11 templates). A template is the only definition
> of its document's structure: agents and skills point to it, never restate it.
> **Validator (project-scaffolded, repo-relative path — never `${CLAUDE_PLUGIN_ROOT}`):** `node scripts/validate-frontmatter.mjs <file>` — run after scaffolding.
> The corpus engine (`scripts/*.mjs` + `corpus.config.mjs`) lives in the **project repo**, not the plugin, because git hooks and CI invoke the same scripts by relative path. Always call it as `scripts/...`.

> Naming note: the role reviews `review_code-reviewer` and `review_devils-advocate` were formerly aliased `review_heimdall` and `review_loki`. The aliases are documentation cross-references only — use the role-descriptive names everywhere.

---

## Trigger

- `/new-doc` — prompts for type + slug
- "crea un spec" / "nuevo doc" / "scaffold a review" / "diseña el alpha test" / "create a handoff"

---

## Types and destinations

The date prefix `YYYY-MM-DD` is today's ISO date. `NN` is the zero-padded task number; `slug` is a short kebab-case label. `<TICKET>` is the tracker ticket id — read the **tracker type** (Jira / Linear / none) and the **ticket prefix** from `corpus.config.mjs` / `.claude/settings.json` / `CLAUDE.md` at runtime; never hardcode a prefix here.

| Type | Template | Destination path | Lifecycle step |
|------|----------|------------------|----------------|
| `spec` | `docs/_templates/spec.md` | `docs/claude_tasks/NN_slug.md` | 3 (PM) |
| `alpha_test` | `docs/_templates/alpha_test.md` | `docs/claude_tasks/alpha_tests/NN_slug.md` | 4 design / 6 seal (DA) |
| `analysis` | `docs/_templates/analysis.md` | `docs/claude_tasks/reports/YYYY-MM-DD_NN_slug_analysis.md` | 2 (DA) — also ad-hoc investigations |
| `report` | `docs/_templates/report.md` | `docs/claude_tasks/reports/YYYY-MM-DD_NN_slug_report.md` | 7 (DE) |
| `review_de` | `docs/_templates/review_de.md` | `docs/claude_tasks/reviews/YYYY-MM-DD_NN_de_review.md` | 5 (DE) |
| `review_devils-advocate` | `docs/_templates/review_devils-advocate.md` | `docs/claude_tasks/reviews/YYYY-MM-DD_NN_devils-advocate_review.md` | 5 (devils-advocate) |
| `review_code-reviewer` | `docs/_templates/review_code-reviewer.md` | `docs/claude_tasks/reviews/YYYY-MM-DD_NN_code-reviewer_review.md` | 7 gate (code-reviewer) |
| `review_da` | `docs/_templates/review_da.md` | `docs/claude_tasks/reviews/YYYY-MM-DD_NN_da_review.md` | 8 (DA) — optional data validation; the binary Step-8 record is the alpha test's Execution log |
| `council` | `docs/_templates/council.md` | `docs/claude_tasks/council/YYYY-MM-DD_slug_council.md` | any (PM) |
| `handoff` | `docs/_templates/handoff.md` | `docs/claude_tasks/handoffs/YYYY-MM-DD_NN_slug_handoff.md` | session boundary |
| `kb_article` | `docs/_templates/kb_article.md` | `docs/knowledge_base/<kebab-slug>.md` | any (kb-curator at close / PM or human on demand) |

> If a project added template types beyond these eleven, list `docs/_templates/` first (`ls docs/_templates/`) and treat any additional `*.md` there as a valid type whose destination follows the same convention. Do not invent a type that has no template file.

---

## Steps

1. **Determine the type** from the user request, or ask:
   `spec | alpha_test | analysis | report | review_de | review_da | review_code-reviewer | review_devils-advocate | council | handoff | kb_article`.
   If the user said "scaffold a review" without a role, ask which role review (`de`, `da`, `code-reviewer`, `devils-advocate`).

2. **Read the template first** — `docs/_templates/<type>.md`. NEVER write frontmatter from memory; the template is the source of the valid shape. If the template file does not exist, stop and tell the user the project's templates are missing (likely `/lifecycle-init` was not run, or the project predates this type).

3. **Determine the destination path** from the table above. Ask for the task number (`NN`) and slug if they were not given. Create any missing parent directory (`docs/claude_tasks/alpha_tests/`, `.../reviews/`, `.../council/`, `.../handoffs/`).

4. **Fill the placeholders** — replace every `<placeholder>` token with a real value. **Prompt when ambiguous — never guess these fields:**
   - `created:` / `updated:` → today's ISO date (`YYYY-MM-DD`).
   - `ticket:` (or the tracker field the project's frontmatter schema defines) → the real ticket id using the project's prefix, or `null` **explicitly**. Required for `spec` and `alpha_test`.
   - `task_number:` → the `NN`. Required for `spec` and `alpha_test`.
   - `authority:` → `ssot | secondary | superseded`. At most **one** `ssot` doc per ticket — check the existing docs for that ticket before assigning `ssot`.
   - `depends_on:` / `affects:` → only fill unambiguous items; otherwise leave `[]`. Each value must resolve to a real file (or known ticket id) or `/audit-corpus` will flag it as a dangling ref.
   - **Delete the template guidance header** — remove the `<!-- DELETE THIS HEADER BEFORE PUBLISHING -->` sentinel block before delivering.

   **Type-specific fields:**
   - `alpha_test` → `designed_by: da`, `status: draft`, `sealed_date: null`. The seal (`status: sealed`, `sealed_date:` set) happens **only at lifecycle Step 6**, after spec review resolves — never at scaffold time. (Freeze rule.)
   - `analysis` → `type: report` with `tags: [analysis]`; written at Step 2, BEFORE the spec exists — so no
     `depends_on` to a spec. Ad-hoc DA investigations use it too.
   - `review_de` / `review_da` / `review_code-reviewer` / `review_devils-advocate` → set `reviewer:` to the matching role (`de | da | code-reviewer | devils-advocate`); leave the verdict as a placeholder until the review actually runs. The `code-reviewer` verdict enum is `safe | non_blocking | not_safe_to_deploy`; the `devils-advocate` verdict enum is `attack | mostly_grounded_dissent | mostly_speculative` (both enforced by the validator from `corpus.config.mjs`).
   - `council` → `status: pending` until the human delivers the Step 7 verdict (then `decided` / `open`).
   - `report` → link it to its spec via `depends_on:` (the spec path) so the report/spec chain resolves in the index.
   - `handoff` → `status: snapshot`, `authority: secondary`, `next_action:` = the exact first OPEN item (the
     single next step for the resuming session); current-state facts only, no history.
   - `kb_article` → `status: living`, `authority: ssot`, `owner: kb-curator`; **one topic, one article** — grep
     `docs/knowledge_base/` (including every article's `aliases:`) for the topic before creating (the kb-curator's
     dedup ladder is the reference procedure); fill the first `## Sources` row; the `## Sources` section is
     **append-only** forever after. No `ticket:` field — provenance lives in `## Sources`.

5. **Validate** the scaffolded file:
   ```
   node scripts/validate-frontmatter.mjs <file>
   ```
   Fix every hard violation before delivering. Exit 0 = clean; exit 1 = hard violations present.

6. **Report** the path of the created file to the user (in the project's communication language — read it from `CLAUDE.md`).

---

## Hard rules

- NEVER scaffold without reading the template first (`docs/_templates/<type>.md`).
- NEVER leave `<placeholder>` tokens in the delivered file.
- NEVER leave the `DELETE THIS HEADER BEFORE PUBLISHING` sentinel in the file.
- ALWAYS run the validator after scaffolding — do not deliver a file with hard frontmatter violations.
- For `spec` and `alpha_test`, the tracker field is required (set to a real ticket id or `null` explicitly), as is `task_number:`.
- NEVER scaffold an `alpha_test` as `sealed`. Sealing happens only at lifecycle Step 6, after spec review resolves: the PM directs it, the DA performs it. **The DE never creates or edits an alpha test** (the alpha-test wall).
- NEVER hardcode a ticket prefix, tracker type, or project paths in the scaffolded doc — read the prefix and tracker from `corpus.config.mjs` / `.claude/settings.json` / `CLAUDE.md` at runtime.
- Call the validator by its repo-relative path (`scripts/validate-frontmatter.mjs`), never via the plugin root — git hooks and CI invoke the same script that way.

---

## Reference

- Template inventory: `docs/_templates/`
- Frontmatter taxonomy SSOT: `.claude/rules/frontmatter.md`
- Validator: `scripts/validate-frontmatter.mjs`
- Per-project corpus constants (paths, tracker key, project slug): `corpus.config.mjs`
- Lifecycle steps and the freeze rule: `.claude/CLAUDE.md` + `FRAMEWORK.md`
- Council verdict shape: the `/council` skill (which scaffolds via `/new-doc council`)
- Index rebuild + dangling-ref / sealed-test checks: the `/audit-corpus` skill
