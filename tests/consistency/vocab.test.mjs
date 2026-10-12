// Cross-file consistency: the vocabularies and references that several files
// repeat must agree with their single source — corpus.config.mjs for enums,
// the filesystem for agents and hook scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { REPO, TEMPLATES, read, render, tmpDir, writeFile } from "../_helpers.mjs";

const agentsDir = join(REPO, "agents");
const skillsDir = join(REPO, "skills");

/** Backtick-free, pipe-separated tokens: "`a` \| `b`" or "a | b" → ["a", "b"]. */
const tokens = (s) => s.split(/\\?\|/).map((t) => t.replace(/[`*\s]/g, "")).filter(Boolean);
const sameSet = (actual, expected, where) => assert.deepEqual([...actual].sort(), [...expected].sort(), `${where}: vocabulary differs from corpus.config`);

async function loadConfig() {
  const dir = tmpDir("consistency");
  const path = join(dir, "corpus.config.mjs");
  writeFile(path, render(read(join(TEMPLATES, "scripts", "corpus.config.mjs.template"))));
  return import(pathToFileURL(path).href);
}

function frontmatter(path) {
  const text = read(path);
  assert.ok(text.startsWith("---\n"), `${path} must start with frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  return yaml.load(text.slice(4, end));
}

test("verdict vocabularies: rules, templates, skills and agents equal corpus.config", async () => {
  const { VERDICT_ENUMS } = await loadConfig();

  // .claude/rules/frontmatter.md — the per-reviewer table
  const rules = read(join(TEMPLATES, ".claude", "rules", "frontmatter.md.template"));
  for (const reviewer of Object.keys(VERDICT_ENUMS)) {
    const row = rules.split("\n").find((l) => l.startsWith(`| \`${reviewer}\` |`));
    assert.ok(row, `frontmatter.md.template has no verdict row for ${reviewer}`);
    const cell = row.match(/^\| `[a-z-]+` \| [^|]* \| (.+?) \|\s*$/);
    assert.ok(cell, `frontmatter.md.template row for ${reviewer} has an unexpected shape`);
    sameSet(tokens(cell[1]), VERDICT_ENUMS[reviewer], `frontmatter.md.template row ${reviewer}`);
  }

  // The four review templates and the reviewing agents: every line that talks about a verdict and lists an enum
  // run (`a | b | c`) lists exactly that role's vocabulary, lowercase, as the validator enforces it.
  const enumRuns = (lines) => lines.flatMap((l) => [...l.matchAll(/[a-z_]+(?:\s*\|\s*[a-z_]+)+/g)].map((m) => m[0]));
  const reviewSources = {
    de: ["docs/_templates/review_de.md.template", "agents/de.md"],
    da: ["docs/_templates/review_da.md.template"],
    "code-reviewer": ["docs/_templates/review_code-reviewer.md.template"],
    "devils-advocate": ["docs/_templates/review_devils-advocate.md.template", "agents/devils-advocate.md"],
  };
  for (const [role, files] of Object.entries(reviewSources)) {
    for (const rel of files) {
      const file = rel.startsWith("agents/") ? join(REPO, rel) : join(TEMPLATES, rel);
      const verdictLines = read(file).split("\n").filter((l) => /verdict/i.test(l));
      const runs = enumRuns(verdictLines);
      assert.ok(runs.length >= 1, `${rel}: names no ${role} verdict vocabulary`);
      if (rel.endsWith(".template")) assert.ok(runs.length >= 2, `${rel}: the frontmatter and the header must both list the verdict enum`);
      for (const run of runs) sameSet(tokens(run), VERDICT_ENUMS[role], `${rel} (${role})`);
      assert.ok(!/\b[A-Z][A-Z_]{2,}\s*\|\s*[A-Z][A-Z_]{2,}\b/.test(verdictLines.join("\n")), `${rel}: uppercase verdict vocabulary`);
    }
  }

  // skills/new-doc — the sentence that names both enums
  const nd = read(join(skillsDir, "new-doc", "SKILL.md"));
  const crSentence = nd.match(/`code-reviewer` verdict enum is `([^`]+)`/);
  const daSentence = nd.match(/`devils-advocate` verdict enum is `([^`]+)`/);
  assert.ok(crSentence && daSentence, "new-doc must state both verdict enums");
  sameSet(tokens(crSentence[1]), VERDICT_ENUMS["code-reviewer"], "new-doc code-reviewer");
  sameSet(tokens(daSentence[1]), VERDICT_ENUMS["devils-advocate"], "new-doc devils-advocate");

  // agents/pm.md — the prompt templates
  const pm = read(join(agentsDir, "pm.md"));
  const pmCr = pm.match(/^Verdict \(frontmatter `verdict:`\): (.+)\.$/m);
  const pmDa = pm.match(/^Verdict: (attack[^.]+)\.$/m);
  assert.ok(pmCr && pmDa, "pm.md prompt templates must state the code-reviewer and devils-advocate verdicts");
  sameSet(tokens(pmCr[1]), VERDICT_ENUMS["code-reviewer"], "pm.md code-reviewer prompt");
  sameSet(tokens(pmDa[1]), VERDICT_ENUMS["devils-advocate"], "pm.md devils-advocate prompt");
});

test("every agent pm.md spawns exists, and every agent file has a coherent frontmatter", () => {
  const pm = read(join(agentsDir, "pm.md"));
  const list = pm.match(/subagent_type: the matching plugin agent — one of ([^\n]+(?:\n[^\n]+)?)/);
  assert.ok(list, "pm.md must list the plugin agent names it spawns");
  const names = [...list[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 6, `expected the roster, got ${names.join(", ")}`);
  for (const name of names) assert.ok(existsSync(join(agentsDir, `${name}.md`)), `pm.md spawns "${name}" but agents/${name}.md does not exist`);

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const fm = frontmatter(join(agentsDir, file));
    assert.equal(fm.name, file.replace(/\.md$/, ""), `${file}: name must equal the filename`);
    assert.ok(typeof fm.description === "string" && fm.description.length > 40, `${file}: description`);
    if (fm.model !== undefined) assert.match(String(fm.model), /^(claude-[a-z0-9.-]+|sonnet|opus|haiku|fable|inherit)$/, `${file}: model pin`);
    if (fm.tools !== undefined) assert.ok(Array.isArray(fm.tools) || typeof fm.tools === "string", `${file}: tools`);
  }
});

test("every skill directory holds a SKILL.md whose name matches the directory", () => {
  const dirs = readdirSync(skillsDir);
  assert.ok(dirs.length >= 7);
  for (const d of dirs) {
    const fm = frontmatter(join(skillsDir, d, "SKILL.md"));
    assert.equal(fm.name, d, `skills/${d}/SKILL.md: name must equal the directory`);
  }
});

test("hooks.json: scripts exist, matchers compile, SessionStart has a timeout", () => {
  const hooks = JSON.parse(read(join(REPO, "hooks", "hooks.json"))).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      assert.doesNotThrow(() => new RegExp(entry.matcher), `${event} matcher does not compile: ${entry.matcher}`);
      for (const h of entry.hooks) {
        assert.equal(h.type, "command");
        for (const m of h.command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([\w.]+)/g)) {
          assert.ok(existsSync(join(REPO, "hooks", m[1])), `${event}: hooks/${m[1]} referenced but missing`);
        }
        if (event === "SessionStart") assert.ok(Number.isInteger(h.timeout) && h.timeout <= 60, "SessionStart hooks must bound their runtime");
      }
    }
  }
  const linear = hooks.PreToolUse.find((e) => /inear/.test(e.matcher)).matcher;
  const re = new RegExp(linear);
  for (const name of ["mcp__linear__save_issue", "mcp__claude_ai_Linear__save_project", "mcp__plugin_x_linear__create_issue"]) assert.ok(re.test(name), name);
  for (const name of ["mcp__linear__get_issue", "mcp__linear__save_document"]) assert.ok(!re.test(name), name);
});

