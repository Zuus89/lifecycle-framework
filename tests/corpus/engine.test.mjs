// The scaffolded corpus engine (data/templates/scripts/*) over a rendered
// fixture project: validate-frontmatter.mjs and build-index.mjs.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES, baseEnv, read, render, runNode, tmpDir, writeFile } from "../_helpers.mjs";

let fx;
const script = (name) => join(fx, "scripts", name);

/** The engine as /lifecycle-init writes it into a project: scripts copied, corpus.config rendered. */
function installEngine(dir) {
  for (const f of ["_corpus-walk.mjs", "validate-frontmatter.mjs", "build-index.mjs", "affects-lookup.mjs"]) {
    writeFile(join(dir, "scripts", f), read(join(TEMPLATES, "scripts", f)));
  }
  writeFile(join(dir, "scripts", "corpus.config.mjs"), render(read(join(TEMPLATES, "scripts", "corpus.config.mjs.template"))));
}

const SPEC = `---
type: spec
title: "Fixture spec"
ticket: ABC-1
task_number: 1
tier: M
status: draft
authority: ssot
affects: [data.sales, module.billing]
depends_on: []
created: "2026-01-01"
updated: "2026-01-02"
tags: [fixture]
---

# Fixture spec
`;
const GOOD_REVIEW = `---
type: review
title: "Code Reviewer Review — Task 1"
ticket: ABC-1
status: done
authority: secondary
reviewer: code-reviewer
task_number: 1
verdict: safe
critical_count: 0
affects: []
created: "2026-01-03"
updated: "2026-01-03"
tags: [review]
---

# Review
`;
// Reviews carry their own tickets so by_ticket (one entry per ticket, last path wins) stays checkable.
const GOOD_REVIEW_2 = GOOD_REVIEW.replace("ticket: ABC-1", "ticket: ABC-2");
const BAD_VERDICT_REVIEW = GOOD_REVIEW
  .replace("ticket: ABC-1", "ticket: ABC-3")
  .replace("verdict: safe", "verdict: approve_with_followups")
  .replace('updated: "2026-01-03"', 'updated: "2026-01-04"')
  .replace("Task 1", "Task 2");
const ALPHA = `---
type: alpha_test
title: "Fixture alpha test"
ticket: ABC-1
task_number: 1
status: sealed
authority: ssot
designed_by: da
sealed_date: "2026-01-02"
affects: []
created: "2026-01-01"
updated: "2026-01-02"
tags: []
---

# Alpha test
`;

before(() => {
  fx = tmpDir("corpus");
  installEngine(fx);
  writeFile(join(fx, "docs", "claude_tasks", "01_fixture.md"), SPEC);
  writeFile(join(fx, "docs", "claude_tasks", "alpha_tests", "01_fixture.md"), ALPHA);
  writeFile(join(fx, "docs", "claude_tasks", "reviews", "2026-01-03_01_code-reviewer_review.md"), GOOD_REVIEW_2);
  writeFile(join(fx, "docs", "claude_tasks", "reviews", "2026-01-04_02_code-reviewer_review.md"), BAD_VERDICT_REVIEW);
  writeFile(join(fx, "docs", "no_frontmatter.md"), "# No frontmatter here\n");
  writeFile(join(fx, "docs", "_templates", "spec.md"), "---\ntype: <placeholder>\n---\n");
  writeFile(join(fx, "TODO.md"), "# TODO (human-owned, excluded)\n");
});

