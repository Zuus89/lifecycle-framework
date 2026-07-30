/**
 * build-index.mjs
 *
 * Generates two artifacts from .md frontmatter across the corpus:
 *   1. docs/INDEX.md    — human-readable, tabular, Mermaid cross-ref graph
 *   2. docs/index.json  — machine-readable cache (by_object / by_ticket)
 *
 * Usage:
 *   node scripts/build-index.mjs [--root <dir>]
 *
 * Performance target: < 5s on a 300-file corpus (hard gate — exits 1 beyond it).
 *
 * Determinism contract (the pre-push hook and CI diff these artifacts, so the
 * same source must produce the same bytes on every machine):
 *   - corpus driven by `git ls-files` (gitignored transient docs excluded)
 *   - entries sorted with locale-free string compare (readdir order is OS-dependent)
 *   - timestamps content-derived (max fm.updated), never wall-clock
 *   - YAML Date objects coerced to YYYY-MM-DD (never timezone-local toString)
 *   - INDEX.md excluded from its own input (no self-reinforcing dates)
 *   - INDEX.md `created:` preserved from the prior build
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { collectMdFiles, parseFrontmatter as parseFmContent } from './_corpus-walk.mjs';
import { TICKET_REGEX, OUTPUT } from './corpus.config.mjs';

// ---------------------------------------------------------------------------
// Git-tracked file filter (determinism — gitignored leak fix)
// ---------------------------------------------------------------------------

/**
 * Returns a Set of tracked .md paths (relative, forward-slash) via `git ls-files`.
 * Returns null when outside a git repo (e.g. test fixture temp dirs) — callers
 * must treat null as "no filter / allow all".
 */