test("plugin.json and marketplace.json carry the same version", () => {
  const plugin = JSON.parse(read(join(REPO, ".claude-plugin", "plugin.json")));
  const marketplace = JSON.parse(read(join(REPO, ".claude-plugin", "marketplace.json")));
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(marketplace.metadata.version, plugin.version);
});

test("activity-log contract: the skill's event table ≡ corpus.config EVENTS; pm.md's event map ⊆ EVENTS; LOG_FIELDS and LOG_AGENTS are the documented ones", async () => {
  const { EVENTS, LOG_FIELDS, LOG_AGENTS } = await loadConfig();
  const tableEvents = (text) => [...text.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]).filter((e) => e !== "event");

  const skill = read(join(skillsDir, "log-activity", "SKILL.md"));
  const sectionB = skill.slice(skill.indexOf("## §B"), skill.indexOf("## §C"));
  assert.deepEqual(tableEvents(sectionB), Object.keys(EVENTS), "log-activity §B must list exactly EVENTS, in order");

  // pm.md's "Event-to-step map" (and its off-lifecycle line) may only name events that exist.
  const pm = read(join(agentsDir, "pm.md"));
  const start = pm.indexOf("Event-to-step map");
  const end = pm.indexOf("## What You Do", start);
  assert.ok(start > 0 && end > start, "pm.md must keep its Event-to-step map before ## What You Do");
  const pmEvents = [...pm.slice(start, end).matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(pmEvents.length >= 20, `expected the full event map in pm.md, found ${pmEvents.length} tokens`);
  for (const e of pmEvents) assert.ok(e in EVENTS, `pm.md names the event \`${e}\`, which is not in corpus.config EVENTS`);

  const exampleKeys = Object.keys(JSON.parse(skill.match(/```json\n([\s\S]+?)\n```/)[1]));
  assert.deepEqual(exampleKeys, LOG_FIELDS, "the §A example line must carry exactly LOG_FIELDS, in order");
  for (const id of ["pm", "de", "da", "code-reviewer", "devils-advocate", "kb-curator", "linear-steward", "human"]) assert.ok(LOG_AGENTS.has(id), id);
});

