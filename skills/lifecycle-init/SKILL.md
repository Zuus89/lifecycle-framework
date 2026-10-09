---
name: lifecycle-init
description: Use this skill to set up a project's governance layer after installing the Lifecycle Framework plugin. Runs a fixed interview (project identity for CLAUDE.md, optional knowledge-base seeding, then Connections — Git, tracker, Databricks), detecting what is already connected before asking, then writes every Tier-B file from the bundled templates, bootstraps the toolchain (git, npm, husky, the Agent Teams flag), and wires/verifies the MCP servers. Designed primarily to run INSIDE an already-cloned repo (a working branch in a CI/CD repo), and re-runnable to update config; never clobbers protected, append-only, or .local files. Trigger when the user says "set up the framework", "lifecycle-init", "scaffold this project", "initialize the team framework", or wants the governance corpus created in a repo.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /lifecycle-init — Set up a project from the Lifecycle Framework

You turn a repository into a fully governed Lifecycle-Framework project: run a short, **fixed-order** interview,
then write every **Tier-B** file from the bundled templates, bootstrap the toolchain, and wire the connections.
You do NOT copy agents/skills/hooks — those are **Tier-A** (plugin-resident) and read this project's config at runtime.

> **Primary scenario:** this usually runs **inside an already-cloned repo** — often a working branch of a repo that
> already has CI/CD. So the Connections phase **detects and confirms what already exists** before offering to create
> anything. Creating a fresh repo is the fallback, not the default.

> **Two-tier rule (never violate it):** Tier-A files (`agents/*.md`, `skills/**`, `hooks/*`) are
> installed once with the plugin and read config (tracker, stack, models) at runtime — they contain **no**
> `{{TEMPLATE_VARS}}`. Tier-B files (everything you write here, sourced from `${CLAUDE_PLUGIN_ROOT}/data/templates/`)
> ARE templated: substitute every `{{VAR}}` and strip the `.template` suffix. Never write a `{{VAR}}` into a
> scaffolded file; never leave a `.template` suffix on an output file.

The template root is **`${CLAUDE_PLUGIN_ROOT}/data/templates/`**. All output paths are relative to the **target
project root** (the current working directory). All user-facing prose follows the project's communication language
(default: Spanish to the user); file contents, code, comments, and docs are English.

---

## 0. Pre-flight — detect the environment (don't act yet, just record)

Run these read-only probes and record the results; you will use them in the interview so you can **confirm rather
than ask blindly**.

1. **Target directory.** State the absolute CWD and confirm it is the project root to set up.
2. **Prior run (idempotency).** Check for `.claude/CLAUDE.md` (or the **legacy root** `CLAUDE.md` — earlier
   scaffolds wrote it there), `corpus.config.mjs`, `.claude/settings.json`. If any exist → **update mode**
   (re-run pre-filled, prompt before overwriting; §7 governs protection). Else → **fresh scaffold**.
   **Legacy-location migration:** if a root `CLAUDE.md` exists and `.claude/CLAUDE.md` does not, offer
   `git mv CLAUDE.md .claude/CLAUDE.md` — the canonical home is INSIDE `.claude/` (both locations are
   auto-loaded by Claude Code, but the framework standardizes on `.claude/CLAUDE.md`; never leave two copies).
3. **Templates.** Verify `${CLAUDE_PLUGIN_ROOT}/data/templates/` exists; list its tree once. If missing, stop — the
   plugin install is broken.
4. **Toolchain.** `git --version`, `node --version` (need 24+), `npm --version`, and `python --version` (only needed
   if the destructive hook's stack patterns are enabled). Record gaps.
5. **Git context** (for C.1): `git rev-parse --is-inside-work-tree`, `git remote -v`, `git branch --show-current`,
   `git config user.name`, `git config user.email`, `git status --porcelain` (clean/dirty), and whether
   `.github/workflows/` already exists (pre-existing CI). **Also enumerate the connected git accounts** — the user
   may have several (work + personal): `gh auth status` lists every authenticated GitHub account and which is
   **active**; also note `git config --get credential.helper`. Record all accounts + the active one.
6. **Connected tracker MCP** (for C.2): run `claude mcp list` from the repo root and record which tracker
   servers exist and **at which scope** (`linear` / `atlassian` at local, project, or user). Session-visible
   tools prefixed `mcp__claude_ai_*` are **account-level claude.ai connectors — they do NOT count** as a wired
   tracker (they are global to the account, exactly what this framework avoids depending on). Record the server
   name + scope, or "none". Also note (informationally) which tracker the connectors suggest the user works with.
   In **update mode**, additionally read the existing `.claude/settings.json → mcp` block (scope + servers) —
   C.5 seeds from it.
7. **Databricks config** (for C.3): check for `~/.databrickscfg` and list the profile names it defines (e.g.
   `dev`, `qa`, `prod`, `global_data_and_analytics`). Record them; do not read secrets.
8. **Cloud-synced folder** (for C.4): note whether the CWD path lies inside a sync client's folder (path contains
   `OneDrive`, `Dropbox`, or `Google Drive`). Record the finding — it drives the `/handshake` transport default.

