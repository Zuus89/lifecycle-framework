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
  // A floor, not an exact count: it catches a scaffold that lost its files, not one that gained or retired one.
  assert.ok(files.length >= 45, `expected ≥ 45 template files, got ${files.length}`);
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

test("docs/_templates ship the eleven governed document shapes, each with the sentinel header", () => {
  const templates = files.filter((f) => f.out.startsWith("docs/_templates/") && f.out.endsWith(".md"));
  assert.deepEqual(templates.map((f) => f.out.replace("docs/_templates/", "")).sort(), [
    "alpha_test.md", "analysis.md", "council.md", "handoff.md", "kb_article.md", "report.md",
    "review_code-reviewer.md", "review_da.md", "review_de.md", "review_devils-advocate.md", "spec.md",
  ]);
  for (const f of templates) {
    assert.ok(f.content.startsWith("---\n"), `${f.src} must start with frontmatter`);
    assert.ok(f.content.includes("DELETE THIS HEADER BEFORE PUBLISHING"), `${f.src} must carry the sentinel R11 looks for`);
  }
});

test("the scaffold ships the nine governance rules", () => {
  const rules = files.filter((f) => f.out.startsWith(".claude/rules/")).map((f) => f.out.replace(".claude/rules/", "")).sort();
  assert.deepEqual(rules, [
    "code-style.md", "dependency-governance.md", "frontmatter.md", "git-workflow.md", "mcp-usage.md",
    "search-first.md", "security.md", "teammate.md", "testing.md",
  ]);
});

test("CI is one job, on pull requests only, installing js-yaml alone (the range package.json declares)", () => {
  const wf = yaml.load(files.find((f) => f.out === ".github/workflows/lint-frontmatter.yml").content);
  assert.deepEqual(Object.keys(wf.on), ["pull_request"], "no push trigger — one run per pull-request update");
  assert.deepEqual(Object.keys(wf.jobs), ["corpus"]);
  const runs = wf.jobs.corpus.steps.map((s) => s.run || "").join("\n");
  assert.doesNotMatch(runs, /npm ci\b/, "never installs the project's dependency tree");
  const range = JSON.parse(files.find((f) => f.out === "package.json").content).devDependencies["js-yaml"];
  assert.ok(runs.includes(`npm install --prefix "$RUNNER_TEMP/corpus-engine" --no-save --no-audit --no-fund "js-yaml@${range}"`),
    "CI installs exactly the js-yaml range the scaffolded package.json declares");
  assert.match(runs, /validate-frontmatter\.mjs docs \.claude/);
  assert.match(runs, /build-index\.mjs[\s\S]*git diff --exit-code -- docs\/INDEX\.md docs\/index\.json/);
});

test("one git hook: pre-commit validates only the staged docs, warn-only; the post-commit logger is gone", () => {
  const hooks = files.filter((f) => f.out.startsWith(".husky/"));
  assert.deepEqual(hooks.map((f) => f.out), [".husky/pre-commit"]);
  assert.match(hooks[0].content, /^git diff --cached --quiet --diff-filter=ACMR -- '\*\.md' && exit 0$/m, "code-only commits start no Node");
  assert.match(hooks[0].content, /^node scripts\/validate-frontmatter\.mjs --warn-only --staged$/m);
  assert.ok(!files.some((f) => f.out === "scripts/log-commit-activity.mjs"));
});

test("the spec template carries the tier; the snapshot carries what the session start reads", () => {
  const spec = files.find((f) => f.out === "docs/_templates/spec.md").content;
  assert.match(spec, /^tier: <placeholder: S \| M \| L/m);
  const snap = files.find((f) => f.out === "docs/context_snapshot.md").content;
  for (const h of ["State in force (read first)", "Next action", "Recent decisions (chronicle tail)", "Open decisions", "Dependencies of the task in flight", "Carry-over (still open)"]) {
    assert.ok(snap.split("\n").includes(`## ${h}`), `the snapshot template lacks "## ${h}"`);
  }
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
