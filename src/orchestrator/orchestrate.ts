// src/orchestrator/orchestrate.ts — imperative shell wiring; selects a workflow and drives runAgent.
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { ulid } from "ulid";
import { buildAgents, orchestratorPrompt } from "../agents/registry.js";
import { runAgent } from "../agents/run.js";
import { resolveAuth } from "../config/auth.js";
import type { Config } from "../config/schema.js";
import type { AgentRunResult } from "../core/types.js";
import { createGitHubClient } from "../github/client.js";
import { isHalted } from "../github/issues.js";
import { buildRepoContext } from "../github/resolve.js";
import { Ledger, emptyMetrics } from "../observability/ledger.js";
import { createLogger } from "../observability/logger.js";
import { loadCheckpoint, persistRun, saveCheckpoint } from "../state/runStore.js";
import { type ToolContext, createGithubMcpServer } from "../tools/githubTools.js";
import { makeAuditHook, makeCanUseTool } from "../tools/guards.js";
import { resumePrompt } from "./resume.js";

export interface OrchestrateArgs {
  cfg: Config;
  env: NodeJS.ProcessEnv;
  workflow: string;
  prompt: string;
  /** Resume a prior run by its id: restores the SDK session and continues the same workflow. */
  resume?: string;
}

export async function orchestrate(args: OrchestrateArgs): Promise<AgentRunResult> {
  const runId = ulid();
  const dryRun = args.cfg.flags.dryRun;
  const log = createLogger(args.cfg, runId);

  // Resolve what to run. A resume reads workflow + original prompt + SDK session from a checkpoint.
  let workflow = args.workflow;
  let prompt = args.prompt;
  let checkpointPrompt = args.prompt; // the ORIGINAL instruction stored for any future re-resume
  let sdkResume: string | undefined;
  let resumedFrom: string | undefined;
  if (args.resume) {
    const cp = loadCheckpoint(args.resume);
    if (!cp) {
      return {
        ok: false,
        runId,
        workflow: args.workflow,
        artifactsPlanned: 0,
        artifactsWritten: [],
        skippedDuplicates: [],
        metrics: emptyMetrics(),
        costUsd: 0,
        modelUsage: {},
        numTurns: 0,
        stopReason: "error_during_execution",
        errors: [`no checkpoint for run ${args.resume} — cannot resume`],
      };
    }
    workflow = cp.workflow;
    checkpointPrompt = cp.prompt;
    prompt = resumePrompt(cp.workflow, cp.prompt);
    sdkResume = cp.sessionId;
    resumedFrom = args.resume;
    log.info({ resumedFrom, sessionId: sdkResume, workflow }, "resuming prior run");
  }

  const auth = resolveAuth(args.env);
  const gh = await createGitHubClient(auth, log);

  const rc = await buildRepoContext(gh, args.cfg, log);

  // Kill-switch: an open `boule:halt` issue stops the run before any model spend or writes.
  if (!dryRun && (await isHalted(gh, rc.owner, rc.name))) {
    log.warn("boule:halt is active — aborting. Close the boule:halt issue to resume.");
    return {
      ok: false,
      runId,
      workflow,
      artifactsPlanned: 0,
      artifactsWritten: [],
      skippedDuplicates: [],
      metrics: emptyMetrics(),
      costUsd: 0,
      modelUsage: {},
      numTurns: 0,
      stopReason: "halted",
      errors: ["boule:halt active — an open issue labeled boule:halt is blocking writes."],
    };
  }

  const ledger = new Ledger();
  const toolCtx: ToolContext = {
    gh,
    rc,
    runId,
    dryRun,
    ledger,
    log,
  };
  const ghServer = createGithubMcpServer(toolCtx);

  const guardState = {
    dryRun,
    halted: false,
    writes: 0,
    maxWrites: args.cfg.budgets.maxGithubWrites,
    log,
    // Live kill-switch: re-probe GitHub for an open boule:halt issue mid-run (throttled in the gate).
    checkHalt: () => isHalted(gh, rc.owner, rc.name),
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
    // Audit EVERY tool call (matcher ".*"), not just GitHub writes — a denied Bash/Write still gets logged.
    hooks: { PreToolUse: [{ matcher: ".*", hooks: [makeAuditHook(guardState)] }] },
    ...(sdkResume ? { resume: sdkResume } : {}),
  };

  // Checkpoint as soon as the SDK session exists, so even a crash/budget-halt mid-run is resumable.
  const result = await runAgent({
    runId,
    prompt,
    options,
    workflow,
    log,
    onSession: (sessionId) => {
      if (!dryRun) {
        saveCheckpoint({
          runId,
          sessionId,
          workflow,
          prompt: checkpointPrompt,
          status: "running",
          updatedAt: new Date().toISOString(),
        });
      }
    },
  });
  if (resumedFrom) result.resumedFrom = resumedFrom;

  // Fold the mutation ledger into the result: real writes + their counts come from what happened,
  // not from what an agent claimed. Persist a report unless this was a dry run (no writes to record).
  result.metrics = ledger.metrics();
  result.artifactsWritten = ledger.writtenRefs();
  result.artifactsPlanned = result.artifactsWritten.length + result.skippedDuplicates.length;
  if (!dryRun) {
    const reportPath = persistRun(runId, result, ledger);
    if (result.sessionId) {
      saveCheckpoint({
        runId,
        sessionId: result.sessionId,
        workflow,
        prompt: checkpointPrompt,
        status: result.ok ? "success" : "failed",
        stopReason: result.stopReason,
        updatedAt: new Date().toISOString(),
      });
    }
    log.info({ reportPath, metrics: result.metrics }, "run report written");
  }
  return result;
}