// --- One truth per format (CRI-1156) -------------------------------------------------------------------

const TEMPLATE_DIR = join(TEMPLATES, "docs", "_templates");
const walkFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(join(dir, e.name)) : [join(dir, e.name)]));
const agentFiles = () => readdirSync(agentsDir).map((f) => join(agentsDir, f));
const skillFiles = () => readdirSync(skillsDir).map((d) => join(skillsDir, d, "SKILL.md"));
const shippedText = () => [...agentFiles(), ...skillFiles(), ...walkFiles(TEMPLATES), join(REPO, "FRAMEWORK.md"), join(REPO, "README.md")];

/** /new-doc's destination table — the single convention for where each governed document lives. */
function newDocTable() {
  const text = read(join(skillsDir, "new-doc", "SKILL.md"));
  return [...text.matchAll(/^\| `([a-z_-]+)` \| `docs\/_templates\/([a-z_-]+\.md)` \| `([^`]+)` \|/gm)]
    .map(([, type, template, destination]) => ({ type, template, destination }));
}

/** A destination pattern as a regex: its placeholders match themselves or concrete example values. */
const destinationRe = (pattern) => new RegExp(`^${pattern
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  .replace(/YYYY-MM-DD/g, "(?:YYYY-MM-DD|\\d{4}-\\d{2}-\\d{2})")
  .replace(/NN/g, "(?:NN|\\d{2,})")
  .replace(/slug/g, "[a-z0-9][a-z0-9_-]*")}$`);

test("/new-doc's table and docs/_templates/ list the same document types", () => {
  const table = newDocTable();
  const templates = readdirSync(TEMPLATE_DIR).map((f) => f.replace(/\.template$/, "")).sort();
  assert.deepEqual(table.map((r) => r.template).sort(), templates, "every template has a /new-doc row and every row a template");
  for (const r of table) assert.equal(r.template, `${r.type}.md`, `${r.type}: the template is named after the type`);
  const skill = read(join(skillsDir, "new-doc", "SKILL.md"));
  const step1 = skill.match(/^ {3}`(spec \|[^`]+)`/m);
  assert.ok(step1, "/new-doc Step 1 must list the types");
  assert.deepEqual(tokens(step1[1]).sort(), table.map((r) => r.type).sort(), "/new-doc Step 1 lists exactly the table's types");
  assert.equal(Number(skill.match(/one template per type \((\d+) templates\)/)[1]), templates.length, "/new-doc states the template count");
});

