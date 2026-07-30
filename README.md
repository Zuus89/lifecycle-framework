# Lifecycle Framework — Claude Code Plugin

A disciplined way to build software with an AI team. The plugin packages a **role-specialized team** that runs **one
task at a time** through a fixed **ten-step lifecycle**, with **every step logged** and project state always
recoverable from files. Install it once, run **`/lifecycle-init`** in any repo, and the whole governance layer is
scaffolded.

> See **[`FRAMEWORK.md`](FRAMEWORK.md)** for the canonical definitions: every scaffolded document, the lifecycle, and
> every role.

---

## Install

```
/plugin marketplace add celtonchamberlain/lifecycle-framework
/plugin install lifecycle-framework@lifecycle-framework
```

Then, inside a repository (ideally a working branch of a repo with CI/CD):

```
/lifecycle-init
```

## Prerequisites

- **Agent Teams** enabled — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (the scaffolder writes it into the project's
  committed `settings.json`). Without it the orchestration collapses to a single agent.
- **Git** repository, **Node 24+** with `npm` (the scaffolder runs `npm install` + `husky`).
- **Python** on PATH (only if the destructive-command guard hook is enabled).
- **MCP servers**: none required by default — the markdown corpus (chronicle + snapshot + knowledge base + INDEX)
  *is* the memory; `basic-memory` is an opt-in backend at init. `github` + your tracker (Linear or Atlassian for
  Jira) — `/lifecycle-init` verifies they are present at the scope you choose.

---

## How it works — the two-tier model

- **Tier A — plugin-resident** (agents, skills, the safety hook, MCP): installed **once**, available in **every**
  project automatically. Never copied per project.
- **Tier B — project-scaffolded** (`CLAUDE.md`, the `docs/` governance tree, `settings.json`, rules, husky, CI,
  corpus scripts): written into **each** project by `/lifecycle-init` from bundled templates.

### What the plugin ships (Tier A)

- **Agents** — `pm`, `de`, `da`, `code-reviewer`, `devils-advocate` (core); `corpus-steward` and `kb-curator`
  (on by default — the kb-curator folds every session's durable knowledge into `docs/knowledge_base/` at
  `/close-task`), `data-reviewer` / `scout` / `dead-code-cleanup` (optional).
- **Skills** — `/lifecycle-init`, `/close-task`, `/log-activity`, `/log-tracker`, `/council`, `/new-doc`,
  `/audit-corpus`, `/handshake` (two-machine work transfer — synced-folder or git-remote transport).
- **Hook** — a destructive-command guard. **MCP** — none by default (empty `.mcp.json`; the corpus — chronicle +
  snapshot + knowledge base + INDEX — is the knowledge graph; `basic-memory` opt-in at init).

### What `/lifecycle-init` scaffolds (Tier B)

`CLAUDE.md`; a `docs/` tree (`strategy.md`*, `architecture.md`*, `project_chronicle.md`†, `context_snapshot.md`,
`activity_log.jsonl`†, `INDEX.md`+`index.json`, `_templates/`, `claude_tasks/{spec, alpha_tests/, reviews/, reports/,
council/, handoffs/, archive/}`, `audits/`, `knowledge_base/`); `TODO.md`*; `.claude/` (`settings.json`, `.local/secrets.env`,
`rules/*`, `log_session`); `.husky/`; `.github/workflows/`; the corpus-script engine. *(\* protected, † append-only.)*

---

## `/lifecycle-init` — the interview

1. **Project identity** (for `CLAUDE.md`): name, goal, stack (`web | data | generic`), language, model policy,
   agent roster.
2. **Initial documentation?** — optionally seed `docs/knowledge_base/` from docs you provide, then `/audit-corpus`.
3. **Connections** — each detects what already exists before asking:
   - **Git** — confirm the repo / remote / working branch (1 ticket = 1 branch = 1 PR), or guide creating one.
   - **Tracker** — detect Linear/Jira, confirm or choose, then connect to the project/epic/ticket this repo lives under.
   - **Databricks** (data stack) — detect `~/.databrickscfg` profiles, choose envs (dev/qa/prod) and warehouses.

It then writes the Tier-B files, bootstraps the toolchain (git, npm, husky, the Agent Teams flag), and is
idempotent (re-runnable; never clobbers protected, append-only, or `.local` files).

---

## The lifecycle (1–10) — one session = one task, Brief → Close

1 **Brief** (Human) · 2 **Data analysis** (DA) · 3 **Spec expanded** (PM) · 4 **Alpha test** (DA) ·
5 **Spec reviewed** (DE + devils-advocate) · 6 **Resolve / freeze** (PM) · 7 **Implementation** (DE; code-reviewer
gate) · 8 **Review** (PM + DA runs the frozen test) · 9 **Validation** (Human) · 10 **Close** (PM).

**Bias control:** the acceptance test is written before the code (Step 4), frozen before implementation (Step 6),
and run against a result it could not influence (Step 8). Full definitions in **[`FRAMEWORK.md`](FRAMEWORK.md)**.

---

## License

MIT.
