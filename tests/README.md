# Plugin tests

The plugin's own safety net. Everything deterministic the plugin ships is exercised here: the three
hooks, the corpus engine that `/lifecycle-init` scaffolds, the template rendering, and the cross-file
vocabularies that must agree. The LLM agents and skills are not run — their *contracts* are checked
(frontmatter, referenced files, enums), not their judgment.

```
npm install        # once: js-yaml, the corpus engine's only dependency
npm test           # node --test "tests/**/*.test.mjs"  — target: < 10 s
```

| File | What it proves |
|---|---|
| `hooks/filing-guard.test.mjs` | `check_linear_filing.py`: the 15 stdin cases (deny / allow + warning / pass) |
| `hooks/destructive.test.mjs` | `check_destructive.py`: generic core, stack patterns gated by env var or `settings.json` |
| `hooks/detector.test.mjs` | `linear_hygiene.mjs` against a local fake GraphQL server: flag off, no key, auth error, complexity error, project / cached / `--project` / `--scope workspace`, not found |
| `corpus/engine.test.mjs` | `validate-frontmatter.mjs` and `build-index.mjs` over a rendered fixture project; the tier rules (R13 hard, S2 soft); `--staged` (the pre-commit hook) in a throwaway git repo checks only staged docs |
| `scaffold/render.test.mjs` | every file under `data/templates/` renders with dummy vars: valid JSON/YAML, importable `corpus.config.mjs`, zero unresolved `{{VAR}}`; one git hook (pre-commit, staged, warn-only); CI = one job on pull requests installing js-yaml alone; the spec carries `tier:`; the snapshot carries the session-start sections |
| `consistency/claims.test.mjs` | honest docs: README, `/lifecycle-init`, FRAMEWORK.md and the scaffolded CLAUDE.md agree with the plugin — seven agents and the four folded ones named only where the docs say where they went (`/dead-code`, `/audit-corpus --archival`, the search-first rule, a second fresh `da` keyed on the `da-runner` label, each protocol still present, `/dead-code` pre-approving no writes); `affects-lookup` called with an object id, never a path; the INDEX rebuilt only after new docs are staged (build-index lists tracked files); `settings.json → agents` ≡ the optional agents + SoD mode; agent and skill lists ≡ `agents/` and `skills/`; model pins in A.5 and CLAUDE.md ≡ the frontmatter; Python required; §2 walks every template file and the unsuffixed ones carry no `{{VAR}}`; no per-stack variants; CI is a corpus gate, not a code review; `scripts/corpus.config.mjs` by its real path; `log_session` is a runtime file; the kb-curator runs at a Transitory close only with a report, spec or review |
| `consistency/vocab.test.mjs` | one verdict vocabulary across config, rules, the four review templates, skills and agents; the activity-log contract (`/log-activity` table ≡ `EVENTS`, example line ≡ `LOG_FIELDS`, `LOG_AGENTS` ≡ the plugin's agents + `human` ≡ the skill's list, `pm.md` events ⊆ `EVENTS`); one truth per format (`/new-doc`'s table ≡ `docs/_templates/`, every `docs/claude_tasks/` path named anywhere is a `/new-doc` destination, no agent or skill restates a templated document, templates carry the sections their protocols need, DE checklist ≡ report template, the teammate rule is pointed to and not restated, the basic-memory caveat lives once); task tiers (pm.md ≡ FRAMEWORK.md ≡ `TIER_ENUM` ≡ spec template); the session start is three steps and two reads; the retired hooks (post-commit, pre-push) and `/log-tracker` stay retired; every agent `pm.md` names exists; agent/skill frontmatter; `hooks.json`; versions |

Fixtures are rendered into `tests/.tmp/` (gitignored) on every run. Subprocesses get a scrubbed environment
(`LINEAR_*`, `CLAUDE_*`, `DESTRUCTIVE_GUARD_*` removed) so a developer's own keys never leak into a test.
The Python hooks need `python` or `python3` on PATH; the detector test needs no network.