test("every docs/claude_tasks/ path named anywhere is a /new-doc destination", () => {
  const allowed = [...newDocTable().map((r) => r.destination), "docs/claude_tasks/archive/NN_slug.md" /* /close-task's archive move */].map(destinationRe);
  for (const file of shippedText()) {
    for (const [mention] of read(file).matchAll(/docs\/claude_tasks\/[A-Za-z0-9<>{}_./-]*?\.md\b/g)) {
      const path = mention.replace(/[<>{}]/g, "");
      assert.ok(allowed.some((re) => re.test(path)), `${file}: \`${mention}\` is not a /new-doc destination`);
    }
  }
});

test("no agent or skill restates the structure of a templated document", () => {
  for (const file of [...agentFiles(), ...skillFiles()]) {
    for (const [, block] of read(file).matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
      assert.ok(!/^type: (spec|alpha_test|report|review|council|handoff)\s*$/m.test(block) && !/^reviewer: /m.test(block),
        `${file}: a fenced block restates a templated document's frontmatter — point to the template instead`);
      assert.ok(!/^# (Task Report|Analysis Report|Data Analysis|Council Verdict|Devil's|Code Review|Alpha-Test Execution)/m.test(block),
        `${file}: a fenced block restates a templated document's body — point to the template instead`);
    }
  }
});

test("templates carry the sections their protocols depend on", () => {
  const headings = (file) => new Set([...read(join(TEMPLATE_DIR, file)).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));
  const required = {
    "council.md.template": ["Question", "Decision", "Unresolved questions", "Accepted risks", "Reopen criteria", "Human verdict (Step 7)", "Council meta"],
    "review_devils-advocate.md.template": ["Grounded attacks", "Speculation (quarantined)", "No objection found in", "Confidence note"],
    "review_code-reviewer.md.template": ["Verdict", "CRITICAL", "WARNING", "SUGGESTION", "SCHEMA", "Summary"],
    "alpha_test.md.template": ["Derivation rule", "Ground truth cases", "Pass/fail criteria", "Seal record", "Execution log (Step 8)", "Post-seal discoveries"],
    "analysis.md.template": ["Summary", "Methodology", "Findings", "Recommendations"],
    "report.md.template": ["Summary", "Spec deviations", "Validation results", "Self-review confirmation", "Lessons learned"],
  };
  for (const [file, list] of Object.entries(required)) {
    for (const h of list) assert.ok(headings(file).has(h), `${file} lacks "## ${h}"`);
  }
});

test("the DE self-review checklist and the report template's self-review table carry the same checks", () => {
  const rows = (text) => [...text.matchAll(/^\| (\d+) \| ([^|]+?) \|/gm)].map((m) => `${m[1]}. ${m[2].trim()}`);
  const de = read(join(agentsDir, "de.md"));
  const deRows = rows(de.slice(de.indexOf("## 3. Self-review"), de.indexOf("## 4.")));
  const tpl = read(join(TEMPLATE_DIR, "report.md.template"));
  const tplSection = tpl.slice(tpl.indexOf("## Self-review confirmation"), tpl.indexOf("## Lessons learned"));
  assert.ok(deRows.length >= 10, `expected the DE checklist, found ${deRows.length} rows`);
  assert.deepEqual(rows(tplSection), deRows);
  assert.match(tplSection, new RegExp(`All ${deRows.length} points verified`));
});

test("teammate protocol: one rule, pointed to by every teammate agent, restated by none", () => {
  assert.ok(existsSync(join(TEMPLATES, ".claude", "rules", "teammate.md.template")));
  for (const name of ["de", "da", "data-reviewer", "devils-advocate", "code-reviewer"]) {
    const text = read(join(agentsDir, `${name}.md`));
    assert.match(text, /\.claude\/rules\/teammate\.md/, `${name}.md must point to the teammate rule`);
    assert.ok(!/^## (Teammate Protocol|Session Start Checklist|Record Findings in the Corpus|Reference Files|Reference)\s*$/m.test(text),
      `${name}.md still restates a section the teammate rule owns`);
  }
});

