/**
 * validate-frontmatter.mjs
 *
 * Validates YAML frontmatter across all governed .md files in scope.
 * Hard rules (block CI) + soft rules (warnings).
 *
 * Usage:
 *   node scripts/validate-frontmatter.mjs [--warn-only] [--root <dir>] [path...]
 *
 * Flags:
 *   --warn-only   Print issues but exit 0 (local pre-commit mode)
 *   --root <dir>  Override repo root (testing)
 *
 * Exit codes:
 *   0  All checks pass (or --warn-only)
 *   1  One or more hard-rule violations (without --warn-only)
 *
 * Rule definitions mirror the frontmatter taxonomy in .claude/rules/frontmatter.md.
 * Project constants (enums, ticket regex, affects grammar, alpha_test rules)
 * come from scripts/corpus.config.mjs — never inline them here.
 */

import { readFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectMdFiles, parseFrontmatter, hasBOM } from './_corpus-walk.mjs';
import {
  TYPE_ENUM,
  STATUS_ENUM,
  AUTHORITY_ENUM,
  VERDICT_ENUMS,
  TICKET_REGEX,
  AFFECTS_PREFIXES,
  AFFECTS_PREFIX_RE,
  VALIDATOR,
} from './corpus.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const WARN_ONLY = args.includes('--warn-only');
const rootIdx = args.indexOf('--root');
const REPO_ROOT = rootIdx !== -1 ? args[rootIdx + 1] : join(__dirname, '..');
const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--root');
const TARGET_DIRS = paths.length > 0 ? paths.map(p => (p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(REPO_ROOT, p))) : [REPO_ROOT];

const DROPPED = new Set(VALIDATOR.DROPPED_RULES || []);

// ---------------------------------------------------------------------------
// Validation
//
// File collection + frontmatter parsing live in _corpus-walk.mjs (single
// source of truth for the walk); enums live in corpus.config.mjs.
//
// The frontmatter `ticket` field is tracker-agnostic: it holds the canonical
// ticket id (Jira project key or Linear ticket prefix) and is validated against
// TICKET_REGEX, which corpus.config.mjs derives from the project's tracker key.
// ---------------------------------------------------------------------------

