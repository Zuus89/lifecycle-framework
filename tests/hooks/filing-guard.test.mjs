// check_linear_filing.py — the Linear filing guard (PreToolUse, always on).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "../_helpers.mjs";

const call = (tool, args) => ({ tool_name: tool, tool_input: args });

// [name, hook input, expected decision, text the reason/context must carry]
const CASES = [
  ["issue creation without project is denied", call("mcp__linear__save_issue", { team: "CRI", title: "[Plugin] x" }), "deny", "rule §1"],
  ["issue creation with project passes", call("mcp__linear__save_issue", { team: "CRI", title: "[Plugin] x", project: "Lifecycle Framework" }), null],
  ["issue update without project argument passes", call("mcp__linear__save_issue", { id: "CRI-1145", state: "Done" }), null],
  ["issue update with project: null (unfiling) is denied", call("mcp__linear__save_issue", { id: "CRI-1145", project: null }), "deny", "project: null"],
  ["project creation without initiative is denied", call("mcp__linear__save_project", { name: "X", addTeams: ["CRI"] }), "deny", "exactly one"],
  ["project creation with one initiative passes", call("mcp__linear__save_project", { name: "X", addTeams: ["CRI"], addInitiatives: ["Personal Operations"] }), null],
  ["project creation with two initiatives is denied", call("mcp__linear__save_project", { name: "X", addTeams: ["CRI"], addInitiatives: ["A", "B"] }), "deny", "exactly one"],
  ["project update with labels is allowed with a SET-semantics warning", call("mcp__linear__save_project", { id: "Brisia Website", labels: ["Foundation"] }), "allow", "SET semantics"],
  ["project update with setInitiatives: [] is denied", call("mcp__linear__save_project", { id: "Brisia Website", setInitiatives: [] }), "deny", "exactly one"],
  ["unrelated Linear tool (get_issue) passes", call("mcp__linear__get_issue", { id: "CRI-1" }), null],
  ["older verb create_issue without project is denied", call("mcp__linear__create_issue", { teamId: "x", title: "y" }), "deny", "rule §1"],
  ["claude.ai connector prefix is matched", call("mcp__claude_ai_Linear__save_issue", { team: "CRI", title: "z" }), "deny", "rule §1"],
  ["plugin-bundled server prefix is matched", call("mcp__plugin_lf_linear__save_issue", { team: "CRI", title: "z" }), "deny", "rule §1"],
  ["project update with removeInitiatives is allowed with a warning", call("mcp__linear__save_project", { id: "X", removeInitiatives: ["A"] }), "allow", "removeInitiatives"],
];

for (const [name, input, decision, needle] of CASES) {
  test(name, () => {
    const r = runHook("check_linear_filing.py", input);
    assert.equal(r.status, 0, `hook must always exit 0 (stderr: ${r.stderr})`);
    if (decision === null) {
      assert.equal(r.stdout.trim(), "", "a pass prints nothing");
      return;
    }
    assert.equal(r.output.hookEventName, "PreToolUse");
    assert.equal(r.output.permissionDecision, decision);
    const text = decision === "deny" ? r.output.permissionDecisionReason : r.output.additionalContext;
    assert.match(text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("garbage stdin fails open (exit 0, no output)", () => {
  const r = runHook("check_linear_filing.py", "not json");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("the deny payload is pure ASCII (safe on Windows consoles without PYTHONIOENCODING)", () => {
  const r = runHook("check_linear_filing.py", call("mcp__linear__save_issue", { team: "CRI", title: "x" }));
  assert.ok(/^[\x00-\x7F]*$/.test(r.stdout), "json.dumps must escape non-ASCII");
});
