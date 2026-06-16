// src/cli/commands/_shared.ts — common wiring so each verb file stays a thin prompt builder.
import type { Command } from "commander";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { makeEmitter } from "../../observability/events.js";
import { orchestrate } from "../../orchestrator/orchestrate.js";
import { renderRunSummary } from "../render.js";

export type GlobalFlags = CliFlags & { json?: boolean };

/** Merge this subcommand's options with the inherited global flags. */
export function globals(cmd: Command): GlobalFlags {
  return cmd.optsWithGlobals() as GlobalFlags;
}

/**
 * Load config, drive one orchestrator run for `workflow`, set the exit code.
 * --json streams NDJSON events (incl. the final result); otherwise renders a human summary.
 */
export async function runWorkflow(global: GlobalFlags, workflow: string, prompt: string): Promise<void> {
  const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global });
  const json = Boolean(global.json);
  const result = await orchestrate({ cfg, env: process.env, workflow, prompt, onEvent: makeEmitter(json) });
  if (!json) renderRunSummary(result, { json: false });
  if (!result.ok) {
    process.exitCode = result.stopReason === "error_max_budget_usd" ? 4 : 1;
  }
}
