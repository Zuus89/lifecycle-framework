// Honest docs (CRI-1158): what /lifecycle-init, the README, FRAMEWORK.md and the scaffolded CLAUDE.md say about
// the plugin is checked against the plugin itself — the agent files, the skill directories, the templates and
// hooks.json. A doc that drifts from the code fails here, not in a user's project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { REPO, TEMPLATES, VAR_RE, listFiles, read, render } from "../_helpers.mjs";

const agentsDir = join(REPO, "agents");
const skillsDir = join(REPO, "skills");
const README = read(join(REPO, "README.md"));
const FRAMEWORK = read(join(REPO, "FRAMEWORK.md"));
const INIT = read(join(skillsDir, "lifecycle-init", "SKILL.md"));
const CLAUDE = read(join(TEMPLATES, ".claude", "CLAUDE.md.template"));

const agentNames = () => readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
const skillNames = () => readdirSync(skillsDir).sort();

/** An agent's `model:` frontmatter pin (undefined for the PM, which runs on the session model). */
function pin(agent) {
  const text = read(join(agentsDir, `${agent}.md`));
  return yaml.load(text.slice(4, text.indexOf("\n---\n", 4))).model;
}

/** A markdown section: from its heading to the next heading of the same or a higher level. */
function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `missing section "${heading}"`);
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, "m"));
  return heading + (next < 0 ? rest : rest.slice(0, next));
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** Every shipped text a reader follows: agents, skills, templates, README, FRAMEWORK. */
const docs = () => [
  ...agentNames().map((a) => join(agentsDir, `${a}.md`)),
  ...skillNames().map((s) => join(skillsDir, s, "SKILL.md")),
  ...walk(TEMPLATES),
  join(REPO, "README.md"), join(REPO, "FRAMEWORK.md"),
];

// --- The roster (four agents folded into the core) ------------------------------------------------------

// The hyphenated names are unambiguous; "scout" is also an English verb, so only its identifier forms count.
const FOLDED = /`scout`|"scout"|'scout'|\bagents\.scout\b|\bscout agent\b|\b(dead[-_]code[-_]cleanup|corpus[-_]steward|data[-_]reviewer)\b/i;

test("the roster is seven agents; the four folded agents are gone and nothing ships them", () => {
  assert.deepEqual(agentNames(), ["code-reviewer", "da", "de", "devils-advocate", "kb-curator", "linear-steward", "pm"]);
  // The only sanctioned mentions: where each one went, and how to upgrade a project that still names them.
  const sanctioned = {
    [join(REPO, "FRAMEWORK.md")]: (t) => t.replace(section(t, "## Folded into the core (0.3)"), ""),
    [join(REPO, "README.md")]: (t) => t.replace(section(t, "## Upgrading to 0.3"), ""),
    [join(skillsDir, "lifecycle-init", "SKILL.md")]: (t) => t.replace(/On a project scaffolded before 0\.3,[\s\S]*?\.\)/, ""),
  };
  for (const file of docs()) {
    const hit = (sanctioned[file] ?? ((t) => t))(read(file)).match(FOLDED);
    assert.ok(!hit, `${file} still names the folded agent "${hit?.[0]}"`);
  }
});

test("each folded agent's protocol survives where the docs say it went", () => {
  const expect = (text, where, phrases) => { for (const p of phrases) assert.ok(text.includes(p), `${where} lacks "${p}"`); };
  const deadCode = read(join(skillsDir, "dead-code", "SKILL.md"));
  expect(deadCode, "/dead-code", ["Confirmed", "Suspicious", "False-positive", "only on explicit approval",
    "Re-run the build, the linter and the test suite", "used only by tests or mocks"]);
  const preApproved = String(yaml.load(deadCode.slice(4, deadCode.indexOf("\n---\n", 4)))["allowed-tools"]).split(/[\s,]+/);
  for (const tool of ["Edit", "Write", "MultiEdit", "Bash"]) {
    assert.ok(!preApproved.includes(tool), `/dead-code pre-approves ${tool}: a deletion must go through the permission prompt`);
  }
  expect(section(read(join(skillsDir, "audit-corpus", "SKILL.md")), "## Archival proposal (`--archival`)"), "/audit-corpus --archival",
    ["proposal-only", "E1", "E2", "E3", "Never archive", "docs/**/*.md", "affects-lookup", "_archival_proposal.md"]);
  expect(read(join(TEMPLATES, ".claude", "rules", "search-first.md.template")), "the search-first rule",
    ["Inbound", "Outbound", "affects-lookup", "A leaf", "~10 inbound dependents", "import cycle"]);
  // Strict mode is keyed on the label the PM gives the runner: in collapsed mode the Step-8 spawn is fresh too.
  expect(read(join(agentsDir, "da.md")), "da.md", ["Strict separation of duties", "second, fresh `da`", "If your brief labels you `da-runner`",
    "git log -p", "`status: sealed`, a `sealed_date` and `authority: ssot`"]);
  expect(read(join(agentsDir, "pm.md")), "pm.md", ["labelled `da-runner`", "a fresh `da` as `da-runner`"]);
});

