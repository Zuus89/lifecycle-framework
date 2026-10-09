#!/usr/bin/env python3
"""PreToolUse guard: enforce the Linear filing rules on save_issue / save_project.

Plugin-resident (Tier A). Installed once, runs in every project — no flag, no
project settings: the rules it enforces are workspace-structural and hold
everywhere. (The flag-gated parts of the linear-steward are the SessionStart
detector, hooks/linear_hygiene.mjs, and the agent, agents/linear-steward.md.)

Wiring: registered as a PreToolUse hook in hooks/hooks.json with the matcher

    ^mcp__.*[Ll]inear.*__(save|create|update)_(issue|project)$

so it fires for the Linear MCP whatever the server is named (the framework's
local `linear` server, a claude.ai connector, a plugin-bundled server) and
whichever verb generation the server exposes (`save_*`, or `create_*`/`update_*`
on older servers). The same regex is re-checked here, so a broader matcher in a
project's own settings cannot make this script misread an unrelated tool.

Contract (Claude Code hooks):
  - stdin  : JSON with tool_name and tool_input (the MCP call's arguments).
  - stdout : a PreToolUse hookSpecificOutput.
             A violation  -> permissionDecision = "deny" whose reason quotes the
                             rule; the model reads it and re-issues the call.
             A footgun    -> permissionDecision = "allow" + additionalContext,
                             a warning the model reads (not shown in chat).
  - exit 0 : always — same contract as check_destructive.py. The decision is
             carried in the JSON payload; a non-zero exit would surface as a
             hook error, not a clean deny. Unparseable input -> pass (fail open:
             never block normal work on a parse error).

Rules enforced — a copy of the Linear workspace rule, carried here so the guard
works on a machine where the user-level rule file is absent:

  §1   Every issue MUST belong to a Project. An issue with no project is a
       defect, not a valid state.
  §1   Every Project MUST belong to exactly one Initiative. Zero = invisible
       in roadmap views; two = ambiguous ownership.
  §3   `labels` on a project is SET semantics, not append — fetch the existing
       labels and pass the full list, or you drop the others. An unknown label
       name is silently dropped (the project saves with labels: [], no error).
       Always re-read the project after saving to confirm.
  §4.1 Assign the Project at creation time. Never file first and sort later.

Decisions:
  deny : issue creation without `project`; any issue save with `project: null`
         (an explicit unfiling); project creation without exactly one
         initiative (`addInitiatives` / `setInitiatives`, or an `initiative*`
         argument on older servers); any project save with `setInitiatives`
         holding zero or more than one entry.
  warn : any project save carrying `labels` (SET semantics), or
         `removeInitiatives` (may leave the project in zero initiatives).
  pass : everything else.

Requires: Python 3 on PATH.
"""
import json
import re
import sys

TOOL_RE = re.compile(r"^mcp__.*[Ll]inear.*__(save|create|update)_(issue|project)$")

# --- Rule text (quoted verbatim in every decision) ---------------------------
RULE_ISSUE_PROJECT = (
    'Linear workspace rule §1: "Every issue MUST belong to a Project. An issue '
    'with no project is a defect, not a valid state." '
    '§4.1: "Assign the Project at creation time. Never file first and sort later."'
)
RULE_PROJECT_INITIATIVE = (
    'Linear workspace rule §1: "Every Project MUST belong to exactly one '
    'Initiative." A project in zero initiatives is invisible in roadmap views; '
    "a project in two is ambiguous ownership."
)
RULE_LABELS_SET = (
    "Linear workspace rule §3: `labels` on a project is SET semantics, not "
    "append — fetch the project's existing labels and pass the FULL list, or "
    "the ones you omit are dropped. An unknown label name is silently dropped "
    "(the project saves with labels: [], no error). Re-read the project after "
    "saving to confirm the label set."
)
RULE_REMOVE_INITIATIVES = (
    "`removeInitiatives` may leave the project in zero initiatives (rule §1: "
    "exactly one). Re-read the project after saving and confirm it still "
    "belongs to exactly one initiative."
)

# Argument names that carry a project's initiative across server generations.
INITIATIVE_KEYS = (
    "addInitiatives", "setInitiatives", "initiatives",
    "initiative", "initiativeId", "initiativeIds",
)
PROJECT_KEYS = ("project", "projectId")


def _present(value) -> bool:
    """True for a non-empty string / list / dict, or any other non-None value."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def _count(value) -> int:
    """Number of entries in a list-or-scalar initiative argument."""
    if isinstance(value, list):
        return len(value)
    return 1 if _present(value) else 0


def _deny(rule: str, hint: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"BLOCKED by the Linear filing guard. {rule} {hint}"
            ),
        }
    }))


def _warn(text: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "additionalContext": f"Linear filing guard warning: {text}",
        }
    }))


def _check_issue(args: dict, creating: bool) -> None:
    if "project" in args and args["project"] is None:
        _deny(RULE_ISSUE_PROJECT,
              "Do not remove the project (`project: null`); move the issue to "
              "the correct project instead (`project: <name|id>`).")
        return
    if creating and not any(_present(args.get(k)) for k in PROJECT_KEYS):
        _deny(RULE_ISSUE_PROJECT,
              "Re-issue the call with `project: <project name|id>` — map by the "
              "title's workstream prefix, verified against the live project "
              "inventory (never by ticket-number adjacency). If no project "
              "fits, create one inside the right initiative first; never file "
              "an issue without a project.")
        return


def _check_project(args: dict, creating: bool) -> None:
    if "setInitiatives" in args and _count(args["setInitiatives"]) != 1:
        _deny(RULE_PROJECT_INITIATIVE,
              f"`setInitiatives` holds {_count(args['setInitiatives'])} "
              "initiatives; pass exactly one.")
        return
    if creating:
        given = sum(_count(args.get(k)) for k in INITIATIVE_KEYS)
        if given == 0:
            _deny(RULE_PROJECT_INITIATIVE,
                  "Re-issue the call with `addInitiatives: [<initiative "
                  "name|id>]` — pick the initiative by domain (which body of "
                  "work is this?), reading the live initiative list, never a "
                  "hardcoded table.")
            return
        if given > 1:
            _deny(RULE_PROJECT_INITIATIVE,
                  f"{given} initiatives were passed; a project belongs to "
                  "exactly one.")
            return

    warnings = []
    if "labels" in args:
        warnings.append(RULE_LABELS_SET)
    if _present(args.get("removeInitiatives")):
        warnings.append(RULE_REMOVE_INITIATIVES)
    if warnings:
        _warn(" ".join(warnings))


def main() -> int:
    try:
        hook_input = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    if not isinstance(hook_input, dict):
        return 0

    match = TOOL_RE.match(str(hook_input.get("tool_name", "")))
    if not match:
        return 0
    verb, kind = match.group(1), match.group(2)

    args = hook_input.get("tool_input")
    if not isinstance(args, dict):
        return 0

    # `save_*` without an id creates; `create_*` always creates; `update_*` never.
    creating = verb == "create" or (verb == "save" and not _present(args.get("id")))

    if kind == "issue":
        _check_issue(args, creating)
    else:
        _check_project(args, creating)
    return 0


if __name__ == "__main__":
    sys.exit(main())
