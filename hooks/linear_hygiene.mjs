#!/usr/bin/env node
/**
 * SessionStart hook: Linear hygiene detector (linear-steward, layer 2).
 *
 * Plugin-resident (Tier A), flag-gated, deterministic, READ-ONLY. At session
 * startup in a repo whose .claude/settings.json has `agents.linear_steward:
 * true`, it prints the hygiene checklist for THIS REPO'S PROJECT — the one
 * `settings.json → tracker.project` names — into the session context, so the
 * PM can spawn the linear-steward agent on drift. It never looks beyond that
 * project unless asked (`--scope workspace`, a manual run only), and it never
 * writes to Linear: query operations only, by construction.
 *
 * Wiring (hooks/hooks.json, SessionStart, matcher `startup`):
 *   grep -qE '"linear_steward"[[:space:]]*:[[:space:]]*true' "$CLAUDE_PROJECT_DIR/.claude/settings.json"
 *     && node "${CLAUDE_PLUGIN_ROOT}/hooks/linear_hygiene.mjs"; exit 0
 * The shell-level grep is the fast path: with the flag off, Node never starts
 * (Node's bare startup alone exceeds the 50 ms budget). The flag is re-read
 * here as the authoritative check.
 *
 * Inputs (read at runtime, never hardcoded):
 *   - CLAUDE_PROJECT_DIR (set by Claude Code for hooks; cwd as fallback).
 *   - .claude/settings.json → agents.linear_steward (boolean; absent = off)
 *     and tracker.project (the Linear project name — or id — this repo lives
 *     under; resolved live, case-insensitive).
 *   - LINEAR_API_KEY: the environment first, else the gitignored
 *     .claude/.local/secrets.env (KEY=value lines, last non-empty assignment).
 *     A personal API key is sent as the raw `Authorization` header value.
 *     The key is never printed.
 *   - Cache: .claude/.local/linear-hygiene-cache.json, 12 h, written only for
 *     the repo's own project. It stores the STRUCTURED report — every check
 *     with its full id list — so the linear-steward agent can read it as its
 *     input; stdout shows at most 15 ids per check. `--force` bypasses the
 *     cache AND the flag (manual run).
 *
 * Manual runs:
 *   node "<plugin>/hooks/linear_hygiene.mjs" --force                       # this repo's project (refreshes the cache)
 *   node "<plugin>/hooks/linear_hygiene.mjs" --force --project "<name>"    # another project (never cached)
 *   node "<plugin>/hooks/linear_hygiene.mjs" --force --scope workspace     # the whole workspace — the quarterly §7
 *                                                                          # sweep, on request only (never cached)
 *
 * Output: plain text on stdout, exit 0 → added to Claude's context. Every
 * failure mode (no key, key rejected, project not found, network, timeout) is
 * a one-line notice and exit 0 — a hygiene check never blocks a session. Data
 * sets are fetched independently, so one unsupported schema field degrades
 * the checks that need it, not the whole report.
 *
 * Requires: Node 24 (global fetch, AbortController). No dependencies.
 */
import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.linear.app/graphql";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 250;
const NESTED_PAGE_SIZE = 50; // Linear bounds complexity by `first` × nested `first`
const MAX_PAGES = 40;
const MAX_LISTED = 15;
const MIN_PREFIX_EVIDENCE = 3; // a prefix "belongs" to a project from 3 filed issues (rule §4.2)

const OPEN_TYPES = new Set(["triage", "backlog", "unstarted", "started"]);
const PREFIX_RE = /^\[([^\]]+)\]/;

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const localDir = path.join(projectDir, ".claude", ".local");
const settingsPath = path.join(projectDir, ".claude", "settings.json");
const secretsPath = path.join(localDir, "secrets.env");
const cachePath = path.join(localDir, "linear-hygiene-cache.json");

const out = (line) => process.stdout.write(`${line}\n`);
const notice = (msg) => out(`linear-steward detector: ${msg} — hygiene check skipped.`);
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });

