// src/cli/commands/daily.ts — post the daily status standup as a GitHub Discussion (the "dashboard").
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerDaily(program: Command): void {
  program
    .command("daily")
    .description(
      "Post today's status standup to the 'Daily Status' Discussion category (the Boule dashboard).",
    )
    .action(async (_local: unknown, cmd: Command) => {
      const prompt = [
        "Compose and post today's daily status to the 'Daily Status' Discussion category:",
        "yesterday's completed work, today's in-flight items, blockers, board metrics, and notable",
        "agent activity. Use the issue-project-manager to create the discussion. Exactly one post per",
        "day — if today's post already exists, update it (idempotent).",
      ].join("\n");
      await runWorkflow(globals(cmd), "daily", prompt);
    });
}
