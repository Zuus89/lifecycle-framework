/**
 * log-commit-activity.mjs
 *
 * Invoked by the .husky/post-commit hook. Appends one `committed` line to
 * docs/activity_log.jsonl for the HEAD commit — the deterministic spine of the
 * activity log that manual /log-activity calls tend to forget.
 *
 * BEST-EFFORT: always exits 0. Any error → write nothing, never disrupt the commit.
 * The line shape is LOG_FIELDS from corpus.config.mjs (the machine copy of
 * the contract the /log-activity skill documents) — same writer, same shape.
 *
 * Machine-originated line: agent=null, model=null, step=null, pr_url=null,
 * tracker_comment_id=null.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { OUTPUT, BRANCH_TICKET_REGEX, TICKET_KEY, LOG_FIELDS } from './corpus.config.mjs';

const LOG_PATH = OUTPUT.ACTIVITY_LOG;
const SESSION_PATH = OUTPUT.SESSION_FILE;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

try {
  // ── Guard: skip during rebase / merge / cherry-pick ────────────────────────
  // Resolve the real git dir — in a worktree `.git` is a FILE, not a dir, so a
  // hardcoded `.git/MERGE_HEAD` check silently fails.
  let gitDir;
  try {
    gitDir = git('rev-parse --git-dir');
  } catch {
    process.exit(0); // not a git context — nothing to do
  }
  const inProgress = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply']
    .some((m) => existsSync(join(gitDir, m)));
  if (inProgress) process.exit(0);

  // ── Gather commit context ──────────────────────────────────────────────────
  const branch = git('branch --show-current');
  const subject = git('log -1 --format=%s');
  // --root: a repo's first commit (the scaffold commit) has no parent and would otherwise list nothing.
  const files = git('diff-tree --root --no-commit-id --name-only -r HEAD')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  // ticket: loose regex on the branch name (matches feat/<KEY>-912-slug and
  // user/<KEY>-912-slug). Normalized to the canonical `<KEY>-<n>` form.
  const m = branch.match(BRANCH_TICKET_REGEX);
  let ticket = m ? `${TICKET_KEY}-${m[1]}` : null;

  // ── Session id (mirror the /log-activity session contract) ─────────────────
  let session = null;
  try {
    if (existsSync(SESSION_PATH)) {
      const s = JSON.parse(readFileSync(SESSION_PATH, 'utf8'));
      if (s && s.branch === branch && typeof s.id === 'string') {
        session = s.id;
        if (!ticket && s.issue) ticket = s.issue; // fall back to stored ticket
      }
    }
  } catch { /* ignore malformed session file */ }
  if (!session) {
    session = randomBytes(4).toString('hex');
    try {
      writeFileSync(SESSION_PATH, JSON.stringify({ id: session, branch, issue: ticket }) + '\n', 'utf8');
    } catch { /* gitignored dir may be absent on a fresh clone — non-fatal */ }
  }

  // ── Build the line (machine-originated → nulls for human/agent fields) ──────
  const values = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    session,
    ticket,
    branch,
    pr_url: null,            // no network call in the hook (fast, offline-safe)
    step: null,              // a commit's lifecycle step is not determinable in-hook
    event: 'committed',
    agent: null,             // machine-originated
    model: null,             // machine-originated
    summary: subject,
    artifacts: files,
    tracker_comment_id: null,
  };
  // LOG_FIELDS fixes the shape and the order; anything this hook cannot know is null.
  const line = Object.fromEntries(LOG_FIELDS.map((f) => [f, values[f] ?? null]));

  appendFileSync(LOG_PATH, JSON.stringify(line) + '\n', 'utf8');
} catch {
  // Best-effort: never disrupt the commit.
}

process.exit(0);
