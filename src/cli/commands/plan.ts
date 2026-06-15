// src/cli/commands/plan.ts — decompose a Design into Epics/Features/Tasks and populate the board.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerPlan(program: Command): void {
  program
    .command("plan <design>")
    .description("Decompose a Design into Epics → Features → Tasks and populate the Projects v2 board.")
    .action(async (design: string, _local: unknown, cmd: Command) => {
      const prompt = [
        `Decompose Design "${design}" into a work breakdown: Epics → Features → Tasks,`,
        "each with an estimate and a RICE score. Have the issue-project-manager create the issue",
        "hierarchy via native sub-issues and add every item to the Projects v2 board with",
        "Status / Kind / Priority / RICE fields set. Idempotent on boule-id.",
      ].join("\n");
      await runWorkflow(globals(cmd), "plan", prompt);
    });
}