Then run the interview in **exactly this order**: A → B → C. Echo each captured value before moving on.

---

## A. Information for `CLAUDE.md` (project identity)

1. **Project name** → `{{PROJECT_NAME}}`; derive `{{PROJECT_SLUG}}` (lowercase, non-alphanumeric → `_`, collapsed).
   The slug **must be unique across the user's projects** (it identifies the project — and, if `basic-memory` is
   enabled, its notes folder). Confirm it.
2. **One-line goal** → `{{PROJECT_GOAL}}`.
3. **Stack** → `{{STACK}}` (`web | data | generic`). Selects the CLAUDE.md / architecture / CI variant and stack MCP
   guidance. **If `data`, default Databricks ON in C.3.** If unsure, `generic`.
4. **Communication language** (default: Spanish to the user, English for code/docs) → `{{COMM_LANGUAGE}}`.
5. **Model policy — confirm all-Opus defaults**, ask only for overrides:

   | Role | Default | Var |
   |------|---------|-----|
   | pm | session model (no pin — Opus via `/model`) | `{{MODEL_PM}}` = `session (Opus via /model)` |
   | de | `claude-opus-4-8` | `{{MODEL_DE}}` |
   | da | `claude-opus-4-8` | `{{MODEL_DA}}` |
   | code-reviewer | `claude-opus-4-8` | `{{MODEL_CODE_REVIEWER}}` |
   | devils-advocate | `claude-opus-4-8` | `{{MODEL_DEVILS_ADVOCATE}}` |

   (Optional agents are fixed by policy: `corpus-steward`/`scout`/`dead-code-cleanup` = `sonnet`, `data-reviewer` =
   `claude-opus-4-8`, `kb-curator` and `linear-steward` = `claude-opus-5`. Their pins live in the Tier-A agent
   frontmatter; here you only document the policy.)
6. **Agent roster.** Core five always on. Toggles: `corpus-steward` **ON** by default; `kb-curator` **ON** by
   default (at-close KB curation on every `/close-task` variant — writes only `docs/knowledge_base/`);
   `data-reviewer` OFF (ON sets `separation_of_duties_mode = strict`); `scout` OFF; `dead-code-cleanup` OFF;
   `linear-steward` OFF (offer it only when the tracker is Linear — it keeps this repo's project, and at close the
   closing ticket's project, to the Initiative → Project → Issue taxonomy, structural fields only, never the whole
   workspace unless asked; ON needs `LINEAR_API_KEY` in `.claude/.local/secrets.env` for the SessionStart hygiene
   detector, while the agent itself uses the Linear MCP; the detector reads the project from `tracker.project`).
   Record the enabled set + SoD mode — **they are written to the `agents` block of `.claude/settings.json`**, the
   machine-readable roster that `/close-task` and the PM read at runtime. (Re-running init on a project scaffolded
   before this block existed simply ADDS it.)
7. **Memory backend** → `{{MEMORY_BACKEND}}` (`corpus | basic-memory`). **Default `corpus`** — there is **no memory
   MCP**: the project's markdown corpus *is* the knowledge graph (chronicle + snapshot + knowledge base + INDEX +
   `affects-lookup`).
   Recall = read `project_chronicle.md` + `context_snapshot.md` + `docs/knowledge_base/` (topic articles) + the
   INDEX, then grep / `affects-lookup` for a topic;
   record = write to the corpus (task report, reviews, and the chronicle via `/close-task`). Opt-in `basic-memory`
   adds an MCP over the repo's own Markdown (notes in `docs/memory/`); the corpus stays the source of truth either
   way. If the user picks `basic-memory`, honor the §6.4 enablement steps at scaffold time.

---

## B. Initial documentation → knowledge base

Ask: **"Do you have initial documentation you want to seed the project with?"**

- **Yes:** the user gives file/folder paths. Copy them into `docs/knowledge_base/` (preserve filenames). Record as
  `knowledge_base_seed`. After the scaffold + toolchain are up (§5–§6), run **`/audit-corpus`** so the seeded docs get
  valid frontmatter and are indexed.
- **No:** create `docs/knowledge_base/` with a `.gitkeep`.

Never invent knowledge-base content; only copy what the user supplies.

---

## C. Connections — MCP scope → Git → Tracker → Databricks

This is where the project is wired to the outside world. For **each** connection: **report what you detected in
pre-flight, ask the user to confirm or change it, and only then guide creation if nothing exists.**

### C.0 — MCP scope (set ONCE — default `local`; applies to every MCP server this init wires)

