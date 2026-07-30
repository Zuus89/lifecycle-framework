---
name: handshake
description: Two-machine transfer of in-progress work (notebook <-> tower). Transport-aware — synced-folder (repo inside OneDrive/Dropbox; the sync client carries the working tree AND .git; /handshake verifies sync completion, scans conflict copies, checks git integrity, verifies per-machine environment) or git-remote (per-machine clones; out = wip(<TICKET>) transport commit + transitory close + durable handoff doc + push; in = ff-pull + snapshot regeneration + environment verification). Auto-detects transport and direction; explicit "out"/"in" argument wins. Never force-push, never stash, never rewrite history, never transport or print secret values, never mutate machine config without confirmation. Triggers include "/handshake", "handshake out", "handshake in", "switching machines", "continue on my other machine", "me cambio de máquina", "sigo en la torre", "sigo en el notebook", "traspaso de trabajo", "empaca el trabajo".
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, TodoWrite
---

# Handshake

Move one in-progress task cleanly between the user's two machines. The **PM** runs this. The framework's
principle — *state is files, not memory; any session can resume cold* — extends here across machines: everything
the next session needs must be in files that reach the other machine, and everything that CANNOT travel
(per-machine config) must be verified on arrival, not assumed.

This skill is **plugin-resident** and reads everything at runtime — never assume a transport, tracker, account,
or path. Read these first, then act:

- **`.claude/settings.json`** — `handshake.transport` (`auto | synced-folder | git-remote`), `git` block
  (`repo`, `defaultBranch`, **`account`**), `mcp.scope`, `tracker`, `databricks`, `agents`.
- **`corpus.config.mjs`** — paths, ticket prefix, project slug.
- **`CLAUDE.md`** — communication language, protected files, hard rules.
- **`.claude/rules/git-workflow.md`** — the `wip(<TICKET>):` carve-out (git-remote transport only).
- **`.claude/rules/mcp-usage.md` §0** — the recorded MCP scope and the per-machine consequence.

Two facts drive the whole design:

1. **What travels** depends on the transport. On `synced-folder`, the sync client carries the working tree, the
   gitignored `docs/context_snapshot.md`, `.claude/log_session`, `.claude/.local/secrets.env`, and `.git/`
   itself. On `git-remote`, ONLY committed-and-pushed state travels — the gitignored snapshot cannot cross, so
   its durable twin (the handoff doc, `docs/claude_tasks/handoffs/`) travels instead.
2. **What never travels** (either transport): MCP servers at `local`/`user` scope in `~/.claude.json`, the
   active `gh` account, `~/.databrickscfg`, Files-On-Demand hydration state. `/handshake in` verifies all of it
   from committed config — report-and-offer-fixes, never silent mutation.

> **Honest risk statement (synced-folder):** `.git/` inside a cloud-synced folder on two machines carries a real
> corruption risk — objects synced mid-write, placeholder hydration, conflict copies on simultaneous use. The
> handshake ritual (sync-verify on leave, conflict-scan + integrity check on arrival, one machine at a time)
> **mitigates** this; it cannot eliminate it. The remote on GitHub remains the recovery path — keep pushing at
> natural boundaries even on this transport.

## 0. Resolve transport and direction FIRST

**Transport.** Read `settings.json → handshake.transport`. `synced-folder` or `git-remote` → use it. `auto` or
absent → detect: repo path contains `OneDrive`, `Dropbox`, or `Google Drive` (case-insensitive) →
`synced-folder`; else `git-remote` (which requires a configured, reachable remote — see §6).

**Direction.** An explicit argument (`/handshake out` / `/handshake in`) always wins. Otherwise:

