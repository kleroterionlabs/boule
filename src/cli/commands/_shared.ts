// src/cli/commands/_shared.ts — common wiring so each verb file stays a thin prompt builder.
import type { Command } from "commander";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { orchestrate } from "../../orchestrator/orchestrate.js";
import { renderRunSummary } from "../render.js";

export type GlobalFlags = CliFlags & { json?: boolean };

/** Merge this subcommand's options with the inherited global flags. */
export function globals(cmd: Command): GlobalFlags {
  return cmd.optsWithGlobals() as GlobalFlags;
}

/** Load config, drive one orchestrator run for `workflow`, render the result, set the exit code. */
export async function runWorkflow(global: GlobalFlags, workflow: string, prompt: string): Promise<void> {
  const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global });
  const result = await orchestrate({ cfg, env: process.env, workflow, prompt });
  renderRunSummary(result, { json: Boolean(global.json) });
  if (!result.ok) {
    process.exitCode = result.stopReason === "error_max_budget_usd" ? 4 : 1;
  }
}
