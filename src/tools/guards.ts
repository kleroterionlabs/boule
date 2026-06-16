// src/tools/guards.ts — the single chokepoint where autonomy guardrails are enforced (deterministic).
import type { CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../observability/logger.js";

export interface GuardState {
  dryRun: boolean;
  halted: boolean;
  writes: number;
  maxWrites: number;
  log: Logger;
}

const WRITE_TOOLS = new Set([
  "mcp__github__gh_upsert_issue",
  "mcp__github__gh_link_sub_issue",
  "mcp__github__gh_project_set_fields",
  "mcp__github__gh_post_discussion",
]);

export const isWrite = (name: string): boolean => WRITE_TOOLS.has(name);

/** Programmatic allow/deny + arg-rewrite gate passed to query({ canUseTool }). */
export function makeCanUseTool(state: GuardState): CanUseTool {
  return async (toolName, input) => {
    if (!isWrite(toolName)) return { behavior: "allow", updatedInput: input };
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
    state.log.info({ event: "pre_tool_use", tool, dryRun: state.dryRun }, "tool invocation");
    return { continue: true };
  };
}
