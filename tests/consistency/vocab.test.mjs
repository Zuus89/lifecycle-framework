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

  // agents/code-reviewer.md — the inline frontmatter example
  const cr = read(join(agentsDir, "code-reviewer.md")).match(/^verdict: (.+)$/m);
  assert.ok(cr, "code-reviewer.md has no `verdict:` example line");
  sameSet(tokens(cr[1]), VERDICT_ENUMS["code-reviewer"], "agents/code-reviewer.md");

  // docs/_templates/review_code-reviewer.md — placeholder + guidance
  const tpl = read(join(TEMPLATES, "docs", "_templates", "review_code-reviewer.md.template"));
  for (const m of tpl.matchAll(/(?:verdict:|Verdict enum[^:]*:|\*\*Verdict:\*\*) <?(?:placeholder: )?([a-z_ |]+)>?/g)) {
    sameSet(tokens(m[1]), VERDICT_ENUMS["code-reviewer"], "review_code-reviewer.md.template");
  }
  assert.ok(!/SAFE \| NON-BLOCKING/.test(tpl), "the template must not carry the old uppercase vocabulary");

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
  assert.ok(dirs.length >= 8);
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

test("activity-log event vocabulary is single-sourced (log-activity ≡ log-tracker)", { todo: "CRI-1155 (PR2) folds /log-tracker into /log-activity and moves the vocabulary to corpus.config" }, () => {
  const events = (text) => new Set([...text.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]));
  const a = events(read(join(skillsDir, "log-activity", "SKILL.md")));
  const b = events(read(join(skillsDir, "log-tracker", "SKILL.md")));
  assert.deepEqual([...a].sort(), [...b].sort());
});