// --- Config -----------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readApiKey() {
  const fromEnv = (process.env.LINEAR_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  let text;
  try {
    text = fs.readFileSync(secretsPath, "utf8");
  } catch {
    return "";
  }
  // Last non-empty assignment wins (shell semantics): the scaffolded stub
  // carries an empty `LINEAR_API_KEY=` line that a real value may follow.
  let key = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim().replace(/^export\s+/, "") !== "LINEAR_API_KEY") continue;
    const value = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    if (value) key = value;
  }
  return key;
}

// Scope: this repo's project by default; the workspace only on explicit
// request from the command line (never from settings — a session start must
// not sweep other projects' tickets).
function resolveScope(settings) {
  const scope = argValue("--scope") === "workspace" ? "workspace" : "project";
  const ownProject = String(settings?.tracker?.project || "").trim();
  const projectRef = String(argValue("--project") || ownProject).trim();
  return { scope, projectRef, isOwnProject: scope === "project" && !argValue("--project") };
}

// --- Linear GraphQL (queries only) -----------------------------------------

async function gql(key, query, variables = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    throw fatal(`network: ${err.name === "AbortError" ? `timeout after ${REQUEST_TIMEOUT_MS} ms` : err.message}`);
  } finally {
    clearTimeout(timer);
  }
  // Linear answers GraphQL-level problems — including authentication — as
  // HTTP 400 with an `errors` array, so read the body before the status.
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const errors = body?.errors;
  if (errors?.length) {
    const message = errors.map((e) => e.message).join("; ");
    const codes = errors.map((e) => e.extensions?.code).filter(Boolean);
    if (codes.includes("AUTHENTICATION_ERROR") || /authenticat/i.test(message)) throw fatal(`LINEAR_API_KEY rejected (${message})`);
    if (codes.includes("RATELIMITED") || res.status === 429) throw fatal(`rate limited by Linear (${message})`);
    // Unknown field / complexity: NOT fatal — the caller marks the affected
    // checks unavailable and the rest still run.
    throw new Error(message);
  }
  if (res.status === 401 || res.status === 403) throw fatal(`LINEAR_API_KEY rejected (HTTP ${res.status})`);
  if (res.status === 429) throw fatal("rate limited by Linear (HTTP 429)");
  if (!res.ok || !body?.data) throw fatal(`HTTP ${res.status}`);
  return body.data;
}

// Every node of a paginated root connection.
async function fetchAll(key, query, root, pageSize = PAGE_SIZE, variables = {}) {
  const nodes = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const conn = (await gql(key, query, { ...variables, first: pageSize, after }))[root];
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes;
}

