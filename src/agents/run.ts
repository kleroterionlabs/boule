// src/agents/run.ts — owns the query() loop; reads result cost/usage; budget is SDK-enforced.
// The resilient run-loop now lives in @kleroterion/koine (runQuery); this thin adapter maps koine's
// RunOutcome onto Boule's AgentRunResult, preserving the exact contract orchestrate.ts fills in later
// (the ledger placeholders: artifactsPlanned/artifactsWritten/skippedDuplicates/metrics).
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { runQuery } from "@kleroterion/koine";
import type { AgentRunResult } from "../core/types.js";
import { emptyMetrics } from "../observability/ledger.js";
import type { Logger } from "../observability/logger.js";

export interface RunArgs {
  runId: string;
  prompt: string;
  options: Options;
  workflow: string;
  log: Logger;
  /** Called once with the SDK session id (at init) so the caller can checkpoint for resume. */
  onSession?: (sessionId: string) => void;
}

/** Drive one query() to completion, returning a normalized AgentRunResult. */
export async function runAgent(args: RunArgs): Promise<AgentRunResult> {
  const outcome = await runQuery(args.prompt, args.options, {
    log: args.log,
    ...(args.onSession ? { onSession: args.onSession } : {}),
  });

  return {
    ok: outcome.ok,
    runId: args.runId,
    ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
    workflow: args.workflow,
    artifactsPlanned: 0, // populated below from the ledger
    artifactsWritten: [], // populated below from the ledger
    skippedDuplicates: [],
    metrics: emptyMetrics(),
    costUsd: outcome.costUsd,
    modelUsage: outcome.modelUsage,
    numTurns: outcome.numTurns,
    stopReason: outcome.stopReason,
    errors: outcome.errors,
  };
}