test("the basic-memory caveat lives once — in the mcp-usage rule", () => {
  for (const file of shippedText()) {
    assert.ok(!/If the project enabled basic-memory/.test(read(file)), `${file} restates the basic-memory caveat`);
  }
  const mcp = read(join(TEMPLATES, ".claude", "rules", "mcp-usage.md.template"));
  assert.match(mcp, /### Opt-in: the `basic-memory` MCP/);
  assert.match(mcp, /the corpus remains the default and the source of\s+truth/);
});

test("/log-tracker is gone: no skill directory and no mention left in the shipped files", () => {
  assert.ok(!existsSync(join(skillsDir, "log-tracker")), "skills/log-tracker must not exist");
  const shipped = [
    ...readdirSync(agentsDir).map((f) => join(agentsDir, f)),
    ...readdirSync(skillsDir).map((d) => join(skillsDir, d, "SKILL.md")),
    join(REPO, "README.md"), join(REPO, "FRAMEWORK.md"), join(REPO, "hooks", "hooks.json"),
  ];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of [...shipped, ...walk(TEMPLATES)]) {
    assert.ok(!/log-tracker/.test(read(file)), `${file} still mentions log-tracker`);
  }
});

// --- Tiers, one hook, two-read session start (CRI-1157) ------------------------------------------------

test("task tiers: one table in pm.md, mirrored in FRAMEWORK.md, enumerated in corpus.config and the spec template", async () => {
  const { TIER_ENUM } = await loadConfig();
  const tierRows = (text) => Object.fromEntries([...text.matchAll(/^\| \*\*([SML])\*\* \| [^|]+ \| ([^|]+) \|\s*$/gm)].map((m) => [m[1], m[2].trim()]));
  const pm = tierRows(read(join(agentsDir, "pm.md")));
  assert.deepEqual(Object.keys(pm).sort(), [...TIER_ENUM].sort(), "pm.md's tier table names exactly TIER_ENUM");
  assert.deepEqual(tierRows(read(join(REPO, "FRAMEWORK.md"))), pm, "FRAMEWORK.md's tier table runs the same steps as pm.md's");
  const spec = read(join(TEMPLATE_DIR, "spec.md.template")).match(/^tier: <placeholder: ([^—>]+)/m);
  assert.ok(spec, "the spec template must carry a tier placeholder");
  sameSet(tokens(spec[1]), TIER_ENUM, "spec template tier placeholder");
  const claude = read(join(TEMPLATES, ".claude", "CLAUDE.md.template"));
  assert.match(claude, /\*\*Task tiers:\*\*/);
  assert.doesNotMatch(claude + read(join(agentsDir, "pm.md")), /\*\*Shortcuts/, "tiers replace the shortcuts the human had to invoke");
});

test("session start: CLAUDE.md §3 is three steps and two reads; pm.md points to it instead of repeating it", () => {
  const claude = read(join(TEMPLATES, ".claude", "CLAUDE.md.template"));
  const s3 = claude.slice(claude.indexOf("## 3. Session Start Protocol"), claude.indexOf("## 4."));
  assert.deepEqual([...s3.matchAll(/^(\d+)\. /gm)].map((m) => m[1]), ["0", "1", "2"]);
  assert.match(s3, /^1\. \*\*Read `docs\/context_snapshot\.md`\*\*/m);
  assert.match(s3, /^2\. \*\*Read the spec in flight\*\*/m);
  const pm = read(join(agentsDir, "pm.md"));
  assert.doesNotMatch(pm, /^## Session-Start Checklist/m);
  assert.match(pm, /^## Session Start\n\nRun the Session Start Protocol in `CLAUDE\.md` §3/m);
});

test("the retired hooks stay retired: no template, no `committed` event, nothing that relies on them", async () => {
  const { EVENTS } = await loadConfig();
  assert.ok(!("committed" in EVENTS), "commits are not logged — git log is their record");
  for (const f of ["post-commit", "pre-push"]) assert.ok(!existsSync(join(TEMPLATES, ".husky", f)), `.husky/${f} must not be scaffolded`);
  assert.ok(!existsSync(join(TEMPLATES, "scripts", "log-commit-activity.mjs")));
  for (const file of shippedText()) {
    if (file.endsWith(join("lifecycle-init", "SKILL.md"))) continue; // its §7 lists the retired files, to remove them
    assert.doesNotMatch(read(file), /log-commit-activity|\.husky\/(post-commit|pre-push)/, `${file} still relies on a retired hook`);
  }
});