// Try query variants in order; fall through only on an unknown-field error
// (older/newer schema), never on a fatal transport/auth error.
async function fetchAllWithFallback(key, variants, root, pageSize) {
  let lastErr;
  for (const query of variants) {
    try {
      return await fetchAll(key, query, root, pageSize);
    } catch (err) {
      if (err.fatal || !/Cannot query field/i.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

const ISSUE_FIELDS = "id identifier title state { type } project { id } parent { id }";
const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const Q_ORG = `{ organization { name } }`;
const Q_INITIATIVES = `query($first: Int!, $after: String) {
  initiatives(first: $first, after: $after) {
    nodes { id name projects(first: 50) { nodes { id } } }
    ${PAGE_INFO}
  }
}`;
const Q_PROJECTS = `query($first: Int!, $after: String) {
  projects(first: $first, after: $after) {
    nodes {
      id name slugId status { name type }
      initiatives(first: 5) { nodes { id name } }
      labels(first: 25) { nodes { name } }
    }
    ${PAGE_INFO}
  }
}`;
const Q_PROJECTS_NO_LABELS = Q_PROJECTS.replace(/\s*labels\(first: 25\) \{ nodes \{ name \} \}/, "");
const Q_ISSUES = `query($first: Int!, $after: String) {
  issues(first: $first, after: $after) { nodes { ${ISSUE_FIELDS} } ${PAGE_INFO} }
}`;
const Q_PROJECT_ISSUES = `query($first: Int!, $after: String, $projectId: ID!) {
  issues(first: $first, after: $after, filter: { project: { id: { eq: $projectId } } }) {
    nodes { ${ISSUE_FIELDS} } ${PAGE_INFO}
  }
}`;
const Q_ORPHAN_ISSUES = `query($first: Int!, $after: String) {
  issues(first: $first, after: $after, filter: { project: { null: true } }) {
    nodes { ${ISSUE_FIELDS} } ${PAGE_INFO}
  }
}`;
const Q_PROJECT_LABELS = `query($first: Int!, $after: String) {
  projectLabels(first: $first, after: $after) { nodes { name } ${PAGE_INFO} }
}`;

// A non-fatal fetch failure becomes { error } so one check degrades, not all.
const part = async (fetcher) => {
  try {
    return { data: await fetcher() };
  } catch (err) {
    if (err.fatal) throw err;
    return { error: err.message };
  }
};

const lower = (s) => String(s || "").trim().toLowerCase();

function findProject(projects, ref) {
  const wanted = lower(ref);
  return projects.find((p) => p.id === ref || p.slugId === ref || lower(p.name) === wanted) || null;
}

async function collectProject(key, projectRef) {
  // The organization query doubles as the key check: a rejected key fails
  // here, once, before any paginated fetch.
  const orgName = (await gql(key, Q_ORG)).organization?.name || "workspace";
  const projects = await fetchAllWithFallback(key, [Q_PROJECTS, Q_PROJECTS_NO_LABELS], "projects", NESTED_PAGE_SIZE);
  const project = findProject(projects, projectRef);
  if (!project) throw fatal(`project "${projectRef}" not found in Linear (settings.json → tracker.project)`);
  return {
    orgName,
    project,
    issues: await part(() => fetchAll(key, Q_PROJECT_ISSUES, "issues", PAGE_SIZE, { projectId: project.id })),
    orphans: await part(() => fetchAll(key, Q_ORPHAN_ISSUES, "issues")),
  };
}

async function collectWorkspace(key) {
  const orgName = (await gql(key, Q_ORG)).organization?.name || "workspace";
  return {
    orgName,
    initiatives: await part(() => fetchAll(key, Q_INITIATIVES, "initiatives", NESTED_PAGE_SIZE)),
    projects: await part(() => fetchAllWithFallback(key, [Q_PROJECTS, Q_PROJECTS_NO_LABELS], "projects", NESTED_PAGE_SIZE)),
    issues: await part(() => fetchAll(key, Q_ISSUES, "issues")),
    projectLabels: await part(() => fetchAll(key, Q_PROJECT_LABELS, "projectLabels")),
  };
}

// --- Checks (the §7 checklist) ---------------------------------------------
// A check is a structured record (cached in full for the steward); rendering
// truncates the id list for the session context.

const check = (key, label, ids, detail = "") => ({ key, label, drift: ids.length > 0, count: ids.length, ids, detail });
const unavailable = (key, label, error) => ({ key, label, drift: false, count: 0, ids: [], detail: "", unavailable: error });

function listed(items) {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown} (+${items.length - MAX_LISTED} more)` : shown;
}

function renderCheck(c) {
  if (c.unavailable) return `- ??  ${c.label}: unavailable (${c.unavailable})`;
  if (!c.drift) return `- ok  ${c.label}: 0`;
  return `- !!  ${c.label}: ${c.count}${c.detail ? ` ${c.detail}` : ""} — ${listed(c.ids)}`;
}

// Per-project issue counts, children by parent, open total — shared by both scopes.
function indexIssues(issues) {
  const byProject = new Map();
  const childrenOf = new Map();
  let open = 0;
  for (const issue of issues) {
    const type = issue.state?.type;
    const isOpen = OPEN_TYPES.has(type);
    if (isOpen) open++;
    if (issue.project) {
      const c = byProject.get(issue.project.id) || { total: 0, open: 0, started: 0, completed: 0 };
      c.total++;
      if (isOpen) c.open++;
      if (type === "started") c.started++;
      if (type === "completed") c.completed++;
      byProject.set(issue.project.id, c);
    }
    if (issue.parent) {
      const kids = childrenOf.get(issue.parent.id) || [];
      kids.push(issue);
      childrenOf.set(issue.parent.id, kids);
    }
  }
  return { byProject, childrenOf, open };
}

const EMPTY_COUNTS = { total: 0, open: 0, started: 0, completed: 0 };

function statusDrift(project, c) {
  const type = project.status?.type;
  const name = project.status?.name || type;
  if ((type === "backlog" || type === "planned") && (c.started > 0 || c.completed > 0)) {
    return `is ${name} but has ${c.started} started / ${c.completed} completed issues`;
  }
  if (type === "started" && c.total > 0 && c.open === 0) return `is ${name} but all ${c.total} issues are completed/canceled`;
  if ((type === "completed" || type === "canceled") && c.open > 0) return `is ${name} but ${c.open} issues are still open`;
  return null;
}

function closedParentsWithOpenChildren(issues, childrenOf) {
  const stale = [];
  for (const parent of issues) {
    if (OPEN_TYPES.has(parent.state?.type)) continue;
    const open = (childrenOf.get(parent.id) || []).filter((k) => OPEN_TYPES.has(k.state?.type));
    if (open.length) stale.push(`${parent.identifier} (${open.length} open)`);
  }
  return stale;
}

const openWithoutPrefix = (issues) =>
  issues.filter((i) => OPEN_TYPES.has(i.state?.type) && !PREFIX_RE.test(i.title || "")).map((i) => i.identifier);

const prefixOf = (issue) => lower(PREFIX_RE.exec(issue.title || "")?.[1]);

function analyzeProject({ orgName, project, issues, orphans }) {
  const checks = [];
  const initiatives = project.initiatives?.nodes || [];

  // 1. Exactly one initiative (rule §1).
  checks.push(check("project_initiative", "Project outside exactly one initiative", initiatives.length === 1 ? []
    : [`${initiatives.length} initiatives (${initiatives.map((i) => `"${i.name}"`).join(", ") || "none"})`]));

  let openIssues = 0;
  if (issues.data) {
    // Orphans ride along in the child index so a Done parent here still sees
    // an open child that was filed nowhere (counts stay project-only: an
    // orphan has no project to count under).
    const idx = indexIssues(issues.data.concat(orphans.data || []));
    openIssues = issues.data.filter((i) => OPEN_TYPES.has(i.state?.type)).length;
    // 2. Status vs the issue evidence (rule §6).
    const drift = statusDrift(project, idx.byProject.get(project.id) || EMPTY_COUNTS);
    checks.push(check("project_status", "Project status inconsistent with its issues", drift ? [`"${project.name}" ${drift}`] : []));
    // 3. Done/Canceled parents (in the project) with open children.
    checks.push(check("closed_parents_open_children", "Done/Canceled parents with open children", closedParentsWithOpenChildren(issues.data, idx.childrenOf)));
    // 4. Open issues without a [Prefix] title (rule §4.2).
    checks.push(check("open_without_prefix", "Open issues without a [Prefix] title", openWithoutPrefix(issues.data)));
    // 5-6. Orphan issues the steward may file HERE: those carrying one of this
    //      project's established prefixes (≥ MIN_PREFIX_EVIDENCE filed issues,
    //      rule §4.2) and those whose parent is filed here (rule §4.3 — the
    //      parent link is already in the orphan query, so this costs nothing).
    //      Other orphans are out of scope.
    if (orphans.data) {
      const tally = new Map();
      for (const p of issues.data.map(prefixOf).filter(Boolean)) tally.set(p, (tally.get(p) || 0) + 1);
      const prefixes = [...tally].filter(([, n]) => n >= MIN_PREFIX_EVIDENCE).map(([p]) => p);
      const owned = new Set(prefixes);
      checks.push(check("orphans_with_project_prefix", "Issues without project carrying this project's prefixes",
        orphans.data.filter((i) => owned.has(prefixOf(i))).map((i) => `${i.identifier} [${PREFIX_RE.exec(i.title)[1]}]`),
        `(of ${orphans.data.length} orphans workspace-wide; prefixes with ≥${MIN_PREFIX_EVIDENCE} filed issues: ${prefixes.join(", ") || "none"})`));
      const identifierOf = new Map(issues.data.map((i) => [i.id, i.identifier]));
      checks.push(check("orphans_with_parent_here", "Issues without project whose parent is in this project",
        orphans.data.filter((i) => i.parent && identifierOf.has(i.parent.id)).map((i) => `${i.identifier} (child of ${identifierOf.get(i.parent.id)})`)));
    } else {
      checks.push(unavailable("orphans_with_project_prefix", "Issues without project carrying this project's prefixes", orphans.error));
      checks.push(unavailable("orphans_with_parent_here", "Issues without project whose parent is in this project", orphans.error));
    }
  } else {
    for (const [key, label] of [
      ["project_status", "Project status inconsistent with its issues"],
      ["closed_parents_open_children", "Done/Canceled parents with open children"],
      ["open_without_prefix", "Open issues without a [Prefix] title"],
      ["orphans_with_project_prefix", "Issues without project carrying this project's prefixes"],
      ["orphans_with_parent_here", "Issues without project whose parent is in this project"],
    ]) checks.push(unavailable(key, label, issues.error));
  }

  const failing = checks.filter((c) => c.drift).length;
  return {
    generatedAt: new Date().toISOString(),
    scope: "project",
    projectRef: project.name,
    project: { id: project.id, name: project.name, status: project.status?.name || null, initiatives: initiatives.map((i) => i.name) },
    title: `project "${project.name}" (${orgName})`,
    summary: `status ${project.status?.name || "?"} · ${issues.data ? `${issues.data.length} issues (${openIssues} open)` : "issues n/a"}` +
      " · scope = this project (settings.json → tracker.project) · checklist = Linear workspace rule §7",
    checks,
    footer: failing
      ? `Drift: ${failing} check(s) failing → PM: spawn the linear-steward agent with scope: project "${project.name}" (agents.linear_steward is on).`
      : `All checks clean for project "${project.name}".`,
  };
}

function analyzeWorkspace({ orgName, initiatives, projects, issues, projectLabels }) {
  const checks = [];
  const idx = issues.data ? indexIssues(issues.data) : null;

  if (issues.data) {
    const orphans = issues.data.filter((i) => !i.project);
    const open = orphans.filter((i) => OPEN_TYPES.has(i.state?.type));
    const closed = orphans.filter((i) => !OPEN_TYPES.has(i.state?.type));
    checks.push(check("orphans", "Issues without project", [...open, ...closed].map((i) => i.identifier), `(${open.length} open)`));
  } else checks.push(unavailable("orphans", "Issues without project", issues.error));

  if (projects.data) {
    checks.push(check("projects_no_initiative", "Projects without initiative",
      projects.data.filter((p) => p.initiatives.nodes.length === 0).map((p) => `"${p.name}"`)));
    checks.push(check("projects_multi_initiative", "Projects in more than one initiative", projects.data
      .filter((p) => p.initiatives.nodes.length > 1)
      .map((p) => `"${p.name}" (${p.initiatives.nodes.map((i) => i.name).join(" + ")})`)));
  } else {
    checks.push(unavailable("projects_no_initiative", "Projects without initiative", projects.error));
    checks.push(unavailable("projects_multi_initiative", "Projects in more than one initiative", projects.error));
  }

  if (initiatives.data) {
    checks.push(check("initiatives_empty", "Initiatives with 0 projects",
      initiatives.data.filter((i) => i.projects.nodes.length === 0).map((i) => `"${i.name}"`)));
    const byName = new Map();
    for (const i of initiatives.data) byName.set(lower(i.name), (byName.get(lower(i.name)) || 0) + 1);
    checks.push(check("initiatives_duplicate", "Duplicate initiative names",
      [...byName].filter(([, n]) => n > 1).map(([name, n]) => `"${name}" ×${n}`)));
  } else {
    checks.push(unavailable("initiatives_empty", "Initiatives with 0 projects", initiatives.error));
    checks.push(unavailable("initiatives_duplicate", "Duplicate initiative names", initiatives.error));
  }

  // Label catalog when the schema exposes it, else the labels in use across projects.
  const labelNames = projectLabels.data
    ? projectLabels.data.map((l) => l.name)
    : projects.data?.flatMap((p) => p.labels?.nodes?.map((l) => l.name) || []);
  if (initiatives.data && labelNames) {
    const labels = new Set(labelNames.map(lower));
    checks.push(check("initiative_label_collision", "Initiative names colliding with project labels",
      initiatives.data.filter((i) => labels.has(lower(i.name))).map((i) => `"${i.name}"`)));
  } else {
    checks.push(unavailable("initiative_label_collision", "Initiative names colliding with project labels",
      initiatives.error || projectLabels.error || projects.error));
  }

  if (projects.data && idx) {
    const drift = [];
    for (const p of projects.data) {
      const d = statusDrift(p, idx.byProject.get(p.id) || EMPTY_COUNTS);
      if (d) drift.push(`"${p.name}" ${d}`);
    }
    checks.push(check("project_status", "Project status inconsistent with its issues", drift));
  } else checks.push(unavailable("project_status", "Project status inconsistent with its issues", projects.error || issues.error));

  if (idx) {
    checks.push(check("closed_parents_open_children", "Done/Canceled parents with open children", closedParentsWithOpenChildren(issues.data, idx.childrenOf)));
    checks.push(check("open_without_prefix", "Open issues without a [Prefix] title", openWithoutPrefix(issues.data)));
  } else {
    checks.push(unavailable("closed_parents_open_children", "Done/Canceled parents with open children", issues.error));
    checks.push(unavailable("open_without_prefix", "Open issues without a [Prefix] title", issues.error));
  }

  const failing = checks.filter((c) => c.drift).length;
  return {
    generatedAt: new Date().toISOString(),
    scope: "workspace",
    projectRef: "",
    title: `workspace ${orgName}`,
    summary: [
      initiatives.data ? `${initiatives.data.length} initiatives` : "initiatives n/a",
      projects.data ? `${projects.data.length} projects` : "projects n/a",
      issues.data ? `${issues.data.length} issues (${idx.open} open)` : "issues n/a",
      "scope = whole workspace (on request) · checklist = Linear workspace rule §7",
    ].join(" · "),
    checks,
    footer: failing
      ? `Drift: ${failing} check(s) failing → PM: spawn the linear-steward agent with scope: workspace (explicit request only).`
      : "All checks clean.",
  };
}

// --- Cache + output ----------------------------------------------------------

function readCache(scope, projectRef) {
  const cached = readJson(cachePath);
  if (!cached?.generatedAt || !Array.isArray(cached.checks)) return null;
  if (cached.scope !== scope || lower(cached.projectRef) !== lower(projectRef)) return null;
  return Date.now() - Date.parse(cached.generatedAt) < CACHE_TTL_MS ? cached : null;
}

function writeCache(report) {
  try {
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(report, null, 2));
  } catch {
    // A cache miss next time costs a few requests; never fail the hook over it.
  }
}

function render(report, cached) {
  const d = new Date(report.generatedAt);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  out(`## Linear hygiene — ${report.title} — ${when} ${cached ? "(cached; --force refreshes)" : "(live)"}`);
  out(report.summary);
  for (const c of report.checks) out(renderCheck(c));
  out(report.footer);
}

async function main() {
  const settings = readJson(settingsPath);
  if (!force && settings?.agents?.linear_steward !== true) return; // default OFF: silent
  const { scope, projectRef, isOwnProject } = resolveScope(settings);
  if (scope === "project" && !projectRef) {
    notice('no project configured (settings.json → tracker.project is empty; a manual run takes --project "<name>")');
    return;
  }
  const key = readApiKey();
  if (!key) {
    notice("no LINEAR_API_KEY in the environment or .claude/.local/secrets.env");
    return;
  }
  if (!force) {
    const cached = readCache(scope, projectRef);
    if (cached) {
      render(cached, true);
      return;
    }
  }
  const report = scope === "workspace"
    ? analyzeWorkspace(await collectWorkspace(key))
    : analyzeProject(await collectProject(key, projectRef));
  // Only the repo's own project report is cached (it is the hook's); a manual
  // run on another project or on the workspace must not shadow it for 12 h.
  if (isOwnProject) writeCache(report);
  render(report, false);
}

main().catch((err) => notice(`failed (${err.message})`));
