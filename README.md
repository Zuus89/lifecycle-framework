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
/plugin marketplace add Zuus89/lifecycle-framework
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
- **Python 3** on PATH as `python` — **required**: the plugin's two guard hooks are Python and run on every
  Bash/PowerShell call (destructive-command guard) and every Linear issue/project write (filing guard). Without it
  each of those calls reports a hook error and the guards do nothing.
- **MCP servers**: none required by default — the markdown corpus (chronicle + snapshot + knowledge base + INDEX)
  *is* the memory; `basic-memory` is an opt-in backend at init. `/lifecycle-init` wires the project's MCPs
  **per repo at `local` scope** (never user-global): the tracker (Linear or Atlassian), plus only the stack MCPs
  the project needs (Slack, Vercel, Supabase or Neon) — all official remote OAuth endpoints, no tokens in files.
  Databricks connects via CLI/profiles, not MCP.

---

## How it works — the two-tier model

- **Tier A — plugin-resident** (agents, skills, hooks): installed **once**, available in **every** project
  automatically. Never copied per project.
- **Tier B — project-scaffolded** (`.claude/CLAUDE.md`, the `docs/` governance tree, `settings.json`, rules, husky, CI,
  corpus scripts): written into **each** project by `/lifecycle-init` from bundled templates.

### What the plugin ships (Tier A)

- **Agents** — `pm`, `de`, `da`, `code-reviewer`, `devils-advocate` (core); `kb-curator` (on by default — folds
  the session's durable knowledge into `docs/knowledge_base/` at `/close-task`) and `linear-steward` (opt-in,
  Linear only — keeps the ticket's Linear project to the Initiative → Project → Issue taxonomy: structural fields
  only, proposals for the rest, a whole-workspace sweep only on request).
- **Skills** — `/lifecycle-init`, `/close-task`, `/log-activity` (one logger; `--tracker` at milestones), `/council`,
  `/new-doc`, `/audit-corpus` (`--archival` adds a proposal-only archival manifest), `/dead-code` (read-only
  dead-code hunt; deletes only on approval), `/handshake` (two-machine work transfer — synced-folder or git-remote
  transport).
- **Hooks** — a destructive-command guard and a Linear filing guard (both always on: no issue without a project, no
  project outside exactly one initiative), plus an opt-in Linear hygiene detector at session start
  (`agents.linear_steward`, scoped to the repo's project). **MCP** — none by default (empty `.mcp.json`; the corpus — chronicle +
  snapshot + knowledge base + INDEX — is the knowledge graph; `basic-memory` opt-in at init).
- **Tests** — the plugin's own safety net: `npm install && npm test` (`tests/`, Node 24 + Python 3, under 10 s)
  exercises the hooks, the scaffolded corpus engine, every template, and the vocabularies that several files must
  agree on. CI runs it on every PR.

### What `/lifecycle-init` scaffolds (Tier B)

`.claude/CLAUDE.md` (the operating contract — always inside `.claude/`, never the repo root); a `docs/` tree
(`strategy.md`*, `architecture.md`*, `project_chronicle.md`†, `context_snapshot.md`, `activity_log.jsonl`†,
`INDEX.md`+`index.json`, `_templates/`, `claude_tasks/{alpha_tests/, reviews/, reports/, council/, handoffs/,
archive/}`, `audits/`, `knowledge_base/`); `TODO.md`*; `.claude/` (`settings.json`, `.local/secrets.env`, `rules/*`);
`.gitignore`, `.gitattributes`, `.mcp.json`, `package.json`; `.husky/pre-commit`;
`.github/workflows/lint-frontmatter.yml`; the corpus engine in `scripts/` (with `scripts/corpus.config.mjs`). *(\* protected, † append-only.)* One template set
serves every stack.

---

## `/lifecycle-init` — the interview

1. **Project identity** (for `CLAUDE.md`): name, goal, stack (`web | data | generic`), language, the optional
   agents and the separation-of-duties mode. The agents' models are recorded from their plugin pins, not chosen.
2. **Initial documentation?** — optionally seed `docs/knowledge_base/` from docs you provide, then `/audit-corpus`.
3. **Connections** — each detects what already exists before asking:
   - **MCP scope** — `local` by default (announced, per repo, never user-global, never claude.ai connectors).
   - **Git** — confirm the repo / remote / working branch (1 ticket = 1 branch = 1 PR), or guide creating one.
   - **Tracker** — detect Linear/Jira, confirm or choose, wire its MCP at the recorded scope, then connect to
     the project/epic/ticket this repo lives under.
   - **Databricks** (data stack) — detect `~/.databrickscfg` profiles, choose envs (dev/qa/prod) and warehouses
     (CLI/profiles — not an MCP).
   - **Stack MCPs** — only what the project needs: Slack (asked, default no), Vercel (web + Vercel deploy
     detected), Supabase or Neon (per the project's database). All official remote OAuth endpoints.
   - **Handshake transport** — `auto` (synced-folder vs git-remote, for `/handshake`).

It then writes the Tier-B files, bootstraps the toolchain (git, npm, husky, the Agent Teams flag), wires and
verifies the project's MCP servers at the recorded scope, and is
idempotent (re-runnable; never clobbers protected, append-only, or `.local` files).

---

## The lifecycle (1–10) — one session = one task, Brief → Close

1 **Brief** (Human) · 2 **Data analysis** (DA) · 3 **Spec expanded** (PM) · 4 **Alpha test** (DA) ·
5 **Spec reviewed** (DE + devils-advocate) · 6 **Resolve / freeze** (PM) · 7 **Implementation** (DE; code-reviewer
gate) · 8 **Review** (PM + DA runs the frozen test) · 9 **Validation** (Human) · 10 **Close** (PM).

**Bias control:** the acceptance test is written before the code (Step 4), frozen before implementation (Step 6),
and run against a result it could not influence (Step 8). Full definitions in **[`FRAMEWORK.md`](FRAMEWORK.md)**.

---

## Upgrading to 0.3

Update the plugin on each machine, then re-run the scaffolder in every project:

```
/plugin marketplace update lifecycle-framework
/plugin update lifecycle-framework@lifecycle-framework
/lifecycle-init
```

`/lifecycle-init` detects the existing scaffold and runs in update mode. What changes in a project:

- **New files:** `.claude/rules/teammate.md` and `docs/_templates/analysis.md`.
- **Changed templates:** the spec gains `tier:` (S, M or L); the context snapshot gains its new sections; the
  search-first rule now holds the whole pre-edit impact check.
- **Retired files:** update mode lists the files earlier versions scaffolded and this one no longer ships (the old
  commit-logging and pre-push hooks) and offers to delete them. The single hook is `.husky/pre-commit`.
- **`settings.json → agents`:** keep `kb_curator`, `linear_steward` and `separation_of_duties_mode`. Drop
  `corpus_steward`, `scout`, `dead_code_cleanup` and `data_reviewer`. A project with `data_reviewer: true` sets
  `separation_of_duties_mode` to `strict` instead.
- **Folded agents:** the archival sweep is `/audit-corpus --archival`, the dead-code hunt is `/dead-code`, the
  pre-edit blast radius is the search-first rule, and strict separation of duties is a second, fresh `da`.

---

## License

MIT.
