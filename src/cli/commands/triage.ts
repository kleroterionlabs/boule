// src/cli/commands/triage.ts — groom the backlog (intended for scheduled/CI runs).
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerTriage(program: Command): void {
  program
    .command("triage")
    .description("Groom the backlog: label/prioritize new issues, flag duplicates, surface blockers.")
    .option("--since <date>", "only triage issues updated on/after this date (YYYY-MM-DD)")
    .option("--assign", "also propose assignees/owners for actionable items", false)
    .option("--dedupe", "focus on detecting and closing duplicate issues", false)
    .action(async (local: { since?: string; assign?: boolean; dedupe?: boolean }, cmd: Command) => {
      const prompt = [
        "Triage the backlog: for each untriaged boule issue, assign Kind / Priority / RICE,",
        "detect likely duplicates (by boule-id and by content similarity), flag blockers, and",
        "update the board accordingly. Summarize what changed and why.",
        local.since ? `Only consider issues updated on or after ${local.since}.` : "",
        local.assign ? "Also propose assignees/owners for items that are ready to be worked." : "",
        local.dedupe
          ? "Prioritize de-duplication: when two issues describe the same artifact, keep the canonical one and close the rest with a cross-link and an audit note."
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      await runWorkflow(globals(cmd), "triage", prompt);
    });
}
