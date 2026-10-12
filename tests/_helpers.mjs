// Shared helpers for the plugin's test suite (node --test). Underscore prefix:
// not a test file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATES = join(REPO, "data", "templates");
export const TMP_ROOT = join(REPO, "tests", ".tmp");

/** A fresh scratch directory under tests/.tmp (gitignored). */
export function tmpDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export const read = (path) => readFileSync(path, "utf8");

/** Every file under dir, as paths relative to dir with forward slashes. */
export function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

// A scrubbed environment for subprocesses: the developer's own keys and
// Claude Code variables must never shape a test.
export function baseEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(LINEAR_|CLAUDE_|DESTRUCTIVE_GUARD_)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

let pythonCmd = null;
export function python() {
  if (pythonCmd) return pythonCmd;
  for (const cmd of ["python", "python3"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return (pythonCmd = cmd);
  }
  throw new Error("No python/python3 on PATH — the hook tests need Python 3");
}

/** Run a PreToolUse hook script with a JSON (or raw) stdin payload. */
export function runHook(script, hookInput, { env = {} } = {}) {
  const r = spawnSync(python(), [join(REPO, "hooks", script)], {
    input: typeof hookInput === "string" ? hookInput : JSON.stringify(hookInput),
    encoding: "utf8",
    env: { ...baseEnv(), ...env },
  });
  const stdout = r.stdout ?? "";
  return {
    status: r.status,
    stdout,
    stderr: r.stderr ?? "",
    output: stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null,
  };
}

/** Run a Node script as a subprocess with a scrubbed environment (blocking). */
export function runNode(script, args = [], { cwd = REPO, env = {} } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...baseEnv(), ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Same, non-blocking. Required whenever the test process itself must keep
 * serving while the child runs (the detector test hosts a fake HTTP server;
 * spawnSync would freeze that server and the child would time out).
 */
export function runNodeAsync(script, args = [], { cwd = REPO, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...baseEnv(), ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// --- Template rendering (the shape /lifecycle-init §2 describes) -------------

export const VAR_RE = /\{\{([A-Z0-9_]+)\}\}/g;

/** Dummy values typed the way the scaffolder's variable table describes them. */
export function dummyValue(name) {
  if (name.startsWith("AGENT_")) return "false";
  if (name === "MCP_SERVERS_JSON") return "[]";
  if (name.endsWith("_JSON")) return "{}";
  const fixed = {
    TRACKER_KEY: "ABC", TRACKER: "linear", STACK: "generic", TODAY: "2026-01-01",
    SOD_MODE: "collapsed", MEMORY_BACKEND: "corpus", DATABRICKS: "off",
    MCP_SCOPE: "local", HANDSHAKE_TRANSPORT: "auto", GIT_BRANCH: "main", GIT_DEFAULT_BRANCH: "main",
    PROJECT_SLUG: "fixture-project", PROJECT_NAME: "fixture-project",
  };
  return fixed[name] ?? "x";
}

export const render = (text) => text.replace(VAR_RE, (_, name) => dummyValue(name));

/** `.claude/settings.json.template` → `.claude/settings.json`; unsuffixed files keep their name. */
export const outputPath = (relTemplatePath) => relTemplatePath.replace(/\.template$/, "");

/** Render the whole scaffold into dir; returns [{ src, out }] with repo-relative paths. */
export function renderScaffold(dir) {
  const rendered = [];
  for (const rel of listFiles(TEMPLATES)) {
    const out = outputPath(rel);
    const content = render(read(join(TEMPLATES, rel)));
    writeFile(join(dir, out), content);
    rendered.push({ src: rel, out, content });
  }
  return rendered;
}

export const exists = (p) => existsSync(p);
