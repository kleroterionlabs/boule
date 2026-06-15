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

/** Subagents the orchestrator may delegate to (everything except the orchestrator itself). */
const SUBAGENT_KEYS = [
  "repo-scout",
  "product-designer",
  "requirements-engineer",
  "competitive-analyst",
  "gap-analyst",
  "issue-project-manager",
  "critic-reviewer",
] as const;

/**
 * Build the agents map passed to query({ agents }). The issue-project-manager is the only
 * agent granted write tools — every other agent is read/research-only (see guards.ts).
 */
export function buildAgents(_cfg: Config): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {};
  for (const key of SUBAGENT_KEYS) {
    const spec = AGENT_SPECS[key];
    if (!spec) continue;
    out[key] = {
      description: spec.description,
      prompt: spec.systemPrompt,
      model: MODEL_ALIAS[spec.model] ?? "inherit",
      tools: spec.allowedTools,
    };
  }
  return out;
}

/** The orchestrator's operating rules, appended to the claude_code system-prompt preset. */
export function orchestratorPrompt(): string {
  return AGENT_SPECS.orchestrator?.systemPrompt ?? "";
}
