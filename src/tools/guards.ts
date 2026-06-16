// src/tools/guards.ts — the single chokepoint where autonomy guardrails are enforced (deterministic).
import type { CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../observability/logger.js";
import { checkFetchUrl } from "../util/webfetch.js";

export interface GuardState {
  dryRun: boolean;
  halted: boolean;
  writes: number;
  maxWrites: number;
  log: Logger;
  /** Optional live halt probe (e.g. isHalted against GitHub); polled, throttled, before writes. */
  checkHalt?: () => Promise<boolean>;
}

const WRITE_TOOLS = new Set([
  "mcp__github__gh_upsert_issue",
  "mcp__github__gh_link_sub_issue",
  "mcp__github__gh_project_set_fields",
  "mcp__github__gh_post_discussion",
  "mcp__github__gh_close_issue",
  "mcp__github__gh_remove_project_item",
]);

// Boule's ONLY mutation path is the GitHub MCP tools. Shell and file mutation must never run — deny
// them defensively even if a future allowedTools change or a preset would expose them. (Read/Glob/Grep
// stay allowed for repo inspection; WebFetch is allowed for research but URL-gated — see below.)
const DENIED_TOOLS = new Set([
  "Bash",
  "BashOutput",
  "KillBash",
  "KillShell",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

export const isWrite = (name: string): boolean => WRITE_TOOLS.has(name);
export const isDenied = (name: string): boolean => DENIED_TOOLS.has(name);

/** Re-probe the halt switch at most once per this many writes (responsive, but not per-call chatty). */
const HALT_POLL_EVERY = 5;

/** Programmatic allow/deny + arg-rewrite gate passed to query({ canUseTool }). */
export function makeCanUseTool(state: GuardState): CanUseTool {
  return async (toolName, input) => {
    if (isDenied(toolName)) {
      state.log.warn({ toolName }, "denied: tool outside Boule's GitHub-only side-effect surface");
      return {
        behavior: "deny",
        message: `${toolName} is not permitted — Boule only writes via GitHub tools`,
      };
    }
    // WebFetch is read-only research egress, but URL-gated against SSRF and credential exfiltration.
    if (toolName === "WebFetch") {
      const verdict = checkFetchUrl((input as { url?: unknown }).url);
      if (!verdict.ok) {
        state.log.warn({ reason: verdict.reason }, "denied: unsafe WebFetch URL");
        return { behavior: "deny", message: `WebFetch denied: ${verdict.reason}` };
      }
      return { behavior: "allow", updatedInput: input };
    }
    if (!isWrite(toolName)) return { behavior: "allow", updatedInput: input };

    // Live kill-switch: poll (throttled) so a `boule:halt` opened mid-run takes effect within a few writes.
    if (!state.halted && state.checkHalt && state.writes % HALT_POLL_EVERY === 0) {
      try {
        if (await state.checkHalt()) state.halted = true;
      } catch (e) {
        state.log.warn({ err: String(e) }, "halt poll failed; continuing");
      }
    }
    if (state.halted) return { behavior: "deny", message: "boule:halt active" };
    if (state.dryRun) {
      // Dry-run is enforced inside the tool too; deny here keeps a hard second layer.
      state.log.info({ toolName }, "dry-run: write denied at gate");
      return { behavior: "deny", message: "dry-run: writes disabled" };
    }
    if (state.writes >= state.maxWrites) {
      return { behavior: "deny", message: `blast-radius cap reached (${state.maxWrites})` };
    }
    state.writes += 1;
    return { behavior: "allow", updatedInput: input };
  };
}

/** PreToolUse hook: independent audit layer (a bug in the gate can't silently bypass this). */
export function makeAuditHook(state: GuardState): HookCallback {
  return async (input) => {
    const tool = "tool_name" in input ? input.tool_name : input.hook_event_name;
    state.log.info(
      { event: "pre_tool_use", tool, dryRun: state.dryRun, write: isWrite(tool), denied: isDenied(tool) },
      "tool invocation",
    );
    return { continue: true };
  };
}
