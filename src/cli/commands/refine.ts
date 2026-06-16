// src/cli/commands/refine.ts — improve ONE existing artifact in place (idempotent update on its boule-id).
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerRefine(program: Command): void {
  program
    .command("refine <bouleId>")
    .description(
      "Refine one existing artifact (by boule-id): re-review and update it in place — no duplicate.",
    )
    .option("-m, --message <text>", "the specific change to make (otherwise: general quality pass)")
    .action(async (bouleId: string, local: { message?: string }, cmd: Command) => {
      const change = local.message
        ? `Apply this specific change: ${local.message}`
        : "Improve clarity, completeness, and methodology conformance without changing intent.";
      const prompt = [
        `Refine the existing artifact whose boule-id is "${bouleId}".`,
        "1) Find it with gh_find_issue and read its current body. If no issue has that boule-id, report",
        "   that and stop — do not create anything.",
        "2) Have the appropriate specialist subagent revise the draft, then the critic review it.",
        `   ${change}`,
        "3) Persist via the issue-project-manager as an idempotent UPDATE on the same boule-id (the",
        "   content-hash changes → update-in-place + audit comment). Never create a duplicate.",
      ].join("\n");
      await runWorkflow(globals(cmd), "refine", prompt);
    });
}