Claude Code stores MCP servers at three usable scopes (plus IT-managed `managed-mcp.json`), with documented
precedence **local > project > user** — the winning entry replaces the whole definition, fields are never merged
(https://code.claude.com/docs/en/mcp — Installation scopes / Scope hierarchy):

| Scope | Lives in | Official guidance |
| --- | --- | --- |
| `local` (CLI default) | `~/.claude.json` → this project's entry | personal servers, experimental configs, credentials you don't want in version control |
| `project` | `.mcp.json` at repo root (committed) | team collaboration — same servers for everyone; **no secrets**, use `${VAR}` / `${VAR:-default}` env expansion (officially supported in `command`/`args`/`env`/`url`/`headers`) |
| `user` | `~/.claude.json` root level | personal utilities you use across all projects on this machine |

1. **Detect multi-identity signals** from pre-flight: ≥2 accounts in `gh auth status`, and/or multiple
   tracker/Atlassian identities already configured across `~/.claude.json` projects.
2. **Default: `local` — do not ask, announce it.** The framework wires every project MCP at **`local` scope**:
   the server lives in THIS project's entry in `~/.claude.json`, confined to this repo — nothing bleeds into
   other projects, other clients' sessions, or the machine's global config, and nothing depends on
   account-level claude.ai connectors. Override only if the user **explicitly** requests it:
   - `project` — team repo where every teammate should inherit the same servers: committed `.mcp.json`, **no
     secrets**, `${VAR}` indirection; approval flow via `enabledMcpjsonServers` / trust dialog.
   - `user` — single-identity machine, personal tooling used everywhere. **Never assume it.**
3. Record → `{{MCP_SCOPE}}` **and write it into committed config — `.claude/settings.json` → `"mcp": { "scope":
   … }`** — so `/handshake in` can re-verify the servers at the right scope on the user's other machine. Apply it
   to **every** server this init wires (tracker in C.2, the C.5 stack catalog, `basic-memory` stays
   project-scoped by design — §6.4). Note the choice in `mcp-usage`/`CLAUDE.md` so future sessions know where
   servers live.
4. **Never assume `user`/global.** If the user later needs the same server elsewhere, re-running init there (or
   `claude mcp add` in that project) is the supported path.

### C.1 — Git (the repo this framework runs in)

Goal: end up on a **working branch of a repo with a remote** (the CI/CD target), with a configured git identity.
Use the pre-flight git context.

- **Already a repo with a remote (the common case):** report `origin` URL, current branch, and git identity. Ask:
  **"Run the framework here, on this repo + branch?"**
  - Derive `{{GITHUB_REPO}}` (origin URL), `{{GIT_HOST}}` (github/gitlab/bitbucket from the URL), `{{GIT_BRANCH}}`
    (current), `{{GIT_DEFAULT_BRANCH}}` (`git symbolic-ref refs/remotes/origin/HEAD` or ask).
  - **If the current branch is the default (`main`/`master`):** warn — the framework works on a feature branch
    (1 ticket = 1 branch = 1 PR). Offer to create/checkout a working branch (named from the start ticket once C.2 is
    done, e.g. `feat/<key>-<slug>`). Don't force it; record the choice.
  - **Pre-existing CI:** if `.github/workflows/` already exists, do **not** clobber it — in §2 add
    `lint-frontmatter.yml` alongside the existing workflows and tell the user.
  - **Dirty tree:** if `git status` is dirty, note it; the scaffold adds files — make sure that's expected.
- **A repo with NO remote:** ask whether to add one (`git remote add origin <url>`) — needed for CI/CD and PRs — or
  proceed local-only (note husky works, but CI/PR review won't).
- **Not a repo:** offer, in order of preference for the CI/CD goal:
  1. **Point at / clone an existing remote** — if the user wants the framework in an existing project, they should
     run init **inside that clone**; offer the exact `git clone <url>` + `cd` to run first, then re-invoke init.
  2. **`git init` a new repo here** + optionally `git remote add origin <url>` (and `gh repo create` if `gh` is
     authenticated).
  3. **Proceed without git** — discouraged: husky hooks, the INDEX-freshness gate, post-commit logging, and the
     `lint-frontmatter` CI all need a git repo. Warn explicitly.
- **Git identity:** if `user.name`/`user.email` are unset, set them (ask) — commits and the activity log need them.
- **Pick the right git account — the user may have several connected.** Parse the **remote owner** from the origin
  URL (`github.com/<owner>/…` or `git@host:<owner>/…`) and compare against the accounts from pre-flight
  (`gh auth status`):
  - **One match:** an account whose login equals the remote owner (or is a member/admin of the owner org) is the one
    to use. If `{{GIT_HOST}} = github` and it is **not** the active account, switch to it **for this repo**:
    `gh auth switch --user <account>` then `gh auth setup-git`. **Record the previously-active account and restore it
    in §8** — never leave the user's global `gh` state changed after init.
  - **Record the selected login as `{{GIT_ACCOUNT}}`** → committed `settings.json` `git.account` (an identity, never
    a credential — the token stays in the credential helper). `/handshake in` compares `gh auth status` on the
    user's other machine against this value. If `{{GIT_HOST}}` is not github or no account applies, record `""`.
  - **Several candidates / ambiguous:** show the accounts and ask which to use for this remote (default: the one
    matching the owner).
  - **No account can reach the remote:** the user is authenticated but none can push here — say so and offer
    `gh auth login` (or add) the right account before continuing.
- **Use the token from where it already lives — never hardcode it.** Local pushes use **the selected account's
  credential** via gh's credential helper / the system credential store — you do NOT copy the git token into
  `settings.json` or any committed file. Only if the project itself needs the GitHub API (the `github` MCP, or a
  script) fetch it from the correct account — `gh auth token --user <account>` — and write it as `GITHUB_TOKEN` into
  the gitignored `.claude/.local/secrets.env`. For non-GitHub hosts (gitlab/bitbucket), rely on the configured git
  credential helper for the matching account; same rule — read from the credential store, never inline it.
- **`gh` availability:** if `{{GIT_HOST}} = github` and no authenticated account can reach the remote, flag it —
  Step-8 PR review and the `github` MCP depend on it.

### C.2 — Tracker (where tickets live)

Use the pre-flight detection of the connected tracker MCP.

1. **Confirm or choose the tracker:**
   - If exactly one is wired (pre-flight found `linear` or `atlassian` via `claude mcp list`): **"I detected <X>.
     Use <X> for this project?"** Confirm or switch. → `{{TRACKER}}`.
   - If both are wired: ask which to use. If none is wired: ask `linear | jira | none`.
   - **Wire-at-scope is mandatory whenever `{{TRACKER}} ≠ none`:** if `claude mcp list` (from the repo root) does
     NOT show the tracker server at `{{MCP_SCOPE}}`, run the **C.5 catalog** command now — even if tracker tools
     are visible in-session (those may be account-level claude.ai connectors or another scope, and §6's
     verification would fail against them). OAuth completes via `/mcp`, no token in any file; for `project`
     scope write the server into `.mcp.json` instead (no secrets). The tracker's server name is **always**
     included in `{{MCP_SERVERS_JSON}}` when `{{TRACKER}} ≠ none`. `none` → local `TODO.md` only; skip the rest
     of C.2.
2. **Find what this repo connects to** (scope). Ask: **"Is this repo tied to a single ticket, or to a larger
   project/epic?"** Then resolve it concretely using the tracker MCP so you store real ids, not guesses:
   - **Linear:** `{{TRACKER_ORG}}` (workspace) + `{{TRACKER_TEAM}}` (team) + the **project or initiative** →
     `{{TRACKER_PROJECT}}` (use `list_projects` / `list_initiatives` to find and confirm the id/name) + ticket
     prefix → `{{TRACKER_KEY}}`. `{{TRACKER_CLOUD_ID}}` stays empty.
   - **Jira:** Atlassian site/cloud id → `{{TRACKER_CLOUD_ID}}` (use `getAccessibleAtlassianResources`) + the
     project key → `{{TRACKER_KEY}}` (also mirror into `{{TRACKER_PROJECT}}`; confirm via `getVisibleJiraProjects`) +
     the **epic** the repo lives under, if any → record as `start_epic`. `{{TRACKER_TEAM}}` empty unless team-managed.
   - Either tracker, optionally a specific **start ticket** → `start_ticket` (used to name the working branch in C.1
     and seed `TODO.md` / `context_snapshot.md`; not a template var). Validate it exists via the MCP.
3. **Token — only if a script needs the REST API.** The tracker MCP itself needs **no token** (OAuth via
   `/mcp`, per machine). Ask for a tracker API token ONLY if the project will call the tracker's REST API
   directly from scripts (outside the MCP); then write it into the **gitignored** `.claude/.local/secrets.env`
   (`LINEAR_API_KEY`, or `JIRA_API_TOKEN` + `JIRA_EMAIL`) — never into a committed file. The connection
   **identity** goes into committed `settings.json` + `corpus.config.mjs`; tokens never do.

### C.3 — Databricks (data stack)

Ask: **"Connect this project to Databricks?"** (default **yes** if `{{STACK}} = data`, else **no**). If no →
`{{DATABRICKS}} = off`, skip the rest. If yes → `{{DATABRICKS}} = on`:

1. **Profiles / environments.** From the pre-flight `~/.databrickscfg` profile list, report what's available and ask
   which environments this project uses — typically **dev / qa / prod** (and a default). Record:
   - `{{DATABRICKS_ENVS}}` = comma list of the envs in use (e.g. `dev,qa,prod`).
   - `{{DATABRICKS_PROFILE}}` = the default profile/env for everyday work (e.g. `dev`).
   - the host per env (read each profile's `host` from `~/.databrickscfg`) → store as a per-env map.
   - If `~/.databrickscfg` is absent, guide the user to create profiles (`databricks configure` / OAuth) before data work.
2. **Warehouses.** Ask for (or, if a profile authenticates, list via the SQL connector) the **SQL warehouse id per
   env**. Record them in a per-env map. (Warehouse ids are not secrets but per the user's rules must not be hardcoded
   in code — they live in config.)
3. **Where it goes:**
   - **`.claude/settings.json`** + **`corpus.config.mjs`** (committed): a `databricks` block, filled via the
     template vars — `{{DATABRICKS}}` (on/off), `{{DATABRICKS_ENVS}}`, `{{DATABRICKS_PROFILE}}`,
     `{{DATABRICKS_DEFAULT_HOST}}`, and the per-env maps `{{DATABRICKS_HOSTS_JSON}}` / `{{DATABRICKS_WAREHOUSES_JSON}}`.
     No tokens; no catalog names hardcoded in code.
   - **`.claude/.local/secrets.env`** (gitignored): `PYTHONIOENCODING=utf-8` (Windows Unicode), and any token only if
     the user is not using `~/.databrickscfg` profiles. Prefer profile-based auth (`databricks-sql-connector` +
     `w.config.authenticate()` for OAuth) over raw tokens — note this in `mcp-usage`/`CLAUDE.md`.
   - Note in `CLAUDE.md` (data stack): use `databricks-sql-connector` for local SQL; never hardcode catalogs/
     warehouse ids/workspace URLs; pick the env profile per task.

### C.4 — Handshake transport (two-machine work transfer)

From pre-flight item 8, report whether the repo lies inside a cloud-synced folder, then confirm
`{{HANDSHAKE_TRANSPORT}}` (`auto | synced-folder | git-remote`, default **`auto`**):

- **`auto`** (default) — `/handshake` decides at runtime: repo path inside a sync client's folder →
  `synced-folder`; else `git-remote`.
- **`synced-folder`** — the sync client (e.g. OneDrive) carries the working tree, the gitignored snapshot, and
  `.git/` itself between the user's machines; `/handshake` verifies sync completion, scans for conflict copies,
  and checks git integrity. **Warn once here:** `.git/` inside a synced folder on two machines carries a real
  corruption risk (objects synced mid-write, placeholder hydration, conflict copies on simultaneous use) —
  the handshake ritual mitigates it, it cannot eliminate it.
- **`git-remote`** — per-machine clones; `/handshake out` packs (WIP transport commit + handoff doc) and pushes.

### C.5 — Project MCPs (the stack catalog, wired at `{{MCP_SCOPE}}`)

Beyond the tracker (C.2), wire the MCPs this project actually needs — **detect before asking, install only what
is needed**, everything at the C.0 scope (default `local`), with every `claude mcp add` run **from the repo
root** (local scope binds to the CWD's project entry). All catalog servers are the providers' **official remote
endpoints with OAuth** — no token lands in any file; the user completes each auth via `/mcp` in-session, **per
machine** (local scope does not travel — `/handshake in` re-offers these exact commands on the other machine).

| Server | When | Command (official remote endpoint, OAuth) |
| --- | --- | --- |
| Tracker — Linear | `{{TRACKER}} = linear` (C.2) | `claude mcp add --transport http --scope local linear https://mcp.linear.app/mcp` |
| Tracker — Atlassian (Jira) | `{{TRACKER}} = jira` (C.2) | `claude mcp add --transport http --scope local atlassian https://mcp.atlassian.com/v1/mcp/authv2` |
| Slack | ask: "Does this project read/notify Slack?" — default **no** | `claude mcp add --transport http --scope local slack https://mcp.slack.com/mcp` (a workspace admin must have approved MCP access) |
| Vercel | only `{{STACK}} = web` AND the repo deploys on Vercel — detect `vercel.json` / `.vercel/`; if neither, don't even ask | `claude mcp add --transport http --scope local vercel https://mcp.vercel.com` |
| Supabase | the project's database is Supabase — detect `supabase/` dir, else confirm | `claude mcp add --transport http --scope local supabase https://mcp.supabase.com/mcp` |
| Neon | the project's database is Neon (mutually exclusive with Supabase — one DB backend per project) | `claude mcp add --transport http --scope local neon https://mcp.neon.tech/mcp` |

(For `{{MCP_SCOPE}} = project`, the same servers go into the committed `.mcp.json` instead; for `user`, swap the
`--scope` flag. The commands above are the default-`local` form.)

**Databricks is NOT an MCP.** Its connection is CLI/SDK-based via the profiles in `~/.databrickscfg` (C.3:
`databricks-sql-connector`, OAuth via `w.config.authenticate()`). Do not wire a Databricks MCP server.

Record the enabled set as a JSON array of the configured server names (e.g. `["linear", "slack", "supabase"]`) →
`{{MCP_SERVERS_JSON}}`, written to committed `.claude/settings.json` → `"mcp": { "servers": … }` — this is the
list §6 verifies here and `/handshake in` verifies on the user's other machine (`[]` when `tracker = none` and
no stack MCP applies). If an add command fails or an endpoint has moved, check the provider's MCP docs rather
than guessing — and record the correction in `mcp-usage.md` §0 so the repo carries the working command.

**Update mode (re-run on an already-scaffolded project): merge, never silently overwrite.** Seed the interview
from the existing `settings.json → mcp` block + the pre-flight `claude mcp list`: present explicit adds/drops
instead of re-asking from defaults (Slack's "default no" becomes "default: the previous answer"). On a confirmed
drop, offer the matching `claude mcp remove --scope {{MCP_SCOPE}} <name>` so the record and `~/.claude.json`
move together — never drop a server from `mcp.servers` while leaving it configured (orphan drift), and never
remove a configured server without the user confirming the drop.

After C, **echo a full summary** (all vars + roster + SoD mode + memory backend + the three connections +
handshake transport + the project MCP set) and get a single confirmation before writing anything.

---

## 1. Canonical template variables

Resolve all before substitution; use **exactly** these names:

| Var | Source |
|-----|--------|
| `{{PROJECT_NAME}}` / `{{PROJECT_SLUG}}` / `{{PROJECT_GOAL}}` | A.1 / A.1 derived / A.2 |
| `{{STACK}}` / `{{COMM_LANGUAGE}}` | A.3 / A.4 |
| `{{MODEL_PM}}` (=`session (Opus via /model)`) / `{{MODEL_DE}}` / `{{MODEL_DA}}` / `{{MODEL_CODE_REVIEWER}}` / `{{MODEL_DEVILS_ADVOCATE}}` | A.5 |
| `{{TRACKER}}` / `{{TRACKER_ORG}}` / `{{TRACKER_TEAM}}` / `{{TRACKER_PROJECT}}` / `{{TRACKER_KEY}}` / `{{TRACKER_CLOUD_ID}}` | C.2 |
| `{{GITHUB_REPO}}` / `{{GIT_HOST}}` / `{{GIT_BRANCH}}` / `{{GIT_DEFAULT_BRANCH}}` | C.1 |
| `{{GIT_ACCOUNT}}` | C.1 — the gh login selected for this remote (`""` when not github / not applicable) |
| `{{MCP_SCOPE}}` (`local\|project\|user`) | C.0 |
| `{{HANDSHAKE_TRANSPORT}}` (`auto\|synced-folder\|git-remote`, default `auto`) | C.4 |
| `{{MCP_SERVERS_JSON}}` | C.2 + C.5 — bare JSON array of configured server names (unquoted; `[]` when none) |
| `{{DATABRICKS}}` (`on\|off`) / `{{DATABRICKS_ENVS}}` (comma list) / `{{DATABRICKS_PROFILE}}` / `{{DATABRICKS_DEFAULT_HOST}}` | C.3 |
| `{{DATABRICKS_HOSTS_JSON}}` / `{{DATABRICKS_WAREHOUSES_JSON}}` | C.3 — JSON objects keyed by env (e.g. `{"dev":"...","prod":"..."}`); resolve to `{}` when `{{DATABRICKS}}=off` |
| `{{MEMORY_BACKEND}}` (`corpus\|basic-memory`, default `corpus`) | A.7 |
| `{{AGENT_CORPUS_STEWARD}}` / `{{AGENT_KB_CURATOR}}` / `{{AGENT_SCOUT}}` / `{{AGENT_DEAD_CODE_CLEANUP}}` / `{{AGENT_DATA_REVIEWER}}` / `{{AGENT_LINEAR_STEWARD}}` | A.6 — bare JSON booleans (`true`/`false`, unquoted); defaults `true, true, false, false, false, false` (`linear-steward` only offered when `{{TRACKER}} = linear`) |
| `{{SOD_MODE}}` (`collapsed\|strict`) | A.6 — `strict` iff `data-reviewer` is ON, else `collapsed` |
| `{{TODAY}}` | `date +%F` |

(`.mcp.json` expected contents by configuration: `{{MCP_SCOPE}} = local|user` + `corpus` backend → **empty**
(`{"mcpServers":{}}`) — the corpus is the knowledge graph, no memory MCP, and the wired servers live in
`~/.claude.json`, not here. `{{MCP_SCOPE}} = project` → it declares the tracker + C.5 catalog servers (official
remote endpoints, no secrets). `{{MEMORY_BACKEND}} = basic-memory` → additionally the `basic-memory` entry
(§6.4), whose `BASIC_MEMORY_HOME` is set literally via `${CLAUDE_PROJECT_DIR}`, per-project without a slug.)

Empty vars (e.g. tracker fields when `none`, Databricks fields when `off`) substitute to the empty string; ensure the
surrounding template line still reads correctly.

---

## 2. Write the Tier-B files (template substitution)

For every `*.template` under `${CLAUDE_PLUGIN_ROOT}/data/templates/`: read it, substitute every `{{VAR}}`, compute
the output path (same relative path under project root, `.template` stripped), create parent dirs, apply the §7
overwrite policy, write. Expected map: `.claude/CLAUDE.md` (stack-variant — **inside `.claude/`, never the repo
root**), `TODO.md` (protected), `.gitignore`, `.mcp.json` (expected contents per the §1 note — empty by default; project scope → the wired servers, **merge with, never overwrite, servers already written by `claude mcp add --scope project`**; basic-memory per §6.4);
`docs/{strategy.md,architecture.md}` (protected), `project_chronicle.md` (append-only, init entry `{{TODAY}}`),
`context_snapshot.md`, empty `activity_log.jsonl`, `_templates/*`, `claude_tasks/{alpha_tests,reviews,reports,council,archive,handoffs}`,
`audits/`, `knowledge_base/`, INDEX (autogen in §6); `.claude/{settings.json (committed, has Agent Teams env +
connections), .local/secrets.env (gitignored), rules/*, log_session}`; `.husky/{pre-commit,post-commit,pre-push}`;
`.github/workflows/lint-frontmatter.yml` (+ stack optionals, **alongside** any pre-existing CI); `scripts/*.mjs` +
`corpus.config.mjs` (scaffolded into the repo — husky/CI call them by relative path; `${CLAUDE_PLUGIN_ROOT}` does not
resolve there). If a template is absent, report it — don't fabricate.

---

## 3–4. Where connection config + secrets go

- **`.claude/.local/secrets.env`** (gitignored): `PYTHONIOENCODING=utf-8` (if Databricks), tracker REST token(s)
  **only if C.2.3's script-needs-the-API condition fired** (the tracker MCP is OAuth — no token) **or
  `agents.linear_steward` is ON** (`LINEAR_API_KEY` feeds the plugin's read-only SessionStart hygiene detector;
  the steward agent itself uses the MCP), and
  `GITHUB_TOKEN` **only if a script/MCP needs the GitHub API** (fetched from the selected account via
  `gh auth token --user <account>`) — git push itself uses the account's credential helper, not this.
- **Memory backend:** the default (`{{MEMORY_BACKEND}} = corpus`) has **no memory MCP** — the markdown corpus
  (`project_chronicle.md` + `context_snapshot.md` + `docs/knowledge_base/` + INDEX + `affects-lookup`) *is* the
  knowledge graph; the
  scaffolded `.mcp.json` is empty (`{"mcpServers":{}}`). There is no `memory.jsonl` to create. Only when the user
  opted into `basic-memory` (A.7) do you run the §6.4 enablement (verify uv/uvx + Python 3.12+; write `.mcp.json` +
  `docs/memory/` + `.bmignore`; gitignore the SQLite index; extend the allowlist).
- **`.claude/settings.json`** + **`corpus.config.mjs`** (committed): tracker **type + identity**, git remote/branch,
  the `databricks` block (envs/profile/host+warehouse map). **No secrets.**
- `{{TRACKER}} = none` → empty tracker identity, no token. `{{DATABRICKS}} = off` → no databricks block.

---

## 5. Bootstrap the toolchain

From the project root (print the exact command for the user if a step is blocked — never fail silently):

1. **Git.** Honor the C.1 decision: if not a repo and the user chose to create one, `git init` (+ `git remote add
   origin {{GITHUB_REPO}}` / `gh repo create` if chosen); if the user chose a new working branch, create/checkout it.
   Do nothing to an existing repo/remote beyond what C.1 confirmed.
2. **npm.** If `package.json` is **absent** → render `package.json.template`. If it **already exists** (the common
   already-cloned-repo case) → **merge, do not overwrite**: add the governance `devDependencies` (`js-yaml`, `husky`)
   and `scripts` (`lint:frontmatter`, `build:index`, and `prepare: "husky"` if absent) into the project's existing
   `package.json`, leaving its own fields untouched. Then `npm install` (installs husky + js-yaml) and commit the
   resulting `package-lock.json` (CI uses `npm ci`, which requires the lockfile).
3. **husky.** `npx husky install` (or `npm run prepare`); confirm `.husky/` hooks present + executable (`chmod +x`).
4. **Agent Teams flag.** Verify `.claude/settings.json` `env` has `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` — the
   **hard prerequisite** (a plugin can't set it). If missing, add it. Without it, orchestration collapses to one agent.

---

## 6. Build the index + verify connections/MCP

1. **Stage, then build INDEX.** `build-index.mjs` reads **git-tracked** files, so an unstaged scaffold indexes 0
   files. First `git add -A` (stage the scaffolded corpus), then `node scripts/build-index.mjs` → `docs/INDEX.md` +
   `docs/index.json`. **Commit order matters** — the `pre-push` hook rebuilds the INDEX and blocks on drift — so the
   first commit should be: `git add -A && npm run build:index && git add docs/INDEX.md docs/index.json && git commit`.
   (Init does not commit for the user unless asked; tell them this is the first commit to make.)
2. **Seed KB** (if §B had docs): run `/audit-corpus`.
3. **Verify connections:**
   - **Git:** remote reachable (`git ls-remote` if a remote is set), on the intended branch, identity set; `gh auth
     status` if GitHub.
   - **MCP:** confirm `.mcp.json` matches the expected contents for the recorded scope/backend (§1 note:
     local/user + corpus → empty; project → the wired servers; basic-memory → its entry, verified per §6.4) and
     that the corpus (chronicle + snapshot + knowledge base + INDEX) is in place; that *is* the knowledge graph.
     Then verify **every server in `settings.json → mcp.servers`** (the tracker + the C.5 catalog) **at
     `{{MCP_SCOPE}}` (C.0)**: run `claude mcp list` from the repo root — each must appear at the recorded scope
     with its OAuth completed (`/mcp` shows it connected). If one is absent, give the user the exact C.5
     command; flag, don't block. **Reverse check:** any server configured at the recorded scope but absent from
     `mcp.servers` is an orphan — offer to add it to the record or `claude mcp remove` it. Two extra checks:
     - **Shadowing (doc-backed):** if the same server name exists at more than one scope, warn which definition wins
       (precedence `local > project > user`, whole-entry override — a stale local entry silently masks the team's
       `.mcp.json`). Offer `claude mcp remove --scope <loser>` to clean up.
     - **Windows dual-casing (empirical, not in official docs):** with `{{MCP_SCOPE}} = local`, `~/.claude.json` may
       hold TWO entries for the same project differing only in drive-letter case (`c:/…` vs `C:/…`), and
       `claude mcp add` writes only the cwd's casing. Verify the server exists under **both** casings when both
       entries exist; mirror it into the missing one.
   - **Databricks** (if on): confirm the chosen profile authenticates (`databricks current-user me --profile
     {{DATABRICKS_PROFILE}}` or an SQL-connector ping); flag per-env gaps.

### 6.4 — Enable `basic-memory` (only if `{{MEMORY_BACKEND}} = basic-memory`)

Skip entirely for the default `corpus` backend. `basic-memory` is deliberately **project-scoped** (`.mcp.json`)
regardless of `{{MCP_SCOPE}}` — its storage lives inside the repo (`docs/memory/`), so the definition belongs with
the repo; the C.0 choice governs the *external* connections (tracker, github, stack MCPs). Being project-scoped it
goes through the approval flow — that is why step 4 below allowlists it in `enabledMcpjsonServers`. When opted in,
at scaffold time:

1. **Prereqs.** Verify `uv`/`uvx` and **Python 3.12+** are available (`uvx --version`, `python --version`). If
   missing, tell the user to install `uv` (https://docs.astral.sh/uv/) and **flag it** — do not block the rest of init.
2. **Declare the server** in the project `.mcp.json` (instead of the empty default):
   ```json
   { "mcpServers": { "basic-memory": {
       "command": "uvx",
       "args": ["basic-memory", "mcp"],
       "env": { "BASIC_MEMORY_HOME": "${CLAUDE_PROJECT_DIR}/docs/memory" } } } }
   ```
   Manual alternative for the user: `claude mcp add basic-memory -- uvx basic-memory mcp`.
3. **Storage.** Create `docs/memory/` (with a `.gitkeep`) and a `docs/memory/.bmignore` guarding PII. **Gitignore**
   the derived SQLite index and any `*.db` (add `*.db` and the basic-memory index path to `.gitignore`).
4. **Allowlist.** In `.claude/settings.json`, add `"basic-memory"` to `enabledMcpjsonServers`, and add the
   `mcp__basic-memory__*` tools to the permission allowlist:
   `write_note`, `read_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`, `list_directory`.
   The corpus remains the default source of truth; agents must still work without this MCP.

---

## 7. Idempotency & overwrite policy (critical)

- **Protected** (`strategy.md`, `architecture.md`, `TODO.md`): if they exist with content, **don't overwrite** — show
  intent, preserve by default. PM edits these via proposal mode.
- **Append-only** (`project_chronicle.md`, `activity_log.jsonl`): never truncate/rewrite; create only on fresh scaffold.
- **`.claude/.local/`**: never blind-overwrite; merge new keys, preserve existing tokens.
- **Autogenerated** (`INDEX.md`, `index.json`): always safe to regenerate.
- **Pre-existing CI** (`.github/workflows/`): add framework workflows alongside; never delete the user's.
- **Everything else** (config, rules, scripts, hooks, `CLAUDE.md`): update mode → prompt before overwriting a
  differing file; fresh scaffold → write freely.
- **Sealed alpha tests** (`docs/claude_tasks/alpha_tests/`): never touch — the FREEZE RULE.

---

## 8. Final summary (in the user's language)

Report: project identity; model policy + enabled roster + `separation_of_duties_mode`; the **three connections** —
Git (repo/branch/remote, identity, **the git account selected for this remote** — recorded in `git.account`), tracker
(type + connection identity + MCP OAuth status; a REST token in secrets.env only if C.2.3's condition fired,
never shown), Databricks (envs/profile/warehouses, or "not connected"); the MCP scope + the project MCP set
(recorded in `mcp.scope` / `mcp.servers` — default scope `local`: confined to this repo, never global) and the
handshake transport (recorded in `handshake.transport`); every
file written, every file **preserved**, any missing template; toolchain status (git, npm, husky, Agent Teams flag,
INDEX); memory backend (`corpus` = no MCP, the corpus is the knowledge graph; or `basic-memory` enabled per §6.4);
MCP verification (every server in `mcp.servers` at `{{MCP_SCOPE}}` per §6, + `basic-memory` if enabled;
Databricks is verified separately via its CLI profile — it is not an MCP). **If you switched the active `gh` account in C.1,
restore the previously-active one now** (`gh auth switch --user <prev>`) and confirm it. Next step: start a session —
the PM reads `CLAUDE.md` + `TODO.md` + the chronicle and begins the
lifecycle at Step 1 (Brief).

Do not declare success if the Agent Teams flag is missing, the corpus scripts failed, or any `{{VAR}}` was left
unresolved — surface these as blocking issues.
