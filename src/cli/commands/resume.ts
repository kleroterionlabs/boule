// src/cli/commands/resume.ts — continue a prior run from its checkpoint (restores the agent session).
import type { Command } from "commander";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { orchestrate } from "../../orchestrator/orchestrate.js";
import { loadCheckpoint } from "../../state/runStore.js";
import { renderRunSummary } from "../render.js";
import { globals } from "./_shared.js";

export function registerResume(program: Command): void {
  program
    .command("resume <runId>")
    .description(
      "Resume a prior run: restores the agent's session and completes any artifacts not yet written " +
        "(idempotent — already-written work is skipped). Use after a crash or budget halt.",
    )
    .action(async (runId: string, _opts: unknown, cmd: Command) => {
      const global = globals(cmd);
      const cp = loadCheckpoint(runId);
      if (!cp) {
        process.stderr.write(`No checkpoint for run ${runId} — nothing to resume.\n`);
        process.exitCode = 2;
        return;
      }
      if (cp.status === "success") {
        process.stdout.write(`Run ${runId} already completed successfully; resuming anyway.\n`);
      }
      const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global as CliFlags });
      const result = await orchestrate({
        cfg,
        env: process.env,
        workflow: cp.workflow,
        prompt: cp.prompt,
        resume: runId,
      });
      renderRunSummary(result, { json: Boolean(global.json) });
      if (!result.ok) {
        process.exitCode = result.stopReason === "error_max_budget_usd" ? 4 : 1;
      }
    });
}
