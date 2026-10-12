// check_destructive.py — the destructive-command guard (PreToolUse on Bash|PowerShell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runHook, tmpDir, writeFile } from "../_helpers.mjs";

const cmd = (command) => ({ tool_name: "Bash", tool_input: { command } });

const DENIED = [
  ["DROP TABLE sales", "SQL DROP"],
  ["truncate table x", "SQL TRUNCATE"],
  ["DELETE FROM users WHERE 1=1", "SQL DELETE FROM"],
  ["git push --force origin main", "git force push"],
  ["git push -f", "git force push"],
  ["git reset --hard HEAD~1", "git reset --hard"],
  ["git clean -fd", "git clean -f"],
  ["rm -rf build/", "rm -rf"],
  ["Remove-Item -Recurse -Force .\\out", "PowerShell Remove-Item"],
];

for (const [command, category] of DENIED) {
  test(`denies: ${command}`, () => {
    const r = runHook("check_destructive.py", cmd(command));
    assert.equal(r.status, 0);
    assert.equal(r.output?.permissionDecision, "deny");
    assert.match(r.output.permissionDecisionReason, new RegExp(category.replace(/[-]/g, "\\-")));
  });
}

for (const command of ["ls -la", "git status", "git push origin feature", "node --test", "rm notes.txt"]) {
  test(`passes: ${command}`, () => {
    const r = runHook("check_destructive.py", cmd(command));
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  });
}

test("stack patterns are off by default and on via DESTRUCTIVE_GUARD_STACKS", () => {
  const off = runHook("check_destructive.py", cmd("databricks jobs delete 123"));
  assert.equal(off.stdout.trim(), "", "databricks delete passes without the stack enabled");
  const on = runHook("check_destructive.py", cmd("databricks jobs delete 123"), { env: { DESTRUCTIVE_GUARD_STACKS: "databricks" } });
  assert.equal(on.output?.permissionDecision, "deny");
  assert.match(on.output.permissionDecisionReason, /Databricks/);
});

test("stack patterns can also come from the project's settings.json", () => {
  const project = tmpDir("destructive-settings");
  writeFile(join(project, ".claude", "settings.json"), JSON.stringify({ destructiveGuard: { stacks: ["supabase"] } }));
  const r = runHook("check_destructive.py", cmd("supabase db reset"), { env: { CLAUDE_PROJECT_DIR: project } });
  assert.equal(r.output?.permissionDecision, "deny");
  assert.match(r.output.permissionDecisionReason, /Supabase/);
});

test("unparseable input fails open", () => {
  const r = runHook("check_destructive.py", "{not json");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
