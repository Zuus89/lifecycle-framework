// linear_hygiene.mjs — the SessionStart hygiene detector, run against a local
// fake Linear GraphQL server (LINEAR_API_URL). No network, no real key.
// The detector runs as an async child: this process must keep serving.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, runNodeAsync, tmpDir, writeFile } from "../_helpers.mjs";

const SCRIPT = join(REPO, "hooks", "linear_hygiene.mjs");

// --- Fixture workspace ---------------------------------------------------------
const P1 = { id: "p1", name: "Website", slugId: "web1", status: { name: "In Progress", type: "started" }, initiatives: { nodes: [{ id: "i1", name: "Alpha" }] }, labels: { nodes: [] } };
const P2 = { id: "p2", name: "Orphaned Project", slugId: "orp1", status: { name: "Backlog", type: "backlog" }, initiatives: { nodes: [] }, labels: { nodes: [] } };
const P3 = { id: "p3", name: "Finished", slugId: "fin1", status: { name: "Completed", type: "completed" }, initiatives: { nodes: [{ id: "i1", name: "Alpha" }] }, labels: { nodes: [{ name: "Foundation" }] } };
const PROJECTS = [P1, P2, P3];
const INITIATIVES = [
  { id: "i1", name: "Alpha", projects: { nodes: [{ id: "p1" }, { id: "p3" }] } },
  { id: "i2", name: "Beta", projects: { nodes: [] } },
  { id: "i3", name: "beta", projects: { nodes: [] } },
  { id: "i4", name: "Foundation", projects: { nodes: [] } },
];
const issue = (id, identifier, title, type, project, parent) => ({ id, identifier, title, state: { type }, project: project ? { id: project } : null, parent: parent ? { id: parent } : null });
const ISSUES = [
  issue("x1", "X-1", "[Site] shipped umbrella", "completed", "p1", null),
  issue("x2", "X-2", "[Site] open child of a done parent", "backlog", "p1", "x1"),
  issue("x3", "X-3", "[Site] in progress", "started", "p1", null),
  issue("x4", "X-4", "[Site] done", "completed", "p1", null),
  issue("x5", "X-5", "no prefix here", "backlog", "p1", null),
  issue("x20", "X-20", "[Fin] still open in a completed project", "backlog", "p3", null),
  issue("x10", "X-10", "[Site] orphan with the project's prefix", "backlog", null, null),
  issue("x11", "X-11", "[Other] orphan with a foreign prefix", "backlog", null, null),
  issue("x12", "X-12", "orphan whose parent is filed", "backlog", null, "x3"),
];
const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