test("validate-frontmatter: a valid file passes with Files checked = 1", () => {
  const r = runNode(script("validate-frontmatter.mjs"), ["--root", fx, "docs/claude_tasks/01_fixture.md"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Files checked: {3}1/);
  assert.match(r.stdout, /PASS/);
});

test("validate-frontmatter: the whole fixture fails on R1 and R3b, and nothing else", () => {
  const r = runNode(script("validate-frontmatter.mjs"), ["--root", fx]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /docs\/no_frontmatter\.md: R1/);
  assert.match(r.stderr, /2026-01-04_02_code-reviewer_review\.md: R3b — verdict "approve_with_followups" is not valid for reviewer "code-reviewer"\. Allowed: safe, non_blocking, not_safe_to_deploy/);
  assert.match(r.stdout, /Hard violations: 2\b/);
  assert.match(r.stdout, /Files checked: {3}5/, "TODO.md and _templates/ are excluded from the walk");
});

test("validate-frontmatter: --warn-only exits 0 on the same violations", () => {
  const r = runNode(script("validate-frontmatter.mjs"), ["--warn-only", "--root", fx]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--warn-only/);
});

test("build-index: INDEX.md + index.json from the fixture, byte-stable across runs", () => {
  // GIT_DIR points at nothing so `git ls-files` fails → the engine treats the
  // fixture as a non-git corpus (allow all), exactly as its own comment says.
  const env = { GIT_DIR: join(fx, "no-such-git") };
  const first = runNode(script("build-index.mjs"), ["--root", fx], { env });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Files indexed: 4/);

  const indexJson = JSON.parse(readFileSync(join(fx, "docs", "index.json"), "utf8"));
  assert.equal(indexJson.files_indexed, 4);
  assert.equal(indexJson.generated_at, "2026-01-04", "content-derived: the max updated: in the corpus");
  // ABC-1 is carried by the spec and the alpha test; sorted by path, the alpha test comes last and wins.
  assert.equal(indexJson.by_ticket["ABC-1"].type, "alpha_test");
  assert.equal(indexJson.by_ticket["ABC-2"].path, "docs/claude_tasks/reviews/2026-01-03_01_code-reviewer_review.md");
  assert.deepEqual(Object.keys(indexJson.by_object).sort(), ["data.sales", "module.billing"]);
  assert.equal(indexJson.by_object["data.sales"][0].ticket, "ABC-1");

  const indexMd = readFileSync(join(fx, "docs", "INDEX.md"), "utf8");
  assert.match(indexMd, /^---\ntype: doc\ntitle: Repository Index/);
  assert.match(indexMd, /## Specs \(1\)/);
  assert.match(indexMd, /## Alpha tests \(1\)/);
  assert.match(indexMd, /## Reviews \(2\)/);
  assert.match(indexMd, /\| ABC-2 \| code-reviewer \| safe \|/);

  const second = runNode(script("build-index.mjs"), ["--root", fx], { env });
  assert.equal(second.status, 0);
  assert.equal(readFileSync(join(fx, "docs", "INDEX.md"), "utf8"), indexMd, "same source → same bytes");
  assert.ok(existsSync(join(fx, "docs", "index.json")));
});

test("validate-frontmatter: a spec's tier is S, M or L (R13); an active spec without one gets a warning (S2)", () => {
  const dir = tmpDir("tiers");
  installEngine(dir);
  const spec = (tier, status) => SPEC.replace("tier: M\n", tier ? `tier: ${tier}\n` : "").replace("status: draft", `status: ${status}`);
  writeFile(join(dir, "docs", "claude_tasks", "01_small.md"), spec("S", "draft"));
  writeFile(join(dir, "docs", "claude_tasks", "02_bad.md"), spec("XL", "draft"));
  writeFile(join(dir, "docs", "claude_tasks", "03_untiered.md"), spec(null, "in_progress"));
  writeFile(join(dir, "docs", "claude_tasks", "archive", "04_old.md"), spec(null, "done"));
  const r = runNode(join(dir, "scripts", "validate-frontmatter.mjs"), ["--root", dir]);
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 1);
  assert.match(out, /02_bad\.md: R13 — Invalid tier: "XL"\. Must be one of: S, M, L/);
  assert.match(out, /03_untiered\.md: S2 — spec has no tier: — it runs as M/);
  assert.doesNotMatch(out, /04_old\.md/, "a done spec from before tiers stays quiet");
  assert.doesNotMatch(out, /01_small\.md/);
  assert.match(r.stdout, /Hard violations: 1\b/);
});

test("validate-frontmatter --staged (the pre-commit hook): only staged docs are checked; nothing staged → exit 0", () => {
  const dir = tmpDir("staged");
  installEngine(dir);
  const git = (...args) => spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", ...args], { cwd: dir, encoding: "utf8", env: baseEnv() });
  assert.equal(git("init", "-q").status, 0);
  writeFile(join(dir, "docs", "claude_tasks", "01_good.md"), SPEC);
  writeFile(join(dir, "docs", "broken.md"), "# no frontmatter\n");
  const validate = () => runNode(join(dir, "scripts", "validate-frontmatter.mjs"), ["--warn-only", "--staged", "--root", dir]);

  const none = validate();
  assert.equal(none.status, 0);
  assert.match(none.stdout, /No staged \.md files — nothing to validate/);

  assert.equal(git("add", "docs/claude_tasks/01_good.md").status, 0);
  const one = validate();
  assert.match(one.stdout, /Files checked: {3}1\b/);
  assert.doesNotMatch(one.stdout + one.stderr, /broken\.md/, "an unstaged doc is not checked");

  assert.equal(git("add", "docs/broken.md").status, 0);
  const two = validate();
  assert.match(two.stdout, /Files checked: {3}2\b/);
  assert.match(two.stderr, /docs\/broken\.md: R1/);
  assert.equal(two.status, 0, "--warn-only never blocks the commit");
});
