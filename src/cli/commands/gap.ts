// src/cli/commands/gap.ts — gap analysis: desired vs current state → prioritized Gap issues.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerGap(program: Command): void {
  program
    .command("gap [design]")
    .description(
      "Gap analysis: desired (design/requirements) vs current (repo/issues) → prioritized Gap issues.",
    )
    .action(async (design: string | undefined, _local: unknown, cmd: Command) => {
      const scope = design ? ` for Design "${design}"` : " across the repository";
      const prompt = [
        `Perform a gap analysis${scope}.`,
        "Use the repo-scout agent to assess the current state, the gap-analyst agent to compare it",
        "against the desired state and produce a prioritized (RICE / MoSCoW) gap-closing backlog,",
        "then the issue-project-manager to upsert Gap issues (idempotent on boule-id) linked to the",
        "requirements they close.",
      ].join("\n");
      await runWorkflow(globals(cmd), "gap", prompt);
    });
}