function trackedMdSet(repoRoot) {
  try {
    const out = execSync('git ls-files "*.md"', { cwd: repoRoot, encoding: 'utf8' });
    return new Set(out.split(/\r?\n/).filter(Boolean));
  } catch {
    // Outside a git repo (e.g., test fixtures): allow all .md — test corpus is intentional.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Content-derived timestamp helpers (determinism — no wall-clock in artifacts)
// ---------------------------------------------------------------------------

/**
 * Returns the maximum ISO date (YYYY-MM-DD) found in any entry's fm.updated field.
 * Filters out falsy, non-string, and non-ISO-date values to guard against
 * hand-authored files with empty/missing updated: keys.
 * Falls back to today's date on a degenerate (empty or all-invalid) corpus.
 */
function maxSourceUpdate(entries) {
  // js-yaml parses unquoted YAML dates as Date objects; coerce back to YYYY-MM-DD to keep them in the max calculation.
  const dates = entries
    .map(e => e.fm.updated)
    .map(d => {
      if (d instanceof Date) return d.toISOString().split('T')[0];
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      return null;
    })
    .filter(d => d !== null);
  if (dates.length === 0) {
    return new Date().toISOString().split('T')[0]; // fallback to today (degenerate)
  }
  return dates.reduce((a, b) => (a > b ? a : b));
}

/**
 * Coerces a YAML-parsed date field to a YYYY-MM-DD string for stable rendering.
 *
 * Why: js-yaml parses unquoted YAML dates as JS `Date` objects. When such a
 * Date is interpolated into a template string (as in markdown table rows), JS
 * calls `.toString()` which emits a timezone-local human-readable form like
 * `Thu May 14 2026 02:00:00 GMT+0200 (CEST)`. Two runners in different TZs
 * (e.g. CI runs UTC, local runs elsewhere) produce different bytes for the
 * same date → INDEX drift → pre-push hook + CI failure.
 */
function formatDateField(v) {
  if (v == null) return '—';
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return v;
}

/**
 * Reads the existing INDEX.md and returns its frontmatter `created:` value,
 * or null on any error (file missing, unreadable, malformed YAML, missing field).
 * Uses parseFmContent imported from _corpus-walk.mjs — same parser as the rest
 * of the build pipeline.
 */
function readExistingCreated(indexMdPath) {
  let content;
  try { content = readFileSync(indexMdPath, 'utf8'); } catch { return null; }
  try {
    const fm = parseFmContent(content);
    return (fm && typeof fm.created === 'string') ? fm.created : null;
  } catch { return null; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const REPO_ROOT = rootIdx !== -1 ? args[rootIdx + 1] : join(__dirname, '..');

const INDEX_MD = join(REPO_ROOT, OUTPUT.INDEX_MD);
const INDEX_JSON = join(REPO_ROOT, OUTPUT.INDEX_JSON);

// ---------------------------------------------------------------------------
// File collection + content frontmatter parsing → _corpus-walk.mjs
// (single source of truth for the exclusion list, LF/CRLF parser, BOM rejection)
// ---------------------------------------------------------------------------

function parseFrontmatter(filePath) {
  let content;
  try { content = readFileSync(filePath, 'utf8'); } catch { return null; }
  try {
    return parseFmContent(content);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build corpus index
// ---------------------------------------------------------------------------

function buildCorpus() {
  const files = collectMdFiles(REPO_ROOT, REPO_ROOT);
  // Determinism: drive corpus from git-tracked files only. Gitignored transient
  // docs (e.g. docs/context_snapshot.md) exist locally but not on CI's fresh
  // checkout → drift. null = no filter (test fixtures).
  const tracked = trackedMdSet(REPO_ROOT);
  const entries = [];
  // Never include the generated output file in its own input: if a prior run
  // wrote INDEX.md with a max updated: date, re-reading it would cause that
  // date to become self-reinforcing (transient mutations become permanently
  // sticky via INDEX's own updated: field).
  const SELF_OUTPUT = OUTPUT.INDEX_MD;

  for (const f of files) {
    const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');
    if (rel === SELF_OUTPUT) continue;
    if (tracked && !tracked.has(rel)) continue; // gitignored / untracked — skip
    const fm = parseFrontmatter(f);
    if (!fm) continue;
    entries.push({ path: rel, fm });
  }

  // Determinism: sort entries by path before returning. readdirSync order is
  // OS-dependent (ext4 vs NTFS), causing INDEX table rows to shuffle between
  // local and CI when task_number ties require a tiebreaker. Locale-free
  // string compare guarantees identical order on all platforms.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return entries;
}

// ---------------------------------------------------------------------------
// Group entries by type (the governed types — corpus.config.mjs TYPE_ENUM)
// ---------------------------------------------------------------------------

function groupByType(entries) {
  const groups = {
    spec: [],
    alpha_test: [],
    report: [],
    review: [],
    council: [],
    handoff: [],
    doc: [],
    archive: [],
    agent: [],
    skill: [],
    rule: [],
    audit: [],
    other: [],
  };

  for (const e of entries) {
    const t = e.fm.type || 'other';
    if (groups[t]) groups[t].push(e);
    else groups.other.push(e);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Mermaid cross-reference graph (ticket→ticket depends_on / supersedes edges)
// ---------------------------------------------------------------------------

function buildMermaid(entries) {
  const edges = new Set();

  for (const e of entries) {
    const { fm } = e;
    const srcId = fm.ticket;
    if (!srcId) continue;

    if (Array.isArray(fm.depends_on)) {
      for (const dep of fm.depends_on) {
        if (dep && TICKET_REGEX.test(dep)) {
          edges.add(`  ${srcId.replace(/-/, '')} --> ${dep.replace(/-/, '')}`);
        }
      }
    }
    if (fm.supersedes && TICKET_REGEX.test(fm.supersedes)) {
      edges.add(`  ${srcId.replace(/-/, '')} -.-> ${fm.supersedes.replace(/-/, '')}`);
    }
  }

  if (edges.size === 0) return '```mermaid\ngraph LR\n  %% No cross-references found yet\n```';
  return `\`\`\`mermaid\ngraph LR\n${[...edges].join('\n')}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// INDEX.md generation
// ---------------------------------------------------------------------------

function renderTable(headers, rows) {
  if (rows.length === 0) return '_None._\n';
  const headerRow = `| ${headers.join(' | ')} |`;
  const sepRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(r => `| ${r.join(' | ')} |`);
  return [headerRow, sepRow, ...dataRows].join('\n') + '\n';
}

function truncate(s, n = 60) {
  if (!s) return '—';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function link(text, path) {
  return `[${truncate(text, 40)}](${path})`;
}

function buildIndexMd(groups, mermaid, latestSourceUpdate, totalFiles, existingCreated) {
  const lines = [];

  // Frontmatter — INDEX.md is a derived cache (authority: secondary); the
  // indexed sources are the truth.
  // created: preserved from prior builds so it reflects the first-ever build date.
  // updated: content-derived (max fm.updated across corpus) — byte-stable across runs.
  const created = existingCreated || latestSourceUpdate;
  lines.push('---');
  lines.push('type: doc');
  lines.push('title: Repository Index');
  lines.push('ticket: null');
  lines.push('status: living');
  lines.push('authority: secondary');
  lines.push('affects: []');
  lines.push(`created: "${created}"`);
  lines.push(`updated: "${latestSourceUpdate}"`);
  lines.push('tags: [autogenerated, index, navigation]');
  lines.push('---');
  lines.push('');

  lines.push('# Repository Index');
  lines.push('');
  lines.push('> Autogenerated by `scripts/build-index.mjs`. Do not edit by hand. Run `npm run build:index` to refresh.');
  lines.push(`> Source as of: ${latestSourceUpdate}. Files indexed: ${totalFiles}.`);
  lines.push('');

  // Specs
  const specs = groups.spec.sort((a, b) => (b.fm.task_number || 0) - (a.fm.task_number || 0));
  lines.push(`## Specs (${specs.length})`);
  lines.push('');
  lines.push(renderTable(
    ['ticket', 'task#', 'title', 'status', 'authority', 'path'],
    specs.map(e => [
      e.fm.ticket || '—',
      e.fm.task_number != null ? String(e.fm.task_number) : '—',
      truncate(e.fm.title, 50),
      e.fm.status || '—',
      e.fm.authority || '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Alpha tests (Step 4 design → Step 6 seal → Step 8 execute; ssot once sealed)
  const alphaTests = groups.alpha_test.sort((a, b) => (b.fm.task_number || 0) - (a.fm.task_number || 0));
  lines.push(`## Alpha tests (${alphaTests.length})`);
  lines.push('');
  lines.push(renderTable(
    ['ticket', 'task#', 'title', 'status', 'sealed_date', 'path'],
    alphaTests.map(e => [
      e.fm.ticket || '—',
      e.fm.task_number != null ? String(e.fm.task_number) : '—',
      truncate(e.fm.title, 50),
      e.fm.status || '—',
      formatDateField(e.fm.sealed_date),
      link(basename(e.path), e.path),
    ])
  ));

  // Reports
  const reports = groups.report.sort((a, b) => (a.fm.task_number || 0) - (b.fm.task_number || 0));
  lines.push(`## Reports (${reports.length})`);
  lines.push('');
  lines.push(renderTable(
    ['ticket', 'task#', 'title', 'deployed', 'critical', 'path'],
    reports.map(e => [
      e.fm.ticket || '—',
      e.fm.task_number != null ? String(e.fm.task_number) : '—',
      truncate(e.fm.title, 50),
      e.fm.deployed != null ? String(e.fm.deployed) : '—',
      e.fm.code_reviewer_findings ? String(e.fm.code_reviewer_findings.critical || 0) : '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Reviews
  const reviews = groups.review.sort((a, b) => (a.path > b.path ? 1 : -1));
  lines.push(`## Reviews (${reviews.length})`);
  lines.push('');
  lines.push(renderTable(
    ['ticket', 'reviewer', 'verdict', 'critical', 'path'],
    reviews.map(e => [
      e.fm.ticket || '—',
      e.fm.reviewer || '—',
      e.fm.verdict || '—',
      e.fm.critical_count != null ? String(e.fm.critical_count) : '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Council
  lines.push(`## Council verdicts (${groups.council.length})`);
  lines.push('');
  lines.push(renderTable(
    ['topic', 'decision_id', 'participants', 'path'],
    groups.council.map(e => [
      e.fm.topic || '—',
      e.fm.decision_id != null ? String(e.fm.decision_id) : '—',
      e.fm.participants ? e.fm.participants.join(', ') : '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Handoffs
  const handoffs = groups.handoff.sort((a, b) => (a.path > b.path ? 1 : -1));
  lines.push(`## Handoffs (${handoffs.length})`);
  lines.push('');
  lines.push(renderTable(
    ['title', 'ticket', 'next_action', 'path'],
    handoffs.map(e => [
      truncate(e.fm.title, 50),
      e.fm.ticket || '—',
      truncate(e.fm.next_action, 60),
      link(basename(e.path), e.path),
    ])
  ));

  // Docs
  lines.push(`## Docs (${groups.doc.length})`);
  lines.push('');
  lines.push(renderTable(
    ['title', 'owner', 'last_reviewed', 'authority', 'path'],
    groups.doc.map(e => [
      truncate(e.fm.title, 50),
      e.fm.owner || '—',
      formatDateField(e.fm.last_reviewed),
      e.fm.authority || '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Archive
  lines.push(`## Archive (${groups.archive.length})`);
  lines.push('');
  lines.push(renderTable(
    ['title', 'archived_date', 'superseded_by', 'path'],
    groups.archive.map(e => [
      truncate(e.fm.title, 50),
      formatDateField(e.fm.archived_date),
      truncate(e.fm.superseded_by, 40),
      link(basename(e.path), e.path),
    ])
  ));

  // Audits
  const audits = groups.audit.sort((a, b) => (a.path > b.path ? 1 : -1));
  lines.push(`## Audits (${audits.length})`);
  lines.push('');
  lines.push(renderTable(
    ['title', 'audit_week', 'issues (h/m/l)', 'path'],
    audits.map(e => [
      truncate(e.fm.title, 50),
      e.fm.audit_week || '—',
      e.fm.issues ? `${e.fm.issues.high || 0}/${e.fm.issues.medium || 0}/${e.fm.issues.low || 0}` : '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Agents / Skills / Rules
  const infra = [...groups.agent, ...groups.skill, ...groups.rule].sort((a, b) => (a.path > b.path ? 1 : -1));
  lines.push(`## Agents / Skills / Rules (${infra.length})`);
  lines.push('');
  lines.push(renderTable(
    ['name', 'type', 'path'],
    infra.map(e => [
      e.fm.name || e.fm.title || basename(e.path, '.md'),
      e.fm.type || '—',
      link(basename(e.path), e.path),
    ])
  ));

  // Cross-reference graph
  lines.push('## Cross-reference graph');
  lines.push('');
  lines.push(mermaid);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// index.json generation
// ---------------------------------------------------------------------------

function buildIndexJson(entries, latestSourceUpdate) {
  const byObject = {};
  const byTicket = {};

  for (const e of entries) {
    const { path, fm } = e;

    // by_ticket
    // created/updated routed through formatDateField() (same normalization as
    // the INDEX.md tables) so YAML Date objects never serialize as
    // "YYYY-MM-DDT00:00:00.000Z" in index.json.
    if (fm.ticket) {
      byTicket[fm.ticket] = {
        title: fm.title || null,
        type: fm.type || null,
        status: fm.status || null,
        path,
        created: fm.created != null ? formatDateField(fm.created) : null,
        updated: fm.updated != null ? formatDateField(fm.updated) : null,
        affects: fm.affects || [],
      };
    }

    // by_object — index affects entries
    if (Array.isArray(fm.affects)) {
      for (const obj of fm.affects) {
        if (!obj) continue;
        if (!byObject[obj]) byObject[obj] = [];
        byObject[obj].push({
          ticket: fm.ticket || null,
          task_number: fm.task_number || null,
          title: fm.title || null,
          type: fm.type || null,
          path,
          created: fm.created != null ? formatDateField(fm.created) : null,
        });
      }
    }
  }

  // Sort by_object entries chronologically
  for (const key of Object.keys(byObject)) {
    byObject[key].sort((a, b) => {
      if (!a.created) return 1;
      if (!b.created) return -1;
      return a.created < b.created ? -1 : 1;
    });
  }

  return {
    generated_at: latestSourceUpdate, // content-derived — byte-stable across runs with no source change
    files_indexed: entries.length,
    by_object: byObject,
    by_ticket: byTicket,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const t0 = Date.now();

console.log(`Building index from ${REPO_ROOT}...`);

const entries = buildCorpus();
const groups = groupByType(entries);
const mermaid = buildMermaid(entries);

// Content-derived timestamp — byte-stable across runs with no source change.
const latestSourceUpdate = maxSourceUpdate(entries);
const existingCreated = readExistingCreated(INDEX_MD);

const totalFiles = entries.length;
const indexMd = buildIndexMd(groups, mermaid, latestSourceUpdate, totalFiles, existingCreated);
const indexJson = buildIndexJson(entries, latestSourceUpdate);

writeFileSync(INDEX_MD, indexMd, { encoding: 'utf8' });
writeFileSync(INDEX_JSON, JSON.stringify(indexJson, null, 2), { encoding: 'utf8' });

const elapsed = Date.now() - t0;
console.log(`INDEX.md written: ${INDEX_MD}`);
console.log(`index.json written: ${INDEX_JSON}`);
console.log(`Files indexed: ${totalFiles}`);
console.log(`Time: ${elapsed}ms`);

if (elapsed > 5000) {
  console.warn(`[PERF WARNING] build-index took ${elapsed}ms — exceeds 5s target`);
  process.exit(1);
}
