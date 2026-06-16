import { readFileSync } from "node:fs";
// src/cli/commands/design.ts — one verb file → builds a WorkflowRequest and calls the orchestrator.
import type { Command } from "commander";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { orchestrate } from "../../orchestrator/orchestrate.js";
import { renderRunSummary } from "../render.js";

export function registerDesign(program: Command): void {
  program
    .command("design [idea]")
    .description("Produce a Product Design (PRD) issue from a one-line idea or a brief file.")
    .option("--brief <file>", "read the product brief from a file ('-' for stdin)")
    .action(async (idea: string | undefined, local: { brief?: string }, cmd: Command) => {
      const global = cmd.optsWithGlobals() as CliFlags & { json?: boolean };
      const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global });

      const brief = local.brief ? readFileSync(local.brief === "-" ? 0 : local.brief, "utf8") : (idea ?? "");
      if (!brief.trim()) throw Object.assign(new Error("provide an idea or --brief"), { name: "UsageError" });

      const prompt = [
        "Produce a Product Design (PRD) as a typed GitHub issue for the following idea.",
        "Delegate authoring to the product-designer agent, critique with the critic, then have the ipm",
        "agent upsert the Design issue (idempotent on boule-id). Enforce: explicit Non-Goals, JTBD job",
        "stories, numeric KPIs, and an autonomously-resolved Decision (with rationale) for every Open",
        "Question — defer nothing to a human.",
        "Boule is fully autonomous: on the critic's APPROVE, accept the design (status:accepted / board",
        "Ready) and CONTINUE in this same run — delegate the requirements-engineer to derive Requirement",
        "sub-issues, each critic-reviewed and accepted the same way. Stop only at the budget/turn cap or a",
        "genuine boule:needs-human blocker.",
        "",
        `IDEA / BRIEF:\n${brief}`,
      ].join("\n");

      const result = await orchestrate({ cfg, env: process.env, workflow: "design", prompt });
      renderRunSummary(result, { json: Boolean(global.json) });
      if (!result.ok) process.exitCode = result.stopReason === "error_max_budget_usd" ? 4 : 1;
    });
}
