// src/cli/commands/triage.ts — groom the backlog (intended for scheduled/CI runs).
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerTriage(program: Command): void {
  program
    .command("triage")
    .description("Groom the backlog: label/prioritize new issues, flag duplicates, surface blockers.")
    .action(async (_local: unknown, cmd: Command) => {
      const prompt = [
        "Triage the backlog: for each untriaged boule issue, assign Kind / Priority / RICE,",
        "detect likely duplicates (by boule-id and by content similarity), flag blockers, and",
        "update the board accordingly. Summarize what changed and why.",
      ].join("\n");
      await runWorkflow(globals(cmd), "triage", prompt);
    });
}
