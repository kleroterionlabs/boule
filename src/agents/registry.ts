// src/agents/registry.ts — the agent fleet, built from the editable prompts in src/agents/prompts/*.md
// (compiled into prompts.generated.ts). Model tiering is config here, never in workflow logic.
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config/schema.js";
import { AGENT_SPECS, type AgentModelId } from "./prompts.generated.js";

/** The Agent SDK's AgentDefinition.model accepts tier aliases, not full model IDs. */
const MODEL_ALIAS: Record<AgentModelId, "opus" | "sonnet" | "haiku"> = {
  "claude-opus-4-8": "opus",
  "claude-sonnet-4-6": "sonnet",
  "claude-haiku-4-5": "haiku",
};

const FIND = "mcp__github__gh_find_issue";
const WRITE_TOOLS = [
  "mcp__github__gh_upsert_issue",
  "mcp__github__gh_link_sub_issue",
  "mcp__github__gh_project_set_fields",
  "mcp__github__gh_post_discussion",
];

/**
 * Authoritative per-agent tool grants (full MCP tool names). Only the issue-project-manager
 * holds write tools; everyone else is read/research-only. This is the enforced boundary — the
 * prompt frontmatter is advisory.
 */
const TOOLS_BY_KEY: Record<string, string[]> = {
  "repo-scout": ["Read", "Grep", "Glob", FIND],
  "product-designer": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", FIND],
  "requirements-engineer": ["Read", "Grep", "Glob", FIND],
  "competitive-analyst": ["Read", "Grep", "WebSearch", "WebFetch", FIND],
  "gap-analyst": ["Read", "Grep", "Glob", FIND],
  "critic-reviewer": ["Read", "Grep", FIND],
  "issue-project-manager": ["Read", FIND, ...WRITE_TOOLS],
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
      model: MODEL_ALIAS[spec.model] ?? "inherit",
      tools,
    };
  }
  return out;
}

/** The orchestrator's operating rules, appended to the claude_code system-prompt preset. */
export function orchestratorPrompt(): string {
  return AGENT_SPECS.orchestrator?.systemPrompt ?? "";
}
