/**
 * _corpus-walk.mjs — Shared corpus traversal and frontmatter parsing primitives.
 *
 * Single source of truth for shouldExclude(), parseFrontmatter(), hasBOM() and
 * collectMdFiles() across validate-frontmatter.mjs, build-index.mjs and
 * affects-lookup.mjs. Keeping traversal + parsing in one module prevents the
 * consumers from drifting apart (each script inlining its own copy of the
 * exclusion list and parser is how silent corpus gaps happen).
 *
 * This module is GENERIC: it carries no project-specific constants. The
 * exclusion lists (EXCLUDED_DIRS, EXCLUDED_ROOT_FILES, PROJECT_SKILLS) live in
 * corpus.config.mjs — this module only implements the mechanics.
 *
 * Deps justified (.claude/rules/dependency-governance.md):
 *   js-yaml@^4 — YAML parse; the only non-stdlib dependency the corpus engine needs.
 *
 * Public API:
 *   - shouldExclude(filePath, repoRoot) → boolean
 *   - parseFrontmatter(content) → object | null     (handles LF + CRLF)
 *   - hasBOM(content) → boolean
 *   - collectMdFiles(dir, repoRoot) → string[]      recursive .md collector
 *
 * Underscore prefix flags this as a private module — not a CLI entrypoint.
 */

import { readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import yaml from 'js-yaml';
import { EXCLUDED_DIRS, EXCLUDED_ROOT_FILES, PROJECT_SKILLS } from './corpus.config.mjs';

// ---------------------------------------------------------------------------
// Exclusion logic
// ---------------------------------------------------------------------------

/**
 * Returns true if filePath is inside a directory that should NOT be walked.
 * Excludes EXCLUDED_DIRS basenames anywhere in the path.
 *
 * Skill exclusion logic (Claude Code skills live in `<name>/SKILL.md`):
 * - Project skills `.claude/skills/<PROJECT_SKILL>/SKILL.md` are INCLUDED
 *   (governance corpus — name + description is part of the schema).
 * - Vendored / third-party skills are EXCLUDED (external packages / symlinks,
 *   not this project's governance).
 * - Any other depth >= 4 file under .claude/skills/ is EXCLUDED (assets,
 *   references, additional bundle files inside vendored skills).
 */
export function shouldExclude(filePath, repoRoot) {
  const parts = relative(repoRoot, filePath).split(/[/\\]/);
  if (parts.some(p => EXCLUDED_DIRS.has(p))) return true;
  if (parts.length === 1 && EXCLUDED_ROOT_FILES.has(parts[0])) return true;
  // The project operating contract (auto-loaded by Claude Code, no frontmatter)
  // is a human-owned doc, not a governed corpus artifact.
  if (parts.length === 2 && parts[0] === '.claude' && parts[1] === 'CLAUDE.md') return true;
  if (parts[0] === '.claude' && parts[1] === 'skills' && parts.length > 3) {
    // Allow project-owned <name>/SKILL.md (depth 4); exclude everything else.
    if (parts.length === 4 && parts[3] === 'SKILL.md' && PROJECT_SKILLS.has(parts[2])) {
      return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Returns true if content begins with the UTF-8 BOM (EF BB BF).
 * readFileSync(path, 'utf8') decodes the BOM as U+FEFF.
 */
export function hasBOM(content) {
  return content.charCodeAt(0) === 0xFEFF;
}

/**
 * Parses YAML frontmatter from a markdown file's text content.
 * Handles both LF (---\n) and CRLF (---\r\n) line endings on the opening AND
 * closing delimiters. Returns null when no frontmatter is present (file does
 * not start with --- or has no closing delimiter). Throws on invalid YAML.
 *
 * Rejects BOM-prefixed content (returns null) so callers see a clear "no
 * frontmatter" signal that mirrors the validator's R10 hard-rule outcome.
 */
export function parseFrontmatter(content) {
  if (hasBOM(content)) return null;
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  let end = content.indexOf('\n---\n', 4);
  if (end === -1) end = content.indexOf('\r\n---\r\n', 4);
  if (end === -1) return null;
  const fmStr = content.slice(4, end);
  return yaml.load(fmStr);
}

// ---------------------------------------------------------------------------
// Recursive .md collector
// ---------------------------------------------------------------------------

/**
 * Returns absolute paths of every .md file under dir, recursively, skipping
 * any path matched by shouldExclude(). A single .md FILE path is also
 * accepted and returned as-is (subject to the same exclusion check) — so
 * per-file invocations (`validate-frontmatter.mjs docs/knowledge_base/x.md`)
 * validate that file instead of silently checking nothing.
 */
export function collectMdFiles(dir, repoRoot) {
  const results = [];
  try {
    const target = statSync(dir);
    if (target.isFile()) {
      if (extname(dir) === '.md' && !shouldExclude(dir, repoRoot)) results.push(dir);
      return results;
    }
  } catch { return results; }
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (shouldExclude(full, repoRoot)) continue;
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...collectMdFiles(full, repoRoot));
    } else if (stat.isFile() && extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}