test("affects-lookup is invoked with an object id, never a path — a path always finds nothing", () => {
  const usage = read(join(TEMPLATES, "scripts", "affects-lookup.mjs")).match(/Usage:\s+node scripts\/affects-lookup\.mjs <([^>]+)>/);
  assert.equal(usage?.[1], "object-id|TICKET-ID", "the CLI's own usage line");
  for (const file of docs()) {
    for (const [, arg] of read(file).matchAll(/affects-lookup\.mjs <([^>]+)>/g)) {
      assert.match(arg, /^object/, `${file}: affects-lookup takes an object id (or a ticket id), not <${arg}>`);
    }
  }
});

test("the INDEX is rebuilt after new governed docs are staged — build-index lists only tracked files", () => {
  assert.match(read(join(TEMPLATES, "scripts", "build-index.mjs")), /git ls-files/, "build-index reads the tracked files");
  const audit = read(join(skillsDir, "audit-corpus", "SKILL.md"));
  const step6 = audit.slice(audit.indexOf("6. **Commit**"), audit.indexOf("## Archival proposal"));
  const stage = step6.indexOf("git add docs/audits/");
  const rebuild = step6.indexOf("node scripts/build-index.mjs");
  assert.ok(stage >= 0 && rebuild > stage, "/audit-corpus Step 6 stages the new report and manifest before rebuilding");
  assert.match(read(join(skillsDir, "close-task", "SKILL.md")), /\*\*stage the new and changed governed docs first\*\*/);
});