/** @returns {{severity: 'hard'|'soft', rule: string, message: string}[]} */
function validateFile(filePath, content) {
  const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const issues = [];

  function hard(rule, message) {
    if (DROPPED.has(rule)) return;
    issues.push({ severity: 'hard', rule, message });
  }
  function soft(rule, message) {
    if (DROPPED.has(rule)) return;
    issues.push({ severity: 'soft', rule, message });
  }

  // Rule 1: Frontmatter required (line 1 is ---)
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    hard('R1', 'Missing frontmatter — file does not start with ---');
    return issues; // no point checking further
  }

  // Rule 10: UTF-8 without BOM
  if (hasBOM(content)) {
    hard('R10', 'File has UTF-8 BOM (EF BB BF) — remove it');
  }

  // Rule 2: YAML parses
  let fm;
  try {
    fm = parseFrontmatter(content);
    if (!fm || typeof fm !== 'object') {
      hard('R2', 'Frontmatter YAML is empty or not an object');
      return issues;
    }
  } catch (e) {
    hard('R2', `Frontmatter YAML parse error: ${e.message}`);
    return issues;
  }

  // Rule 3: type: is in enum
  if (!fm.type) {
    hard('R3', 'Missing required field: type');
  } else if (!TYPE_ENUM.has(fm.type)) {
    hard('R3', `Invalid type: "${fm.type}". Must be one of: ${[...TYPE_ENUM].join(', ')}`);
  }

  // Rule 4: status: is valid
  if (!fm.status) {
    hard('R4', 'Missing required field: status');
  } else if (!STATUS_ENUM.has(fm.status)) {
    hard('R4', `Invalid status: "${fm.status}". Must be one of: ${[...STATUS_ENUM].join(', ')}`);
  }

  // Rule 5: ticket format (required on type: spec and type: alpha_test).
  // `ticket` is the tracker-agnostic canonical id (matches TICKET_REGEX) or null.
  if (fm.ticket !== null && fm.ticket !== undefined) {
    if (typeof fm.ticket !== 'string' || !TICKET_REGEX.test(fm.ticket)) {
      hard('R5', `Invalid ticket: "${fm.ticket}". Must match ${TICKET_REGEX} or be null`);
    }
  } else if ((fm.type === 'spec' || fm.type === 'alpha_test') && fm.ticket === undefined) {
    hard('R5', `type: ${fm.type} requires a ticket field (set to a ticket id or null explicitly)`);
  }

  // Rule 7: authority: is valid (if present)
  if (fm.authority !== undefined && fm.authority !== null) {
    if (!AUTHORITY_ENUM.has(fm.authority)) {
      hard('R7', `Invalid authority: "${fm.authority}". Must be one of: ${[...AUTHORITY_ENUM].join(', ')}`);
    }
  }

  // Rule 8: affects: items match the project's affects prefix grammar
  if (Array.isArray(fm.affects)) {
    for (const item of fm.affects) {
      if (item && typeof item === 'string' && !AFFECTS_PREFIX_RE.test(item)) {
        hard('R8', `affects: item "${item}" does not match any allowed prefix (${AFFECTS_PREFIXES.join(', ')})`);
      }
    }
  }

  // Rule 11: No template sentinel left in a published artifact.
  // Templates publish under docs/claude_tasks/ (lifecycle artifacts) and
  // docs/knowledge_base/ (KB articles); the _templates dir is excluded from
  // the walk, so any sentinel here is an un-filled scaffold.
  const isProductionFile =
    rel.startsWith('docs/claude_tasks/') || rel.startsWith('docs/knowledge_base/');
  if (isProductionFile && content.includes('DELETE THIS HEADER BEFORE PUBLISHING')) {
    hard('R11', 'Template sentinel "DELETE THIS HEADER BEFORE PUBLISHING" found in a published file — remove it');
  }

  // Rule 12: alpha_test contract — designed_by + restricted status vocabulary.
  // Enforces the freeze discipline: alpha tests are designed by the DA only and
  // carry a status drawn from the restricted alpha-test lifecycle vocabulary.
  if (fm.type === 'alpha_test') {
    if (fm.designed_by !== VALIDATOR.ALPHA_TEST.DESIGNED_BY) {
      hard('R12', `type: alpha_test requires designed_by: ${VALIDATOR.ALPHA_TEST.DESIGNED_BY} (got "${fm.designed_by}") — alpha tests are designed by the DA only`);
    }
    if (fm.status != null && !VALIDATOR.ALPHA_TEST.STATUS_ENUM.has(fm.status)) {
      hard('R12', `Invalid alpha_test status: "${fm.status}". Must be one of: ${[...VALIDATOR.ALPHA_TEST.STATUS_ENUM].join(', ')}`);
    }
  }

  // Rule 6: Cross-references resolve (depends_on / supersedes).
  // Format-only here (ticket-id shape); full cross-ref resolution runs in
  // build-index.mjs via /audit-corpus.
  if (Array.isArray(fm.depends_on)) {
    for (const dep of fm.depends_on) {
      if (dep && !TICKET_REGEX.test(dep)) {
        hard('R6', `depends_on item "${dep}" does not match ${TICKET_REGEX}`);
      }
    }
  }
  if (fm.supersedes && !TICKET_REGEX.test(fm.supersedes)) {
    hard('R6', `supersedes "${fm.supersedes}" does not match ${TICKET_REGEX}`);
  }

  // Rule 3b: verdict enum validation for type: review
  if (fm.type === 'review' && fm.reviewer && fm.verdict) {
    const allowed = VERDICT_ENUMS[fm.reviewer];
    if (allowed && !allowed.has(fm.verdict)) {
      hard('R3b', `verdict "${fm.verdict}" is not valid for reviewer "${fm.reviewer}". Allowed: ${[...allowed].join(', ')}`);
    }
  }

  // --- Soft rules ---

  // Soft 1: tags empty on a spec older than 7 days
  if (fm.type === 'spec' && Array.isArray(fm.tags) && fm.tags.length === 0 && fm.created) {
    const created = new Date(fm.created);
    const ageDays = (Date.now() - created.getTime()) / 86400000;
    if (ageDays > 7) {
      soft('S1', `tags: is empty on a spec older than 7 days (created ${fm.created})`);
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let totalFiles = 0;
let hardViolations = 0;
let softWarnings = 0;

for (const targetDir of TARGET_DIRS) {
  const files = collectMdFiles(targetDir, REPO_ROOT);

  for (const f of files) {
    totalFiles++;
    const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch (e) {
      console.error(`[ERROR] Cannot read ${rel}: ${e.message}`);
      hardViolations++;
      continue;
    }

    const issues = validateFile(f, content);
    for (const issue of issues) {
      if (issue.severity === 'hard') {
        hardViolations++;
        console.error(`[HARD] ${rel}: ${issue.rule} — ${issue.message}`);
      } else {
        softWarnings++;
        console.warn(`[WARN] ${rel}: ${issue.rule} — ${issue.message}`);
      }
    }
  }
}

console.log(`\n--- Validation Summary ---`);
console.log(`Files checked:   ${totalFiles}`);
console.log(`Hard violations: ${hardViolations}`);
console.log(`Soft warnings:   ${softWarnings}`);
if (WARN_ONLY) {
  console.log(`(--warn-only: exiting 0 regardless of violations)`);
} else if (hardViolations > 0) {
  console.error(`\nFAIL — ${hardViolations} hard violation(s) found.`);
  process.exit(1);
} else {
  console.log(`\nPASS`);
}