| Transport | Signal | Direction |
|---|---|---|
| synced-folder | `.claude/handshake.json` absent, or last written by THIS machine (`machine` == this hostname), with local work present (dirty tree, or commits since the marker's `ts`) | **out** |
| synced-folder | marker written by the OTHER machine (`machine` ≠ this hostname) with `direction: "out"` — a surviving `{other, "out"}` marker itself witnesses "not yet unpacked here", because §2.6 flips it on unpack; staleness is §2.1's problem, not this table's | **in** |
| git-remote | dirty tree (`git status --porcelain` non-empty, **excluding hook residue** — a modification of ONLY `docs/activity_log.jsonl` whose diff is purely trailing `committed` hook lines, see §3.2.1) OR unpushed commits (`git log @{u}..HEAD` non-empty) | **out** |
| git-remote | clean tree (hook residue excluded) AND remote ahead (`git log HEAD..@{u}` non-empty). A handoff doc newer than the local snapshot, or a missing snapshot while handoffs exist, is a **secondary** signal — it also fires on the machine that just packed (out writes the handoff AFTER the snapshot), so it counts only when the newest handoff's machine hint is NOT this hostname | **in** |
| either | both kinds of signal, or neither | **ASK — never guess a direction** |

## 1. `/handshake out` — synced-folder transport

1. **Transitory close.** Run `/close-task` **§0 Transitory variant verbatim** (snapshot overwrite + kb-curator +
   INDEX rebuild if the curator wrote + `/log-activity paused` + curation bundle commit + report). Do not
   reimplement it; do not skip it. Commits are fine on this transport — `.git/` syncs — but no push is required.
2. **Marker.** Write `.claude/handshake.json` (gitignored; travels by sync):
   ```json
   { "machine": "<hostname>", "ts": "<ISO-8601 UTC>", "branch": "<current branch>",
     "direction": "out", "next_action": "<the single next work step, verbatim from the snapshot's OPEN item 1>" }
   ```
3. **Log.** `/log-activity handshake-out` (step `null`, agent `pm`; summary = machine hint + "snapshot refreshed,
   marker written").
4. **Sync verification (report — the user acts, the skill cannot).** List the files this session modified
   (`git status --porcelain` + `git log --since` window). Then instruct, verbatim intent: **wait until the sync
   client shows "Up to date" / "Al día" BEFORE shutting down or sleeping this machine** — a half-synced `.git/`
   is the corruption scenario. Optionally check pending-state attributes on the changed files (`attrib` pin/unpin
   flags) and report anything that looks unsynced.
5. **Report** (project's communication language): what the transitory close updated, the marker content, the
   sync checklist, and the one-machine-at-a-time reminder. No handoff doc on this transport — the snapshot
   itself syncs; a per-boundary handoff doc would duplicate it.

## 2. `/handshake in` — synced-folder transport

1. **Marker sanity.** Read `.claude/handshake.json`. Expected: `machine` ≠ this hostname, `direction: "out"`,
   plausible `ts`. Marker missing, stale, or written by this machine → **warn: sync may not have finished** —
   tell the user to check the sync client's status, and offer a degraded resume (proceed with whatever state is
   present, flagged as possibly stale). Never treat a warning as a blocker without telling the user why.
2. **Conflict scan.** Glob the repo (docs/, .claude/, scripts/, src/) for sync-conflict artifacts,
   case-insensitive: files containing a hostname suffix (`*-<machine-name>*`), `*-Copy*`, `*copia*`,
   `*conflict*`. Report every hit with its twin. **The human resolves conflict copies — never auto-delete,
   never auto-pick a side.**
3. **Git integrity (cheap first).** `git status` and `git log -1` must parse cleanly. On any anomaly (broken
   refs, "not a git repository", index errors) → STOP and report; offer `git fsck --no-progress` for diagnosis.
   Never attempt destructive repair; if `.git/` is corrupt, the sanctioned recovery is re-cloning from the
   remote (history lives on the git host — this is why pushing at natural boundaries matters even on this
   transport).
4. **Hydration.** Files-On-Demand can leave placeholders: verify `node_modules/.bin/`, `scripts/`, and
   `.husky/` are actually hydrated and executable. `node_modules` missing or broken → offer `npm install`.
5. **Environment verification — what sync does NOT carry.** Derived from committed config; every row =
   check → report → **offer the exact command; run it only on explicit confirmation**:

   | Check | From | If missing/mismatched — OFFER |
   |---|---|---|
   | MCP servers (tracker MCP, `github`, stack MCPs) present at the recorded scope | `settings.json → mcp.scope` + `mcp-usage.md` §0 | exact `claude mcp add --scope <scope> <name> ...`; on Windows local scope, check BOTH drive-letter casings in `~/.claude.json` and mirror into the missing one |
   | `gh auth status` — the account matching `git.account` exists and can reach the remote | `settings.json → git.account` | `gh auth switch --user <account>` (or `gh auth login` if absent) |
   | `~/.databrickscfg` has a profile per configured env | `settings.json → databricks.envs` (skip when `databricks.enabled` ≠ on) | `databricks configure` guidance per env; never write the file yourself |
   | `node --version` ≥ 24, husky hooks present + executable | `package.json` | `npm install` (re-runs `prepare`/husky) |
   | `python --version` | only if the destructive guard's stack patterns are enabled | install pointer only |
   | `.claude/.local/secrets.env` key PRESENCE by NAME for the configured tracker | `settings.json → tracker.type` | which key NAMES to add and where each value comes from. On this transport secrets usually synced with the folder — verify anyway (first-time machine). **Never print, echo, or log a value** |

6. **Fresh session id.** Regenerate `.claude/log_session` (new 8-char id, current branch/issue) — a machine
   boundary is a new session per `/log-activity` §C. Update the marker: `direction: "in"`, this machine, now.
7. **Log + resume.** `/log-activity handshake-in` (step `null`, agent `pm`; summary = source machine, snapshot
   present/stale, verification result). Report **"ready to resume"** leading with the marker's `next_action`,
   then the per-check results (ok / offered-fix). Then run the normal Session Start Protocol.

## 3. git-remote transport

### 3.1 `/handshake out`

1. **Preflight (read-only; abort cleanly on failure).** Current branch must be a **task branch** — never
   `git.defaultBranch` (WIP transport on the default branch is prohibited). Capture `git status --porcelain`
   (the file list goes in the handoff doc). `git ls-remote` the configured remote — no remote or unreachable →
   **abort**: without a push there is no transfer; fallback = plain `/close-task` Transitory now, retry when
   online. Capture hostname + date.
2. **WIP transport commit** (skip if the tree is clean — say so). `git add -A`, then verify the stage before
   committing — the `.gitignore` guarantees the four state paths; everything else gets reviewed:
   - `git diff --cached --name-only` must show **nothing** under `.claude/.local/`, no
     `docs/context_snapshot.md`, no `.claude/log_session`, no `.claude/handshake.json` — if any appears, STOP:
     the project's `.gitignore` is broken; fix that first.
   - `git diff --cached --stat` — STOP-and-ask on any newly-staged file that is large (>5 MB), a bulk-data
     artifact (`*.csv`, `*.parquet`, `*.xlsx`, `*.pkl`, `*.zip`, `*.db`) not already tracked, or
     secret-suggestive (`credentials*`, `token*`, `*service-account*`).
   Then commit: `wip(<TICKET>): handshake YYYY-MM-DD <machine-hint>`. This is the ONE sanctioned non-runnable
   commit (see `git-workflow.md`, "Handshake WIP transport"). It is cleaned up by the PR squash-merge, **never**
   by history rewrite. (Distinct from close-task §5's curation bundle, which stages explicit paths — different
   commit, different purpose.)
3. **Transitory close.** Run `/close-task` §0 Transitory verbatim, as in §1.1.
4. **Handoff doc — the snapshot's durable twin.** Write
   `docs/claude_tasks/handoffs/YYYY-MM-DD_NN_slug_handoff.md` following the `/new-doc` contract: read
   `docs/_templates/handoff.md` FIRST, fill every placeholder, delete the sentinel header, then
   `node scripts/validate-frontmatter.mjs docs/claude_tasks/handoffs` (directory form). Content map:

   | Handoff section | Fill with |
   |---|---|
   | frontmatter | real `ticket` / `task_number` (no active task → `ticket: null`, `task_number: 0`, slug from the branch); `next_action:` = OPEN item 1 |
   | header block | Task · Tracker link (or "local TODO.md only") · **Branch:** verbatim current branch (what `/handshake in` verifies) · lifecycle step reached |
   | State in force | from the just-overwritten snapshot + which spec / sealed alpha test governs (paths) |
   | What this session did | snapshot bullets + **the transport record**: wip-commit hash + the captured dirty-file list + curation-bundle hash if the kb-curator wrote |
   | OPEN — start here | numbered, executable cold; item 1 == `next_action`. Work actions only — `/handshake in` is the reader's entry point, not a task |
   | Carry-over | snapshot carry-over unchanged |
   | How to run things | the machine-B checklist derived from committed config — secrets key NAMES for the tracker, expected `git.account`, expected MCP servers at `mcp.scope` (+ the `claude mcp add` commands), required `~/.databrickscfg` profiles, `npm install` note. Names, never values |

5. **Log + INDEX + commit + push.** `/log-activity handshake-out` (before the commit, so the line rides the
   push; summary = wip hash + handoff path + machine hint). `node scripts/build-index.mjs`; stage the handoff
   doc + `docs/INDEX.md` + `docs/index.json` + `docs/activity_log.jsonl`; commit
   `docs(handoff): handshake out <TICKET> YYYY-MM-DD`; plain `git push` (the pre-push hook re-verifies INDEX
   freshness — it passes because the rebuild just ran). Push rejected → §4 divergence. The post-commit hook
   auto-logs `committed` lines — expected; do not hand-log them. **The FINAL commit's own hook line stays
   uncommitted by design** (sweeping it would fire the hook again — infinite regress): the leaving machine ends
   with exactly one expected residue, a trailing `committed` line in `docs/activity_log.jsonl`, restored at
   `/handshake in` (§3.2.1).
6. **Report:** what traveled (up to 3 commits: wip transport / curation bundle / handoff+INDEX), the handoff
   path, the expected hook residue, and: *"On the other machine: open the repo and run `/handshake in`."*

### 3.2 `/handshake in`

1. **Sanity.** `git remote get-url origin` must match `settings.json → git.repo` — mismatch → STOP (wrong
   clone). Then triage the tree:
   - **Hook residue (expected):** the only modification is `docs/activity_log.jsonl` and its diff is purely
     trailing `committed` hook line(s) whose commits are already in pushed history → `git restore
     docs/activity_log.jsonl` (the line is machine-reproducible from `git log`; no audit loss) and continue.
     This is the leaving machine's designed end-state (§3.1.5), not divergence.
   - **Anything else dirty** → STOP and report the files: real work → that IS divergence — offer to commit it
     as `wip(<TICKET>): handshake-in divergence <machine>` and go to §4; junk → the HUMAN discards it (the
     destructive guard blocks `reset --hard` / `clean -f`; never propose them). **Never stash.**
2. **Pull.** `git fetch`. **Early exit:** if the newest handoff was written by THIS machine and the remote is
   not ahead, nothing arrived — report *"this machine packed last — nothing to unpack"* and stop. If the task
   branch does not exist locally (first transfer to this clone), materialize it: identify it (explicit
   argument, or the remote branch holding the newest `wip(<TICKET>)` / `docs(handoff)` commit; ambiguous →
   ask), then `git switch --track origin/<branch>`. Otherwise `git pull --ff-only` on the task branch. A
   refused fast-forward means both machines moved → §4.
3. **Handoff.** Newest doc in `docs/claude_tasks/handoffs/` (date prefix, then `updated:`). Its `Branch:` must
   match the current branch — mismatched or missing → degraded resume (§6), never regenerate the snapshot from
   a stale or foreign handoff without asking.
4. **Regenerate the snapshot.** Overwrite the gitignored `docs/context_snapshot.md` from the handoff (section
   map: State in force → State in force · What this session did → What the last session did · OPEN → OPEN ·
   Carry-over → Carry-over · environment notes → environment notes). The snapshot **stays gitignored** — never
   commit it.
5. **Environment verification.** Same table as §2.5.
6. **Do NOT un-WIP.** Work continues on top of the `wip(...)` commit; the PR squash-merge flattens it. No
   amend, no rebase, no cleanup commit.
7. **Fresh session id** (as §2.6), `/log-activity handshake-in`, report "ready to resume" with `next_action` +
   verification results, then the Session Start Protocol.

## 4. Divergence — BOTH machines moved (push rejected / non-ff pull)

1. **Never force.** Not `--force`, not `--force-with-lease`, not `reset --hard` (Hard Rule 8; the destructive
   guard blocks them; this skill never proposes them).
2. Show both sides: `git log --oneline --left-right --graph @{u}...HEAD` and `git diff --stat @{u}` — report
   which files diverge and what each machine did.
3. **The human decides.** Exactly two sanctioned resolutions: (a) integrate — `git pull --no-rebase` (a merge
   commit on a task branch is acceptable; the PR squash-merge flattens it), conflicts resolved with the human in
   the loop; or (b) the human resolves manually. The skill stops after reporting — it never auto-merges
   conflicting work.
4. Prevention: run `/handshake out` BEFORE leaving a machine; Session Start step 0 catches the other half.

## 5. Hard rules

1. **One transport per project.** Git or the sync client — never both as simultaneous carriers of the same
   state, never USB/scp side-channels.
2. **Never force-push, never rewrite history, never `reset --hard`, never `git clean`.** The WIP commit dies at
   the PR squash-merge, nowhere else.
3. **Never stash** — a stash is machine-local invisible state; this skill exists to make state files.
4. **Never commit** `docs/context_snapshot.md`, `.claude/.local/**`, `.claude/log_session`, or
   `.claude/handshake.json`. If `git status` ever shows them, STOP — the `.gitignore` is broken; fix that first.
5. **Never print, log, or write a secret VALUE.** Key names only.
6. **Never mutate machine config uninvited** — `gh auth switch`, `claude mcp add`, `npm install`,
   `databricks configure` are offered as exact commands and run only on explicit confirmation.
7. **`wip(<TICKET>):` only on a task branch, only as handshake transport** (git-remote), per `git-workflow.md`.
8. **One machine at a time.** Simultaneous sessions on both machines produce conflict copies (synced-folder) or
   divergence (git-remote) — both land on the human's desk.
9. **This skill closes nothing.** No ticket transitions, no `TODO.md` writes, no chronicle — the Transitory
   close it wraps owns those boundaries.
10. **Ambiguous auto-detect → ask.** Never guess transport or direction.

## 6. Edge cases and degraded modes

| Case | Handling |
|---|---|
| Marker missing/stale on arrival (synced-folder) | Warn "sync may not have finished — check the sync client"; offer degraded resume from the state present, flagged as possibly stale |
| Conflict copies detected | Report the list with twins; human resolves; never auto-delete |
| Git integrity anomaly (synced `.git/`) | STOP; offer `git fsck --no-progress` diagnosis; never destructive repair; recovery = re-clone from the remote. **Salvage first:** before resuming in the fresh clone, copy `docs/context_snapshot.md`, `.claude/handshake.json`, `.claude/.local/`, and the uncommitted `docs/activity_log.jsonl` tail out of the old folder's working tree |
| Both machines worked simultaneously (synced-folder) | Conflict copies + marker confusion → report both signals; human arbitrates; restate one-machine-at-a-time |
| `node_modules` unhydrated / broken executables | Offer `npm install` |
| No remote / unreachable (git-remote out) | Abort; fallback = plain `/close-task` Transitory; retry online |
| Push rejected — remote ahead (git-remote) | §4 divergence protocol |
| Dirty tree at `/handshake in` (git-remote) | Hook residue (only `docs/activity_log.jsonl`, purely trailing `committed` lines for pushed commits) → `git restore` it and continue (§3.2.1). Anything else → STOP; wip-divergence commit or human cleanup; never stash |
| Task branch absent in the arriving clone (first transfer) | `git fetch`, identify the branch (newest `wip`/`docs(handoff)` commit; ambiguous → ask), `git switch --track origin/<branch>`, continue the normal flow |
| Handoff doc missing / Branch mismatch (git-remote in) | Degraded resume: reconstruct from the last commits' diff, `docs/activity_log.jsonl` tail, and `TODO.md`; say loudly the snapshot could not be regenerated from a handoff; recommend `/handshake out` next boundary |
| No active task (research session) | Marker/handoff with `ticket: null`, `task_number: 0`, slug from the branch |
| `tracker = none` | Skip tracker-key and tracker-MCP checks; handoff header Tracker = "local TODO.md only" |
| Secrets missing on the arriving machine | Names-only report + which capabilities are down (tracker MCP, `/log-tracker`) until the keys exist |
| Branch protection blocks pushing the task branch (git-remote) | Report the server's exact rejection; options: adjust protection for the task-branch namespace, or accept transfer only at PR boundaries. Never bypass |
| Pre-push INDEX drift at push time | Run `npm run build:index`, commit the INDEX pair as a NEW commit (never `--amend`), push again. Never `--no-verify` |

## Reference

- `/close-task` §0 — the Transitory variant this skill wraps (both transports).
- `/new-doc` — the handoff row (template, destination, contract).
- `/log-activity` §B (`handshake-out` / `handshake-in`) + §C (session id self-heal / regeneration).
- `.claude/rules/git-workflow.md` — the WIP transport carve-out.
- `.claude/rules/mcp-usage.md` §0 — MCP scope + the two-machine consequence + Windows dual-casing hazard.
- `.claude/rules/frontmatter.md` — the `handoff` type extension (`next_action:`).
- `.husky/pre-push` — the INDEX-freshness gate every push must satisfy.

## Invocation

`/handshake` (auto-detect) · `/handshake out` (leaving this machine) · `/handshake in` (arriving). Also:
"me cambio de máquina", "sigo en la torre", "sigo en el notebook", "switching machines", "continue on my other
machine". The PM runs it; it wraps the Transitory close and never closes tickets itself.