test("settings.json → agents holds exactly the optional agents' toggles and the SoD mode, filled by /lifecycle-init and read by /close-task", () => {
  const template = read(join(TEMPLATES, ".claude", "settings.json.template"));
  const keys = Object.keys(JSON.parse(render(template)).agents);
  assert.deepEqual(keys, ["kb_curator", "linear_steward", "separation_of_duties_mode"]);
  for (const key of keys.slice(0, -1)) assert.ok(existsSync(join(agentsDir, `${key.replace(/_/g, "-")}.md`)), `agents.${key} toggles no agent`);
  const vars = (text) => [...new Set([...text.matchAll(/\{\{(AGENT_[A-Z_]+|SOD_MODE)\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(vars(INIT), vars(template), "/lifecycle-init and the settings template name the same roster variables");
  const closeTask = read(join(skillsDir, "close-task", "SKILL.md"));
  for (const key of keys) assert.ok(closeTask.includes(`agents.${key}`), `/close-task does not read agents.${key}`);
});

test("README, CLAUDE.md and FRAMEWORK.md list exactly the agents and skills the plugin ships", () => {
  const bullet = (name) => README.match(new RegExp(`^- \\*\\*${name}\\*\\* —([\\s\\S]*?)(?=^- \\*\\*)`, "m"))[1];
  const agentTicks = (s) => [...new Set([...s.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]))].sort();
  const skillTicks = (s) => [...new Set([...s.matchAll(/`\/([a-z][a-z-]*)`/g)].map((m) => m[1]))].sort();
  assert.deepEqual(agentTicks(bullet("Agents")), agentNames(), "README's Agents bullet");
  assert.deepEqual(skillTicks(bullet("Skills")), skillNames(), "README's Skills bullet");

  const roles = section(CLAUDE, "## 5. Roles");
  assert.deepEqual([...roles.matchAll(/^\| \*\*[^*|]+\*\* \| `([a-z-]+)`/gm)].map((m) => m[1]).sort(), agentNames(), "CLAUDE.md §5 role tables");
  const skills = section(CLAUDE, "## 6. Skills");
  assert.deepEqual([...skills.matchAll(/^\| [^|]+ \| `\/([a-z-]+)`/gm)].map((m) => m[1]).sort(),
    skillNames().filter((s) => s !== "lifecycle-init"), "CLAUDE.md §6 lists every skill a project uses (the scaffolder excepted)");

  const part3 = section(FRAMEWORK, "# PART 3 — Role definitions");
  assert.deepEqual([...part3.matchAll(/^### [^\n]*? — `([a-z-]+)`/gm)].map((m) => m[1]).sort(), agentNames(), "FRAMEWORK.md Part 3");
});

// --- The seven claims that disagreed with the code ------------------------------------------------------

test("model pins: /lifecycle-init A.5 and the CLAUDE.md table state exactly what the agents' frontmatter pins", () => {
  const byVar = {};
  const a5 = [...INIT.matchAll(/^\s*\| ([a-z-]+) \| `([^`]+)` \| `\{\{(MODEL_[A-Z_]+)\}\}` \|/gm)];
  assert.ok(a5.length >= 4, "A.5 lists the core agents' pins");
  for (const [, agent, model, variable] of a5) {
    assert.equal(model, pin(agent), `A.5 says ${agent} runs ${model}; its frontmatter pins ${pin(agent)}`);
    byVar[variable] = agent;
  }
  const rows = [...section(CLAUDE, "## 2. Model Policy").matchAll(/^\| [^|]+ \| `([a-z-]+)` \| `([^`]+)` \|/gm)];
  assert.deepEqual(rows.map((r) => r[1]).sort(), agentNames().filter((a) => pin(a) !== undefined),
    "the CLAUDE.md model table lists every pinned agent, and only those");
  for (const [, agent, cell] of rows) {
    const variable = cell.match(/^\{\{(MODEL_[A-Z_]+)\}\}$/);
    if (variable) assert.equal(byVar[variable[1]], agent, `${cell} is filled from A.5's ${agent} row`);
    else assert.equal(cell, pin(agent), `CLAUDE.md says ${agent} runs ${cell}; its frontmatter pins ${pin(agent)}`);
  }
  assert.match(INIT, /Model policy — recorded, not chosen/);
  assert.doesNotMatch(INIT, /ask only for overrides|overridable/i, "an init-time model override never reached the pins");
});

test("Python is a hard prerequisite — the guard hooks run it on every shell call", () => {
  const shell = JSON.parse(read(join(REPO, "hooks", "hooks.json"))).hooks.PreToolUse.find((e) => e.matcher === "Bash|PowerShell");
  assert.ok(shell.hooks.some((h) => /^python /.test(h.command)), "the shell guard runs on Python");
  assert.match(README, /\*\*Python 3\*\* on PATH as `python` — \*\*required\*\*/);
  assert.match(INIT, /`python --version` \(required/);
  for (const file of docs()) assert.doesNotMatch(read(file), /only (needed\s+)?if the destructive/i, `${file} still calls Python optional`);
});

test("/lifecycle-init §2 walks every template file; the unsuffixed ones carry no {{VAR}}, so copying them verbatim is exact", () => {
  assert.match(section(INIT, "## 2. Write the Tier-B files"), /For every file under `\$\{CLAUDE_PLUGIN_ROOT\}\/data\/templates\/`/);
  assert.doesNotMatch(INIT, /For every `\*\.template`/);
  const unsuffixed = listFiles(TEMPLATES).filter((f) => !f.endsWith(".template"));
  assert.deepEqual(unsuffixed, [
    ".github/workflows/lint-frontmatter.yml", ".husky/pre-commit",
    "scripts/_corpus-walk.mjs", "scripts/affects-lookup.mjs", "scripts/build-index.mjs", "scripts/validate-frontmatter.mjs",
  ], "§2 names them: the four corpus scripts, the git hook and the CI workflow");
  for (const f of unsuffixed) {
    assert.deepEqual([...read(join(TEMPLATES, f)).matchAll(VAR_RE)].map((m) => m[0]), [], `${f} has no .template suffix but carries a {{VAR}}`);
  }
});

test("one template set serves every stack — no doc claims a per-stack variant", () => {
  for (const file of docs()) {
    assert.doesNotMatch(read(file), /stack-variant|stack optionals|optional CI by stack|Optional add-ons|CI variant|Optional by stack/i,
      `${file} claims a per-stack variant`);
  }
  for (const f of listFiles(TEMPLATES)) assert.doesNotMatch(f, /\.(web|data|generic)\./, `${f} looks like a per-stack variant`);
});

test("CI is described as the corpus gate it is — no doc claims a CI code review", () => {
  assert.doesNotMatch(read(join(TEMPLATES, ".github", "workflows", "lint-frontmatter.yml")), /review/i, "the scaffolded CI runs no review");
  for (const file of docs()) {
    assert.doesNotMatch(read(file), /CI code[- ]review|code-review layer run on its diff|claude-code-review|bias-free CI|PR-diff review/i,
      `${file} claims a CI code review`);
  }
  assert.match(section(CLAUDE, "## 4. Task Lifecycle"), /CI is a corpus gate, not a code review/);
  assert.match(FRAMEWORK, /CI\s+is the corpus gate \(frontmatter \+ INDEX freshness\), not a code review/);
});

test("every instruction names the corpus config by its real path, scripts/corpus.config.mjs", () => {
  assert.ok(existsSync(join(TEMPLATES, "scripts", "corpus.config.mjs.template")));
  const engine = join("data", "templates", "scripts"); // the engine's own relative imports are correct as they are
  for (const file of docs().filter((f) => !f.includes(engine))) {
    const bare = read(file).match(/(?<![\w./-])corpus\.config\.mjs/);
    assert.ok(!bare, `${file}: \`corpus.config.mjs\` without its folder — it lives at scripts/corpus.config.mjs`);
  }
});

test("log_session is a runtime file: no template, and the README does not list it as scaffolded", () => {
  for (const name of ["log_session", "log_session.template"]) assert.ok(!existsSync(join(TEMPLATES, ".claude", name)));
  assert.doesNotMatch(section(README, "### What `/lifecycle-init` scaffolds (Tier B)"), /log_session/);
  assert.match(INIT, /`\.claude\/log_session` has no template — `\/log-activity`\s+creates it at runtime/);
});

// --- A shorter close --------------------------------------------------------------------------------------

test("KB curation: every Full and Research close; a Transitory close only when the session produced a report, spec or review", () => {
  const closeTask = read(join(skillsDir, "close-task", "SKILL.md"));
  assert.match(closeTask, /^### Knowledge-base curation — kb-curator \(Full \+ Research; Transitory only with a report, spec or review\)$/m);
  for (const file of [join(agentsDir, "kb-curator.md"), join(agentsDir, "pm.md"), join(skillsDir, "close-task", "SKILL.md"),
    join(skillsDir, "lifecycle-init", "SKILL.md"), join(skillsDir, "handshake", "SKILL.md"), join(TEMPLATES, ".claude", "CLAUDE.md.template"),
    join(REPO, "FRAMEWORK.md")]) {
    assert.match(read(file), /report, spec or review/, `${file} does not state the Transitory condition`);
  }
  assert.match(closeTask, /diff window: from the last `kb-curated` or `task-closed` line/, "a skipped Transitory close stays in the next window");
  assert.doesNotMatch(read(join(agentsDir, "kb-curator.md")), /all three variants|\(Full, Research,?\s+(?:AND\s+|and\s+|or\s+)?Transitory\)/,
    "kb-curator.md still claims every variant");

  // Every sentence or table cell that puts the kb-curator at a Transitory close (or at every close) states the
  // condition, or is visibly conditional itself. Fenced blocks are example output, not claims.
  const units = (text) => text.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n|\|/)
    .flatMap((block) => block.replace(/\s+/g, " ").split(/(?<=[.;])\s/));
  const curator = /kb-curator|KB curation|knowledge-base curation/i;
  const atTransitory = /transitory|every variant|all variants|every `\/close-task`|every close|all three/i;
  const conditional = /report, spec or review|when that runs|skipped|if the (kb-)?curator wrote|idempoten|null on a Transitory/i;
  for (const file of docs()) {
    for (const unit of units(read(file))) {
      assert.ok(!(curator.test(unit) && atTransitory.test(unit) && !conditional.test(unit)),
        `${file}: "${unit.slice(0, 140)}…" runs the kb-curator at a Transitory close without the condition`);
    }
  }
});
