// src/cli/commands/compete.ts — competitive analysis for a product space.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerCompete(program: Command): void {
  program
    .command("compete <space>")
    .description("Competitive analysis for a product space → Competitor issues + a feature matrix.")
    .option("--for <design>", "anchor the analysis to a specific Design issue")
    .action(async (space: string, local: { for?: string }, cmd: Command) => {
      const anchor = local.for ? ` Anchor the comparison to Design "${local.for}".` : "";
      const prompt = [
        `Run a competitive analysis for: ${space}.${anchor}`,
        "Delegate to the competitive-analyst agent: scope 3–7 relevant competitors, build a",
        "feature matrix and a positioning view (SWOT + feature-gap grid), and cite evidence.",
        "Then have the issue-project-manager upsert one Competitor issue per rival plus a summary",
        "issue, idempotent on boule-id.",
      ].join("\n");
      await runWorkflow(globals(cmd), "compete", prompt);
    });
}
