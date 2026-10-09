// Every file under data/templates/ renders with dummy variables into something
// a scaffolded project can use: valid JSON, parseable YAML frontmatter, an
// importable corpus.config.mjs, and zero unresolved {{VAR}} placeholders.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { VAR_RE, renderScaffold, tmpDir } from "../_helpers.mjs";

let dir;
let files;

before(() => {
  dir = tmpDir("scaffold");
  files = renderScaffold(dir);
});

test("the scaffold has the expected size and no unresolved placeholders", () => {
  assert.ok(files.length >= 50, `expected ≥ 50 template files, got ${files.length}`);
  for (const f of files) {
    const left = [...f.content.matchAll(VAR_RE)].map((m) => m[1]);
    assert.deepEqual(left, [], `${f.src} still carries ${left.join(", ")}`);
  }
});

test("JSON templates parse after rendering", () => {
  const jsons = files.filter((f) => f.out.endsWith(".json"));
  assert.ok(jsons.length >= 3, "settings.json, .mcp.json, package.json");
  for (const f of jsons) assert.doesNotThrow(() => JSON.parse(f.content), `${f.src} is not valid JSON once rendered`);
  const settings = JSON.parse(files.find((f) => f.out === ".claude/settings.json").content);
  assert.equal(typeof settings.agents.linear_steward, "boolean");
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, "1");
});

test("markdown templates with frontmatter parse as YAML (docs/_templates excepted — placeholders on purpose)", () => {
  const governed = files.filter((f) => f.out.endsWith(".md") && !f.out.startsWith("docs/_templates/") && f.content.startsWith("---\n"));
  assert.ok(governed.length >= 10, "rules + strategy/architecture/chronicle/snapshot/TODO…");
  for (const f of governed) {
    const end = f.content.indexOf("\n---\n", 4);
    assert.ok(end > 0, `${f.src}: frontmatter never closes`);
    assert.doesNotThrow(() => yaml.load(f.content.slice(4, end)), `${f.src}: frontmatter YAML does not parse`);
  }
});

test("docs/_templates ship the ten governed document shapes, each with the sentinel header", () => {
  const templates = files.filter((f) => f.out.startsWith("docs/_templates/") && f.out.endsWith(".md"));
  assert.deepEqual(templates.map((f) => f.out.replace("docs/_templates/", "")).sort(), [
    "alpha_test.md", "council.md", "handoff.md", "kb_article.md", "report.md",
    "review_code-reviewer.md", "review_da.md", "review_de.md", "review_devils-advocate.md", "spec.md",
  ]);
  for (const f of templates) {
    assert.ok(f.content.startsWith("---\n"), `${f.src} must start with frontmatter`);
    assert.ok(f.content.includes("DELETE THIS HEADER BEFORE PUBLISHING"), `${f.src} must carry the sentinel R11 looks for`);
  }
});

test("the GitHub workflow template is valid YAML with the two jobs it documents", () => {
  const wf = yaml.load(files.find((f) => f.out === ".github/workflows/lint-frontmatter.yml").content);
  assert.deepEqual(Object.keys(wf.jobs).sort(), ["validate", "verify-index"]);
});

test("husky hooks are executable shell scripts that call the scaffolded scripts", () => {
  const hooks = files.filter((f) => f.out.startsWith(".husky/"));
  assert.deepEqual(hooks.map((f) => f.out).sort(), [".husky/post-commit", ".husky/pre-commit", ".husky/pre-push"]);
  assert.match(hooks.find((f) => f.out === ".husky/pre-commit").content, /validate-frontmatter\.mjs/);
  assert.match(hooks.find((f) => f.out === ".husky/pre-push").content, /build-index\.mjs/);
});

test("corpus.config.mjs renders into an importable module with the engine's contract", async () => {
  const cfg = await import(pathToFileURL(join(dir, "scripts", "corpus.config.mjs")).href);
  for (const name of ["TYPE_ENUM", "STATUS_ENUM", "AUTHORITY_ENUM", "VERDICT_ENUMS", "TICKET_REGEX", "AFFECTS_PREFIXES", "EXCLUDED_DIRS", "OUTPUT", "VALIDATOR"]) {
    assert.ok(name in cfg, `corpus.config.mjs must export ${name}`);
  }
  assert.equal(cfg.ticketKey, "ABC");
  assert.ok(cfg.TICKET_REGEX.test("ABC-12"));
  assert.ok(!cfg.TICKET_REGEX.test("XYZ-12"));
  assert.deepEqual([...cfg.VERDICT_ENUMS["code-reviewer"]], ["safe", "non_blocking", "not_safe_to_deploy"]);
});
