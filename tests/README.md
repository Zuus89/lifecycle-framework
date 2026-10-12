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
| `corpus/engine.test.mjs` | `validate-frontmatter.mjs` and `build-index.mjs` over a rendered fixture project; `log-commit-activity.mjs` in a throwaway git repo writes exactly `LOG_FIELDS` |
| `scaffold/render.test.mjs` | every file under `data/templates/` renders with dummy vars: valid JSON/YAML, importable `corpus.config.mjs`, zero unresolved `{{VAR}}` |
| `consistency/vocab.test.mjs` | one verdict vocabulary across config, rules, templates, skills and agents; the activity-log contract (`/log-activity` table ≡ `EVENTS`, example line ≡ `LOG_FIELDS`, `pm.md` events ⊆ `EVENTS`); `/log-tracker` retired for good; every agent `pm.md` names exists; agent/skill frontmatter; `hooks.json` scripts and matchers; plugin/marketplace versions |

Fixtures are rendered into `tests/.tmp/` (gitignored) on every run. Subprocesses get a scrubbed environment
(`LINEAR_*`, `CLAUDE_*`, `DESTRUCTIVE_GUARD_*` removed) so a developer's own keys never leak into a test.
The Python hooks need `python` or `python3` on PATH; the detector test needs no network.
