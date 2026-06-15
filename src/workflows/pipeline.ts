// src/workflows/pipeline.ts — orchestrator is dumb & deterministic; stages are smart & agentic.
import type { IssueRef } from "../core/types.js";
import type { Logger } from "../observability/logger.js";

export interface RunContext {
  runId: string;
  repo: string;
  projectNumber?: number;
  budgetUsdRemaining: number;
  dryRun: boolean;
  artifacts: Record<string, IssueRef>; // keyed by bouleId, accumulates across stages
  log: Logger;
}

export interface StageResult {
  produced: { bouleId: string; ref: IssueRef }[];
  costUsd: number;
}

export interface Stage {
  name: string;
  /** Upstream bouleIds this stage consumes (drives checkpoint freshness). */
  dependsOn: (ctx: RunContext) => string[];
  run: (ctx: RunContext) => Promise<StageResult>;
}

export class BudgetExceededError extends Error {}

/** Fold over stages: the single place skip/run/budget decisions are made. */
export async function runPipeline(stages: Stage[], ctx: RunContext): Promise<RunContext> {
  for (const stage of stages) {
    if (ctx.budgetUsdRemaining <= 0) {
      ctx.log.warn({ stage: stage.name }, "budget exhausted; stopping");
      break;
    }
    ctx.log.info({ stage: stage.name, deps: stage.dependsOn(ctx) }, "stage start");
    try {
      const result = await stage.run(ctx);
      for (const p of result.produced) ctx.artifacts[p.bouleId] = p.ref;
      ctx.budgetUsdRemaining -= result.costUsd;
      ctx.log.info({ stage: stage.name, produced: result.produced.length }, "stage done");
    } catch (err) {
      ctx.log.error({ stage: stage.name, err: String(err) }, "stage failed; halting (resumable)");
      throw err; // checkpoint/resume handled by the runner caller per failure policy
    }
  }
  return ctx;
}
