// src/orchestrator/orchestrate.ts — imperative shell wiring; selects a workflow and drives runAgent.
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { ulid } from "ulid";
import { buildAgents, orchestratorPrompt } from "../agents/registry.js";
import { runAgent } from "../agents/run.js";
import { resolveAuth } from "../config/auth.js";
import type { Config } from "../config/schema.js";
import type { AgentRunResult } from "../core/types.js";
import { createGitHubClient } from "../github/client.js";
import { buildRepoContext } from "../github/resolve.js";
import { createLogger } from "../observability/logger.js";
import { type ToolContext, createGithubMcpServer } from "../tools/githubTools.js";
import { makeAuditHook, makeCanUseTool } from "../tools/guards.js";

export interface OrchestrateArgs {
  cfg: Config;
  env: NodeJS.ProcessEnv;
  workflow: string;
  prompt: string;
}

export async function orchestrate(args: OrchestrateArgs): Promise<AgentRunResult> {
  const runId = ulid();
  const log = createLogger(args.cfg, runId);
  const auth = resolveAuth(args.env);
  const gh = await createGitHubClient(auth, log);

  const rc = await buildRepoContext(gh, args.cfg, log);

  const toolCtx: ToolContext = {
    gh,
    rc,
    runId,
    dryRun: args.cfg.flags.dryRun,
    log,
  };
  const ghServer = createGithubMcpServer(toolCtx);

  const guardState = {
    dryRun: args.cfg.flags.dryRun,
    halted: false,
    writes: 0,
    maxWrites: args.cfg.budgets.maxGithubWrites,
    log,
  };

  const options: Options = {
    model: args.cfg.models.orchestrator,
    fallbackModel: args.cfg.models.subagent,
    maxTurns: args.cfg.budgets.maxTurns,
    maxBudgetUsd: args.cfg.budgets.usdPerRun, // ENFORCED hard cap
    cwd: process.cwd(),
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: orchestratorPrompt() },
    permissionMode: "default",
    allowedTools: ["Agent", "Read", "Glob", "Grep", "TodoWrite", "mcp__github__gh_find_issue"],
    mcpServers: { github: ghServer },
    agents: buildAgents(args.cfg),
    canUseTool: makeCanUseTool(guardState),
    hooks: { PreToolUse: [{ matcher: "mcp__github__.*", hooks: [makeAuditHook(guardState)] }] },
  };

  return runAgent({ prompt: args.prompt, options, workflow: args.workflow, log });
}
