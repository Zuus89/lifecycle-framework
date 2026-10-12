---
name: council
description: Multi-agent deliberation for contested, architectural, or irreversible decisions. Runs a 7-step protocol — PM frames the question, de/da/code-reviewer take independent positions, devils-advocate attacks (mandatory), PM synthesizes, the human delivers the verdict. Writes a council doc with explicit reopen criteria. Use ONLY for decisions that are contested, ambiguous, or high-blast-radius — NOT for routine implementation. Invoke when the user says "council", "delibera", "convoca consejo", "get multiple perspectives", when a spec has ≥2 viable designs with no clear winner, or when a change touches protected files.
allowed-tools: Read, Write, Edit, Glob, Grep, Task
---

# council

Formal multi-agent deliberation with adversarial review. Adapts the 7-step protocol from `0xNyk/council-of-high-intelligence` and the debate pattern from Du et al. 2023 (Multi-Agent Debate), but uses the project's **domain-specialized agents** (`de`, `da`, `code-reviewer`, `devils-advocate`) instead of generic personas — and ends with a **human verdict**: the human decides, the council recommends.

> The mandatory adversary `devils-advocate` was formerly aliased `loki`; the code-review gate `code-reviewer` was formerly `heimdall`. The aliases are documentation cross-references only — use the role-descriptive names.

## When to invoke

**Use council for:**
- Contested decisions — `de`, `da`, and `code-reviewer` might reasonably disagree
- Architectural decisions (platform choice, foundational behavior, decisions of record)
- Irreversible or high-blast-radius decisions (data-contract commitments, schema changes, anything that modifies canonical identifiers or reference data)
- Specs with ≥2 viable designs and no clear winner
- Changes touching protected files (`CLAUDE.md`, `docs/strategy.md`, `docs/architecture.md`, `TODO.md` content, `.claude/settings.json`, hooks)
- The user explicitly requests deliberation ("convoca consejo", "pásalo por council")

**Do NOT use council for:**
- Routine implementation of an approved spec (Step 7 of the lifecycle)
- Code review of an existing change (that is `code-reviewer` alone)
- Data validation or alpha-test execution (that is `da` alone)
- Bug fixes with an obvious root cause
- Anything the PM can decide in <5 min with current context

> Rule of thumb: if you could answer the question in a single sentence after reading the spec, council is overkill — decide it and log a `decision` event instead.

---

## Invocation

| Command | What happens |
|---------|--------------|
| `/council [target]` | Full 7-step protocol — `de` + `da` + `code-reviewer` positions, `devils-advocate` attack, PM synthesis, human verdict |
| `/council --quick [target]` | Faster check — `de` + `da` + `devils-advocate` only; skips the cross-examination round |
| `/council --dry-run [target]` | Preview the framing + member list, no execution |

**Target** can be:
- A spec path: `docs/claude_tasks/<NN_slug>.md`
- A ticket: a tracker key (read the prefix and tracker type from `scripts/corpus.config.mjs` / `.claude/settings.json` at runtime — e.g. a Jira key or a Linear identifier)
- An inline question: `"Should component X use approach A or approach B?"`

---

## The 7-step protocol

### Step 1 — PM frames the question (PM)

The PM writes the framing **before any member is spawned**:
- **The question** — one sentence, answerable
- **Options on the table** — each stated neutrally (no pre-loaded winner)
- **Evidence available** — file paths, data profiles, prior decisions from `docs/project_chronicle.md` and `docs/strategy.md` (the Decisions section), relevant incidents from the corpus (grep `docs/project_chronicle.md` for the topic; the chronicle is the memory).
- **What a decision must satisfy** — the constraints (cost, governance, data freshness, distribution, deadlines, etc.)

**Abort gate:** if the framing makes the answer obvious, stop — council is overkill. Decide it and log a `decision` event via `/log-activity` instead.

### Step 2 — Independent positions (parallel)

