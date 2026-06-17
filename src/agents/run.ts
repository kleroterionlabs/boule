// src/agents/run.ts — owns the query() loop; reads result cost/usage; budget is SDK-enforced.
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunResult, StopReason } from "../core/types.js";
import { CostMeter } from "../observability/cost.js";
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

function stopReasonOf(subtype: string): StopReason {
  if (subtype === "success") return "success";
  if (subtype === "error_max_turns") return "error_max_turns";
  if (subtype === "error_max_budget_usd") return "error_max_budget_usd";
  return "error_during_execution";
}

/** Drive one query() to completion, returning a normalized AgentRunResult. */
export async function runAgent(args: RunArgs): Promise<AgentRunResult> {
  const meter = new CostMeter();
  let stopReason: StopReason = "error_during_execution";
  let numTurns = 0;
  let sessionId = "";
  const errors: string[] = [];
  let gotResult = false;

  try {
    for await (const msg of query({ prompt: args.prompt, options: args.options })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        args.log.info({ sessionId }, "agent run started");
        args.onSession?.(sessionId);
      }
      if (msg.type === "result") {
        stopReason = stopReasonOf(msg.subtype);
        numTurns = msg.num_turns;
        meter.record(msg.total_cost_usd, msg.modelUsage ?? {});
        if (msg.subtype !== "success") errors.push(...(msg.errors ?? []));
        gotResult = true;
        args.log.info({ stopReason, costUsd: msg.total_cost_usd, numTurns }, "agent run finished");
      }
    }
  } catch (err) {
    // The SDK's Claude Code subprocess can exit non-zero on teardown AFTER delivering a terminal
    // result message — that transport noise must not override a run whose outcome is already known.
    // A failure BEFORE any result is real: record it and report the run as failed (don't rethrow,
    // so the CLI exits via result.ok rather than an unhandled crash that aborts later pipeline steps).
    const message = err instanceof Error ? err.message : String(err);
    if (gotResult) {
      args.log.warn({ err: message }, "agent transport error after result; keeping captured outcome");
    } else {
      args.log.error({ err: message }, "agent run failed before producing a result");
      errors.push(message);
      stopReason = "error_during_execution";
    }
  }

  return {
    ok: stopReason === "success",
    runId: args.runId,
    ...(sessionId ? { sessionId } : {}),
    workflow: args.workflow,
    artifactsPlanned: 0, // populated below from the ledger
    artifactsWritten: [], // populated below from the ledger
    skippedDuplicates: [],
    metrics: emptyMetrics(),
    costUsd: meter.totalUsd,
    modelUsage: meter.byModel(),
    numTurns,
    stopReason,
    errors,
  };
}
