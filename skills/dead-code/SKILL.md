---
name: dead-code
description: "Hunt and report dead code — unused functions/classes, unused imports, orphaned files (nothing imports them), dead endpoints/routes, stale TODO/FIXME/HACK comments — after a major refactor, after replacing a component, or as periodic code-health hygiene. Read-only by default: it classifies every finding as Confirmed / Suspicious / False-positive with evidence, and deletes code only when the user explicitly approves, then re-runs the build, the linter and the tests. Triggers: /dead-code, \"find dead code\", \"unused code\", \"código muerto\", \"limpia código sin uso\"."
allowed-tools: Read, Grep, Glob
---

# dead-code

Find dead code with the stack's own tooling plus grep, classify every finding by confidence, and report. **Read-only
by default — a scan is never a license to delete.** Deletion happens only on the user's explicit approval ("remove the
confirmed dead code"), and then only for Confirmed findings.

- **When in doubt, downgrade.** Any ambiguity → *Suspicious*, never *Confirmed*. A wrong "Confirmed" that gets deleted
  costs far more than a missed one.
- **Evidence or Suspicious.** Every Confirmed finding carries the search that proves zero references across the full
  scope.
- **No pre-approved writes.** The skill pre-approves only Read, Grep and Glob: running the stack's tools and every
  deletion go through the project's permission settings.
- **Stack-aware.** Read the stack and the source directories from `.claude/CLAUDE.md` and `.claude/settings.json`;
  never assume a language or a layout. A scope the user names (a directory, a module) wins over the default.

## 1. Find candidates

Prefer the language's native dead-code tooling; grep is the fallback. A menu, not a script:

| What | JS / TS | Python | Go / Rust / other |
|---|---|---|---|
| Unused imports | `eslint` (`no-unused-vars`), `tsc --noUnusedLocals` | `ruff check --select F401`, `vulture --min-confidence 80` | `staticcheck` (U1000) · `cargo build` warnings · the linter's unused rule |
| Unused symbols | `knip`, `ts-prune` | `vulture` | `staticcheck` U1000 · `cargo` `dead_code` |
| Unused dependencies | `depcheck`, `knip` | — | `cargo +nightly udeps` |

For every symbol candidate, confirm with a repo-wide reference search (exclude the declaration and comments).
**Orphaned files:** source files (not entry points, `__init__`/`index` barrels) that no other file imports or
references. **Dead endpoints:** registered routes/handlers with no caller in the codebase or its API clients — at most
Suspicious unless provably unreachable. **Stale comments:** `grep -rn "TODO\|FIXME\|HACK\|XXX"`; one is stale only when
it points at work the tracker or `docs/project_chronicle.md` shows as done — otherwise list it as unverified.

## 2. Filter false positives (always, before calling anything Confirmed)

Framework-registered handlers (routes, decorators, event handlers, CLI commands, scheduled jobs) · serialization/ORM
models instantiated by a framework · entry points and re-exporting barrels · dynamic or reflective references
(string imports, dependency injection, `getattr`, config-driven loading) · config files and test fixtures · build and
tooling hooks, generated code · a symbol used only by tests or mocks (Suspicious, never Confirmed) · **public API of
a library** (exported for external consumers — Suspicious at most).

## 3. Report (read-only)

Report in chat, in the project's communication language:

```
Dead-code scan — YYYY-MM-DD · scope: <dirs> · stack/tools: <…>
Confirmed dead (safe to remove):   file:line · symbol · kind · evidence ("0 refs in <scope>; not an entry point")
Suspicious (human decision):       file:line · symbol · kind · why it might be alive
False positives (verified alive):  file · symbol · why alive
Stale comments:                    file:line · comment · reference · stale | unverified
Dead endpoints:                    file:line · route/handler · why no caller
Summary: N confirmed · M suspicious · K false positives · P stale comments
Recommendation: <what is safe to remove, what needs a decision>
```

Then stop and wait. Do not delete anything unprompted.

## 4. Cleanup — only on explicit approval

1. Remove **Confirmed** findings only; never Suspicious or False-positive ones. Minimal, surgical deletions — no
   refactoring around them.
2. Re-run the build, the linter and the test suite (commands in `.claude/CLAUDE.md`), and the reference searches for
   every removed symbol.
3. Report exactly what was removed (file, line range, symbol) and the validation result. Any failure → stop, report,
   and revert that deletion; no further fixes.
4. Production code changed → the code-reviewer gate applies before the commit, as for any code change.

## Boundaries

Report, and delete only on approval. Never refactor, rename or restructure; never delete framework-registered
handlers, entry points or public API without the user confirming they are unused. Not a code review and not an
architecture call — surface the evidence; the human decides.
