// src/agents/registry.ts — the agent fleet, built from the editable prompts in src/agents/prompts/*.md
// (compiled into prompts.generated.ts). Model tiering is config here, never in workflow logic.
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config/schema.js";
import { AGENT_SPECS } from "./prompts.generated.js";

const FIND = "mcp__github__gh_find_issue";
const LIST = "mcp__github__gh_list_issues";
const LIST_ITEMS = "mcp__github__gh_list_project_items";
const READ_TOOLS = [FIND, LIST, LIST_ITEMS];
const WRITE_TOOLS = [
  "mcp__github__gh_upsert_issue",
  "mcp__github__gh_link_sub_issue",
  "mcp__github__gh_project_set_fields",
  "mcp__github__gh_post_discussion",
  "mcp__github__gh_close_issue",
  "mcp__github__gh_remove_project_item",
  "mcp__github__gh_set_status",
  "mcp__github__gh_add_dependency",
];

/**
 * Authoritative per-agent tool grants (full MCP tool names). Only the issue-project-manager
 * holds write tools; everyone else is read/research-only. This is the enforced boundary — the
 * prompt frontmatter is advisory.
 */
const TOOLS_BY_KEY: Record<string, string[]> = {
  "repo-scout": ["Read", "Grep", "Glob", ...READ_TOOLS],
  "product-designer": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", ...READ_TOOLS],
  "requirements-engineer": ["Read", "Grep", "Glob", ...READ_TOOLS],
  "competitive-analyst": ["Read", "Grep", "WebSearch", "WebFetch", ...READ_TOOLS],
  "gap-analyst": ["Read", "Grep", "Glob", ...READ_TOOLS],
  "critic-reviewer": ["Read", "Grep", ...READ_TOOLS],
  "issue-project-manager": ["Read", ...READ_TOOLS, ...WRITE_TOOLS],
};

/** Subagents the orchestrator may delegate to (everything except the orchestrator itself). */
const SUBAGENT_KEYS = Object.keys(TOOLS_BY_KEY);

/**
 * Build the agents map passed to query({ agents }). The issue-project-manager is the only
 * agent granted write tools — every other agent is read/research-only (see guards.ts).
 */
export function buildAgents(_cfg: Config): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {};
  for (const key of SUBAGENT_KEYS) {
    const spec = AGENT_SPECS[key];
    const tools = TOOLS_BY_KEY[key];
    if (!spec || !tools) continue;
    out[key] = {
      description: spec.description,
      prompt: spec.systemPrompt,
      // Pin the EXACT model id (e.g. claude-sonnet-4-6). The SDK's AgentDefinition type narrows
      // `model` to tier aliases ('sonnet'|'opus'|'haiku'), and those aliases resolve to the
      // 4.5-series — so we pass the full id (the runtime accepts it, as the top-level option does).
      model: spec.model as unknown as AgentDefinition["model"],
      tools,
    };
  }
  return out;
}

/** The orchestrator's operating rules, appended to the claude_code system-prompt preset. */
export function orchestratorPrompt(): string {
  return AGENT_SPECS.orchestrator?.systemPrompt ?? "";
}