let server;
let url;
let mode = "ok"; // ok | authError | complexProjects
let hits = [];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { query, variables } = JSON.parse(body);
      hits.push(query.replace(/\s+/g, " ").slice(0, 60));
      const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.headers.authorization !== "test-key" || mode === "authError") {
        return send(400, { errors: [{ message: "Authentication required, not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] });
      }
      if (query.includes("organization {")) return send(200, { data: { organization: { name: "TestOrg" } } });
      if (query.includes("initiatives(first: $first")) return send(200, { data: { initiatives: page(INITIATIVES) } });
      if (query.includes("projectLabels(first: $first")) return send(200, { data: { projectLabels: page([{ name: "Foundation" }]) } });
      if (query.includes("projects(first: $first")) {
        if (mode === "complexProjects") return send(400, { errors: [{ message: "Query too complex" }] });
        return send(200, { data: { projects: page(PROJECTS) } });
      }
      if (query.includes("issues(first: $first")) {
        if (query.includes("project: { id:")) return send(200, { data: { issues: page(ISSUES.filter((i) => i.project?.id === variables.projectId)) } });
        if (query.includes("project: { null: true }")) return send(200, { data: { issues: page(ISSUES.filter((i) => !i.project)) } });
        return send(200, { data: { issues: page(ISSUES) } });
      }
      send(400, { errors: [{ message: `Cannot query field in: ${query.slice(0, 40)}` }] });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/graphql`;
});
after(() => server.close());

function project(name, { flag = true, project: trackerProject = "Website" } = {}) {
  const dir = tmpDir(`detector-${name}`);
  writeFile(join(dir, ".claude", "settings.json"), JSON.stringify({ tracker: { type: "linear", project: trackerProject }, agents: { linear_steward: flag } }));
  return dir;
}

function run(dir, args = [], env = {}) {
  hits = [];
  return runNodeAsync(SCRIPT, args, { env: { CLAUDE_PROJECT_DIR: dir, LINEAR_API_URL: url, LINEAR_API_KEY: "test-key", ...env } });
}

const cacheOf = (dir) => JSON.parse(readFileSync(join(dir, ".claude", ".local", "linear-hygiene-cache.json"), "utf8"));

test("flag off: prints nothing and exits 0", async () => {
  const r = await run(project("off", { flag: false }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(hits.length, 0, "no request leaves the machine when the flag is off");
});

test("flag on, no key anywhere: one notice line", async () => {
  const r = await run(project("nokey"), [], { LINEAR_API_KEY: "" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  assert.match(r.stdout, /no LINEAR_API_KEY/);
});

test("the key is read from .claude/.local/secrets.env (last non-empty assignment wins)", async () => {
  const dir = project("secrets");
  writeFile(join(dir, ".claude", ".local", "secrets.env"), "# stub\nLINEAR_API_KEY=\nexport LINEAR_API_KEY=\"test-key\"\n");
  const r = await run(dir, ["--force"], { LINEAR_API_KEY: "" });
  assert.match(r.stdout, /^## Linear hygiene — project "Website"/);
});

test("tracker.project empty: one notice line", async () => {
  const r = await run(project("noproject", { project: "" }));
  assert.match(r.stdout.trim(), /^linear-steward detector: no project configured/);
});

test("project scope: the six checks against the fixture, then cached on the second run", async () => {
  const dir = project("scope");
  const live = await run(dir);
  assert.equal(live.status, 0, live.stderr);
  const out = live.stdout;
  assert.match(out, /^## Linear hygiene — project "Website" \(TestOrg\) — \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(live\)/);
  assert.match(out, /status In Progress · 5 issues \(3 open\)/);
  assert.match(out, /- ok {2}Project outside exactly one initiative: 0/);
  assert.match(out, /- ok {2}Project status inconsistent with its issues: 0/);
  assert.match(out, /- !! {2}Done\/Canceled parents with open children: 1 — X-1 \(1 open\)/);
  assert.match(out, /- !! {2}Open issues without a \[Prefix\] title: 1 — X-5/);
  assert.match(out, /- !! {2}Issues without project carrying this project's prefixes: 1 \(of 3 orphans workspace-wide; prefixes with ≥3 filed issues: site\) — X-10 \[Site\]/);
  assert.match(out, /- !! {2}Issues without project whose parent is in this project: 1 — X-12 \(child of X-3\)/);
  assert.match(out, /Drift: 4 check\(s\) failing → PM: spawn the linear-steward agent with scope: project "Website"/);

  const cachePath = join(dir, ".claude", ".local", "linear-hygiene-cache.json");
  assert.ok(existsSync(cachePath), "the own-project report is cached");
  const cache = cacheOf(dir);
  assert.equal(cache.scope, "project");
  assert.equal(cache.project.name, "Website");
  assert.deepEqual(cache.checks.map((c) => c.key), ["project_initiative", "project_status", "closed_parents_open_children", "open_without_prefix", "orphans_with_project_prefix", "orphans_with_parent_here"]);
  assert.deepEqual(cache.checks.find((c) => c.key === "orphans_with_parent_here").ids, ["X-12 (child of X-3)"]);

  const cached = await run(dir);
  assert.match(cached.stdout, /\(cached; --force refreshes\)/);
  assert.equal(hits.length, 0, "a cache hit makes no request");
});

test("--project <other> runs live and never overwrites the own-project cache", async () => {
  const dir = project("other");
  await run(dir); // warm the own-project cache
  const r = await run(dir, ["--project", "Finished", "--force"]);
  assert.match(r.stdout, /^## Linear hygiene — project "Finished" \(TestOrg\) — .* \(live\)/);
  assert.match(r.stdout, /- !! {2}Project status inconsistent with its issues: 1 — "Finished" is Completed but 1 issues are still open/);
  assert.equal(cacheOf(dir).project.name, "Website");
  assert.match((await run(dir)).stdout, /project "Website" .* \(cached/);
});

test("--scope workspace: the nine workspace checks, never cached", async () => {
  const dir = project("workspace");
  const r = await run(dir, ["--scope", "workspace", "--force"]);
  const out = r.stdout;
  assert.match(out, /^## Linear hygiene — workspace TestOrg/);
  assert.match(out, /4 initiatives · 3 projects · 9 issues \(7 open\)/);
  assert.match(out, /- !! {2}Issues without project: 3 \(3 open\) — X-10, X-11, X-12/);
  assert.match(out, /- !! {2}Projects without initiative: 1 — "Orphaned Project"/);
  assert.match(out, /- ok {2}Projects in more than one initiative: 0/);
  assert.match(out, /- !! {2}Initiatives with 0 projects: 3 — "Beta", "beta", "Foundation"/);
  assert.match(out, /- !! {2}Duplicate initiative names: 1 — "beta" ×2/);
  assert.match(out, /- !! {2}Initiative names colliding with project labels: 1 — "Foundation"/);
  assert.match(out, /- !! {2}Project status inconsistent with its issues: 1 — "Finished"/);
  assert.match(out, /- !! {2}Done\/Canceled parents with open children: 1 — X-1 \(1 open\)/);
  assert.match(out, /- !! {2}Open issues without a \[Prefix\] title: 2 — X-5, X-12/);
  assert.match(out, /Drift: 8 check\(s\) failing/);
  assert.ok(!existsSync(join(dir, ".claude", ".local", "linear-hygiene-cache.json")), "a workspace run writes no cache");
});

test("project not found: one notice line", async () => {
  const r = await run(project("notfound", { project: "No Such Project" }));
  assert.match(r.stdout.trim(), /^linear-steward detector: failed \(project "No Such Project" not found/);
});

test("authentication error (HTTP 400 + errors) is reported as a rejected key, once", async () => {
  mode = "authError";
  try {
    const r = await run(project("auth"));
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^linear-steward detector: failed \(LINEAR_API_KEY rejected/);
    assert.equal(hits.length, 1, "fails on the first (organization) request");
  } finally {
    mode = "ok";
  }
});

test("a complexity error degrades only the checks that need that data", async () => {
  mode = "complexProjects";
  try {
    const r = await run(project("complex"), ["--scope", "workspace", "--force"]);
    assert.match(r.stdout, /- \?\? {2}Projects without initiative: unavailable \(Query too complex\)/);
    assert.match(r.stdout, /- \?\? {2}Project status inconsistent with its issues: unavailable/);
    assert.match(r.stdout, /- !! {2}Issues without project: 3/);
    assert.match(r.stdout, /- !! {2}Initiative names colliding with project labels: 1/, "labels come from the catalog when projects are unavailable");
  } finally {
    mode = "ok";
  }
});