The PM spawns the members **in parallel** (single message, multiple Task/teammate calls). Each member reads ONLY the framing + the cited evidence (NOT each other's output):

- **de** — implementation perspective: can this be built? what is the simplest design? what is the engineering risk? (executes read-only probes where useful)
- **da** — data perspective: does the current data support this? what does profiling show? what breaks downstream?
- **code-reviewer** — architecture/operational perspective: does this fit the existing system? does it violate a hard rule? what is the code-level and operational risk?

`--quick` runs `de` + `da` only at this step.

Each member returns a **≤400-word position** with:
1. Recommendation (one sentence)
2. Reasoning (evidence-backed — file paths, numbers, profiling results)
3. Biggest risk they see
4. Biggest uncertainty they have

### Step 3 — Cross-examination round *(skipped in `--quick`)*

The PM passes each member's position to the other members. Each member must:
- Identify the **strongest** point from ≥2 peers
- Identify the **weakest** point from ≥2 peers
- State whether their own recommendation changes given the peer inputs

Output per member: **≤300 words**, must explicitly engage 2+ peers.

### Step 4 — Post-round enforcement *(skipped in `--quick`)*

The PM audits the cross-examination for health signals:

| Check | Pass criterion | Failure action |
|-------|----------------|----------------|
| **Dissent quota** | ≥1 member disagrees with another on something substantive | If everyone agrees on everything → groupthink suspected → rerun Step 2 with adversarial framing |
| **Novelty gate** | ≥1 new consideration surfaced in Step 3 that was not in Step 2 | If Step 3 is pure restatement → council is adding no value, abort and decide directly |
| **Anti-recursion** | No member repeated their Step 2 position verbatim | If verbatim → that member is not engaging, respawn it |

### Step 5 — devils-advocate attack (MANDATORY)

The PM drafts a one-paragraph synthesis of the emerging position from Steps 2–4 and passes it to `devils-advocate` together with the member positions.

`devils-advocate` applies the full **Grounded-Dissent Protocol** (see its agent charter): every objection must cite evidence — file:line, data row, a `project_chronicle` incident, architecture principle, hard rule, or a `project_chronicle` problem — or it is discarded. It returns a structured attack report with an overall verdict (`attack` / `mostly_grounded_dissent` / `mostly_speculative`).

**A council without a `devils-advocate` attack is invalid — no exceptions, even when the members agree unanimously.** Especially then: unanimity is a groupthink signal, not a confidence signal.

### Step 6 — PM synthesis (PM)

For each `devils-advocate` attack, the PM responds explicitly — silence is not allowed:

| Response | When to use |
|----------|-------------|
| **Mitigate** | Attack is valid → modify the recommendation to address it, re-draft the verdict |
| **Accept risk** | Attack is valid but cost of mitigation > cost of risk → document in "Accepted Risks" with a revisit trigger |
| **Reject** | Attack's evidence does not actually support the claim → explain why, keep the recommendation |

Health checks during synthesis:
- **Dissent quota** — if all members agreed on everything AND `devils-advocate` found nothing grounded → suspect groupthink; rerun Steps 2–4 with adversarial framing before synthesizing.
- **Novelty gate** — if the council surfaced nothing beyond what the framing already contained → the council was ceremonial; say so in Council Meta.

The PM writes the verdict document (scaffold it with `/new-doc council`, template `docs/_templates/council.md`) to:

```
docs/claude_tasks/council/YYYY-MM-DD_slug_council.md
```

with `status: pending` — the recommendation is not a decision yet.

### Step 7 — Human verdict (Human)

The PM presents the synthesis to the human (in the project's communication language — read it from `CLAUDE.md`; lead with the recommendation and the unresolved questions). The human **accepts, modifies, or rejects**. Then:

1. Update the council doc: `status: decided` (or `open` if sent back), and record the verdict verbatim including its **reopen criteria**.
2. **Decision of record:** the human's verdict IS the authorization for the protected-file write — add a row to the `docs/strategy.md` Decisions table and append an entry to `docs/project_chronicle.md`.
3. Log it once: `/log-activity decision: <verdict> --tracker` — the `decision` line in the activity log plus the mirrored comment on the relevant ticket (the logger branches on the tracker chosen at init — Jira via the Atlassian MCP, or Linear).

If the human's verdict leaves blocking unresolved questions, they become tracker sub-issues before any implementation starts.

---

## The verdict document

Scaffold it with `/new-doc council`: the template (`docs/_templates/council.md`) is the only definition of its
sections — Question, Decision, Reasoning, Unresolved questions, Accepted risks, Reopen criteria, Recommended next
steps, Human verdict, Council meta, and the member positions as an appendix. Two are never empty: **Unresolved
questions** (if none, say so explicitly) and **Reopen criteria** (a decision without them can never be revisited
cleanly). If an unresolved question is blocking, it leads the document, above the Decision.

---

## Integration with the task lifecycle

Council is an **optional branch** at Steps 5–6 of the 10-step lifecycle:

```
Step 3: Spec expanded ───── PM
Step 4: Alpha test ──────── DA
Step 5: Spec review ─────── DE + devils-advocate (parallel)
   │
   ├── Default: reviews → PM resolves objections (Step 6)
   │
   └── IF contested / architectural / irreversible: /council
        → human verdict feeds Step 6 resolve
```

It also runs **standalone** for strategic decisions outside any single task. The verdict then becomes input to the spec (Step 6 resolve) or feeds directly into the `docs/strategy.md` Decisions table.

**The PM decides whether to escalate.** Triggers for escalation:
- Spec ambiguity detected during expansion (≥2 viable designs, no clear winner)
- The target touches protected files
- Prior attempts at similar decisions in `docs/project_chronicle.md` show recurring failures
- The human explicitly requests deliberation

If a council verdict has unresolved blocking questions, those must be resolved before implementation (Step 7) begins.

---

## Anti-ceremonial guards

Council has real cost (~6× tokens, ~3× latency vs single-agent). To prevent ritualization:

1. **If council runs 3× in a row with `devils-advocate` returning no grounded objections → the triggers are miscalibrated.** Review which decisions are being escalated unnecessarily.
2. **If "Unresolved Questions" is consistently empty → council is not surfacing real ambiguity.** Either the questions are clearer than the PM thought, or members are converging too easily (groupthink).
3. **If the same Accepted Risk appears across 3+ verdicts → that risk becomes its own tracker investigation issue.**

Measure council ROI: did the verdict change the outcome versus what the PM would have decided alone? If not → council was ceremonial. Record the answer in Council Meta.

---

## References

- The `devils-advocate` agent charter — the Grounded-Dissent Protocol (every objection cites evidence or is discarded)
- The `de`, `da`, and `code-reviewer` agent charters — member perspectives
- `docs/strategy.md` — the project goal + the Decisions table (context for all members; destination for verdicts)
- `docs/_templates/council.md` — the verdict document template, scaffolded via `/new-doc council`
- `/log-activity … --tracker` — the dual-write logging the verdict requires (one logger, one line, one comment)
- External: [council-of-high-intelligence (0xNyk)](https://github.com/0xNyk/council-of-high-intelligence) — protocol source
- External: [Du et al. 2023, Multi-Agent Debate](https://arxiv.org/abs/2305.14325) — empirical basis for debate > single-agent
