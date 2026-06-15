// src/agents/run.ts — owns the query() loop; reads result cost/usage; budget is SDK-enforced.
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunResult, StopReason } from "../core/types.js";
import { CostMeter } from "../observability/cost.js";
import type { Logger } from "../observability/logger.js";

export interface RunArgs {
  prompt: string;
  options: Options;
  workflow: string;
  log: Logger;
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
  const errors: string[] = [];

  for await (const msg of query({ prompt: args.prompt, options: args.options })) {
    if (msg.type === "system" && msg.subtype === "init") {
      args.log.info({ sessionId: msg.session_id }, "agent run started");
    }
    if (msg.type === "result") {
      stopReason = stopReasonOf(msg.subtype);
      numTurns = msg.num_turns;
      meter.record(msg.total_cost_usd, msg.modelUsage ?? {});
      if (msg.subtype !== "success") errors.push(...(msg.errors ?? []));
      args.log.info({ stopReason, costUsd: msg.total_cost_usd, numTurns }, "agent run finished");
    }
  }

  return {
    ok: stopReason === "success",
    workflow: args.workflow,
    artifactsPlanned: 0, // populated by the workflow from structuredContent
    artifactsWritten: [],
    skippedDuplicates: [],
    costUsd: meter.totalUsd,
    modelUsage: meter.byModel(),
    numTurns,
    stopReason,
    errors,
  };
}
